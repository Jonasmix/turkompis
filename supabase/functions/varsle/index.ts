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
 * Filen har ingen import. Det er et bevisst valg, og det handler om tid:
 * funksjonen starter kald nesten hver gang, og målingene viste at det å
 * laste inn bibliotekene tok tre til fire sekunder før første linje kode
 * kjørte. Derfor er både databasekallene og krypteringen skrevet ut her.
 * Alt som trengs ligger i nettleserstandardene Deno har fra før.
 *
 * Krypteringen følger RFC 8291 (aes128gcm) og RFC 8292 (VAPID), og er
 * prøvd mot testverdiene i RFC 8291 punkt 5: ECDH-hemmeligheten, CEK,
 * nonce og hele meldingskroppen kom ut likt.
 */

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

/* ───────────────── små hjelpere ───────────────── */

const tekst = (s: string) => new TextEncoder().encode(s);

function fraB64u(s: string): Uint8Array {
  const r = s.replace(/-/g, "+").replace(/_/g, "/");
  const b = atob(r + "=".repeat((4 - r.length % 4) % 4));
  return Uint8Array.from(b, c => c.charCodeAt(0));
}

function tilB64u(u: Uint8Array): string {
  let s = "";
  for (const b of u) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function slaaSammen(...deler: Uint8Array[]): Uint8Array {
  const ut = new Uint8Array(deler.reduce((n, d) => n + d.length, 0));
  let i = 0;
  for (const d of deler) { ut.set(d, i); i += d.length; }
  return ut;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, lengde: number) {
  const k = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, k, lengde * 8)
  );
}

/* ───────────────── databasen over vanlig HTTP ───────────────── */

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

async function hvemErJeg(auth: string) {
  const r = await fetch(`${BASE}/auth/v1/user`, {
    headers: { apikey: ANON, Authorization: auth }
  });
  if (!r.ok) return null;
  return await r.json().catch(() => null) as { id?: string } | null;
}

const uuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

/* ───────────────── VAPID: hvem sender ─────────────────
   Et signert kort som sier «dette er TourFlow». Apple og Google krever
   det, og det er det samme kortet til alle mottakere hos samme tjeneste
   — derfor lages det én gang i timen, ikke én gang per varsel. */

let vapid: { priv: CryptoKey; pubRaw: Uint8Array; kontakt: string } | null = null;
const kort = new Map<string, { jwt: string; utloper: number }>();

