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
 *
 * Denne funksjonen snakker med databasen over vanlig HTTP i stedet for å
 * bruke supabase-js. Grunnen er tid: funksjonen starter kaldt nesten hver
 * gang, og da må hele biblioteket lastes inn før første linje kjører —
 * det kostet ti sekunder før varselet i det hele tatt ble sendt. Her
 * gjøres bare de spørringene vi trenger, med fetch.
 */

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

const BASE = Deno.env.get("SUPABASE_URL") || "";
const TJENER = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") || "";

/* Leser med tjenernøkkelen, altså forbi radsikkerheten. Det er nødvendig:
   funksjonen skal se hvem andre som skal varsles, og det har ikke den som
   skrev meldingen lov til selv. */
async function les<T = Record<string, unknown>>(sti: string): Promise<T[]> {
  const r = await fetch(`${BASE}/rest/v1/${sti}`, {
    headers: { apikey: TJENER, Authorization: "Bearer " + TJENER }
  });
  if (!r.ok) return [];
  return await r.json().catch(() => []) as T[];
}

async function slett(sti: string) {
  await fetch(`${BASE}/rest/v1/${sti}`, {
    method: "DELETE",
    headers: { apikey: TJENER, Authorization: "Bearer " + TJENER }
  }).catch(() => {});
}

/* Hvem er det som spør? Billetten sjekkes av Supabase selv. */
async function hvemErJeg(auth: string) {
  const r = await fetch(`${BASE}/auth/v1/user`, {
    headers: { apikey: ANON, Authorization: auth }
  });
  if (!r.ok) return null;
  return await r.json().catch(() => null) as { id?: string } | null;
}

const uuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

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

/* Sender til en bunke enheter. Feiler én, skal de andre likevel få sitt. */
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
        // «high» ber Apple og Google levere med én gang. Uten den samler
        // telefonen opp varsler og viser dem når det passer den — greit
        // for et nyhetsbrev, ikke for «møt på hotellet om ti minutter».
        .pushTextMessage(nyttelast, { ttl: 3600, urgency: webpush.Urgency.High });
      sendt++;
    } catch (err) {
      // 410 betyr at nettleseren har kastet abonnementet — da rydder vi.
      if (err instanceof webpush.PushMessageError && err.isGone()) doede.push(e.endpoint);
      else feil.push(err instanceof Error ? err.toString() : String(err));
    }
  }));

  return { sendt, doede, feil };
}

async function ryddDoede(doede: string[]) {
  for (const e of doede) await slett(`push_subs?endpoint=eq.${encodeURIComponent(e)}`);
}

