/* config.js — hvilket Supabase-prosjekt appen snakker med.

   Begge verdiene under er ment å ligge åpent i en nettside. Anon-nøkkelen
   gir ingen tilgang i seg selv — det er reglene i databasen (se
   supabase/schema.sql) som avgjør hva en bruker får lese og skrive.

   Den hemmelige nøkkelen (service_role) skal ALDRI inn i denne filen
   eller noe annet sted i dette repoet. */

const CONFIG = {
  supabaseUrl: "",      // f.eks. https://abcdefghijkl.supabase.co
  supabaseAnonKey: ""   // "anon public"-nøkkelen fra Project Settings → API
};

CONFIG.ready = Boolean(CONFIG.supabaseUrl && CONFIG.supabaseAnonKey);
