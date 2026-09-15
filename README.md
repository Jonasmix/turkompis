# Turkompis

Program, gruppechat og veibeskrivelse for klasseturer. Nettside som kan legges til på
hjemskjermen (PWA) og virker uten nett. Ingen byggesteg — rene statiske filer, laget for
GitHub Pages.

## Hva som virker nå

- **Bli med med navn og turkode.** Prøvekoder: `BERLIN26`, `PARIS26`
- **Flere turer.** Appen husker hvilken tur du var inne på sist og åpner den neste gang.
- **Flere chatter per tur** — «Hele turen», gruppechatter, reiseledere. Du kan opprette nye.
- **Møteavtaler blir til veibeskrivelse.** Skriver noen «møt på hotellet kl 18:30», kobler
  appen det mot programmet for den dagen, finner riktig adresse og åpner Google Maps
  eller Apple Maps. «Hotellet» slår opp riktig hotell for datoen — turene bytter hotell underveis.
- **Program** med dagsvelger, neste hendelse og kart på hvert punkt.
- **Offline** — service worker cacher appen. Legg til på hjemskjermen fra Del-menyen (iOS)
  eller menyen ⋮ (Android).

## Hva som ikke virker ennå

GitHub Pages serverer bare filer — det finnes ingen server bak. Derfor:

- **Meldinger lagres kun på din egen enhet.** To telefoner ser ikke hverandres meldinger.
- **Ingen opplasting av filer.** Program og filliste ligger i `js/data.js`.
- **Ingen ekte AI.** Meldingstolkningen i `js/parse.js` er regelbasert og kjører lokalt.
- **Ingen innlogging.** Turkoden er en nøkkel til et rom, ikke autentisering.

## Kjør lokalt

Service workers krever `http://`, ikke `file://`. Start en enkel server i mappa:

```bash
python -m http.server 8080
```

Åpne så `http://localhost:8080`.

## Legg ut på GitHub Pages

1. Push dette til et repo, f.eks. `turkompis`.
2. **Settings → Pages → Source: Deploy from a branch**, branch `main`, mappe `/ (root)`.
3. Siden ligger på `https://<brukernavn>.github.io/turkompis/` etter et par minutter.

Alle stier i koden er relative, så appen virker like godt under et undermappe-navn som på et
eget domene. `.nojekyll` er med for at GitHub ikke skal filtrere bort filer.

## Filstruktur

| Fil | Ansvar |
|---|---|
| `index.html` | Skjelettet: join-skjerm, app-skall, ark (sheets) |
| `styles.css` | Alt av utseende, lys og mørk variant |
| `js/data.js` | Turene — program, steder, filer, kanaler |
| `js/store.js` | **All lesing og skriving av data.** Byttepunktet mot backend |
| `js/parse.js` | Melding → møtested, dato, klokkeslett |
| `js/ui.js` | Skjermer, navigasjon, hendelser |
| `sw.js` | Offline-cache. Bump `CACHE`-navnet når du endrer filer |

Skal appen få ekte meldinger på tvers av telefoner, er det `js/store.js` som skal skrives om.
Resten av appen kaller de samme funksjonsnavnene og trenger ingen endring.

## Sikkerhet — ikke bygget ennå, med vilje

Dette er en utprøvingsversjon. Før den brukes av en ekte klasse må dette på plass:

- **Ordentlig pålogging.** Engangskode på e-post eller SMS. Turkode alene betyr at hvem som
  helst som får koden kan lese alt — og et selvvalgt navn betyr at hvem som helst kan utgi seg
  for å være en lærer.
- **Tilgangsstyring på serveren** (row level security), slik at du bare får lest turer og
  kanaler du faktisk er med i. Sjekken må ligge i databasen, ikke i appen.
- **Reiseleder-rolle** — bare de kan laste opp filer, opprette turer og fjerne deltakere.
- **Sletting.** Meldinger og deltakerlister slettes automatisk en gitt tid etter turen.
- **Personvern.** Dette er personopplysninger om mindreårige i skolesammenheng: skolen trenger
  databehandleravtale, data bør ligge i EU, og en personvernkonsekvensvurdering (DPIA) er
  sannsynligvis påkrevd. Bygges inn fra start, ikke ettermonteres.
- **Moderering.** Reiseleder må kunne slette meldinger og stenge en chat.

Ingen av delene er i koden nå. De kommer som eget steg.
