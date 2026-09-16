/* varsle — sender push-varsel om en ny melding.
 *
 * Kalles av appen til den som nettopp skrev. Funksjonen sjekker at det
 * faktisk er hen som skrev meldingen, finner ut hvem som skal ha varsel,
 * og sender. Ingenting av dette kan gjøres i nettleseren: den hemmelige
 * VAPID-nøkkelen må ligge på serveren, og én deltaker skal ikke kunne se
 * hvem andre som er varslet.
 *
 * Hva hver enkelt får, bestemmer de selv (tabellen varselvalg):
 *   alt    — hver melding i chatten
 *   viktig — reiseledere, svar på dine egne meldinger, og meldinger som
 *            avtaler et møtested. Dette er standard.
 *   ingen  — ingenting
 *
 * En admin regnes som vanlig deltaker her. Ellers ville den skjulte
 * rollen røpet seg ved at folk fikk varsel om alt hen skrev.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";
import * as webpush from "jsr:@negrel/webpush@0.5.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const svar = (kropp: unknown, status = 200) =>
  new Response(JSON.stringify(kropp), {
    status, headers: { ...cors, "Content-Type": "application/json" }
  });

const TOM = "00000000-0000-0000-0000-000000000000";

let server: webpush.ApplicationServer | null = null;

async function appServer() {
  if (server) return server;
  const raa = Deno.env.get("VAPID_KEYS");
  if (!raa) throw new Error("VAPID_KEYS mangler under Edge Functions → Secrets.");

  let noekler;
  try { noekler = JSON.parse(raa); }
  catch { throw new Error("VAPID_KEYS er ikke gyldig JSON. Lim inn hele filen på én linje."); }
  if (!noekler?.publicKey || !noekler?.privateKey) {
    throw new Error("VAPID_KEYS mangler publicKey eller privateKey.");
  }

  try {
    server = await webpush.ApplicationServer.new({
      contactInformation: "mailto:" + (Deno.env.get("VAPID_KONTAKT") || "post@example.com"),
      vapidKeys: await webpush.importVapidKeys(noekler, { extractable: false })
    });
  } catch (e) {
    throw new Error("Klarte ikke lese VAPID_KEYS: " + (e instanceof Error ? e.message : String(e)));
  }
  return server;
}

/* Sender til en bunke enheter og forteller hvordan det gikk. Feiler én
   enhet, skal de andre likevel få sitt. */