function manglerNokkel(e: unknown) {
  let navn: string[] = [];
  try { navn = Object.keys(Deno.env.toObject()).filter(k => /vapid/i.test(k)); } catch { /* låst env */ }
  const hint = navn.length
    ? ` Fant disse navnene under Secrets: ${navn.join(", ")}.`
    : " Fant ingen hemmelighet med «vapid» i navnet.";
  return (e instanceof Error ? e.message : String(e)) + hint;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return svar({ feil: "Bare POST." }, 405);

  const auth = req.headers.get("Authorization");
  if (!auth) return svar({ feil: "Ikke innlogget." }, 401);

  let kropp: { messageId?: string; test?: boolean };
  try { kropp = await req.json(); } catch { return svar({ feil: "Ugyldig forespørsel." }, 400); }
  if (!kropp.messageId && !kropp.test) return svar({ feil: "Mangler melding." }, 400);
  if (kropp.messageId && !uuid(kropp.messageId)) return svar({ feil: "Ugyldig melding." }, 400);

  const meg = await hvemErJeg(auth);
  if (!meg?.id) return svar({ feil: "Ikke innlogget." }, 401);

  /* Testvarsel til dine egne enheter. Går hele veien — nøkkel, Apple
     eller Google, og service workeren på telefonen — så et svar herfra
     sier nøyaktig hvor det eventuelt stopper. */
  if (kropp.test) {
    const mine = await les<{ endpoint: string; p256dh: string; auth: string }>(
      `push_subs?user_id=eq.${meg.id}&select=endpoint,p256dh,auth`);
    if (!mine.length) {
      return svar({ feil: "Ingen enheter har sagt ja til varsler for denne kontoen." }, 400);
    }
    let tjener: webpush.ApplicationServer;
    try { tjener = await appServer(); }
    catch (e) { return svar({ feil: manglerNokkel(e) }, 500); }

    const res = await sendTil(tjener, mine, JSON.stringify({
      t: "TourFlow", b: "Testvarsel — alt virker.", u: "", tag: "test"
    }));
    await ryddDoede(res.doede);

    return svar({
      sendt: res.sendt, enheter: mine.length,
      utgaatt: res.doede.length, feil: res.feil[0] || null
    });
  }

  type Melding = {
    trip_id: string; channel_id: string; author_id: string;
    author_name: string; txt: string; action: unknown; reply_to: string | null;
  };
  const meldinger = await les<Melding>(
    `messages?id=eq.${kropp.messageId}` +
    `&select=trip_id,channel_id,author_id,author_name,txt,action,reply_to&limit=1`);
  const melding = meldinger[0];
  if (!melding) return svar({ feil: "Fant ikke meldingen." }, 404);

  // Bare den som skrev meldingen kan utløse varselet om den. Ellers kunne
  // hvem som helst med en turkode fyrt av varsler til hele klassen.
  if (melding.author_id !== meg.id) return svar({ feil: "Ikke din melding." }, 403);

  // Alt som ikke er avhengig av hverandre, hentes samtidig. Hver runde
  // til basen er tid varselet ikke er framme.
  const [kanaler, turer, avsendere, svarRader] = await Promise.all([
    les<{ id: string; name: string; private: boolean }>(
      `channels?id=eq.${melding.channel_id}&select=id,name,private&limit=1`),
    les<{ name: string }>(`trips?id=eq.${melding.trip_id}&select=name&limit=1`),
    les<{ role: string }>(
      `members?trip_id=eq.${melding.trip_id}&user_id=eq.${melding.author_id}&select=role&limit=1`),
    melding.reply_to && uuid(melding.reply_to)
      ? les<{ author_id: string }>(`messages?id=eq.${melding.reply_to}&select=author_id&limit=1`)
      : Promise.resolve([])
  ]);

  const kanal = kanaler[0];
  if (!kanal) return svar({ feil: "Fant ikke chatten." }, 404);

  const fraLeder = avsendere[0]?.role === "leader";     // «admin» teller som deltaker
  const svarTil = svarRader[0]?.author_id ?? null;
  const harMotested = melding.action != null;

  // Hvem kan lese chatten? En privat chat går til dem som er lagt til,
  // en åpen til alle godkjente på turen.
  const rader = kanal.private
    ? await les<{ user_id: string }>(`channel_members?channel_id=eq.${kanal.id}&select=user_id`)
    : await les<{ user_id: string }>(
        `members?trip_id=eq.${melding.trip_id}&status=eq.approved&select=user_id`);

  const mottakere = rader.map(r => r.user_id).filter(id => id !== melding.author_id);
  if (!mottakere.length) return svar({ sendt: 0 });

  const valg = await les<{ user_id: string; channel_id: string | null; niva: string }>(
    `varselvalg?trip_id=eq.${melding.trip_id}` +
    `&user_id=in.(${mottakere.join(",")})&select=user_id,channel_id,niva`);

  const niva = (bruker: string) => {
    const rader = valg.filter(v => v.user_id === bruker);
    const forChat = rader.find(v => v.channel_id === kanal.id);
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

  const enheter = await les<{ endpoint: string; p256dh: string; auth: string }>(
    `push_subs?user_id=in.(${skalHa.join(",")})&select=endpoint,p256dh,auth`);
  if (!enheter.length) return svar({ sendt: 0 });

  const fornavn = String(melding.author_name || "").split(" ")[0];
  const nyttelast = JSON.stringify({
    t: kanal.name + (turer[0]?.name ? " · " + turer[0].name : ""),
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
  await ryddDoede(res.doede);
  if (res.feil.length) console.error("varsel-sending:", res.feil[0]);

  return svar({ sendt: res.sendt });
});
