/* config.js — hvilket Supabase-prosjekt appen snakker med.

   Begge verdiene under er ment å ligge åpent i en nettside. Anon-nøkkelen
   gir ingen tilgang i seg selv — det er reglene i databasen (se
   supabase/schema.sql) som avgjør hva en bruker får lese og skrive.

   Den hemmelige nøkkelen (service_role) skal ALDRI inn i denne filen
   eller noe annet sted i dette repoet. */

const CONFIG = {
  supabaseUrl: "https://uybyyecmiqcqzumahltx.supabase.co",
  supabaseAnonKey: "sb_publishable_Xfi5jUmR3ST1PoZ0_yy-ew_jaBzBiK_",

  // Den offentlige halvdelen av varselnøkkelen. Den skal ligge åpent —
  // den er nettleserens kvittering på at varslene kommer fra oss. Den
  // hemmelige halvdelen ligger som VAPID_KEYS i Supabase, aldri her.
  vapidPublicKey: "BBxB85SpJhoaeEegFdxg2nHue6kN_IgMshqoSuh4ORgX2Hg-EvgiNZsziBdjvOW4Ujbwrwm84TOQkiNcd3EHC5c"
};

CONFIG.ready = Boolean(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);
