/* vaer — værmelding for stedene på en tur.
 *
 * Kjører på serveren av to grunner: Yr krever at den som spør identifiserer
 * seg med et User-Agent-felt, og det kan en nettside ikke sette selv. Og vi
 * vil mellomlagre svarene, så ikke 28 elever spør Yr hver for seg.
 *
 * Adresser gjøres om til koordinater én gang per sted og lagres. Finner vi
 * ikke stedet, blir koordinatene stående tomme — da viser appen ingen vær
 * i stedet for feil vær.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

// Yr ber om at den som kaller oppgir hvem det er og hvordan de nås.
const AGENT = "Turkompis/1.0 (https://github.com/Jonasmix/turkompis)";
const FERSK_MIN = 60;          // hvor lenge en værmelding regnes som fersk
const MAKS_OPPSLAG = 8;        // adresseoppslag per forespørsel

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const svar = (kropp: unknown, status = 200) =>
  new Response(JSON.stringify(kropp), {
    status, headers: { ...cors, "Content-Type": "application/json" }
  });

const rund = (n: number) => Math.round(n * 1000) / 1000;
const sov = (ms: number) => new Promise(r => setTimeout(r, ms));

/* Adresse → koordinat. Nominatim tåler ett oppslag i sekundet. */
async function finnPunkt(sok: string): Promise<{ lat: number; lon: number } | null> {
  const url = "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" +
    encodeURIComponent(sok);
  try {
    const r = await fetch(url, { headers: { "User-Agent": AGENT, "Accept-Language": "no,en" } });
    if (!r.ok) return null;
    const t = await r.json();
    if (!Array.isArray(t) || !t.length) return null;
    return { lat: rund(Number(t[0].lat)), lon: rund(Number(t[0].lon)) };
  } catch { return null; }
}

/* Koordinat → værmelding, med mellomlager i basen. */
async function hentVaer(db: ReturnType<typeof createClient>, lat: number, lon: number) {
  const la = rund(lat), lo = rund(lon);

  const { data: lagret } = await db
    .from("forecasts").select("data, fetched_at").eq("lat", la).eq("lon", lo).maybeSingle();

  if (lagret) {
    const alder = (Date.now() - new Date(lagret.fetched_at).getTime()) / 60000;
    if (alder < FERSK_MIN) return lagret.data;
  }

  try {
    const r = await fetch(
      `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${la}&lon=${lo}`,
      { headers: { "User-Agent": AGENT } }
    );
    if (!r.ok) return lagret ? lagret.data : null;   // heller gammelt enn ingenting
    const full = await r.json();

    // Bare det vi bruker: ett punkt per time, symbol og temperatur.
    const timer = (full?.properties?.timeseries || []).slice(0, 200).map(
      (t: { time: string; data: Record<string, unknown> }) => ({
        t: t.time,
        temp: (t.data as { instant?: { details?: { air_temperature?: number } } })
          ?.instant?.details?.air_temperature ?? null,
        sym: (t.data as { next_1_hours?: { summary?: { symbol_code?: string } };
                          next_6_hours?: { summary?: { symbol_code?: string } } })
          ?.next_1_hours?.summary?.symbol_code
          ?? (t.data as { next_6_hours?: { summary?: { symbol_code?: string } } })
            ?.next_6_hours?.summary?.symbol_code ?? null
      })
    );

    const slank = { timer };
    await db.from("forecasts").upsert({ lat: la, lon: lo, data: slank, fetched_at: new Date().toISOString() });
    return slank;
  } catch {
    return lagret ? lagret.data : null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return svar({ feil: "Bare POST." }, 405);

  const auth = req.headers.get("Authorization");
  if (!auth) return svar({ feil: "Ikke innlogget." }, 401);

  let kropp: { tripId?: string };
  try { kropp = await req.json(); } catch { return svar({ feil: "Ugyldig forespørsel." }, 400); }
  const tripId = kropp.tripId;
  if (!tripId) return svar({ feil: "Mangler tur." }, 400);

  const url = Deno.env.get("SUPABASE_URL")!;
  const somBruker = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } }
  });

  // Er den som spør med på turen? Radsikkerheten svarer.
  const { data: steder, error } = await somBruker
    .from("places").select("id, name, addr, lat, lon").eq("trip_id", tripId);
  if (error) return svar({ feil: "Fikk ikke lest stedene." }, 403);
  if (!steder || !steder.length) return svar({ vaer: {} });

  // Skriving av koordinater går utenom radsikkerheten, fordi også deltakere
  // skal få vær. Den eneste endringen som gjøres er lat/lon på steder som
  // hører til turen brukeren nettopp fikk lese.
  const tjener = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let oppslag = 0;
  const ut: Record<string, unknown> = {};

  for (const s of steder) {
    let lat = s.lat, lon = s.lon;

    if ((lat == null || lon == null) && s.addr && oppslag < MAKS_OPPSLAG) {
      oppslag++;
      if (oppslag > 1) await sov(1100);           // Nominatim: ett per sekund
      const punkt = await finnPunkt(`${s.name}, ${s.addr}`) || await finnPunkt(s.addr);
      if (punkt) {
        lat = punkt.lat; lon = punkt.lon;
        await tjener.from("places").update({ lat, lon }).eq("id", s.id).eq("trip_id", tripId);
      }
    }

    if (lat == null || lon == null) continue;
    const v = await hentVaer(tjener, lat, lon);
    if (v) ut[s.id] = v;
  }

  return svar({ vaer: ut });
});
