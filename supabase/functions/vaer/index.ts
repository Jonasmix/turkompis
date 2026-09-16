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
const AGENT = "TourFlow/1.0 (https://github.com/TourFlowUB/tourflow)";
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

/* Én av dem som spør samtidig får hente; resten får det som ligger der.
   Reservasjonen er selve raden: vi setter fetched_at fram, men bare hvis
   den fortsatt står på den verdien vi leste. Taper vi kappløpet, rører vi
   ingenting. Uten dette ville hundre telefoner på samme buss ha sendt
   hundre like spørsmål til Yr i samme sekund. */
async function reserver(
  db: ReturnType<typeof createClient>, la: number, lo: number, forrige: string | null
) {
  if (forrige) {
    const { data } = await db.from("forecasts")
      .update({ fetched_at: new Date().toISOString() })
      .eq("lat", la).eq("lon", lo).eq("fetched_at", forrige).select("lat");
    return Boolean(data && data.length);
  }
  const { error } = await db.from("forecasts")
    .insert({ lat: la, lon: lo, data: { timer: [] }, fetched_at: new Date().toISOString() });
  return !error;                      // krasj med en annen = noen kom først
}

/* Gikk hentingen galt, slipper vi reservasjonen igjen. Ellers ville et
   bomtur mot Yr ha låst stedet i en time. */
async function frigi(
  db: ReturnType<typeof createClient>, la: number, lo: number, forrige: string | null
) {
  if (forrige) {
    await db.from("forecasts").update({ fetched_at: forrige }).eq("lat", la).eq("lon", lo);
  } else {
    await db.from("forecasts").delete().eq("lat", la).eq("lon", lo);
  }
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

  const forrige = lagret ? String(lagret.fetched_at) : null;
  if (!await reserver(db, la, lo, forrige)) return lagret ? lagret.data : null;

  try {
    const r = await fetch(
      `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${la}&lon=${lo}`,
      { headers: { "User-Agent": AGENT } }
    );
    if (!r.ok) {                                     // heller gammelt enn ingenting
      await frigi(db, la, lo, forrige);
      return lagret ? lagret.data : null;
    }
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
    await frigi(db, la, lo, forrige);
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

  // Adresse → koordinat slås bare opp av reiseledere. Nominatim tillater
  // ett oppslag i sekundet for hele appen; med hundre deltakere som åpner
  // appen på samme buss ville vi sendt hundre like oppslag og blitt stengt
  // ute. Deltakerne får været for stedene som alt har koordinater, og det
  // er reiselederen som ser «Må ordnes»-lista uansett.
  let kanSlaaOpp = false;
  const { data: meg } = await somBruker.auth.getUser();
  if (meg?.user) {
    const { data: rad } = await somBruker.from("members")
      .select("role").eq("trip_id", tripId).eq("user_id", meg.user.id).maybeSingle();
    kanSlaaOpp = rad?.role === "leader" || rad?.role === "admin";
  }

  let oppslag = 0;
  const ut: Record<string, unknown> = {};

  for (const s of steder) {
    let lat = s.lat, lon = s.lon;

    if (kanSlaaOpp && (lat == null || lon == null) && s.addr && oppslag < MAKS_OPPSLAG) {
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