async function sendTil(
  tjener: webpush.ApplicationServer,
  enheter: Array<{ endpoint: string; p256dh: string; auth: string }>,
  nyttelast: string
) {
  let sendt = 0;
  const doede: string[] = [];
  const feil: string[] = [];

  await Promise.all(enheter.map(async (e) => {
    try {
      await tjener.subscribe({ endpoint: e.endpoint, keys: { p256dh: e.p256dh, auth: e.auth } })
        .pushTextMessage(nyttelast, { ttl: 3600 });
      sendt++;
    } catch (err) {
      // 410 betyr at nettleseren har kastet abonnementet — da rydder vi.
      if (err instanceof webpush.PushMessageError && err.isGone()) doede.push(e.endpoint);
      else feil.push(err instanceof Error ? err.toString() : String(err));
    }
  }));

  return { sendt, doede, feil };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return svar({ feil: "Bare POST." }, 405);

  const auth = req.headers.get("Authorization");
  if (!auth) return svar({ feil: "Ikke innlogget." }, 401);

  let kropp: { messageId?: string; test?: boolean };
  try { kropp = await req.json(); } catch { return svar({ feil: "Ugyldig forespørsel." }, 400); }
  if (!kropp.messageId && !kropp.test) return svar({ feil: "Mangler melding." }, 400);

  const url = Deno.env.get("SUPABASE_URL")!;
  const somBruker = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } }
  });
  const { data: meg } = await somBruker.auth.getUser();
  if (!meg?.user) return svar({ feil: "Ikke innlogget." }, 401);

  const db = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  /* Testvarsel til dine egne enheter. Går hele veien — nøkkel, Apple
     eller Google, og service workeren på telefonen — så et svar herfra
     sier nøyaktig hvor det eventuelt stopper. */
  if (kropp.test) {
    const { data: mine } = await db.from("push_subs")
      .select("endpoint, p256dh, auth").eq("user_id", meg.user.id);
    if (!mine || !mine.length) {
      return svar({ feil: "Ingen enheter har sagt ja til varsler for denne kontoen." }, 400);
    }
    let tjener: webpush.ApplicationServer;
    try { tjener = await appServer(); }
    catch (e) { return svar({ feil: e instanceof Error ? e.message : String(e) }, 500); }

    const res = await sendTil(tjener, mine, JSON.stringify({
      t: "TourFlow", b: "Testvarsel — alt virker.", u: "", tag: "test"
    }));
    if (res.doede.length) await db.from("push_subs").delete().in("endpoint", res.doede);

    return svar({
      sendt: res.sendt,
      enheter: mine.length,
      utgaatt: res.doede.length,
      feil: res.feil[0] || null
    });
  }

  const { data: melding } = await db.from("messages")
    .select("id, trip_id, channel_id, author_id, author_name, txt, action, reply_to")
    .eq("id", kropp.messageId).maybeSingle();
  if (!melding) return svar({ feil: "Fant ikke meldingen." }, 404);

  // Bare den som skrev meldingen kan utløse varselet om den. Ellers kunne
  // hvem som helst med en turkode fyrt av varsler til hele klassen.
  if (melding.author_id !== meg.user.id) return svar({ feil: "Ikke din melding." }, 403);

  const [{ data: kanal }, { data: tur }] = await Promise.all([
    db.from("channels").select("id, name, private").eq("id", melding.channel_id).maybeSingle(),
    db.from("trips").select("name").eq("id", melding.trip_id).maybeSingle()
  ]);
  if (!kanal) return svar({ feil: "Fant ikke chatten." }, 404);

  // Hvem kan lese chatten? En privat chat går til dem som er lagt til,
  // en åpen til alle godkjente på turen.
  let mottakere: string[];
  if (kanal.private) {
    const { data } = await db.from("channel_members").select("user_id").eq("channel_id", kanal.id);
    mottakere = (data || []).map(r => r.user_id);
  } else {
    const { data } = await db.from("members")
      .select("user_id").eq("trip_id", melding.trip_id).eq("status", "approved");
    mottakere = (data || []).map(r => r.user_id);
  }
  mottakere = mottakere.filter(id => id !== melding.author_id);
  if (!mottakere.length) return svar({ sendt: 0 });

  // Er avsenderen reiseleder? «admin» teller som vanlig deltaker.
  const { data: avsender } = await db.from("members")
    .select("role").eq("trip_id", melding.trip_id).eq("user_id", melding.author_id).maybeSingle();
  const fraLeder = avsender?.role === "leader";

  // Hvem svarte meldingen på?
  let svarTil: string | null = null;
  if (melding.reply_to) {
    const { data } = await db.from("messages")
      .select("author_id").eq("id", melding.reply_to).maybeSingle();
    svarTil = data?.author_id ?? null;
  }

  const harMotested = melding.action != null;

  const { data: valg } = await db.from("varselvalg")
    .select("user_id, channel_id, niva")
    .eq("trip_id", melding.trip_id).in("user_id", mottakere);

  const niva = (bruker: string) => {
    const rader = (valg || []).filter(v => v.user_id === bruker);
    const forChat = rader.find(v => (v.channel_id || TOM) === kanal.id);
    if (forChat) return forChat.niva;
    const forTur = rader.find(v => v.channel_id == null);
    return forTur ? forTur.niva : "viktig";
  };

  const skalHa = mottakere.filter(bruker => {
    const n = niva(bruker);
    if (n === "ingen") return false;
    if (n === "alt") return true;
    return fraLeder || harMotested || svarTil === bruker;   // «viktig»
  });
  if (!skalHa.length) return svar({ sendt: 0 });

  const { data: enheter } = await db.from("push_subs")
    .select("endpoint, p256dh, auth").in("user_id", skalHa);
  if (!enheter || !enheter.length) return svar({ sendt: 0 });

  const fornavn = String(melding.author_name || "").split(" ")[0];
  const nyttelast = JSON.stringify({
    t: kanal.name + (tur?.name ? " · " + tur.name : ""),
    b: `${fornavn}: ${String(melding.txt).slice(0, 140)}`,
    u: `?tur=${melding.trip_id}&chat=${kanal.id}`,
    tag: kanal.id
  });

  let tjener: webpush.ApplicationServer;
  try { tjener = await appServer(); }
  catch (e) {
    console.error("varsel-oppsett:", e);
    return svar({ feil: "Varsler er ikke satt opp på serveren." }, 500);
  }

  const res = await sendTil(tjener, enheter, nyttelast);
  if (res.doede.length) await db.from("push_subs").delete().in("endpoint", res.doede);
  if (res.feil.length) console.error("varsel-sending:", res.feil[0]);

  return svar({ sendt: res.sendt });
});
