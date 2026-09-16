/* ui.js — skjermer, navigasjon og alt som tegnes. */

const UI = (() => {

  const S = { trip: null, tab: "program", day: null, openChat: null, loadingChat: false, trips: [], edit: false, offline: false, svarTil: null, kart: {}, sisteChat: null, tilBunn: false,
    nye: 0, sistAntall: 0, beholdSkroll: null };

  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
  const today = () => new Date().toISOString().slice(0, 10);
  const clock = iso => new Date(iso).toLocaleTimeString("nb-NO", { hour:"2-digit", minute:"2-digit" });

  function shortStamp(iso) {
    const d = new Date(iso);
    if (d.toDateString() === new Date().toDateString()) return clock(iso);
    const dager = Math.round((Date.now() - d) / 86400000);
    if (dager < 7) return d.toLocaleDateString("nb-NO", { weekday: "short" }).replace(".", "");
    return d.toLocaleDateString("nb-NO", { day: "numeric", month: "short" }).replace(".", "");
  }
  function dayStamp(iso) {
    const d = new Date(iso);
    return d.toDateString() === new Date().toDateString()
      ? clock(iso)
      : d.toLocaleDateString("nb-NO", { weekday:"short", day:"numeric", month:"short" }) + " " + clock(iso);
  }
  function daysUntil(date) {
    return Math.round((new Date(date + "T12:00:00") - new Date(today() + "T12:00:00")) / 86400000);
  }
  /* Nettadresser til steder kommer fra PDF-er vi ikke har skrevet selv.
     Bare vanlige nettlenker slipper gjennom — «javascript:» og liknende
     ville kjørt kode i appen hvis noen la det inn i et hefte. */
  const trygLenke = u => /^https?:\/\//i.test(String(u || "").trim());

  const mapsGoogle = p => "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(p.name + ", " + p.addr) + "&travelmode=transit";
  const mapsApple  = p => "https://maps.apple.com/?daddr=" + encodeURIComponent(p.name + ", " + p.addr) + "&dirflg=r";

  const ICON = {
    pin:'<svg viewBox="0 0 24 24"><path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z"/><circle cx="12" cy="10" r="2.6"/></svg>',
    nav:'<svg viewBox="0 0 24 24"><path d="M3 11 21 3l-8 18-2-7-8-3Z"/></svg>',
    spark:'<svg viewBox="0 0 24 24"><path d="M12 3v5M12 16v5M3 12h5M16 12h5M6.3 6.3l3 3M14.7 14.7l3 3M17.7 6.3l-3 3M9.3 14.7l-3 3"/></svg>',
    cal:'<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
    chat:'<svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-8 8H7l-4 3 1.2-4.4A8 8 0 1 1 21 12Z"/></svg>',
    prog:'<svg viewBox="0 0 24 24"><path d="M4 6h10M4 12h16M4 18h7"/><circle cx="18" cy="6" r="2"/><circle cx="14" cy="18" r="2"/></svg>',
    me:'<svg viewBox="0 0 24 24"><circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/></svg>',
    send:'<svg viewBox="0 0 24 24"><path d="M4 12 20 4l-7 16-2-7-7-1Z"/></svg>',
    chevL:'<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px"><path d="m15 6-6 6 6 6"/></svg>',
    chev:'<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>'
  };

  const cap = s => String(s).charAt(0).toUpperCase() + String(s).slice(1);
  const prikker = () => '<span class="prikker"><i></i><i></i><i></i></span>';
  const venter = tekst => `<div class="venter">${prikker()} ${esc(tekst)}</div>`;

  function toast(text) {
    const t = $("toast");
    t.textContent = text; t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.hidden = true; }, 3000);
  }

  /* ───────────────── varsel → riktig chat ─────────────────
     Trykker du på et varsel, følger tur og chat med i adressen. Vi tar
     dem ut og fjerner dem igjen, så de ikke blir stående og styre hvor
     appen åpner neste gang. */
  function lenkemaal(sok) {
    const p = new URLSearchParams(sok || location.search);
    const maal = { tur: p.get("tur"), chat: p.get("chat") };
    if ((maal.tur || maal.chat) && !sok) history.replaceState(null, "", location.pathname);
    return maal;
  }

  async function aapneFraVarsel(maal) {
    if (!maal.tur && !maal.chat) return false;
    try {
      if (maal.tur && (!S.trip || S.trip.id !== maal.tur)) await openTrip(maal.tur);
      if (!S.trip) return false;
      if (maal.chat && S.trip.channels.some(c => c.id === maal.chat)) {
        S.tab = "chat";
        await openChat(maal.chat);
      } else render();
      return true;
    } catch { return false; }
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", e => {
      const adresse = e.data && e.data.aapne;
      if (adresse) aapneFraVarsel(lenkemaal(adresse.replace(/^\?/, "")));
    });
  }

  /* ───────────────── oppstart ───────────────── */
  async function boot() {
    if (!CONFIG.ready) return bootSetup();

    $("bootMsg").innerHTML = venter("Kobler til");
    const res = await Api.init();

    if (!res.ok) {
      const profile = Api.getProfile(), last = Api.getLastTrip();
      if (profile && last) {                       // prøv lagret kopi
        S.offline = true;
        return openTrip(last);
      }
      $("bootMsg").innerHTML = `Fikk ikke kontakt med serveren.<br>
        <span style="font-size:13px;color:var(--ink-3)">${esc(res.error || res.reason)}</span><br>
        <button class="btn" style="margin-top:14px" onclick="location.reload()">Prøv igjen</button>`;
      return;
    }

    // Tegn paa nytt naar noe kommer inn utenfra - nye meldinger, reaksjoner
    // eller vaer. Tidligere gjaldt dette bare chatten, saa vaeret dukket
    // aldri opp i programmet for man byttet fane.
    // Kommer det noe utenfra — meldinger, reaksjoner, vær, eller et
    // program en reiseleder nettopp endret — tegner vi på nytt. Turen
    // hentes fra Api, for endrer programmet seg er den vi holder utdatert.
    Api.onChange(() => {
      if (!S.trip) return;
      const fersk = Api.currentTrip();
      if (fersk && fersk.id === S.trip.id) S.trip = fersk;
      render();
    });

    // Kom du hit fra et varsel, skal du havne i chatten varselet gjaldt.
    const maal = lenkemaal();
    if ((maal.tur || maal.chat) && await aapneFraVarsel(maal)) return;

    const profile = Api.getProfile(), last = Api.getLastTrip();
    if (profile && last) {
      try { return await openTrip(last); }
      catch { /* turen finnes ikke lenger */ }
    }

    // Innlogget uten lagret «siste tur» på denne telefonen: spør basen om
    // du er med på noe, i stedet for å anta at du ikke er det.
    if (!Api.erAnonym()) {
      try {
        const turer = await Api.myTrips();
        S.trips = turer;
        if (turer.length) return await openTrip(turer[0].id);
      } catch { /* uten nett får vi svare med skjemaet */ }
      return showJoin();
    }
    visAuth("start");
  }

  function bootSetup() {
    $("bootMsg").innerHTML = `
      <b style="font-family:Archivo,sans-serif">Appen mangler serveroppsett</b><br>
      <span style="font-size:14px;color:var(--ink-2)">Fyll inn prosjektadresse og anon-nøkkel i
      <code>js/config.js</code>, og kjør <code>supabase/schema.sql</code> i Supabase-prosjektet.
      Framgangsmåten står i README.</span>`;
  }

  function showJoin() {
    $("bootScreen").hidden = true;
    $("appScreen").hidden = true;
    $("authScreen").hidden = true;
    $("joinScreen").hidden = false;

    const p = Api.getProfile();
    if (p) { $("fFirst").value = p.first; $("fLast").value = p.last; }

    // Er du innlogget, men uten turer, ser skjermen ut som forste gang.
    // Si fra at du faktisk er logget inn, saa du ikke tror det feilet.
    const tilbake = $("joinTilbake");
    if (tilbake) tilbake.hidden = !(S.fraStart && Api.erAnonym());

    const linje = $("joinKonto");
    const epost = Api.minEpost && Api.minEpost();
    if (epost) {
      linje.innerHTML = `Innlogget som <b>${esc(epost)}</b>. Du er ikke med på noen tur ennå — skriv turkoden under.`;
      linje.hidden = false;
    } else linje.hidden = true;
  }


  /* Venter på at reiselederen slipper deg inn. Du ser navnet på turen,
     men ingenting av innholdet — det sørger reglene i basen for. */
  function visVenter(trip) {
    $("joinScreen").hidden = true;
    $("appScreen").hidden = true;
    $("bootScreen").hidden = true;
    $("authScreen").hidden = false;

    $("authInner").innerHTML = `
      <div class="mark" aria-hidden="true">
        <svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="21"/><path d="M24 13v11l7 5"/></svg>
      </div>
      <h1>Venter på godkjenning</h1>
      <p class="lede">Du har bedt om å bli med på <b>${esc(trip.name)}</b>.
        Reiselederen må slippe deg inn før du ser programmet og chatten.</p>
      <button class="btn primary big" id="sjekkIgjen">Sjekk om jeg er godkjent</button>
      <button class="btn" style="width:100%;margin-top:10px" id="venterAnnen">Velg en annen tur</button>`;

    $("sjekkIgjen").addEventListener("click", async e => {
      const b = e.currentTarget;
      b.disabled = true; b.innerHTML = prikker() + " Sjekker";
      try { await openTrip(trip.id); }
      catch { b.disabled = false; b.textContent = "Sjekk om jeg er godkjent"; }
      if (!$("authScreen").hidden) {
        b.disabled = false; b.textContent = "Sjekk om jeg er godkjent";
        toast("Ikke godkjent ennå.");
      }
    });

    $("venterAnnen").addEventListener("click", () => { S.trip = null; S.fraStart = true; showJoin(); });
  }
  async function openTrip(tripId) {
    $("bootMsg").innerHTML = venter("Henter turen");
    const trip = await Api.loadTrip(tripId);
    if (!trip) throw new Error("Fant ikke turen");

    // Venter du på godkjenning, slipper du ikke inn i appen ennå.
    if (trip.venter) { S.trip = null; return visVenter(trip); }

    S.trip = trip;
    S.offline = Boolean(trip.stale);
    Api.setLastTrip(tripId);
    S.day = Parse.baseDate(trip) || (trip.days[0] ? trip.days[0].date : null);

    // Bytter du tur, lukkes samtalen du hadde åpen.
    S.openChat = null;
    S.nye = 0; S.sistAntall = 0;
    Api.unsubscribeChannel();

    $("bootScreen").hidden = true;
    $("joinScreen").hidden = true;
    $("appScreen").hidden = false;

    const p = Api.getProfile();
    $("avatarText").textContent = p ? p.initials : "–";

    render();
    if (!S.offline) {
      Api.subscribeTrip(tripId);
      Api.loadRecent(tripId).then(() => { if (S.tab === "chat" && !S.openChat) render(); }).catch(() => {});
      Api.lastVaer(tripId);
      Api.lastVarselvalg(tripId).catch(() => {});
      S.svarTil = null;
    }
    Api.myTrips().then(t => { S.trips = t; }).catch(() => {});
  }

  /* ───────────────── program ───────────────── */
  function nextEvent(trip) {
    const t = new Date().toTimeString().slice(0, 5);
    const d = trip.days.find(x => x.date === today());
    if (d) {
      const item = d.items.find(i => i.t && i.t > t);
      if (item) return { day: d, item };
      const nd = trip.days.find(x => x.date > today());
      const f = nd && nd.items.find(i => i.t);
      return f ? { day: nd, item: f } : null;
    }
    const up = trip.days.find(x => x.date >= today());
    const forste = up && up.items.find(i => i.t);
    return forste ? { day: up, item: forste } : null;
  }


  /* Yr svarer med koder som «partlycloudy_day». Vi viser et tegn og
     temperaturen — ikke mer, for det skal stå ved siden av programmet
     uten å ta oppmerksomheten fra det. */
  function vaerTegn(kode) {
    if (!kode) return "";
    const k = String(kode);
    const natt = k.endsWith("_night");
    if (k.startsWith("clearsky")) return natt ? "🌙" : "☀️";
    if (k.startsWith("fair")) return natt ? "🌙" : "🌤️";
    if (k.startsWith("partlycloudy")) return "⛅";
    if (k.startsWith("cloudy")) return "☁️";
    if (k.includes("thunder")) return "⛈️";
    if (k.includes("sleet")) return "🌨️";
    if (k.includes("snow")) return "❄️";
    if (k.includes("rain") || k.includes("shower")) return "🌧️";
    if (k.startsWith("fog")) return "🌫️";
    return "";
  }



  /* Hvilket sted representerer dagen når punktet selv ikke har ett med
     koordinater? Hotellet om det er satt, ellers det første stedet på
     dagen som faktisk har en værmelding. Samme by, samme vær. */
  function dagensSted(d) {
    if (d.hotel && Api.vaerFor(d.hotel)) return d.hotel;
    const m = d.items.find(i => i.place && Api.vaerFor(i.place));
    return m ? m.place : (d.hotel || null);
  }
  /* Dagens vær, vist ved siden av datoen: formiddag og ettermiddag der
     gruppen bor eller skal være. Det er «været der du skal den dagen». */
  function dagensVaer(d) {
    const sted = dagensSted(d);
    if (!sted) return "";
    const f = Api.vaerPunkt(sted, d.date, "09:00");
    const e = Api.vaerPunkt(sted, d.date, "15:00");
    if (!f && !e) return "";
    const del = (v, nar) => v
      ? `<span class="dagdel"><em>${nar}</em> ${vaerTegn(v.sym)}${v.temp == null ? "" : ` <b>${Math.round(v.temp)}°</b>`}</span>`
      : "";
    return `<div class="dagvaer">${del(f, "formiddag")}${del(e, "ettermiddag")}</div>`;
  }
  /* Har ikke punktet et sted med koordinater, bruker vi hotellet den dagen.
     Vaeret er stort sett det samme i samme by, og det er byen folk lurer paa. */
  function vaerMerke(placeId, dato, tid, reserve) {
    let v = placeId ? Api.vaerPunkt(placeId, dato, tid) : null;
    if (!v && reserve && reserve !== placeId) v = Api.vaerPunkt(reserve, dato, tid);
    if (!v) return "";
    const tegn = vaerTegn(v.sym);
    const grader = v.temp == null ? "" : `${Math.round(v.temp)}°`;
    if (!tegn && !grader) return "";
    return `<span class="vaer" title="Værmelding fra Yr">${tegn}${grader ? ` <b>${grader}</b>` : ""}</span>`;
  }
  function viewProgram() {
    const trip = S.trip;
    const leader = trip.role === "leader";

    if (!trip.days.length) {
      return `<div class="card pad" style="padding:22px;text-align:center">
        <div class="eyebrow">Tomt program</div>
        <p class="muted" style="margin:10px 0 16px;color:var(--ink-2)">
          ${leader ? "Legg inn dagene i turen, så bygger appen resten." : "Reiselederen har ikke lagt inn programmet ennå."}</p>
        ${leader ? `<div class="stack"><button class="btn primary" data-sheet="addday">Legg til første dag</button>
          <button class="btn" data-sheet="importpdf">Les inn program fra PDF</button></div>` : ""}
      </div>
      ${leader ? `<p class="muted">Del turkoden <b class="mono">${esc(trip.code)}</b> med deltakerne så de kan bli med.</p>` : ""}`;
    }

    const ne = nextEvent(trip);
    const started = trip.days.some(d => d.date <= today());
    let head = "";

    if (!ne) {
      head = `<div class="countdown"><div class="eyebrow">Turen er ferdig</div>
        <p class="muted" style="margin-top:6px">Programmet ligger her så lenge du er med på turen.</p></div>`;
    } else if (!started) {
      const n = daysUntil(trip.days[0].date);
      head = `<div class="countdown"><div class="eyebrow">Avreise</div>
        <b>${n === 0 ? "I dag" : n === 1 ? "I morgen" : "Om " + n + " dager"}</b>
        <p class="muted" style="margin-top:4px;color:var(--ink-2)">Første punkt: ${esc(trip.days[0].items[0] ? trip.days[0].items[0].title : "ikke lagt inn")}</p></div>`;
    } else {
      const p = ne.item.place ? trip.places[ne.item.place] : null;
      head = `<div class="nextup">
        <div class="lbl">${ne.day.date === today() ? "Neste i dag" : "Neste · " + esc(ne.day.label)}</div>
        <div class="t">${esc(ne.item.t)}</div>
        <div class="w">${esc(ne.item.title)}${vaerMerke(ne.item.place, ne.day.date, ne.item.t, dagensSted(ne.day))}</div>
        <div class="p">${p ? esc(p.name) : esc(ne.item.note || "")}</div>
        ${p ? `<div class="acts">
          <a class="btn solid" href="${mapsGoogle(p)}" target="_blank" rel="noopener">${ICON.nav} Veibeskrivelse</a>
          <button class="btn" data-sheet="place" data-place="${esc(ne.item.place)}">Detaljer</button>
        </div>` : ""}
      </div>`;
    }

    const d = trip.days.find(x => x.date === S.day) || trip.days[0];
    const chips = trip.days.map(x =>
      `<button class="chip" aria-pressed="${x.date === d.date}" data-day="${esc(x.date)}">${esc(x.chip)}<span>${esc(x.num)}</span></button>`
    ).join("") + (leader ? `<button class="chip" data-sheet="addday" style="border-style:dashed">+ Dag<span>ny dato</span></button>` : "");

    const hotel = d.hotel ? trip.places[d.hotel] : null;
    const reserveSted = dagensSted(d);
    const rows = d.items.length ? d.items.map((i, k) => {
      const p = i.place ? trip.places[i.place] : null;
      const isNext = ne && ne.day.date === d.date && ne.item.id === i.id && d.date === today();
      return `<div class="ev ${isNext ? "now" : ""}" data-item="${esc(i.id)}" role="button" tabindex="0">
        <div class="time">${i.t ? esc(i.t) : '<span style="color:var(--ink-3)">—</span>'}${isNext ? "<em>neste</em>" : ""}</div>
        <div>
          <div class="title">${esc(i.title)}${vaerMerke(i.place, d.date, i.t, reserveSted)}</div>
          <div class="place">${p ? ICON.pin + esc(p.name) : `<span style="color:var(--ink-3)">${esc(i.note || "Ikke stedfestet")}</span>`}</div>
          ${S.edit ? `<div class="redigerrad">
            <span class="draha" data-drag aria-label="Dra for å flytte">⠿</span>
            <button class="minibtn fare" data-delitem="${esc(i.id)}">Slett</button>
          </div>` : ""}
        </div>
      </div>`;
    }).join("") : `<p class="muted" style="padding:16px 0;text-align:center">Ingen punkter denne dagen.</p>`;

    return `
      ${head}
      <div class="chips">${chips}</div>
      <div>
        <div class="eyebrow" style="margin-bottom:7px;display:flex;justify-content:space-between;gap:8px;align-items:center">
          <span>${esc(d.label)}${hotel ? " · bor på " + esc(hotel.name) : ""}</span>
          ${leader ? `<button class="linkbtn" style="font-size:11px" data-edit>${S.edit ? "Ferdig" : "Rediger"}</button>` : ""}
        </div>
        ${dagensVaer(d)}
        <div class="card pad"><div class="tl">${rows}</div></div>
      </div>
      ${leader ? `<div class="stack">
        <button class="btn primary" data-sheet="additem" data-day="${esc(d.id)}">Legg til programpunkt</button>
        <button class="btn" data-sheet="importpdf">Les inn program fra PDF</button>
        <button class="btn" data-sheet="hotel" data-day="${esc(d.id)}">${hotel ? "Bytt hotell denne dagen" : "Sett hotell denne dagen"}</button>
        ${S.edit ? `<button class="btn danger" data-delday="${esc(d.id)}">Slett hele dagen</button>` : ""}
      </div>` : ""}`;
  }

  /* Dra et programpunkt til en ny plass, slik man flytter i en spilleliste.
     Radene bytter plass i DOM-en mens du drar, og rekkefølgen lagres når du
     slipper. Uten touch-action:none ville telefonen skrollet i stedet. */
  function settOppDraing() {
    const tl = $("screen").querySelector(".tl");
    if (!tl || !S.edit) return;

    let rad = null, startY = 0;

    tl.addEventListener("pointerdown", e => {
      const hank = e.target.closest("[data-drag]");
      if (!hank) return;
      rad = hank.closest(".ev");
      if (!rad) return;
      e.preventDefault();
      startY = e.clientY;
      rad.classList.add("drar");
      try { hank.setPointerCapture(e.pointerId); } catch {}
    });

    tl.addEventListener("pointermove", e => {
      if (!rad) return;
      e.preventDefault();
      const dy = e.clientY - startY;
      rad.style.transform = `translateY(${dy}px)`;

      // Bare naboen i den retningen du drar vurderes, og først når raden
      // har passert midten av den. Ellers bytter raden plass med seg selv.
      const rr = rad.getBoundingClientRect();
      const midt = rr.top + rr.height / 2;
      const nabo = dy > 0 ? rad.nextElementSibling : dy < 0 ? rad.previousElementSibling : null;
      if (!nabo || !nabo.classList.contains("ev")) return;

      const r = nabo.getBoundingClientRect();
      const passert = dy > 0 ? midt > r.top + r.height / 2 : midt < r.top + r.height / 2;
      if (!passert) return;

      if (dy > 0) nabo.after(rad); else nabo.before(rad);
      startY = e.clientY;              // nytt utgangspunkt, ellers hopper raden
      rad.style.transform = "";
    }, { passive: false });

    async function slipp() {
      if (!rad) return;
      rad.style.transform = "";
      rad.classList.remove("drar");
      rad = null;
      const ids = [...tl.querySelectorAll(".ev")].map(r => r.dataset.item);
      await lagreRekkefolge(ids);
    }
    tl.addEventListener("pointerup", slipp);
    tl.addEventListener("pointercancel", slipp);
  }

  async function lagreRekkefolge(ids) {
    const dag = S.trip.days.find(d => d.items.some(i => ids.includes(i.id)));
    if (!dag) return;
    const gammel = dag.items.map(i => i.id).join();
    if (gammel === ids.join()) return;          // ingenting flyttet seg

    dag.items = ids.map(id => dag.items.find(i => i.id === id)).filter(Boolean);
    try {
      for (let n = 0; n < dag.items.length; n++) {
        await Api.updateItem(dag.items[n].id, { sort: (n + 1) * 10 });
      }
      await openTrip(S.trip.id);
    } catch {
      toast("Klarte ikke lagre rekkefølgen.");
      await openTrip(S.trip.id);
    }
  }

  /* ───────────────── chat ───────────────── */
  /* Kartforslaget er en smal stripe som glir ut ved siden av meldingen.
     Den trekker seg sammen til et lite merke etter noen sekunder, så den
     ikke stjeler plass i samtalen — men forsvinner aldri helt. Trykker du
     på den, blir den stående åpen til du lukker den selv. */
  const kartTimere = new Set();

  /* Animasjonene skal spille én gang — når boksen faktisk skifter form.
     Chatten tegnes på nytt hver gang det kommer en melding, og uten denne
     lista ville alle kartbokser i samtalen hoppe til hver gang. */
  const kartNy = new Set();
  const roligBevegelse = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* Bytter tilstand. Når boksen blir mindre, får den gamle formen
     animere seg ut først; den nye merkes så den glir inn ved neste
     tegning. Å åpne skal derimot kjennes umiddelbart. */
  function settKart(id, tilstand) {
    const fra = S.kart[id] || "vis";
    if (fra === tilstand) return;
    const ferdig = () => { S.kart[id] = tilstand; kartNy.add(id + ":" + tilstand); render(); };

    const boks = $("screen").querySelector(`.kartboks[data-kart="${CSS.escape(id)}"]`);
    const ut = tilstand !== "liten" ? null : fra === "apen" ? "lukker" : "krymper";
    if (!boks || !ut || roligBevegelse()) return ferdig();

    boks.classList.add(ut);
    setTimeout(ferdig, ut === "lukker" ? 170 : 220);
  }

  function actionCard(a, msgId) {
    const p = S.trip.places[a.place];
    if (!p) return "";
    const day = Parse.dayOf(S.trip, a.date);
    if (!(msgId in S.kart)) { S.kart[msgId] = "vis"; kartNy.add(msgId + ":vis"); }
    const tilstand = S.kart[msgId];
    const ny = kartNy.delete(msgId + ":" + tilstand) ? " ny" : "";

    return `<div class="kartboks ${tilstand}${ny}" data-kart="${esc(msgId)}">
      <button class="kartmerke" data-kartapne="${esc(msgId)}" aria-label="Vis veibeskrivelse">${ICON.pin}</button>

      <button class="kartstripe" data-kartapne="${esc(msgId)}">
        ${ICON.pin}
        <span class="kartnavn">${esc(p.name)}</span>
        ${a.time ? `<span class="karttid mono">${esc(a.time)}</span>` : ""}
      </button>

      <div class="kartkort">
        <div class="kartkorthode">
          <div>
            <div class="dest">${esc(p.name)}</div>
            <div class="meta">${a.time ? `<span class="mono">${esc(a.time)}</span> · ` : ""}${esc(day ? day.label : a.date)}<br>${esc(p.addr)}</div>
          </div>
          <button class="kartlukk" data-kartlukk="${esc(msgId)}" aria-label="Lukk">✕</button>
        </div>
        <div class="why">${esc(a.why)}</div>
        <div class="acts">
          <a class="btn primary" href="${mapsGoogle(p)}" target="_blank" rel="noopener">${ICON.nav} Google Maps</a>
          <a class="btn" href="${mapsApple(p)}" target="_blank" rel="noopener">${ICON.pin} Apple Maps</a>
        </div>
      </div>
    </div>`;
  }

  /* Start nedtellingen for kartstriper som nettopp dukket opp. Én gang
     per melding — ellers ville hver ny tegning gitt den nye sekunder. */
  function startKarttimere() {
    for (const boks of $("screen").querySelectorAll(".kartboks.vis")) {
      const id = boks.dataset.kart;
      if (kartTimere.has(id)) continue;
      kartTimere.add(id);
      setTimeout(() => {
        if ((S.kart[id] || "vis") === "vis") settKart(id, "liten");
      }, 6000);
    }
  }

  /* Chatten har to nivåer, som i Snapchat: en liste, og én åpen samtale.
     S.openChat holder hvilken samtale som er framme; null betyr lista. */
  function viewChatList() {
    const recent = Api.lastByChannel();
    const rows = S.trip.channels.map(c => {
      const last = recent[c.id];
      const initials = c.name.split(/\s+/).slice(0, 2).map(w => w[0] || "").join("").toUpperCase();
      return `<button class="chatrow" data-openchat="${esc(c.id)}">
        <span class="ava ${c.private ? "locked" : ""}">${c.private ? "&#128274;" : esc(initials)}</span>
        <span class="grow" style="min-width:0">
          <span class="nm">${esc(c.name)}</span>
          <span class="last">${last
            ? `<em>${esc(last.mine ? "Du" : last.who.split(" ")[0])}:</em> ${esc(last.txt)}`
            : `<em>${esc(c.sub || "Ingen meldinger ennå")}</em>`}</span>
        </span>
        <span class="when">${last ? esc(shortStamp(last.ts)) : ""}</span>
      </button>`;
    }).join("");

    return `<div class="chatlist">${rows}</div>
      <button class="btn" data-sheet="newchannel" style="width:100%">Ny chat</button>
      <p class="muted">En chat er enten åpen for hele turen, eller privat for dem du legger til.</p>`;
  }

  const EMOJIER = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

  function viewConversation() {
    const msgs = Api.messages(S.openChat);
    if (!msgs.length && S.loadingChat) return venter("Henter meldinger");
    if (!msgs.length) {
      return `<p class="muted" style="text-align:center;padding:30px 0">Ingen meldinger her ennå. Skriv den første.</p>`;
    }

    const body = msgs.map(m => {
      const svarPaa = m.replyTo ? msgs.find(x => x.id === m.replyTo) : null;
      const rea = Api.reactions(S.openChat, m.id);

      return `<div class="msg ${m.mine ? "me" : ""}" id="msg-${esc(m.id)}" data-msg="${esc(m.id)}">
        ${m.mine ? "" : `<div class="who">${esc(m.who)}${m.role ? ` <b>· ${esc(m.role)}</b>` : ""}</div>`}
        ${m.replyTo ? `<button class="svarpaa" data-hopp="${esc(m.replyTo)}">
            <span class="svarnavn">${esc(svarPaa ? (svarPaa.mine ? "Deg" : svarPaa.who) : "Slettet melding")}</span>
            <span class="svartekst">${esc(svarPaa ? svarPaa.txt : "meldingen finnes ikke lenger")}</span>
          </button>` : ""}
        <div class="bubble">${esc(m.txt)}</div>
        ${rea.length ? `<div class="reaksjoner" data-rea="${esc(m.id)}">
            ${rea.map(r => `<button class="rea ${r.min ? "min" : ""}" data-emoji="${esc(r.emoji)}" data-pa="${esc(m.id)}">
              ${esc(r.emoji)}<span>${r.navn.length}</span></button>`).join("")}
          </div>` : ""}
        <div class="stamp">${esc(dayStamp(m.ts))}${m.mine ? ` · <button class="linkbtn" style="font-size:10.5px" data-delmsg="${esc(m.id)}">slett</button>` : ""}</div>
        ${m.action ? actionCard(m.action, m.id) : ""}
      </div>`;
    }).join("");

    // Chatten holder de 300 nyeste. Ligger det mer bak, hentes det når
    // du ber om det — ikke hver gang samtalen åpnes.
    const eldre = Api.harEldre(S.openChat)
      ? `<button class="eldreknapp" data-eldre="1">Hent eldre meldinger</button>` : "";

    return `<div class="msgs" id="msgs">${eldre}${body}</div>`;
  }

  /* Sveip en melding mot høyre for å svare, hold inne for å reagere.
     Begge gestene ligger på samme element, så en bevegelse avbryter
     holdet — ellers ville et sveip også åpnet emojivelgeren. */
  function settOppMeldingsgester() {
    const boks = $("screen").querySelector(".msgs");
    if (!boks) return;

    let rad = null, startX = 0, startY = 0, holder = null, sveiper = false;

    const avbrytHold = () => { clearTimeout(holder); holder = null; };

    boks.addEventListener("pointerdown", e => {
      if (e.target.closest("button, a")) return;
      rad = e.target.closest(".msg");
      if (!rad) return;
      startX = e.clientX; startY = e.clientY; sveiper = false;
      holder = setTimeout(() => {
        holder = null;
        rad.classList.remove("sveiper");
        rad.style.transform = "";
        const id = rad.dataset.msg;
        rad = null;
        if (navigator.vibrate) navigator.vibrate(12);
        sheetEmoji(id);
      }, 450);
    });

    boks.addEventListener("pointermove", e => {
      if (!rad) return;
      const dx = e.clientX - startX, dy = Math.abs(e.clientY - startY);
      if (!sveiper) {
        if (Math.abs(dx) > 8 || dy > 8) avbrytHold();
        if (dx > 12 && dy < 26) { sveiper = true; rad.classList.add("sveiper"); }
        else return;
      }
      e.preventDefault();
      rad.style.transform = `translateX(${Math.min(Math.max(dx, 0), 90)}px)`;
    }, { passive: false });

    function slipp() {
      avbrytHold();
      if (!rad) return;
      const dx = Number((rad.style.transform.match(/translateX\((\d+(?:\.\d+)?)px\)/) || [0, 0])[1]);
      rad.classList.remove("sveiper");
      rad.style.transform = "";
      const id = rad.dataset.msg;
      rad = null;
      if (sveiper && dx > 55) startSvar(id);
    }
    boks.addEventListener("pointerup", slipp);
    boks.addEventListener("pointercancel", slipp);
  }

  /* Eldre meldinger legges foran i lista. Da vokser innholdet oppover, og
     skjermen ville hoppet — vi legger til nøyaktig den høyden som kom. */
  async function hentEldre() {
    const sc = $("screen");
    const hoyde = sc.scrollHeight, topp = sc.scrollTop;
    try {
      const n = await Api.loadMoreMessages(S.openChat);
      if (!n) return toast("Ikke flere meldinger.");
    } catch { return toast("Klarte ikke hente eldre meldinger."); }
    S.beholdSkroll = { hoyde, topp };
    render();
  }

  function startSvar(id) {
    const m = Api.messages(S.openChat).find(x => x.id === id);
    if (!m) return;
    S.svarTil = { id: m.id, who: m.mine ? "deg selv" : m.who, txt: m.txt };
    render();
    const inn = $("msgInput");
    if (inn) inn.focus();
  }

  function hoppTil(id) {
    const el = document.getElementById("msg-" + id);
    if (!el) return toast("Meldingen finnes ikke lenger.");
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.classList.remove("blink");
    void el.offsetWidth;            // start animasjonen på nytt
    el.classList.add("blink");
  }

  function sheetEmoji(id) {
    const m = Api.messages(S.openChat).find(x => x.id === id);
    const rea = Api.reactions(S.openChat, id);
    openSheet(`<h3>Reager</h3>
      ${m ? `<p class="muted" style="margin:6px 0 14px">${esc(m.txt.slice(0, 90))}${m.txt.length > 90 ? "…" : ""}</p>` : ""}
      <div class="emojirad">
        ${EMOJIER.map(e => `<button class="emojiknapp" data-emoji="${e}" data-pa="${esc(id)}">${e}</button>`).join("")}
      </div>
      ${rea.length ? `<div class="eyebrow" style="margin:18px 0 8px">Hvem har reagert</div>
        <div class="memberlist">${rea.map(r => `<div class="person">
          <span>${esc(r.emoji)} ${esc(r.navn.join(", "))}</span></div>`).join("")}</div>` : ""}
      <button class="btn" style="width:100%;margin-top:14px" data-svar="${esc(id)}">Svar på meldingen</button>
      <button class="btn close" data-close>Lukk</button>`);
  }

  async function reager(id, emoji) {
    try {
      await Api.toggleReaction(S.openChat, id, emoji);
      render();
    } catch { toast("Klarte ikke lagre reaksjonen."); }
  }

  function viewChat() {
    return S.openChat ? viewConversation() : viewChatList();
  }

  /* ───────────────── meg ───────────────── */

  /* Ting reiselederen bør ordne. Alt her er noe som gjør at appen ikke
     kan gjøre jobben sin — et sted uten posisjon gir ingen veibeskrivelse,
     en dag uten hotell gjør at «møt på hotellet» ikke kan slås opp. */
  function oppgaver(taMedSkjulte) {
    if (!S.trip || S.trip.role !== "leader") return [];
    const ut = [];

    for (const d of S.trip.days) {
      if (d.hotel) continue;
      if (d.ignorerHotell && !taMedSkjulte) continue;
      ut.push({
        hva: `${cap(d.label)} mangler hotell`,
        hvorfor: "«Møt på hotellet» kan ikke slås opp denne dagen",
        sheet: "hotel", slag: "day", id: d.id, skjult: !!d.ignorerHotell
      });
    }

    for (const p of Object.values(S.trip.places)) {
      const harPosisjon = p.lat != null && p.lon != null;
      if (p.addr && harPosisjon) continue;
      if (p.ignorer && !taMedSkjulte) continue;
      ut.push({
        hva: p.addr ? `Fant ikke posisjonen til ${p.name}` : `${p.name} mangler adresse`,
        hvorfor: p.addr
          ? "Prøv en mer nøyaktig adresse — gate, postnummer og land"
          : "Ingen veibeskrivelse og ingen værmelding",
        sheet: "place", slag: "place", id: p.id, skjult: !!p.ignorer
      });
    }

    return ut;
  }

  async function skjulOppgave(slag, id, skjul) {
    try {
      await Api.setIgnorer(slag, id, skjul);
      await openTrip(S.trip.id);
      S.tab = "meg"; render();
      toast(skjul ? "Skjult. Du finner den under «Skjulte»." : "Tatt fram igjen.");
    } catch {
      toast("Klarte ikke lagre. Har du kjørt siste SQL?");
    }
  }

  function sheetSkjulte() {
    const skjulte = oppgaver(true).filter(o => o.skjult);
    openSheet(`<h3>Skjulte oppgaver</h3>
      <p class="muted" style="margin:6px 0 14px">Ting du har krysset av som unødvendige.
      De teller ikke med i merket på fanen.</p>
      ${skjulte.length ? `<div class="memberlist">${skjulte.map(o => `<div class="person">
          <span>${esc(o.hva)}</span>
          <button class="linkbtn" data-vis="${esc(o.slag)}" data-visid="${esc(o.id)}">ta fram igjen</button>
        </div>`).join("")}</div>` : `<p class="muted">Ingenting er skjult.</p>`}
      <button class="btn close" data-close>Lukk</button>`);
  }

  function viewMe() {
    const p = Api.getProfile();
    const trip = S.trip;
    const rows = S.trips.length
      ? S.trips.map(t => `<button class="listrow" data-opentrip="${esc(t.id)}" aria-current="${t.id === trip.id}">
          <div class="grow"><div class="nm">${esc(t.name)}</div>
            <div class="sub">${esc([t.org, t.dates].filter(Boolean).join(" · "))}${t.role === "leader" ? " · du er reiseleder" : ""}</div></div>
          <span class="chev">${ICON.chev}</span></button>`).join("")
      : `<p class="muted" style="padding:12px 0">Henter turene dine…</p>`;

    return `
      ${(() => {
        const o = oppgaver();
        const skjulte = oppgaver(true).filter(x => x.skjult);
        if (!o.length && !skjulte.length) return "";

        const skjultLenke = skjulte.length
          ? `<button class="linkbtn" style="margin-top:9px;font-size:13px" data-sheet="skjulte">
               ${skjulte.length} skjult${skjulte.length === 1 ? "" : "e"} — se dem</button>`
          : "";

        // Er alt ordnet, skal lenken til de skjulte fortsatt stå igjen.
        // Ellers forsvinner veien tilbake sammen med selve lista.
        if (!o.length) {
          return `<div>
            <div class="eyebrow" style="margin-bottom:8px;color:var(--moss)">Alt er i orden</div>
            <div class="card pad" style="padding-block:14px;border-left:3px solid var(--moss)">
              <p class="muted" style="margin:0">${skjulte.length
                ? "Ingenting venter på deg. Det du har krysset av ligger under."
                : "Alle steder har adresse, og alle dager har hotell."}</p>
            </div>
            ${skjultLenke}
          </div>`;
        }

        return `<div>
          <div class="eyebrow" style="margin-bottom:8px;color:var(--amber)">Må ordnes · ${o.length}</div>
          <div class="card pad" style="border-left:3px solid var(--amber)">
            <div class="list">${o.map(x => `<div class="oppgave">
              <button class="listrow" data-sheet="${x.sheet}" data-place="${esc(x.id)}" data-day="${esc(x.id)}">
                <div class="grow"><div class="nm">${esc(x.hva)}</div><div class="sub">${esc(x.hvorfor)}</div></div>
                <span class="chev">${ICON.chev}</span>
              </button>
              <button class="linkbtn skjulknapp" data-skjul="${esc(x.slag)}" data-skjulid="${esc(x.id)}">ikke nødvendig</button>
            </div>`).join("")}</div>
          </div>
          ${skjultLenke}
        </div>`;

      })()}
      <div>
        <div class="eyebrow" style="margin-bottom:8px">Deg</div>
        <div class="card pad" style="padding-block:14px">
          <dl class="kv">
            <dt>Navn</dt><dd>${esc(p ? p.name : "—")}</dd>
            <dt>Rolle</dt><dd>${trip.role === "leader" ? "Reiseleder" : "Deltaker"}</dd>
            <dt>Konto</dt><dd>${Api.erAnonym()
              ? 'Gjest <span class="tag amber">bare på denne telefonen</span>'
              : esc(Api.minEpost() || "Innlogget")}</dd>
          </dl>
        </div>
        ${Api.erAnonym()
          ? `<button class="btn primary" style="width:100%;margin-top:10px" data-sheet="koblepost">Sikre kontoen med e-post</button>
             <p class="muted" style="margin-top:7px">Som gjest bor kontoen din i denne nettleseren. Bytter du telefon eller tømmer nettleserdata, er turene borte.</p>`
          : `<button class="btn" style="width:100%;margin-top:10px" data-sheet="koblepost">Bytt e-postadresse</button>
             <p class="muted" style="margin-top:7px">Du får en kode til den nye adressen. Kontoen, turene og rollene dine følger med.</p>`}
      </div>

      <div>
        <div class="eyebrow" style="margin-bottom:8px">Turkode</div>
        <div class="card pad" style="padding-block:14px;display:flex;align-items:center;gap:12px;justify-content:space-between">
          <b class="mono" style="font-size:24px;letter-spacing:.1em">${esc(trip.code)}</b>
          <button class="btn quiet" data-copy="${esc(trip.code)}">Kopier</button>
        </div>
        <p class="muted" style="margin-top:7px">Alle med denne koden kan bli med på turen og lese alt som skrives.</p>
      </div>

      <div>
        <div class="eyebrow" style="margin-bottom:8px">Dine turer</div>
        <div class="card pad"><div class="list">${rows}</div></div>
      </div>

      <div class="stack">
        <button class="btn" data-sheet="deltakere">Deltakere og roller</button>
        <button class="btn" data-sheet="varsler">Varsler</button>
        <button class="btn" data-sheet="jointrip">Bli med på en ny tur</button>
        <button class="btn" data-sheet="newtrip">Lag en ny tur</button>
        <button class="btn" data-sheet="about">Om appen og personvern</button>
        <button class="btn danger" data-leave="${esc(trip.id)}">Meld deg av ${esc(trip.name)}</button>
        ${trip.erEier || trip.erAdmin ? `<button class="btn danger" data-deltrip="${esc(trip.id)}">Slett hele turen</button>` : ""}
        <button class="btn danger" id="resetBtn">Logg ut på denne enheten</button>
      </div>`;
  }

  /* ───────────────── tegning ───────────────── */
  function render() {
    if (!S.trip) return;
    const conv = S.tab === "chat" && S.openChat
      ? S.trip.channels.find(c => c.id === S.openChat) : null;

    // Når en samtale er åpen bytter toppen til samtalens egen overskrift.
    $("apphead").hidden = Boolean(conv);
    $("convhead").hidden = !conv;
    if (conv) {
      $("convName").textContent = conv.name;
      $("convSub").textContent = conv.private ? "Privat · bare de som er lagt til" : "Åpen for alle på turen";
      $("convWho").dataset.members = conv.id;
    } else {
      $("tripName").textContent = S.trip.name;
      $("tripSub").textContent = [S.trip.org, S.trip.dates].filter(Boolean).join(" · ") || ("Kode " + S.trip.code);
    }

    $("banner").innerHTML = S.offline
      ? `<div class="offlinebar">Ingen forbindelse — viser sist lagrede program. Meldinger sendes ikke.</div>` : "";

    const chipsFor = $("screen").querySelector(".chips");
    const chipsScroll = chipsFor ? chipsFor.scrollLeft : 0;

    // Står du nederst i samtalen, følger du med videre. Leser du lenger
    // oppe, skal ikke en melding fra noen andre rykke deg ned igjen — og
    // med hundre på samme tur skjer det hele tiden.
    const sk = $("screen");
    const byttetChat = !conv || S.sisteChat !== conv.id;
    const naerBunn = byttetChat || S.tilBunn ||
      (sk.scrollHeight - sk.scrollTop - sk.clientHeight) < 140;
    S.sisteChat = conv ? conv.id : null;

    // Leser du lenger opp, teller vi hva som har kommet i mellomtiden i
    // stedet for å dra deg ned. Eldre meldinger du selv har hentet, er
    // ikke nye — de legger seg foran, ikke bak.
    if (conv) {
      const antall = Api.messages(conv.id).length;
      if (naerBunn) S.nye = 0;
      else if (!S.beholdSkroll && antall > S.sistAntall) S.nye += antall - S.sistAntall;
      S.sistAntall = antall;
    }

    $("screen").innerHTML = S.tab === "program" ? viewProgram()
                          : S.tab === "chat" ? viewChat()
                          : viewMe();

    const slot = $("composerSlot");
    if (conv && !S.offline) {
      slot.innerHTML = `
        ${S.nye ? `<button class="nyepill" data-nye="1">${S.nye} ny${S.nye === 1 ? " melding" : "e meldinger"} ↓</button>` : ""}
        ${S.svarTil ? `<div class="svarforhaand">
          <div class="svarinfo">
            <b>Svarer ${esc(S.svarTil.who)}</b>
            <span>${esc(S.svarTil.txt.slice(0, 80))}${S.svarTil.txt.length > 80 ? "…" : ""}</span>
          </div>
          <button class="minibtn" id="avbrytSvar" aria-label="Avbryt svaret">✕</button>
        </div>` : ""}
        <form class="composer" id="composer">
          <input id="msgInput" placeholder="${S.svarTil ? "Skriv svaret…" : "Melding til " + esc(conv.name) + "…"}" autocomplete="off" enterkeyhint="send" maxlength="2000">
          <button class="send" type="submit" aria-label="Send melding">${ICON.send}</button>
        </form>`;
      $("composer").addEventListener("submit", onSend);
      const avbryt = $("avbrytSvar");
      if (avbryt) avbryt.addEventListener("click", () => { S.svarTil = null; render(); });
      settOppMeldingsgester();
      const sc = $("screen");
      if (S.beholdSkroll) {
        sc.scrollTop = S.beholdSkroll.topp + (sc.scrollHeight - S.beholdSkroll.hoyde);
      } else if (naerBunn) sc.scrollTop = sc.scrollHeight;
    } else slot.innerHTML = "";
    S.tilBunn = false;
    S.beholdSkroll = null;

    settOppDraing();
    startKarttimere();

    // Dagsvelgeren skal stå der du forlot den, ikke hoppe til mandag.
    const chipsEtter = $("screen").querySelector(".chips");
    if (chipsEtter) {
      chipsEtter.scrollLeft = chipsScroll;
      const valgt = chipsEtter.querySelector('[aria-pressed="true"]');
      if (valgt) {
        // Rull akkurat så langt at knappen så vidt er inne, ikke til midten.
        const v = valgt.getBoundingClientRect(), c = chipsEtter.getBoundingClientRect();
        const marg = 14;
        if (v.left < c.left + marg) chipsEtter.scrollLeft -= (c.left + marg) - v.left;
        else if (v.right > c.right - marg) chipsEtter.scrollLeft += v.right - (c.right - marg);
      }
    }

    // Fanerada er i veien når du skriver i en samtale.
    $("tabbar").hidden = Boolean(conv);
    const antall = oppgaver().length;
    $("tabbar").innerHTML = [
      ["program","Program",ICON.cal], ["chat","Chat",ICON.chat], ["meg","Meg",ICON.me]
    ].map(([id,label,ic]) =>
      `<button role="tab" aria-selected="${S.tab === id}" data-tab="${id}">
        <span class="ikon">${ic}${id === "meg" && antall ? `<span class="varsel">${antall}</span>` : ""}</span>
        <span>${label}</span></button>`
    ).join("");
  }

  /* ───────────────── åpne og lukke en samtale ───────────────── */
  async function openChat(channelId, fromHistory) {
    S.openChat = channelId;
    S.loadingChat = true;
    S.nye = 0; S.sistAntall = 0;
    Api.setLastChannel(S.trip.id, channelId);
    render();
    if (!fromHistory) history.pushState({ chat: channelId }, "");
    // Reaksjoner strømmes bare for samtalen du faktisk ser på.
    if (!S.offline) Api.subscribeChannel(channelId);
    try { await Api.loadMessages(S.trip.id, channelId); }
    catch { toast("Klarte ikke hente meldingene."); }
    S.loadingChat = false;
    render();
  }

  function closeChat(fromHistory) {
    if (!S.openChat) return false;
    S.openChat = null;
    S.nye = 0;
    Api.unsubscribeChannel();
    render();
    if (!fromHistory && history.state && history.state.chat) history.back();
    return true;
  }

  window.addEventListener("popstate", () => { if (S.openChat) closeChat(true); });

  /* Ligger appen i bakgrunnen, kobler vi fra strømmen av meldinger.
     En telefon i lomma trenger den ikke, og hver pålogget teller: én
     melding til hundre påloggede er hundre meldinger gjennom Supabase.
     Vi venter et halvt minutt, så et raskt bytte til kartet ikke koster
     en ny tilkobling — og henter igjen det vi gikk glipp av når appen
     kommer fram. */
  let bakgrunnstimer = null;
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState === "hidden") {
      clearTimeout(bakgrunnstimer);
      bakgrunnstimer = setTimeout(() => Api.kobleFra(), 30000);
      return;
    }
    clearTimeout(bakgrunnstimer); bakgrunnstimer = null;
    if (!S.trip || S.offline) return;

    Api.subscribeTrip(S.trip.id);
    if (S.openChat) {
      Api.subscribeChannel(S.openChat);
      await Api.loadMessages(S.trip.id, S.openChat).catch(() => {});
    }
    await Api.loadRecent(S.trip.id).catch(() => {});
    try { S.trip = (await Api.loadTrip(S.trip.id)) || S.trip; } catch {}
    Api.lastVaer(S.trip.id);
    render();
  });


  /* ───────────────── send melding ───────────────── */
  async function onSend(e) {
    e.preventDefault();
    const inp = $("msgInput");
    const txt = inp.value.trim();
    if (!txt || S.busy) return;
    inp.value = "";
    const action = Parse.analyse(S.trip, txt);
    try {
      await Api.sendMessage(S.trip.id, S.openChat, txt, action, S.svarTil ? S.svarTil.id : null);
      S.svarTil = null;
      S.tilBunn = true;          // din egen melding skal du alltid se
      render();
    } catch (err) {
      inp.value = txt;
      toast(err && err.kjent ? err.message : "Meldingen ble ikke sendt. Sjekk nettet.");
    }
  }

  /* ───────────────── ark ───────────────── */
  function openSheet(html) {
    const s = $("sheet");
    s.innerHTML = `<div class="grabsone"><div class="grab"></div></div><div class="sheetbody">${html}</div>`;
    s.style.transform = "";
    const kropp0 = s.querySelector(".sheetbody");
    if (kropp0) kropp0.scrollTop = 0;
    $("sheetBg").hidden = false;
  }
  function closeSheet() {
    $("sheetBg").hidden = true;
    $("sheet").style.transform = "";
  }

  /* Dra arket nedover for å lukke det, slik man gjør i apper ellers.

     iOS gir oss ikke pekerbevegelser når fingeren havner i et felt som
     kan skrolle — nettleseren tar gesten selv. Derfor lyttes det på
     berøring direkte, der vi kan si fra at vi tar over. Mus håndteres
     for seg, siden den ikke sender berøringshendelser. */
  (function dragToClose() {
    const s = $("sheet");
    let startY = 0, dy = 0, drar = false, kandidat = false, iHandtak = false;

    const kroppen = () => s.querySelector(".sheetbody");
    const kontroll = el => el && el.closest("input, textarea, select, button, a, [contenteditable]");

    function start(mål, y) {
      iHandtak = !!(mål && mål.closest(".grabsone"));
      if (!iHandtak) {
        if (kontroll(mål)) return false;
        const k = kroppen();
        if (k && k.scrollTop > 0) return false;   // skroll, ikke lukk
      }
      kandidat = true; drar = false; startY = y; dy = 0;
      return true;
    }

    function beveg(y, kanStoppe) {
      if (!kandidat) return false;
      const d = y - startY;
      if (!drar) {
        const terskel = iHandtak ? 3 : 10;
        if (d < terskel) { if (d < -terskel) kandidat = false; return false; }
        // Har innholdet rukket å skrolle i mellomtiden, er dette en skroll.
        const k = kroppen();
        if (!iHandtak && k && k.scrollTop > 0) { kandidat = false; return false; }
        drar = true;
        s.classList.add("dragging");
      }
      dy = Math.max(0, d);
      s.style.transform = `translateY(${dy}px)`;
      return kanStoppe;
    }

    function slutt() {
      kandidat = false;
      if (!drar) return;
      drar = false;
      s.classList.remove("dragging");
      if (dy > 100) closeSheet();
      else s.style.transform = "";
    }

    // Berøring
    s.addEventListener("touchstart", e => {
      if (e.touches.length !== 1) return;
      start(e.target, e.touches[0].clientY);
    }, { passive: true });

    s.addEventListener("touchmove", e => {
      if (beveg(e.touches[0].clientY, true) && e.cancelable) e.preventDefault();
    }, { passive: false });

    s.addEventListener("touchend", slutt);
    s.addEventListener("touchcancel", slutt);

    // Mus
    s.addEventListener("mousedown", e => { if (e.button === 0) start(e.target, e.clientY); });
    window.addEventListener("mousemove", e => { if (kandidat) beveg(e.clientY, false); });
    window.addEventListener("mouseup", slutt);
  })();

  function sheetPlace(id) {
    const p = S.trip.places[id];
    if (!p) return;
    const leder = S.trip.role === "leader";
    openSheet(`
      <div class="eyebrow">${esc(p.kind)}</div>
      <h3>${esc(p.name)}</h3>
      <div class="addr">${esc(p.addr || "Ingen adresse lagt inn")}</div>
      ${trygLenke(p.url) ? `<div class="addr"><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.url)}</a></div>` : ""}
      ${p.addr ? `<div class="acts">
        <a class="btn primary" href="${mapsGoogle(p)}" target="_blank" rel="noopener">${ICON.nav} Google Maps</a>
        <a class="btn" href="${mapsApple(p)}" target="_blank" rel="noopener">${ICON.pin} Apple Maps</a>
      </div>` : ""}
      ${leder ? `<form id="adrForm" style="margin-top:16px">
        <div class="field">
          <label for="adrInn">${p.addr ? "Endre adresse" : "Legg inn adresse"}</label>
          <input id="adrInn" value="${esc(p.addr)}" placeholder="Gate, postnummer, sted">
        </div>
        <button class="btn primary" style="width:100%" type="submit">Lagre adressen</button>
      </form>` : ""}
      <button class="btn close" data-close>Lukk</button>`);

    if (leder) $("adrForm").addEventListener("submit", async e => {
      e.preventDefault();
      try {
        await Api.updatePlace(id, { addr: $("adrInn").value.trim() });
        closeSheet();
        await openTrip(S.trip.id);
        toast("Adressen er lagret.");
      } catch { toast("Klarte ikke lagre adressen."); }
    });
  }

  /* Ett programpunkt: kart for alle, og endring for reiseledere. */
  function sheetItem(itemId) {
    const dag = S.trip.days.find(d => d.items.some(i => i.id === itemId));
    const it = dag && dag.items.find(i => i.id === itemId);
    if (!it) return;
    const p = it.place ? S.trip.places[it.place] : null;
    const leder = S.trip.role === "leader";

    openSheet(`
      <div class="eyebrow">${esc(dag.label)}${it.t ? " · " + esc(it.t) : ""}</div>
      <h3>${esc(it.title)}</h3>
      ${p ? `<div class="addr">${esc(p.name)}${p.addr ? " · " + esc(p.addr) : " · ingen adresse"}</div>` : ""}
      ${it.note ? `<div class="addr">${esc(it.note)}</div>` : ""}
      ${p && p.addr ? `<div class="acts">
        <a class="btn primary" href="${mapsGoogle(p)}" target="_blank" rel="noopener">${ICON.nav} Google Maps</a>
        <a class="btn" href="${mapsApple(p)}" target="_blank" rel="noopener">${ICON.pin} Apple Maps</a>
      </div>` : ""}

      ${leder ? `
        <form id="itemForm" style="margin-top:18px;border-top:1px solid var(--line-soft);padding-top:16px">
          <div class="eyebrow" style="margin-bottom:10px">Endre punktet</div>
          <div class="field"><label for="eTid">Klokkeslett</label>
            <input id="eTid" type="time" value="${esc(it.t)}">
            <small style="color:var(--ink-3);display:block;margin-top:5px">La stå tomt hvis tiden ikke er bestemt.</small></div>
          <div class="field"><label for="eTittel">Hva skjer</label><input id="eTittel" value="${esc(it.title)}"></div>
          <div class="field"><label for="eSted">Sted</label>
            <select id="eSted" class="select">
              <option value="">Ingen / ikke stedfestet</option>
              ${placeOptions(it.place)}
              <option value="__new">+ Nytt sted…</option>
            </select></div>
          <div id="eNyttSted" hidden>
            <div class="field"><label for="eNavn">Navn på stedet</label><input id="eNavn"></div>
            <div class="field"><label for="eAdr">Adresse</label><input id="eAdr" placeholder="Gate, postnummer, sted"></div>
          </div>
          <div class="field"><label for="eNotat">Notat</label><input id="eNotat" value="${esc(it.note)}"></div>
          <p class="err" id="eErr" hidden></p>
          <button class="btn primary big" type="submit" id="eLagre">Lagre endringene</button>
        </form>
        <button class="btn danger" style="width:100%;margin-top:10px" data-delitem="${esc(it.id)}">Slett punktet</button>
      ` : ""}
      <button class="btn close" data-close>Lukk</button>`);

    if (!leder) return;

    $("eSted").addEventListener("change", e => {
      $("eNyttSted").hidden = e.target.value !== "__new";
    });

    $("itemForm").addEventListener("submit", async e => {
      e.preventDefault();
      const btn = $("eLagre"), err = $("eErr");
      btn.disabled = true; btn.innerHTML = prikker() + " Lagrer";
      try {
        let placeId = $("eSted").value || null;
        if (placeId === "__new") {
          const navn = $("eNavn").value.trim();
          if (!navn) throw new Error("Stedet trenger et navn.");
          placeId = await Api.addPlace(S.trip.id, {
            name: navn, addr: $("eAdr").value.trim(), kind: "Sted"
          });
        }
        await Api.updateItem(it.id, {
          t: $("eTid").value,
          title: $("eTittel").value.trim() || it.title,
          placeId,
          note: $("eNotat").value.trim()
        });
        closeSheet();
        await openTrip(S.trip.id);
        toast("Punktet er oppdatert.");
      } catch (e2) {
        btn.disabled = false; btn.textContent = "Lagre endringene";
        err.textContent = e2.message; err.hidden = false;
      }
    });
  }


  function sheetTrips() {
    const rows = S.trips.map(t => `<button class="listrow" data-opentrip="${esc(t.id)}" aria-current="${t.id === S.trip.id}">
      <div class="grow"><div class="nm">${esc(t.name)}</div><div class="sub">${esc(t.dates || t.org || "")}</div></div>
      <span class="chev">${ICON.chev}</span></button>`).join("");
    openSheet(`<h3>Dine turer</h3>
      <div class="list" style="margin-top:8px">${rows || venter("Henter turene dine")}</div>
      <div class="stack" style="margin-top:12px">
        <button class="btn" data-sheet="jointrip">Bli med på en ny tur</button>
        <button class="btn" data-sheet="newtrip">Lag en ny tur</button>
      </div>
      <button class="btn close" data-close>Lukk</button>`);
  }

  function sheetJoinTrip() {
    openSheet(`<h3>Bli med på en ny tur</h3>
      <p class="muted" style="margin:6px 0 14px">Skriv turkoden du fikk av reiselederen.</p>
      <form id="joinTripForm">
        <div class="field"><label for="jCode">Turkode</label>
          <input id="jCode" autocapitalize="characters" spellcheck="false" class="mono" style="text-transform:uppercase"></div>
        <p class="err" id="jErr" hidden></p>
        <button class="btn primary big" type="submit">Bli med</button>
      </form>
      <button class="btn close" data-close>Avbryt</button>`);

    $("joinTripForm").addEventListener("submit", async e => {
      e.preventDefault();
      const p = Api.getProfile();
      try {
        const trip = await Api.joinByCode($("jCode").value, p ? p.name : "Deltaker");
        closeSheet();
        S.trips = await Api.myTrips().catch(() => S.trips);
        await openTrip(trip.id);
        toast("Du er med på " + trip.name);
      } catch (err) {
        $("jErr").textContent = err.message; $("jErr").hidden = false;
      }
    });
  }

  function sheetNewTrip() {
    const p = Api.getProfile();
    const tplOptions = TEMPLATES.map(t =>
      `<label class="pick"><input type="radio" name="tpl" value="${esc(t.key)}">
        <span><b>${esc(t.name)}</b> — ${esc(t.lengthLabel)}<br><small>${esc(t.blurb)}</small></span></label>`).join("");

    openSheet(`<h3>Lag en ny tur</h3>
      <p class="muted" style="margin:6px 0 14px">Du blir reiseleder og får en turkode å dele ut.</p>
      <form id="newTripForm">
        ${p ? "" : `<div class="field"><label for="tFirst">Ditt fornavn</label><input id="tFirst"></div>
                    <div class="field"><label for="tLast">Ditt etternavn</label><input id="tLast"></div>`}
        <div class="field"><label for="tName">Navn på turen</label><input id="tName" placeholder="Berlin 2027"></div>
        <div class="field"><label for="tOrg">Klasse eller gruppe</label><input id="tOrg" placeholder="2STB Nordvang vgs"></div>
        <div class="field">
          <label>Start med</label>
          <div class="picks">
            <label class="pick"><input type="radio" name="tpl" value="" checked>
              <span><b>Tomt program</b><br><small>Du legger inn dagene selv.</small></span></label>
            ${tplOptions}
          </div>
        </div>
        <p class="err" id="tErr" hidden></p>
        <button class="btn primary big" type="submit" id="tSubmit">Opprett turen</button>
      </form>
      <button class="btn close" data-close>Avbryt</button>`);

    $("newTripForm").addEventListener("submit", async e => {
      e.preventDefault();
      const btn = $("tSubmit");
      const err = $("tErr");
      let prof = Api.getProfile();
      if (!prof) {
        const f = $("tFirst").value.trim(), l = $("tLast").value.trim();
        if (!f || !l) { err.textContent = "Skriv navnet ditt."; err.hidden = false; return; }
        prof = Api.setProfile(f, l);
      }
      const name = $("tName").value.trim();
      if (!name) { err.textContent = "Turen trenger et navn."; err.hidden = false; return; }

      const key = (document.querySelector('input[name="tpl"]:checked') || {}).value;
      const tpl = TEMPLATES.find(t => t.key === key) || null;

      btn.disabled = true; btn.innerHTML = prikker() + (tpl ? " Lager turen og programmet" : " Lager turen");
      try {
        const plan = tpl ? templateDates(tpl) : null;

        const trip = await Api.createTrip({
          name, org: $("tOrg").value.trim(), dates: "", leaderName: prof.name
        });
        if (tpl) await Api.applyTemplate(trip.id, tpl, plan.dates);

        closeSheet();
        S.trips = await Api.myTrips().catch(() => S.trips);
        S.tab = "program";
        await openTrip(trip.id);
        toast("Turen er laget. Kode: " + trip.code);
      } catch (e2) {
        btn.disabled = false; btn.textContent = "Opprett turen";
        err.textContent = e2.message; err.hidden = false;
      }
    });
  }

  async function sheetNewChannel() {
    openSheet(`<h3>Ny chat i ${esc(S.trip.name)}</h3>
      <p class="muted" style="margin:6px 0 14px">For eksempel en gruppe som skal et annet sted enn resten.</p>
      <form id="newChForm">
        <div class="field"><label for="cName">Navn på chatten</label><input id="cName" placeholder="Gruppe Eiffeltårnet"></div>
        <div class="field"><label for="cSub">Kort beskrivelse</label><input id="cSub" placeholder="Onsdag"></div>
        <div class="field">
          <label>Hvem skal se den</label>
          <div class="picks">
            <label class="pick"><input type="radio" name="priv" value="" checked>
              <span><b>Hele turen</b><br><small>Alle som er med på turen kan lese og skrive.</small></span></label>
            <label class="pick"><input type="radio" name="priv" value="1">
              <span><b>Bare de jeg velger</b><br><small>Usynlig for alle andre — også for reiseledere.</small></span></label>
          </div>
        </div>
        <div class="field" id="memberPick" hidden>
          <label>Velg deltakere</label>
          <div id="memberList" class="memberlist">${venter("Henter deltakere")}</div>
        </div>
        <p class="err" id="chErr" hidden></p>
        <button class="btn primary big" type="submit" id="chSubmit">Opprett chat</button>
      </form>
      <button class="btn close" data-close>Avbryt</button>`);

    let people = [];
    Api.tripMembers(S.trip.id).then(list => {
      people = list.filter(p => !p.me);
      const box = $("memberList");
      if (!box) return;
      box.innerHTML = people.length
        ? people.map(p => `<label class="person">
            <input type="checkbox" value="${esc(p.id)}">
            <span>${esc(p.name)}${p.role === "leader" ? ' <em>reiseleder</em>' : ""}</span></label>`).join("")
        : `<p class="muted" style="padding:10px">Ingen andre har blitt med på turen ennå. Du kan legge dem til senere.</p>`;
    }).catch(() => {
      const box = $("memberList");
      if (box) box.innerHTML = `<p class="muted" style="padding:10px">Klarte ikke hente deltakerlista.</p>`;
    });

    document.querySelectorAll('input[name="priv"]').forEach(r =>
      r.addEventListener("change", () => {
        $("memberPick").hidden = !document.querySelector('input[name="priv"]:checked').value;
      }));

    $("newChForm").addEventListener("submit", async e => {
      e.preventDefault();
      const name = $("cName").value.trim();
      const err = $("chErr"), btn = $("chSubmit");
      if (!name) { err.textContent = "Chatten trenger et navn."; err.hidden = false; return; }
      const isPrivate = Boolean(document.querySelector('input[name="priv"]:checked').value);
      const ids = isPrivate
        ? [...document.querySelectorAll("#memberList input:checked")].map(c => c.value)
        : [];
      btn.disabled = true; btn.textContent = "Oppretter…";
      try {
        const id = await Api.addChannel(S.trip.id, name, $("cSub").value.trim(), isPrivate, ids);
        Api.setLastChannel(S.trip.id, id);
        closeSheet();
        await openTrip(S.trip.id);
        S.tab = "chat"; await openChat(id);
      } catch (e2) {
        btn.disabled = false; btn.textContent = "Opprett chat";
        err.textContent = e2.message; err.hidden = false;
      }
    });
  }

  /* Deltakere i én chat — hvem som kan lese den, og hvem du kan legge til. */
  async function sheetChannelMembers(channelId) {
    const ch = S.trip.channels.find(c => c.id === channelId);
    if (!ch) return;

    openSheet(`<h3>${esc(ch.name)}</h3>
      <p class="muted" style="margin:6px 0 14px">
        ${ch.private
          ? "Privat chat. Bare de som står her kan lese den — reiseledere ser den ikke."
          : "Åpen chat. Alle som er med på turen kan lese og skrive her."}</p>
      <div class="person" style="margin-bottom:16px">
        <span>Varsler herfra</span>
        <select class="select minivalg" id="chatVarsel">
          <option value="folg" ${!Api.varselvalg().chat[channelId] ? "selected" : ""}>Følg turen</option>
          ${NIVAER.map(([v, navn]) => `<option value="${v}"
            ${Api.varselvalg().chat[channelId] === v ? "selected" : ""}>${navn}</option>`).join("")}
        </select>
      </div>
      <div id="cmBody">${venter("Henter")}</div>
      <button class="btn close" data-close>Lukk</button>`);

    $("chatVarsel").addEventListener("change", async e => {
      try { await Api.settVarselNiva(S.trip.id, channelId, e.target.value); toast("Lagret."); }
      catch (err) { toast(err.message || "Klarte ikke lagre."); }
    });

    if (!ch.private) {
      try {
        const all = await Api.tripMembers(S.trip.id);
        $("cmBody").innerHTML = `<div class="memberlist">${all.map(p =>
          `<div class="person"><span>${esc(p.name)}${p.me ? " <em>deg</em>" : p.role === "leader" ? ' <em>reiseleder</em>' : ""}</span></div>`
        ).join("")}</div>`;
      } catch { $("cmBody").innerHTML = `<p class="muted">Klarte ikke hente deltakerlista.</p>`; }
      return;
    }

    try {
      const [all, inChannel] = await Promise.all([
        Api.tripMembers(S.trip.id),
        Api.channelMembers(channelId)
      ]);
      const inSet = new Set(inChannel);
      const members = all.filter(p => inSet.has(p.id));
      const others = all.filter(p => !inSet.has(p.id));

      $("cmBody").innerHTML = `
        <div class="eyebrow" style="margin-bottom:6px">Med i chatten</div>
        <div class="memberlist">${members.map(p => `<div class="person">
          <span>${esc(p.name)}${p.me ? " <em>deg</em>" : ""}</span>
          ${p.me ? "" : `<button class="linkbtn" data-cmdel="${esc(p.id)}">fjern</button>`}
        </div>`).join("")}</div>
        ${others.length ? `
          <div class="eyebrow" style="margin:16px 0 6px">Andre på turen</div>
          <div class="memberlist">${others.map(p => `<div class="person">
            <span>${esc(p.name)}${p.role === "leader" ? ' <em>reiseleder</em>' : ""}</span>
            <button class="linkbtn" data-cmadd="${esc(p.id)}">legg til</button>
          </div>`).join("")}</div>` : ""}
        <button class="btn danger" style="width:100%;margin-top:16px" data-cmleave="${esc(channelId)}">Gå ut av chatten</button>`;

      $("cmBody").addEventListener("click", async ev => {
        const b = ev.target.closest("[data-cmadd],[data-cmdel],[data-cmleave]");
        if (!b) return;
        try {
          if (b.dataset.cmadd) await Api.addChannelMember(channelId, b.dataset.cmadd);
          else if (b.dataset.cmdel) await Api.removeChannelMember(channelId, b.dataset.cmdel);
          else {
            if (!confirm("Gå ut av chatten? Du mister tilgangen til meldingene.")) return;
            const me = all.find(p => p.me);
            await Api.removeChannelMember(channelId, me.id);
            closeSheet();
            S.openChat = null;
            await openTrip(S.trip.id);
            S.tab = "chat"; return render();
          }
          sheetChannelMembers(channelId);
        } catch (e2) { toast(e2.message || "Det gikk ikke."); }
      });
    } catch {
      $("cmBody").innerHTML = `<p class="muted">Klarte ikke hente deltakerlista.</p>`;
    }
  }

  function sheetAddDay() {
    const last = S.trip.days[S.trip.days.length - 1];
    let suggested = today();
    if (last) { const d = new Date(last.date + "T12:00:00"); d.setDate(d.getDate() + 1); suggested = d.toISOString().slice(0, 10); }

    openSheet(`<h3>Legg til dag</h3>
      <form id="addDayForm">
        <div class="field"><label for="dDate">Dato</label><input id="dDate" type="date" value="${suggested}"></div>
        <p class="err" id="dErr" hidden></p>
        <button class="btn primary big" type="submit">Legg til</button>
      </form>
      <button class="btn close" data-close>Avbryt</button>`);

    $("addDayForm").addEventListener("submit", async e => {
      e.preventDefault();
      const date = $("dDate").value;
      if (!date) return;
      try {
        await Api.addDay(S.trip.id, date);
        closeSheet();
        S.day = date;
        await openTrip(S.trip.id);
      } catch (err) {
        $("dErr").textContent = String(err.message).includes("duplicate") ? "Den datoen finnes allerede." : err.message;
        $("dErr").hidden = false;
      }
    });
  }

  function placeOptions(selected) {
    return Object.values(S.trip.places)
      .sort((a, b) => a.name.localeCompare(b.name, "nb"))
      .map(p => `<option value="${esc(p.id)}" ${p.id === selected ? "selected" : ""}>${esc(p.name)}</option>`).join("");
  }

  function sheetAddItem(dayId) {
    const day = S.trip.days.find(d => d.id === dayId);
    openSheet(`<h3>Nytt programpunkt</h3>
      <p class="muted" style="margin:6px 0 14px">${esc(day ? day.label : "")}</p>
      <form id="addItemForm">
        <div class="field"><label for="iTime">Klokkeslett</label><input id="iTime" type="time" value="09:00"></div>
        <div class="field"><label for="iTitle">Hva skjer</label><input id="iTitle" placeholder="Omvisning Berlinmuren"></div>
        <div class="field">
          <label for="iPlace">Sted</label>
          <select id="iPlace" class="select">
            <option value="">Ingen / ikke stedfestet</option>
            ${placeOptions(null)}
            <option value="__new">+ Nytt sted…</option>
          </select>
        </div>
        <div id="newPlaceFields" hidden>
          <div class="field"><label for="pName">Navn på stedet</label><input id="pName" placeholder="Gedenkstätte Berliner Mauer"></div>
          <div class="field"><label for="pAddr">Adresse</label><input id="pAddr" placeholder="Bernauer Straße 111, 13355 Berlin"></div>
          <div class="field"><label for="pKind">Type</label>
            <select id="pKind" class="select">
              <option>Sted</option><option>Hotell</option><option>Museum</option>
              <option>Attraksjon</option><option>Stasjon</option><option>Flyplass</option><option>Restaurant</option>
            </select></div>
          <p class="muted" style="margin:-4px 0 14px">Adressen er det kartet navigerer til — skriv den så nøyaktig du kan.</p>
        </div>
        <div class="field"><label for="iNote">Notat (valgfritt)</label><input id="iNote" placeholder="Møtes igjen 13:45"></div>
        <p class="err" id="iErr" hidden></p>
        <button class="btn primary big" type="submit" id="iSubmit">Legg til punktet</button>
      </form>
      <button class="btn close" data-close>Avbryt</button>`);

    $("iPlace").addEventListener("change", e => {
      $("newPlaceFields").hidden = e.target.value !== "__new";
    });

    $("addItemForm").addEventListener("submit", async e => {
      e.preventDefault();
      const err = $("iErr"), btn = $("iSubmit");
      const title = $("iTitle").value.trim();
      if (!title) { err.textContent = "Skriv hva som skjer."; err.hidden = false; return; }
      btn.disabled = true; btn.textContent = "Lagrer…";
      try {
        let placeId = $("iPlace").value || null;
        if (placeId === "__new") {
          const pn = $("pName").value.trim();
          if (!pn) throw new Error("Stedet trenger et navn.");
          placeId = await Api.addPlace(S.trip.id, {
            name: pn, addr: $("pAddr").value.trim(), kind: $("pKind").value
          });
        }
        await Api.addItem(S.trip.id, dayId, {
          t: $("iTime").value, title, placeId, note: $("iNote").value.trim()
        });
        closeSheet();
        await openTrip(S.trip.id);
      } catch (e2) {
        btn.disabled = false; btn.textContent = "Legg til punktet";
        err.textContent = e2.message; err.hidden = false;
      }
    });
  }

  function sheetHotel(dayId) {
    const day = S.trip.days.find(d => d.id === dayId);
    openSheet(`<h3>Hotell ${esc(day ? day.label : "")}</h3>
      <p class="muted" style="margin:6px 0 14px">Dette er stedet appen mener når noen skriver «hotellet» denne dagen.</p>
      <form id="hotelForm">
        <div class="field">
          <label for="hPlace">Velg sted</label>
          <select id="hPlace" class="select">
            <option value="">Ingen</option>
            ${placeOptions(day ? day.hotel : null)}
            <option value="__new">+ Nytt hotell…</option>
          </select>
        </div>
        <div id="hNewFields" hidden>
          <div class="field"><label for="hName">Navn</label><input id="hName" placeholder="Hotel Moabit Plaza"></div>
          <div class="field"><label for="hAddr">Adresse</label><input id="hAddr" placeholder="Stromstraße 62, 10551 Berlin"></div>
        </div>
        <p class="err" id="hErr" hidden></p>
        <button class="btn primary big" type="submit">Lagre</button>
      </form>
      <button class="btn close" data-close>Avbryt</button>`);

    $("hPlace").addEventListener("change", e => { $("hNewFields").hidden = e.target.value !== "__new"; });

    $("hotelForm").addEventListener("submit", async e => {
      e.preventDefault();
      try {
        let id = $("hPlace").value || null;
        if (id === "__new") {
          const n = $("hName").value.trim();
          if (!n) throw new Error("Hotellet trenger et navn.");
          id = await Api.addPlace(S.trip.id, { name: n, addr: $("hAddr").value.trim(), kind: "Hotell" });
        }
        await Api.setHotel(dayId, id);
        closeSheet();
        await openTrip(S.trip.id);
      } catch (e2) { $("hErr").textContent = e2.message; $("hErr").hidden = false; }
    });
  }

  /* ───────────────── les program fra PDF ───────────────── */
  let forslag = null;   // siste forslag fra serveren, venter på godkjenning

  function sheetImportPdf() {
    openSheet(`<h3>Les inn program fra PDF</h3>
      <p class="muted" style="margin:6px 0 14px">
        Velg programmet, bussplanen eller billettene. Appen leser dem og viser et forslag
        du må godkjenne før noe legges inn.</p>
      <form id="pdfForm">
        <div class="field">
          <label for="pdfFiles">PDF-filer</label>
          <input id="pdfFiles" type="file" accept="application/pdf" multiple>
        </div>
        <p class="muted" style="margin:-4px 0 14px">Maks 5 filer, 8 MB hver.</p>
        <p class="err" id="pdfErr" hidden></p>
        <button class="btn primary big" type="submit" id="pdfSubmit">Les filene</button>
      </form>
      <button class="btn close" data-close>Avbryt</button>`);

    $("pdfForm").addEventListener("submit", async e => {
      e.preventDefault();
      const input = $("pdfFiles"), err = $("pdfErr"), btn = $("pdfSubmit");
      const valgte = [...(input.files || [])];
      if (!valgte.length) { err.textContent = "Velg minst én fil."; err.hidden = false; return; }

      err.hidden = true;
      btn.disabled = true; btn.innerHTML = prikker() + " Leser filene";
      try {
        const filer = [];
        for (const f of valgte) filer.push({ navn: f.name, data: await tilBase64(f) });
        const svar = await Api.lesProgramFraPdf(S.trip.id, filer);
        forslag = svar.forslag;
        visForslag(svar);
      } catch (e2) {
        btn.disabled = false; btn.textContent = "Les filene";
        err.textContent = e2.message; err.hidden = false;
      }
    });
  }

  function tilBase64(fil) {
    return new Promise((ok, feil) => {
      const r = new FileReader();
      r.onload = () => ok(String(r.result).split(",")[1]);
      r.onerror = () => feil(new Error("Klarte ikke lese " + fil.name));
      r.readAsDataURL(fil);
    });
  }

  function visForslag(svar) {
    const dager = (forslag.dager || []).filter(d => d.dato);
    const utenDato = (forslag.dager || []).length - dager.length;
    const advarsler = (forslag.usikkert || []).slice();
    if (utenDato) advarsler.push(`${utenDato} dag(er) manglet dato og er utelatt.`);

    if (!dager.length) {
      openSheet(`<h3>Fant ikke noe program</h3>
        <p class="muted" style="margin:10px 0">Filen inneholdt ingen datoer.
        Er det en skannet PDF som bare er bilder, klarer ikke appen å lese den.</p>
        ${advarsler.length ? `<div class="card pad" style="padding-block:12px"><div class="eyebrow">Merknader</div>
          <ul style="margin:8px 0 0;padding-left:18px;font-size:14px;color:var(--ink-2)">
            ${advarsler.map(a => `<li>${esc(a)}</li>`).join("")}</ul></div>` : ""}
        <button class="btn close" data-close>Lukk</button>`);
      return;
    }

    let utenTid = 0;
    const bolker = dager.map((d, i) => {
      const dag = Api.fmtDay(d.dato);

      const punkter = (d.punkter || []).map((p, j) => {
        if (!p.tid) utenTid++;
        return `<div class="imprad">
          <label class="impvelg">
            <input type="checkbox" data-punkt="${i}-${j}" checked>
            <span class="imptxt">
              ${p.tid ? `<b class="mono">${esc(p.tid)}</b> ` : ""}${esc(p.tittel)}
              ${p.stedNavn ? `<small>${esc(p.stedNavn)}</small>` : ""}
            </span>
          </label>
          ${p.tid ? "" : `<div class="imptid">
            <label for="tid-${i}-${j}">Klokkeslett — sto ikke i filen</label>
            <input type="time" id="tid-${i}-${j}" data-tid="${i}-${j}">
          </div>`}
        </div>`;
      }).join("");

      // Bare hotellet trenger adresse med én gang — det er det «hotellet»
      // i chatten slår opp mot. Andre steder kan fylles inn etterpå.
      const hotell = d.hotellNavn ? `
        <div class="hotellboks">
          <div class="hotellnavn">
            <span>${esc(d.hotellNavn)}</span>
            <button type="button" class="btn quiet" data-kopi="${esc(d.hotellNavn)}">Kopier navn</button>
          </div>
          ${d.hotellAdresse
            ? `<small>${esc(d.hotellAdresse)}</small>`
            : `<input data-hoteladr="${i}" placeholder="Lim inn adressen her">
               <small>Filen oppga ${d.hotellNettside ? "bare en nettlenke" : "ingen adresse"}.
               Kopier navnet, søk det opp i kart, og lim adressen inn her — ellers virker ikke veibeskrivelsen.</small>`}
        </div>` : "";

      return `<div style="margin-bottom:20px">
        <div class="eyebrow" style="margin-bottom:7px">${esc(dag.label)}</div>
        ${hotell}
        <div class="memberlist">${punkter || '<p class="muted" style="padding:10px">Ingen punkter.</p>'}</div>
      </div>`;
    }).join("");

    const antall = dager.reduce((n, d) => n + (d.punkter || []).length, 0);

    openSheet(`<h3>Forslag fra filen</h3>
      <p class="muted" style="margin:6px 0 14px">
        ${dager.length} dager og ${antall} punkter, i samme rekkefølge som i filen.</p>
      ${utenTid ? `<div class="card pad" style="padding-block:12px;margin-bottom:14px;border-left:3px solid var(--blue)">
        <div class="eyebrow" style="color:var(--blue-ink)">${utenTid} punkter uten klokkeslett</div>
        <p style="margin:7px 0 0;font-size:13.5px;color:var(--ink-2)">Filen oppga ingen tid for disse.
        De beholder rekkefølgen sin uansett. Du kan fylle inn tid nå, eller senere.</p></div>` : ""}
      ${advarsler.length ? `<div class="card pad" style="padding-block:12px;margin-bottom:16px;border-left:3px solid var(--amber)">
        <div class="eyebrow" style="color:var(--amber)">Appen er usikker på</div>
        <ul style="margin:8px 0 0;padding-left:18px;font-size:13.5px;color:var(--ink-2)">
          ${advarsler.map(a => `<li>${esc(a)}</li>`).join("")}</ul></div>` : ""}
      ${bolker}
      <p class="err" id="impErr" hidden></p>
      <button class="btn primary big" id="impSubmit">Legg inn i programmet</button>
      <button class="btn close" data-close>Avbryt</button>`);

    $("impSubmit").addEventListener("click", () => leggInnForslag(dager));
  }

  async function leggInnForslag(dager) {
    const btn = $("impSubmit"), err = $("impErr");
    const GENERISK = /^(hotellet|hotell|lobbyen|lobby|resepsjonen|rommet|bussen|egen hånd|ukjent)$/i;

    btn.disabled = true; btn.innerHTML = prikker() + " Legger inn";
    try {
      const kjente = {};
      for (const p of Object.values(S.trip.places)) kjente[p.name.toLowerCase()] = p.id;

      const stedId = async (navn, adresse, type, url) => {
        if (!navn || GENERISK.test(navn.trim())) return null;
        const n = navn.toLowerCase();
        if (kjente[n]) return kjente[n];
        const id = await Api.addPlace(S.trip.id, {
          name: navn, addr: adresse || "", kind: type || "Sted", url: url || ""
        });
        kjente[n] = id;
        return id;
      };

      for (let i = 0; i < dager.length; i++) {
        const d = dager[i];
        const valgte = (d.punkter || [])
          .map((p, j) => ({ p, j }))
          .filter(({ j }) => {
            const boks = document.querySelector(`[data-punkt="${i}-${j}"]`);
            return boks && boks.checked;
          });
        if (!valgte.length && !d.hotellNavn) continue;

        let dagId = (S.trip.days.find(x => x.date === d.dato) || {}).id;
        if (!dagId) dagId = await Api.addDay(S.trip.id, d.dato);

        if (d.hotellNavn) {
          const skrevet = document.querySelector(`[data-hoteladr="${i}"]`);
          const adr = d.hotellAdresse || (skrevet ? skrevet.value.trim() : "");
          const hid = await stedId(d.hotellNavn, adr, "Hotell", d.hotellNettside);
          if (hid) await Api.setHotel(dagId, hid);
        }

        // Rekkefølgen fra filen beholdes — den bærer mening når tiden mangler.
        let n = 10;
        for (const { p, j } of valgte) {
          const tidFelt = document.querySelector(`[data-tid="${i}-${j}"]`);
          const tid = p.tid || (tidFelt ? tidFelt.value : "");
          const sid = await stedId(p.stedNavn, p.stedAdresse, "Sted");
          await Api.addItem(S.trip.id, dagId, {
            t: /^\d{2}:\d{2}$/.test(tid) ? tid : null,
            title: p.tittel || "Programpunkt",
            placeId: sid,
            note: p.notat || "",
            sort: n
          });
          n += 10;
        }
      }

      forslag = null;
      closeSheet();
      await openTrip(S.trip.id);
      toast("Programmet er lagt inn.");
    } catch (e) {
      btn.disabled = false; btn.textContent = "Legg inn i programmet";
      err.textContent = e.message || "Klarte ikke legge inn alt.";
      err.hidden = false;
    }
  }




  /* Deltakere på turen, og hvem som er reiseleder. */
  async function sheetTripMembers() {
    const leder = S.trip.role === "leader";
    openSheet(`<h3>Deltakere</h3>
      <p class="muted" style="margin:6px 0 14px">
        ${leder
          ? "Reiseledere kan endre programmet og lese inn PDF-er. Du kan gi rollen videre."
          : "Reiseledere kan endre programmet."}</p>
      ${leder ? `<label class="pick" style="margin-bottom:16px">
        <input type="checkbox" id="krevGodkjenning" ${S.trip.krevGodkjenning ? "checked" : ""}>
        <span><b>Krev godkjenning for å bli med</b><br>
          <small>Nye deltakere må slippes inn av en reiseleder. Turkoden alene holder ikke.</small></span>
      </label>` : ""}
      <div id="tmBody">${venter("Henter")}</div>
      <button class="btn close" data-close>Lukk</button>`);

    const bryter = $("krevGodkjenning");
    if (bryter) bryter.addEventListener("change", async () => {
      try {
        await Api.setKrevGodkjenning(S.trip.id, bryter.checked);
        S.trip.krevGodkjenning = bryter.checked;
        toast(bryter.checked ? "Nye må nå godkjennes." : "Alle med koden slipper inn.");
      } catch {
        bryter.checked = !bryter.checked;
        toast("Klarte ikke lagre. Har du kjørt siste SQL?");
      }
    });

    try {
      const folk = await Api.tripMembers(S.trip.id);
      const ventende = folk.filter(p => p.venter);
      const med = folk.filter(p => !p.venter);
      const ledere = med.filter(p => p.role === "leader");

      $("tmBody").innerHTML = `
        ${ventende.length ? `
          <div class="eyebrow" style="margin-bottom:7px;color:var(--amber)">Venter på svar · ${ventende.length}</div>
          <div class="memberlist" style="margin-bottom:18px">${ventende.map(p => `
            <div class="person">
              <span>${esc(p.name)}</span>
              <span style="display:flex;gap:10px;flex:none">
                <button class="linkbtn" data-godkjenn="${esc(p.id)}">slipp inn</button>
                <button class="linkbtn" style="color:var(--danger)" data-avvis="${esc(p.id)}">avvis</button>
              </span>
            </div>`).join("")}</div>` : ""}

        <div class="eyebrow" style="margin-bottom:7px">Med på turen · ${med.length}</div>
        <div class="memberlist">${med.map(p => `
          <div class="person">
            <span>${esc(p.name)}${p.me ? " <em>deg</em>" : ""}${p.role === "leader" ? ' <em>reiseleder</em>' : ""}</span>
            ${leder && !p.me && !p.skjult ? `<span style="display:flex;gap:10px;flex:none">
              ${p.role === "leader"
                ? (ledere.length > 1 ? `<button class="linkbtn" data-rolle="${esc(p.id)}" data-til="member">fjern rolle</button>` : "")
                : `<button class="linkbtn" data-rolle="${esc(p.id)}" data-til="leader">gjør til leder</button>`}
              <button class="linkbtn" style="color:var(--danger)" data-fjern="${esc(p.id)}" data-navn="${esc(p.name)}">fjern</button>
            </span>` : ""}
          </div>`).join("")}</div>
        ${leder ? `<p class="muted" style="margin-top:12px">Den som laget turen beholder lederrollen,
          og turen må alltid ha minst én.</p>` : ""}`;

      $("tmBody").addEventListener("click", async ev => {
        const b = ev.target.closest("[data-rolle],[data-godkjenn],[data-avvis],[data-fjern]");
        if (!b) return;
        // Å fjerne noen er ikke til å angre på, så vi spør først. Meldingene
        // deres blir stående, men tilgangen forsvinner med én gang.
        if (b.dataset.fjern &&
            !confirm(`Fjerne ${b.dataset.navn} fra turen? Da mister de tilgangen til program og chatter, og trenger turkoden på nytt for å komme inn igjen.`)) return;
        try {
          if (b.dataset.godkjenn) await Api.godkjennDeltaker(S.trip.id, b.dataset.godkjenn);
          else if (b.dataset.avvis) await Api.avvisDeltaker(S.trip.id, b.dataset.avvis);
          else if (b.dataset.fjern) await Api.fjernDeltaker(S.trip.id, b.dataset.fjern);
          else await Api.setMemberRole(S.trip.id, b.dataset.rolle, b.dataset.til);
          await openTrip(S.trip.id);
          sheetTripMembers();
        } catch (e) { toast(e.message || "Klarte ikke endre."); }
      });
    } catch {
      $("tmBody").innerHTML = `<p class="muted">Klarte ikke hente deltakerlista.</p>`;
    }
  }
  /* ───────────────── innlogging med e-post ─────────────────
     Egen side, ikke et ark: skjemaet er kort, men tastaturet tar halve
     skjermen på telefon, og i et ark lå overskriften under draghåndtaket.

     «start» er skjermen man møter først. E-post er hovedveien, fordi det
     er den eneste identiteten som overlever en ny telefon. Gjest ligger
     under — den krever ingenting, men bor bare i denne nettleseren. */
  function visAuth(modus) {
    const start = modus === "start";
    const kobler = modus === "koble";
    const harAlt = kobler && !Api.erAnonym();

    $("joinScreen").hidden = true;
    $("appScreen").hidden = true;
    $("bootScreen").hidden = true;
    $("authScreen").hidden = false;

    $("authInner").innerHTML = `
      ${start ? `<div class="mark" aria-hidden="true">
          <svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="21"/><path d="M31 17 20.5 21 17 31.5 27.5 27.5 31 17Z"/></svg>
        </div>` : `<button class="tilbake" id="authTilbake">${ICON.chevL} Tilbake</button>`}

      <h1>${start ? "TourFlow" : harAlt ? "Bytt e-postadresse" : kobler ? "Sikre kontoen" : "Logg inn"}</h1>
      <p class="lede">${start
        ? "Program, beskjeder og veibeskrivelse for klasseturen. Skriv e-posten din, så sender vi en kode — ingen passord å huske."
        : harAlt
        ? `Du er innlogget som <b>${esc(Api.minEpost() || "")}</b>. Skriv den nye adressen, så sender vi en kode dit.`
        : kobler
        ? "Du beholder turene og rollene dine. Med e-post kan du logge inn på en annen telefon, og mister ikke alt om denne blir borte."
        : "Vi sender en sekssifret kode. Ingen passord å huske."}</p>

      <form id="authForm" novalidate>
        <div class="field">
          <label for="aPost">E-post</label>
          <input id="aPost" type="email" inputmode="email" autocomplete="email"
                 autocapitalize="none" spellcheck="false" placeholder="navn@eksempel.no">
        </div>
        <p class="err" id="aFeil" hidden></p>
        <button class="btn primary big" type="submit" id="aSend">
          ${start ? "Fortsett med e-post" : "Send kode"}</button>
      </form>

      ${start ? `
        <div class="skille"><span>eller</span></div>
        <button class="btn" style="width:100%" id="gjestKnapp">Fortsett som gjest</button>
        <p class="muted" style="margin-top:9px;text-align:center">
          Som gjest bor kontoen bare i denne nettleseren. Bytter du telefon, er turene borte.</p>
        <p style="text-align:center;margin-top:22px;font-size:14.5px;color:var(--ink-2)">
          Er du reiseleder? <button type="button" class="linkbtn" id="gjestOgLag">Lag en ny tur</button>
        </p>` : ""}`;

    if (!start) setTimeout(() => $("aPost") && $("aPost").focus(), 100);

    const gjest = $("gjestKnapp");
    if (gjest) gjest.addEventListener("click", () => { S.fraStart = true; showJoin(); });

    const lagTur = $("gjestOgLag");
    if (lagTur) lagTur.addEventListener("click", () => { S.fraStart = true; showJoin(); sheetNewTrip(); });

    $("authForm").addEventListener("submit", async e => {
      e.preventDefault();
      const epost = $("aPost").value.trim();
      const feil = $("aFeil"), knapp = $("aSend");
      if (!epost.includes("@") || !epost.includes(".")) {
        feil.textContent = "Skriv en gyldig e-postadresse."; feil.hidden = false; return;
      }
      feil.hidden = true;
      knapp.disabled = true; knapp.innerHTML = prikker() + " Sender";
      try {
        if (kobler) await Api.koblePaaEpost(epost);
        else await Api.sendKode(epost);
        visAuthKode(epost, kobler);
      } catch (e2) {
        knapp.disabled = false; knapp.textContent = start ? "Fortsett med e-post" : "Send kode";
        feil.textContent = e2.message; feil.hidden = false;
      }
    });
  }

  function visAuthKode(epost, kobler) {
    $("authInner").innerHTML = `
      <button class="tilbake" id="authTilbake">${ICON.chevL} Bruk en annen adresse</button>
      <h1>Sjekk e-posten</h1>
      <p class="lede">Vi sendte en kode til <b>${esc(epost)}</b>. Den er gyldig i en time.</p>
      <p class="soppelpost"><b>Finner du den ikke?</b> Se i søppelpost — automatiske e-poster
        havner ofte der. I Gmail, sjekk også fanen «Kampanjer».</p>

      <form id="kodeForm" novalidate>
        <div class="field">
          <label for="aKode">Kode</label>
          <input id="aKode" inputmode="numeric" autocomplete="one-time-code" maxlength="8"
                 class="kodefelt" placeholder="000000">
        </div>
        <p class="err" id="kFeil" hidden></p>
        <button class="btn primary big" type="submit" id="kSend">Logg inn</button>
      </form>`;

    setTimeout(() => $("aKode") && $("aKode").focus(), 100);

    $("kodeForm").addEventListener("submit", async e => {
      e.preventDefault();
      const kode = $("aKode").value.trim();
      const feil = $("kFeil"), knapp = $("kSend");
      if (kode.length < 6) { feil.textContent = "Koden er seks siffer."; feil.hidden = false; return; }
      feil.hidden = true;
      knapp.disabled = true; knapp.innerHTML = prikker() + " Sjekker";
      try {
        if (kobler) {
          await Api.bekreftKobling(epost, kode);
          lukkAuth();
          toast("Kontoen er sikret med " + epost);
        } else {
          await Api.bekreftKode(epost, kode);
          $("authScreen").hidden = true;
          await etterInnlogging();
        }
      } catch (e2) {
        knapp.disabled = false; knapp.textContent = "Logg inn";
        feil.textContent = e2.message; feil.hidden = false;
      }
    });
  }

  /* Tilbake dit man kom fra: appen om man er inne i en tur, ellers join. */
  function lukkAuth() {
    $("authScreen").hidden = true;
    if (S.trip) { $("appScreen").hidden = false; render(); }
    else showJoin();
  }

  async function etterInnlogging() {
    let p = Api.getProfile();
    if (!p) {
      const navn = await Api.hentNavnFraTurer().catch(() => null);
      if (navn) {
        const deler = navn.split(" ");
        p = Api.setProfile(deler[0] || navn, deler.slice(1).join(" "));
      }
    }
    const turer = await Api.myTrips().catch(() => []);
    S.trips = turer;
    if (turer.length) {
      await openTrip(Api.getLastTrip() && turer.some(t => t.id === Api.getLastTrip())
        ? Api.getLastTrip() : turer[0].id);
      toast("Velkommen tilbake.");
    } else {
      showJoin();
      toast("Du er logget inn. Bli med på en tur med turkoden.");
    }
  }
  /* ───────────────── varsler ─────────────────
     Tre nivåer, fordi «alt» er uutholdelig i en tur med hundre deltakere
     og «ingenting» gjør at du går glipp av oppmøtetidene. Standard er
     midt imellom: reiseledere, svar på dine egne meldinger, og meldinger
     som avtaler et møtested. Hver chat kan settes for seg. */
  const NIVAER = [
    ["alt", "Alt", "Hver eneste melding"],
    ["viktig", "Det viktige", "Reiseledere, svar til deg, og møtesteder"],
    ["ingen", "Ingenting", "Ingen varsler herfra"]
  ];

  async function sheetVarsler() {
    const status = await Api.varselStatus();
    const iOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const installert = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

    // På iPhone finnes varsler bare når appen ligger på hjemskjermen.
    // Det er Apple som bestemmer det, ikke vi — så da sier vi hvordan.
    const paaHjem = iOS && !installert;

    const topp = paaHjem
      ? `<div class="card pad" style="padding-block:14px;border-left:3px solid var(--amber)">
           <b style="font-family:Archivo,sans-serif;font-size:14px">Legg appen på hjemskjermen først</b>
           <p style="margin:7px 0 0;font-size:13.5px;color:var(--ink-2)">
             På iPhone kan bare apper på hjemskjermen gi varsler. Trykk delingsknappen
             nederst i Safari, velg <b>Legg til på Hjem-skjerm</b>, og åpne TourFlow derfra.</p>
         </div>`
      : status === "umulig"
      ? `<p class="muted">Denne nettleseren støtter ikke varsler.</p>`
      : status === "avslaatt"
      ? `<div class="card pad" style="padding-block:14px;border-left:3px solid var(--amber)">
           <b style="font-family:Archivo,sans-serif;font-size:14px">Varsler er blokkert</b>
           <p style="margin:7px 0 0;font-size:13.5px;color:var(--ink-2)">
             Du har sagt nei til varsler for denne siden en gang. Det må slås på igjen
             i nettleserens innstillinger for nettstedet.</p>
         </div>`
      : `<button class="btn ${status === "paa" ? "" : "primary"} big" id="varselBryter" style="width:100%">
           ${status === "paa" ? "Slå av varsler på denne enheten" : "Slå på varsler"}</button>
         <p class="muted" style="margin-top:8px">
           ${status === "paa"
             ? "Varsler kommer til denne enheten. Har du flere enheter, må hver av dem slås på."
             : "Gjelder bare denne enheten. Valgene under følger kontoen din."}</p>`;

    openSheet(`<h3>Varsler</h3>
      ${topp}
      <div id="varselValg" style="margin-top:18px">${venter("Henter innstillinger")}</div>
      <button class="btn close" data-close>Lukk</button>`);

    const bryter = $("varselBryter");
    if (bryter) bryter.addEventListener("click", async () => {
      bryter.disabled = true;
      bryter.innerHTML = prikker() + (status === "paa" ? " Slår av" : " Slår på");
      try {
        if (status === "paa") { await Api.slaaAvVarsler(); toast("Varsler er av på denne enheten."); }
        else { await Api.slaaPaaVarsler(); toast("Varsler er på."); }
        sheetVarsler();
      } catch (e) {
        bryter.disabled = false;
        bryter.textContent = status === "paa" ? "Slå av varsler på denne enheten" : "Slå på varsler";
        toast(e.message || "Det gikk ikke.");
      }
    });

    try {
      await Api.lastVarselvalg(S.trip.id);
      const turNiva = Api.varselNiva(null);

      $("varselValg").innerHTML = `
        <div class="eyebrow" style="margin-bottom:8px">Hele turen</div>
        <div class="picks">
          ${NIVAER.map(([v, navn, forklaring]) => `<label class="pick">
            <input type="radio" name="turniva" value="${v}" ${turNiva === v ? "checked" : ""}>
            <span><b>${navn}</b><br><small>${forklaring}</small></span></label>`).join("")}
        </div>

        <div class="eyebrow" style="margin:18px 0 8px">Enkeltchatter</div>
        <div class="memberlist">
          ${S.trip.channels.map(c => `<div class="person">
            <span>${esc(c.name)}</span>
            <select class="select minivalg" data-chatniva="${esc(c.id)}">
              <option value="folg" ${!Api.varselvalg().chat[c.id] ? "selected" : ""}>Følg turen</option>
              ${NIVAER.map(([v, navn]) => `<option value="${v}"
                ${Api.varselvalg().chat[c.id] === v ? "selected" : ""}>${navn}</option>`).join("")}
            </select>
          </div>`).join("")}
        </div>`;

      $("varselValg").addEventListener("change", async ev => {
        const rad = ev.target;
        try {
          if (rad.name === "turniva") {
            await Api.settVarselNiva(S.trip.id, null, rad.value);
            toast("Lagret for hele turen.");
          } else if (rad.dataset.chatniva) {
            await Api.settVarselNiva(S.trip.id, rad.dataset.chatniva, rad.value);
            toast("Lagret for chatten.");
          }
        } catch (e) { toast(e.message || "Klarte ikke lagre."); }
      });
    } catch {
      $("varselValg").innerHTML = `<p class="muted">Klarte ikke hente innstillingene.
        Har du kjørt siste SQL?</p>`;
    }
  }

  function sheetAbout() {
    openSheet(`<h3>Om appen</h3>
      <p style="margin:10px 0;font-size:14.5px;color:var(--ink-2)">
        TourFlow samler program, beskjeder og veibeskrivelser for én klassetur. Når noen avtaler
        et møtested i chatten, kobler appen det mot programmet og finner riktig adresse for den dagen.</p>
      <div class="card pad" style="padding-block:12px;margin-top:6px">
        <dl class="kv">
          <dt>Lagring</dt><dd>Program og meldinger ligger i en database. Du ser bare turer du er medlem av.</dd>
          <dt>Pålogging</dt><dd>Enheten din får en anonym identitet. Navnet er selvvalgt.</dd>
          <dt>Kart</dt><dd>Adressen åpnes i Google Maps eller Apple Maps.</dd>
        </dl>
      </div>
      <p class="muted" style="margin-top:12px">Turkoden er en nøkkel til et rom. Alle som har den kan bli
      med og lese alt som skrives i turen — del den bare med dem som skal være med, og lag en ny tur
      hvis koden kommer på avveie.</p>
      <button class="btn close" data-close>Lukk</button>`);
  }

  /* ───────────────── hendelser ───────────────── */
  document.addEventListener("click", async e => {
    const t = e.target.closest("[data-tab],[data-day],[data-channel],[data-sheet],[data-opentrip],[data-close],[data-copy],[data-edit],[data-delitem],[data-delday],[data-delmsg],[data-leave],[data-deltrip],[data-members],[data-openchat],[data-item],[data-kopi],[data-skjul],[data-vis],[data-kartapne],[data-kartlukk],[data-nye],[data-eldre],#authTilbake,#joinTilbake,[data-emoji],[data-hopp],[data-svar],#tripBtn,#meBtn,#resetBtn,#backBtn");
    if (!t) return;

    if (t.id === "joinTilbake") { S.fraStart = false; return visAuth("start"); }
    if (t.id === "authTilbake") {
      // Paa kodesteget betyr tilbake "bruk en annen adresse", ikke ut.
      return $("authInner").querySelector("#kodeForm") ? visAuth(S.trip && !Api.erAnonym() ? "koble" : "logginn") : lukkAuth();
    }
    if (t.hasAttribute("data-close")) return closeSheet();
    if (t.id === "backBtn") return closeChat();
    if (t.id === "tripBtn") return sheetTrips();
    if (t.id === "meBtn") { S.tab = "meg"; return render(); }
    if (t.hasAttribute("data-edit")) { S.edit = !S.edit; return render(); }

    if (t.id === "resetBtn") {
      if (confirm("Logge ut på denne enheten? Turene ligger igjen i basen, og du kommer inn igjen med turkoden.")) {
        Api.signOutLocal(); location.reload();
      }
      return;
    }

    if (t.dataset.copy) {
      try { await navigator.clipboard.writeText(t.dataset.copy); toast("Turkoden er kopiert."); }
      catch { toast("Kopiering ble blokkert — merk koden manuelt."); }
      return;
    }

    if (t.dataset.opentrip) { closeSheet(); S.tab = "program"; return openTrip(t.dataset.opentrip).catch(() => toast("Klarte ikke åpne turen.")); }
    if (t.dataset.tab) { S.tab = t.dataset.tab; S.openChat = null; return render(); }
    if (t.dataset.openchat) return openChat(t.dataset.openchat);

    if (t.dataset.delitem) {
      if (!confirm("Slette dette punktet?")) return;
      try { await Api.deleteItem(t.dataset.delitem); await openTrip(S.trip.id); }
      catch { toast("Klarte ikke slette."); }
      return;
    }
    if (t.dataset.delday) {
      if (!confirm("Slette hele dagen med alle punktene?")) return;
      try { await Api.deleteDay(t.dataset.delday); S.day = null; await openTrip(S.trip.id); }
      catch { toast("Klarte ikke slette."); }
      return;
    }
    if (t.dataset.delmsg) {
      try { await Api.deleteMessage(t.dataset.delmsg, S.openChat); render(); }
      catch { toast("Klarte ikke slette meldingen."); }
      return;
    }
    if (t.dataset.deltrip) {
      const trip = S.trip;
      if (!confirm(`Slette «${trip.name}» for alle? Program, chatter og meldinger forsvinner for godt.`)) return;
      if (prompt("Skriv turkoden for å bekrefte:") !== trip.code) return toast("Koden stemte ikke. Ingenting er slettet.");
      try {
        await Api.deleteTrip(t.dataset.deltrip);
        S.trips = await Api.myTrips().catch(() => []);
        if (S.trips.length) { S.tab = "program"; await openTrip(S.trips[0].id); }
        else { Api.setLastTrip(null); showJoin(); }
        toast("Turen er slettet.");
      } catch { toast("Klarte ikke slette turen."); }
      return;
    }
    if (t.dataset.leave) {
      if (!confirm("Melde deg av turen? Du kommer inn igjen med turkoden.")) return;
      try {
        await Api.leaveTrip(t.dataset.leave);
        S.trips = await Api.myTrips().catch(() => []);
        if (S.trips.length) { S.tab = "program"; await openTrip(S.trips[0].id); }
        else { Api.setLastTrip(null); showJoin(); }
      } catch { toast("Klarte ikke melde deg av."); }
      return;
    }

    // ark
    if (t.dataset.members) return sheetChannelMembers(t.dataset.members);
    if (t.dataset.skjul) return skjulOppgave(t.dataset.skjul, t.dataset.skjulid, true);
    if (t.dataset.vis) { closeSheet(); return skjulOppgave(t.dataset.vis, t.dataset.visid, false); }
    if (t.dataset.nye) { S.nye = 0; S.tilBunn = true; return render(); }
    if (t.dataset.eldre) return hentEldre();
    if (t.dataset.kartapne) return settKart(t.dataset.kartapne, "apen");
    if (t.dataset.kartlukk) return settKart(t.dataset.kartlukk, "liten");
    if (t.dataset.emoji) { closeSheet(); return reager(t.dataset.pa, t.dataset.emoji); }
    if (t.dataset.hopp) return hoppTil(t.dataset.hopp);
    if (t.dataset.svar) { closeSheet(); return startSvar(t.dataset.svar); }
    if (t.dataset.item) return sheetItem(t.dataset.item);
    if (t.dataset.kopi) {
      try { await navigator.clipboard.writeText(t.dataset.kopi); toast("Kopiert: " + t.dataset.kopi); }
      catch { toast("Kopiering ble blokkert — merk teksten manuelt."); }
      return;
    }
    if (t.dataset.sheet === "place") return sheetPlace(t.dataset.place);
    if (t.dataset.sheet === "jointrip") return sheetJoinTrip();
    if (t.dataset.sheet === "newtrip") return sheetNewTrip();
    if (t.dataset.sheet === "newchannel") return sheetNewChannel();
    if (t.dataset.sheet === "addday") return sheetAddDay();
    if (t.dataset.sheet === "additem") return sheetAddItem(t.dataset.day);
    if (t.dataset.sheet === "hotel") return sheetHotel(t.dataset.day);
    if (t.dataset.sheet === "deltakere") return sheetTripMembers();
    if (t.dataset.sheet === "varsler") return sheetVarsler();
    if (t.dataset.sheet === "logginn") return visAuth("logginn");
    if (t.dataset.sheet === "koblepost") { closeSheet(); return visAuth("koble"); }
    if (t.dataset.sheet === "skjulte") return sheetSkjulte();
    if (t.dataset.sheet === "about") return sheetAbout();
    if (t.dataset.sheet === "importpdf") return sheetImportPdf();

    if (t.dataset.day) { S.day = t.dataset.day; return render(); }
  });

  // Blar du deg selv ned til bunnen, er meldingene ikke nye lenger.
  $("screen").addEventListener("scroll", () => {
    if (!S.nye || !S.openChat) return;
    const sc = $("screen");
    if (sc.scrollHeight - sc.scrollTop - sc.clientHeight < 140) { S.nye = 0; render(); }
  }, { passive: true });

  $("sheetBg").addEventListener("click", e => { if (e.target.id === "sheetBg") closeSheet(); });
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    if (!$("sheetBg").hidden) return closeSheet();
    closeChat();
  });

  $("joinForm").addEventListener("submit", async e => {
    e.preventDefault();
    const first = $("fFirst").value.trim(), last = $("fLast").value.trim();
    const err = $("joinErr"), btn = $("joinSubmit");
    if (!first || !last) { err.textContent = "Skriv både fornavn og etternavn."; err.hidden = false; return; }
    err.hidden = true; btn.disabled = true; btn.innerHTML = prikker() + " Blir med";
    try {
      Api.setProfile(first, last);
      const trip = await Api.joinByCode($("fCode").value, `${first} ${last}`);
      S.trips = await Api.myTrips().catch(() => []);
      await openTrip(trip.id);
    } catch (e2) {
      err.textContent = e2.message; err.hidden = false;
    } finally {
      btn.disabled = false; btn.textContent = "Bli med på turen";
    }
  });

  return { boot };
})();

UI.boot();