async function vapidNokler() {
  if (vapid) return vapid;

  const raa = Deno.env.get("VAPID_KEYS");
  if (!raa) throw new Error("VAPID_KEYS mangler under Edge Functions → Secrets.");

  let n: { publicKey?: JsonWebKey; privateKey?: JsonWebKey };
  try { n = JSON.parse(raa); }
  catch { throw new Error("VAPID_KEYS er ikke gyldig JSON. Lim inn hele filen på én linje."); }
  if (!n.publicKey || !n.privateKey) throw new Error("VAPID_KEYS mangler publicKey eller privateKey.");

  try {
    const priv = await crypto.subtle.importKey(
      "jwk", n.privateKey, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    const pub = await crypto.subtle.importKey(
      "jwk", n.publicKey, { name: "ECDSA", namedCurve: "P-256" }, true, ["verify"]);
    vapid = {
      priv,
      pubRaw: new Uint8Array(await crypto.subtle.exportKey("raw", pub)),
      kontakt: "mailto:" + (Deno.env.get("VAPID_KONTAKT") || "post@example.com")
    };
  } catch (e) {
    throw new Error("Klarte ikke lese VAPID_KEYS: " + (e instanceof Error ? e.message : String(e)));
  }
  return vapid;
}

async function vapidKort(opprinnelse: string) {
  const v = await vapidNokler();
  const naa = Math.floor(Date.now() / 1000);

  const lagret = kort.get(opprinnelse);
  if (lagret && lagret.utloper > naa + 300) return lagret.jwt;

  const utloper = naa + 3600;
  const hode = tilB64u(tekst(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const krav = tilB64u(tekst(JSON.stringify({ aud: opprinnelse, exp: utloper, sub: v.kontakt })));
  const grunnlag = `${hode}.${krav}`;

  const signatur = new Uint8Array(await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" }, v.priv, tekst(grunnlag)));

  const jwt = `${grunnlag}.${tilB64u(signatur)}`;
  kort.set(opprinnelse, { jwt, utloper });
  return jwt;
}

/* ───────────────── selve varselet ─────────────────
   Innholdet krypteres for hver enkelt mottaker med nøkler bare den
   telefonen har. Verken Apple, Google eller vi kan lese det underveis —
   serveren sender en boks bare mottakeren kan åpne. */

type Enhet = { endpoint: string; p256dh: string; auth: string };

async function krypter(enhet: Enhet, nyttelast: string) {
  const uaPubRaa = fraB64u(enhet.p256dh);
  const hemmelighet = fraB64u(enhet.auth);

  // Et ferskt nøkkelpar per varsel — slik krever standarden.
  const par = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
  const asPubRaa = new Uint8Array(await crypto.subtle.exportKey("raw", par.publicKey));

  const uaPub = await crypto.subtle.importKey(
    "raw", uaPubRaa, { name: "ECDH", namedCurve: "P-256" }, true, []);
  const delt = new Uint8Array(await crypto.subtle.deriveBits(
    { name: "ECDH", public: uaPub }, par.privateKey, 256));

  const noekkelinfo = slaaSammen(tekst("WebPush: info\0"), uaPubRaa, asPubRaa);
  const ikm = await hkdf(hemmelighet, delt, noekkelinfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, tekst("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, tekst("Content-Encoding: nonce\0"), 12);

  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  // 0x02 markerer at dette er siste blokk.
  const innhold = slaaSammen(tekst(nyttelast), new Uint8Array([2]));
  const kryptert = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, tagLength: 128 }, aes, innhold));

  const blokkstorrelse = new Uint8Array(4);
  new DataView(blokkstorrelse.buffer).setUint32(0, 4096);

  return slaaSammen(salt, blokkstorrelse, new Uint8Array([asPubRaa.length]), asPubRaa, kryptert);
}

class PushFeil extends Error {
  constructor(public status: number, public tekst: string) {
    super(`${status} ${tekst}`);
  }
  get borte() { return this.status === 404 || this.status === 410; }
}

async function sendEn(enhet: Enhet, nyttelast: string) {
  const v = await vapidNokler();
  const opprinnelse = new URL(enhet.endpoint).origin;
  const kropp = await krypter(enhet, nyttelast);

  const r = await fetch(enhet.endpoint, {
    method: "POST",
    headers: {
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      // «high» ber Apple og Google levere med én gang. Uten den samler
      // telefonen opp varsler og viser dem når det passer den — greit for
      // et nyhetsbrev, ikke for «møt på hotellet om ti minutter».
      "Urgency": "high",
      "TTL": "3600",
      "Authorization": `vapid t=${await vapidKort(opprinnelse)}, k=${tilB64u(v.pubRaw)}`
    },
    body: kropp
  });

  if (!r.ok) throw new PushFeil(r.status, (await r.text().catch(() => "")).slice(0, 200));
}

/* Sender til en bunke enheter. Feiler én, skal de andre likevel få sitt. */
async function sendTil(enheter: Enhet[], nyttelast: string) {
  let sendt = 0;
  const doede: string[] = [];
  const feil: string[] = [];

  await Promise.all(enheter.map(async (e) => {
    try { await sendEn(e, nyttelast); sendt++; }
    catch (err) {
      // 404 og 410 betyr at nettleseren har kastet abonnementet — da rydder vi.
      if (err instanceof PushFeil && err.borte) doede.push(e.endpoint);
      else feil.push(err instanceof Error ? err.message : String(err));
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

/* ───────────────── forespørselen ───────────────── */

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
    const mine = await les<Enhet>(`push_subs?user_id=eq.${meg.id}&select=endpoint,p256dh,auth`);
    if (!mine.length) {
      return svar({ feil: "Ingen enheter har sagt ja til varsler for denne kontoen." }, 400);
    }
    try { await vapidNokler(); }
    catch (e) { return svar({ feil: manglerNokkel(e) }, 500); }

    const res = await sendTil(mine, JSON.stringify({
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
    const mine = valg.filter(v => v.user_id === bruker);
    const forChat = mine.find(v => v.channel_id === kanal.id);
    if (forChat) return forChat.niva;
    const forTur = mine.find(v => v.channel_id == null);
    return forTur ? forTur.niva : "viktig";
  };

  const skalHa = mottakere.filter(bruker => {
    const n = niva(bruker);
    if (n === "ingen") return false;
    if (n === "alt") return true;
    return fraLeder || harMotested || svarTil === bruker;   // «viktig»
  });
  if (!skalHa.length) return svar({ sendt: 0 });

  const enheter = await les<Enhet>(
    `push_subs?user_id=in.(${skalHa.join(",")})&select=endpoint,p256dh,auth`);
  if (!enheter.length) return svar({ sendt: 0 });

  const fornavn = String(melding.author_name || "").split(" ")[0];
  const nyttelast = JSON.stringify({
    t: kanal.name + (turer[0]?.name ? " · " + turer[0].name : ""),
    b: `${fornavn}: ${String(melding.txt).slice(0, 140)}`,
    u: `?tur=${melding.trip_id}&chat=${kanal.id}`,
    tag: kanal.id
  });

  try { await vapidNokler(); }
  catch (e) {
    console.error("varsel-oppsett:", e);
    return svar({ feil: "Varsler er ikke satt opp på serveren." }, 500);
  }

  const res = await sendTil(enheter, nyttelast);
  await ryddDoede(res.doede);
  if (res.feil.length) console.error("varsel-sending:", res.feil[0]);

  return svar({ sendt: res.sendt });
});
