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
        required: ["dato", "hotellNavn", "hotellAdresse", "hotellNettside", "punkter"],
        properties: {
          dato: { type: "string", description: "ISO-dato, YYYY-MM-DD. Tom streng hvis året ikke går fram." },
          hotellNavn: { type: "string", description: "Hotellet gruppen bor på denne natten. Tom streng hvis ukjent." },
          hotellAdresse: { type: "string", description: "Full gateadresse. Tom streng hvis den ikke står i dokumentet." },
          hotellNettside: { type: "string", description: "Nettadresse til hotellet hvis heftet bare oppgir en lenke. Tom streng ellers." },
          punkter: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["tid", "tittel", "stedNavn", "stedAdresse", "notat"],
              properties: {
                tid: { type: "string", description: "HH:MM i 24-timers format. TOM STRENG hvis dokumentet ikke oppgir et klokkeslett." },
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

DEN VIKTIGSTE REGELEN: du skal ALDRI finne på noe. Dette er et program elever
skal møte opp etter. Et oppdiktet klokkeslett sender noen til feil sted til feil tid.
Står det ikke i dokumentet, skal feltet være tomt.

Klokkeslett:
- Bruk BARE klokkeslett som faktisk står i dokumentet. Skriv dem som HH:MM.
  «kl 9» blir 09:00, «kl. 14» blir 14:00, «12.30-14.00» blir 12:30.
- Står det ikke noe klokkeslett — for eksempel «Frokost på hotellet» eller
  «Fritid i Paris» — la «tid» være TOM STRENG. Ikke gjett ut fra hva som er vanlig,
  ikke regn deg fram fra andre punkter, ikke bruk kunnskap om rutetider.
- Et punkt uten klokkeslett skal likevel med. Rekkefølgen i dokumentet er nok.

Steder og adresser:
- Bruk bare adresser som står i dokumentet. Ellers tom streng.
- Oppgir dokumentet en nettlenke til hotellet i stedet for adresse, legg lenken i
  «hotellNettside» og la «hotellAdresse» være tom.
- Bruk samme skrivemåte for samme sted hele veien. Ikke lag både «Oslo lufthavn» og
  «Oslo lufthavn terminal 2».
- Generiske ord er ikke steder. Står det «frokost på hotellet», la «stedNavn» være tom —
  appen vet selv hvilket hotell dagen har.

Datoer:
- «dato» skal være YYYY-MM-DD. Året står ofte bare i tittelen eller på forsiden.
- Går året ikke fram noe sted, la «dato» være tom og skriv det i «usikkert».

Hotell:
- Hotellet gjelder natten etter den dagen. Bytter gruppen hotell underveis, skal hver
  dag ha riktig hotell. Siste dagen har som regel ikke hotell.

«usikkert»:
- Skriv én kort setning per ting du er i tvil om: manglende adresser, to alternative
  avganger, utydelig skann, motstridende opplysninger.
- Ikke skriv at du har estimert noe — du skal ikke estimere i det hele tatt.

Dokumentet kan inneholde mye som ikke er program: historiestoff, pakkeliste,
telefonnumre, bilder. Hopp over alt slikt.

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
