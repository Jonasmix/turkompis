# Turkompis

Program, gruppechat og veibeskrivelse for klasseturer. Nettside som kan legges til på
hjemskjermen (PWA) og virker uten nett. Ingen byggesteg — rene statiske filer på GitHub
Pages, med Supabase som database.

## Hva appen gjør

- **Reiseledere lager turer.** Tomt program, eller start fra en ferdig mal. Du får en
  turkode på seks tegn å dele ut.
- **Deltakere blir med** med fornavn, etternavn og turkoden.
- **Flere turer.** Appen husker hvilken tur du så sist og åpner den neste gang.
- **Flere chatter per tur.** En chat er enten åpen for hele turen, eller privat for dem du
  legger til. Private chatter vises ikke i det hele tatt for andre — heller ikke for
  reiseledere. Alle medlemmer kan opprette en chat og legge til folk som er med på turen.
- **Møteavtaler blir til veibeskrivelse.** Skriver noen «møt på hotellet kl 18:30», kobles
  det mot programmet for den dagen, og kartet åpner riktig adresse. «Hotellet» slår opp
  hotellet dere faktisk bor på den datoen — turer bytter hotell underveis.
- **Program** med dagsvelger, neste hendelse, og kart på hvert punkt. Reiseleder legger inn
  dager, punkter, steder og hvilket hotell som gjelder hver dag.
- **Lys visning.** Appen er lys uansett hva telefonen står på.
- **Offline** — appen caches, og siste turdata vises selv uten nett. Meldinger krever nett.

## Sett opp databasen

Appen trenger et Supabase-prosjekt. Gratisplanen holder godt for utprøving.

1. **Lag prosjekt** på [supabase.com](https://supabase.com) → *New project*.
   Velg en **region i EU** (f.eks. Frankfurt) — dette er elevdata.
2. **Kjør skjemaet.** Åpne *SQL Editor*, lim inn hele [`supabase/schema.sql`](supabase/schema.sql)
   og kjør. Den lager tabeller, regler for hvem som får lese og skrive, og funksjonene
   `join_trip` og `create_trip`.
3. **Slå på anonym pålogging.** *Authentication → Sign In / Providers → Anonymous sign-ins* → på.
   Hver enhet får da en identitet uten at noen må lage passord.
4. **Fyll inn nøklene** i [`js/config.js`](js/config.js). Begge finnes under
   *Project Settings → API*:
   - `supabaseUrl` — *Project URL*
   - `supabaseAnonKey` — nøkkelen merket **anon public**

Anon-nøkkelen er laget for å ligge åpent i en nettside. Det er reglene i databasen som
bestemmer hva noen får lese og skrive, ikke nøkkelen. **`service_role`-nøkkelen skal aldri
inn i dette repoet** — den går utenom alle regler.

## Kjør lokalt

Service workers krever `http://`, ikke `file://`:

```bash
python -m http.server 8080
```

## Legg ut på GitHub Pages

**Settings → Pages → Source: Deploy from a branch**, branch `main`, mappe `/ (root)`.
Alle stier er relative, så appen virker like godt i en undermappe som på eget domene.

## Filstruktur

| Fil | Ansvar |
|---|---|
| `index.html` | Skjelettet: oppstart, join-skjerm, app-skall, ark |
| `styles.css` | Alt av utseende, lys og mørk variant |
| `js/config.js` | Hvilket Supabase-prosjekt appen snakker med |
| `js/api.js` | **All kontakt med databasen.** Ingen andre filer snakker med Supabase |
| `js/parse.js` | Melding → møtested, dato, klokkeslett |
| `js/templates.js` | Ferdige turer for «lag eksempeltur» |
| `js/ui.js` | Skjermer, navigasjon, hendelser |
| `supabase/schema.sql` | Tabeller, radsikkerhet og funksjoner |
| `sw.js` | Offline-cache. Bump `CACHE` når du endrer filer |

## Sikkerhet — hva som er på plass

Reglene ligger i databasen, ikke i appen. En bruker som omgår appen og snakker direkte med
API-et møter de samme reglene.

- **Radsikkerhet på alle tabeller.** Du kan bare lese turer du er medlem av. Innmelding går
  gjennom `join_trip()`, som er den eneste veien inn.
- **Roller.** Bare reiseledere endrer program, steder, dager og hotell. Alle medlemmer kan
  skrive meldinger og lage gruppechatter.
- **Private chatter er private.** Tilgang følger chatten, ikke turen. En privat chat og
  meldingene i den er usynlige for alle som ikke er lagt til — reiseledere inkludert.
- **Meldinger** skrives i eget navn — `author_id` må være din egen bruker. Du kan slette
  dine egne; reiseleder kan slette alle.
- **Anonym pålogging** gir hver enhet en identitet. Ingen passord å miste.
- **Grenser** på lengde av meldinger og antall turer per bruker.

## Sikkerhet — hva som gjenstår

- **Navnet er selvvalgt.** Hvem som helst kan skrive «Kari Lund» og se ut som en lærer.
  Fikses med engangskode på e-post eller SMS, eller ved at reiseleder godkjenner deltakere.
- **Turkoden er en delt hemmelighet.** Lekker den, kommer hvem som helst inn. Bør kunne
  byttes eller stenges av reiseleder når alle er med.
- **Ingen automatisk sletting.** Meldinger og deltakerlister bør slettes en gitt tid etter
  turen, ikke ligge til evig tid.
- **Ingen moderering utover sletting.** Reiseleder bør kunne stenge en chat og fjerne
  deltakere som ikke skal være der.
- **Personvern.** Dette er personopplysninger om mindreårige i skolesammenheng. Skolen
  trenger databehandleravtale med Supabase, og en personvernkonsekvensvurdering (DPIA) er
  sannsynligvis påkrevd før ekte bruk.
- **Filopplasting** er ikke bygget. Program legges inn manuelt.
