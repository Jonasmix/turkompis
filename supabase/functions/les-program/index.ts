/* les-program — leser PDF-er og foreslår et program.
 *
 * Kjører på serveren fordi API-nøkkelen ikke kan ligge i en nettside.
 * Funksjonen SKRIVER ALDRI til databasen: den svarer med et forslag som
 * reiselederen må godkjenne i appen. Da blir en bom en rettelse, ikke et
 * feil program.
 *
 * Bare reiseledere på den aktuelle turen slipper til — ellers kunne hvem
 * som helst med en turkode brukt opp API-kreditten.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

const MODELL = "claude-haiku-4-5";
const MAKS_FILER = 5;
const MAKS_BYTES = 8 * 1024 * 1024;   // per fil, før base64

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const svar = (kropp: unknown, status = 200) =>
  new Response(JSON.stringify(kropp), {
    status,
    headers: { ...cors, "Content-Type": "application/json" }
  });

/* Skjemaet modellen må svare i. Flate strenger, tomme der noe mangler —
   da slipper vi at den finner på adresser den ikke har dekning for. */
const SKJEMA = {
  type: "object",
  additionalProperties: false,
  required: ["dager", "usikkert"],
  properties: {
    dager: {
      type: "array",
      description: "Én oppføring per dag, i kronologisk rekkefølge.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["dato", "hotellNavn", "hotellAdresse", "punkter"],
        properties: {
          dato: { type: "string", description: "ISO-dato, YYYY-MM-DD. Tom streng hvis året ikke går fram." },
          hotellNavn: { type: "string", description: "Hotellet gruppen bor på denne natten. Tom streng hvis ukjent." },
          hotellAdresse: { type: "string", description: "Full adresse. Tom streng hvis den ikke står i dokumentet." },
          punkter: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["tid", "tittel", "stedNavn", "stedAdresse", "notat"],
              properties: {
                tid: { type: "string", description: "HH:MM i 24-timers format." },
                tittel: { type: "string", description: "Hva som skjer, kort." },
                stedNavn: { type: "string", description: "Stedet det skjer. Tom streng hvis ikke oppgitt." },
                stedAdresse: { type: "string", description: "Full adresse. Tom streng hvis den ikke står i dokumentet." },
                notat: { type: "string", description: "Tilleggsinfo, for eksempel «møtes igjen 13:45». Tom streng ellers." }
              }
            }
          }
        }
      }
    },
    usikkert: {
      type: "array",
      description: "Alt du er i tvil om, med egne ord. Én kort setning per punkt.",
      items: { type: "string" }
    }
  }
};

const INSTRUKS = `Du leser vedlegg til en norsk klassetur og trekker ut reiseprogrammet.

Regler:
- Ta med alt som har et klokkeslett: oppmøte, transport, omvisninger, måltider, innetid.
- «tid» skal være HH:MM. Står det «kl 9», skriv 09:00. Står det et tidsrom, bruk starttidspunktet.
- «dato» skal være YYYY-MM-DD. Året står ofte bare i overskriften — bruk det på alle dagene.
- ALDRI finn på en adresse. Står ikke adressen i dokumentet, la feltet være tomt og skriv
  en linje i «usikkert» om at stedet mangler adresse.
- Hotellet gjelder natten etter den dagen. Bytter gruppen hotell underveis, må hver dag få
  riktig hotell.
- Er noe tvetydig — utydelig skann, motstridende klokkeslett, dato uten år — ta det med i
  «usikkert» i stedet for å gjette.

Svar bare ved å kalle verktøyet.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return svar({ feil: "Bare POST." }, 405);

  const nokkel = Deno.env.get("ANTHROPIC_API_KEY");
  if (!nokkel) return svar({ feil: "Serveren mangler ANTHROPIC_API_KEY." }, 500);

  const auth = req.headers.get("Authorization");
  if (!auth) return svar({ feil: "Ikke innlogget." }, 401);

  let kropp: { tripId?: string; filer?: { navn: string; data: string }[] };
  try { kropp = await req.json(); }
  catch { return svar({ feil: "Ugyldig forespørsel." }, 400); }

  const { tripId, filer } = kropp;
  if (!tripId || !Array.isArray(filer) || filer.length === 0) {
    return svar({ feil: "Mangler tur eller filer." }, 400);
  }
  if (filer.length > MAKS_FILER) {
    return svar({ feil: `Maks ${MAKS_FILER} filer om gangen.` }, 400);
  }
  for (const f of filer) {
    if (typeof f.data !== "string" || f.data.length * 0.75 > MAKS_BYTES) {
      return svar({ feil: `«${f.navn}» er for stor. Maks 8 MB per fil.` }, 400);
    }
  }

  // Er den som spør reiseleder på denne turen? Databasen svarer, ikke appen.
  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: auth } } }
  );

  const { data: bruker } = await db.auth.getUser();
  if (!bruker?.user) return svar({ feil: "Ikke innlogget." }, 401);

  const { data: medlem } = await db
    .from("members").select("role")
    .eq("trip_id", tripId).eq("user_id", bruker.user.id).maybeSingle();

  if (!medlem) return svar({ feil: "Du er ikke med på denne turen." }, 403);
  if (medlem.role !== "leader") {
    return svar({ feil: "Bare reiseledere kan lese inn program." }, 403);
  }

  const innhold: unknown[] = filer.map(f => ({
    type: "document",
    source: { type: "base64", media_type: "application/pdf", data: f.data },
    title: f.navn
  }));
  innhold.push({ type: "text", text: "Trekk ut programmet fra vedlegget/vedleggene over." });

  let anthropicSvar: Response;
  try {
    anthropicSvar = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": nokkel,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: MODELL,
        max_tokens: 8000,
        system: INSTRUKS,
        tools: [{
          name: "lagre_program",
          description: "Leverer programmet som ble funnet i dokumentet.",
          input_schema: SKJEMA,
          strict: true
        }],
        tool_choice: { type: "tool", name: "lagre_program" },
        messages: [{ role: "user", content: innhold }]
      })
    });
  } catch (e) {
    return svar({ feil: "Fikk ikke kontakt med modellen.", detalj: String(e) }, 502);
  }

  if (!anthropicSvar.ok) {
    const tekst = await anthropicSvar.text();
    // Ikke send API-feilen rå til appen — den kan inneholde detaljer om kontoen.
    console.error("Anthropic-feil", anthropicSvar.status, tekst);
    const melding = anthropicSvar.status === 429
      ? "For mange forespørsler akkurat nå. Prøv igjen om litt."
      : anthropicSvar.status === 400
      ? "Modellen klarte ikke lese filen. Er det en tekst-PDF og ikke et bilde?"
      : "Noe gikk galt hos modellen.";
    return svar({ feil: melding }, 502);
  }

  const data = await anthropicSvar.json();
  const kall = (data.content || []).find((b: { type: string }) => b.type === "tool_use");
  if (!kall) return svar({ feil: "Modellen fant ikke noe program i filen." }, 422);

  return svar({
    forslag: kall.input,
    forbruk: {
      inn: data.usage?.input_tokens ?? null,
      ut: data.usage?.output_tokens ?? null,
      modell: MODELL
    }
  });
});
