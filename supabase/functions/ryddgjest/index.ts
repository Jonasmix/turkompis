/* ryddgjest — sletter en gjestekonto som ikke skal brukes mer.
 *
 * En gjest er en anonym pålogging som bare finnes i én nettleser. Logger
 * du inn med e-post på samme telefon, eller logger ut som gjest, blir den
 * gamle kontoen liggende igjen i basen uten at noen kan nå den igjen.
 * Denne funksjonen rydder den bort.
 *
 * Hvem som får slette hva, avgjøres av én ting: du må sende inn gjestens
 * egen billett (access token). Har du den, har du hatt kontrollen over
 * kontoen. Uten den skjer ingenting — ellers kunne hvem som helst slettet
 * hvem som helst ved å gjette en id.
 *
 * To ting slettes aldri:
 *   - en konto som ikke er anonym
 *   - en gjest som har laget en tur. Da ville turen stått igjen uten eier.
 */

import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const svar = (kropp: unknown, status = 200) =>
  new Response(JSON.stringify(kropp), {
    status, headers: { ...cors, "Content-Type": "application/json" }
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return svar({ feil: "Bare POST." }, 405);

  let kropp: { gjestToken?: string };
  try { kropp = await req.json(); } catch { return svar({ feil: "Ugyldig forespørsel." }, 400); }
  if (!kropp.gjestToken) return svar({ feil: "Mangler billett." }, 400);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;

  // Billetten er beviset. Er den ikke gyldig lenger, er det ingenting å gjøre.
  const somGjest = createClient(url, anon, {
    global: { headers: { Authorization: "Bearer " + kropp.gjestToken } }
  });
  const { data: g } = await somGjest.auth.getUser();
  if (!g?.user) return svar({ slettet: false, grunn: "ugyldig_billett" }, 401);
  if (!g.user.is_anonymous) return svar({ slettet: false, grunn: "ikke_gjest" }, 403);

  const gjest = g.user.id;
  const db = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Har gjesten laget en tur, blir kontoen stående. En tur uten eier kan
  // ingen slette eller styre etterpå.
  const { data: egneTurer } = await db.from("trips").select("id").eq("created_by", gjest).limit(1);
  if (egneTurer && egneTurer.length) return svar({ slettet: false, grunn: "eier_tur" });

  // Ryddes først, ellers blir radene stående og peke på en konto som
  // ikke finnes: da ville et navn uten ansikt blitt hengende i
  // deltakerlister og private chatter.
  await db.from("channel_members").delete().eq("user_id", gjest);
  await db.from("members").delete().eq("user_id", gjest);
  await db.from("push_subs").delete().eq("user_id", gjest);
  await db.from("varselvalg").delete().eq("user_id", gjest);

  // Meldingene blir stående med navnet som ble skrevet den gangen. Å
  // slette dem ville revet hull i samtaler andre har vært med på.
  const { error } = await db.auth.admin.deleteUser(gjest);
  if (error) return svar({ slettet: false, grunn: error.message }, 500);

  return svar({ slettet: true });
});
