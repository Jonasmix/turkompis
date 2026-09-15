/* ui.js — skjermer, navigasjon og alt som tegnes. */

const UI = (() => {

  const S = { trip: null, tab: "program", day: null, channel: null };

  /* ---------- små hjelpere ---------- */
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
  const today = () => new Date().toISOString().slice(0, 10);
  const clock = iso => new Date(iso).toLocaleTimeString("nb-NO", { hour:"2-digit", minute:"2-digit" });

  function dayStamp(iso) {
    const d = new Date(iso), n = new Date();
    const same = d.toDateString() === n.toDateString();
    return same ? clock(iso) : d.toLocaleDateString("nb-NO", { weekday:"short", day:"numeric", month:"short" }) + " " + clock(iso);
  }
  function daysUntil(date) {
    const a = new Date(today() + "T12:00:00"), b = new Date(date + "T12:00:00");
    return Math.round((b - a) / 86400000);
  }
  const mapsGoogle = p => "https://www.google.com/maps/dir/?api=1&destination=" + encodeURIComponent(p.name + ", " + p.addr) + "&travelmode=transit";
  const mapsApple  = p => "https://maps.apple.com/?daddr=" + encodeURIComponent(p.name + ", " + p.addr) + "&dirflg=r";

  const ICON = {
    pin:'<svg viewBox="0 0 24 24"><path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z"/><circle cx="12" cy="10" r="2.6"/></svg>',
    nav:'<svg viewBox="0 0 24 24"><path d="M3 11 21 3l-8 18-2-7-8-3Z"/></svg>',
    spark:'<svg viewBox="0 0 24 24"><path d="M12 3v5M12 16v5M3 12h5M16 12h5M6.3 6.3l3 3M14.7 14.7l3 3M17.7 6.3l-3 3M9.3 14.7l-3 3"/></svg>',
    cal:'<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
    chat:'<svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-8 8H7l-4 3 1.2-4.4A8 8 0 1 1 21 12Z"/></svg>',
    file:'<svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z"/><path d="M14 3v5h5"/></svg>',
    me:'<svg viewBox="0 0 24 24"><circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/></svg>',
    send:'<svg viewBox="0 0 24 24"><path d="M4 12 20 4l-7 16-2-7-7-1Z"/></svg>',
    chev:'<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>'
  };

  function toast(text) {
    const t = $("toast");
    t.textContent = text; t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.hidden = true; }, 2600);
  }

  /* ---------- oppstart ---------- */
  function boot() {
    const profile = Store.getProfile();
    const tripId = Store.getLastTrip();
    if (profile && tripId && tripById(tripId)) openTrip(tripId);
    else showJoin();
  }

  function showJoin() {
    $("appScreen").hidden = true;
    $("joinScreen").hidden = false;
    const p = Store.getProfile();
    if (p) { $("fFirst").value = p.first; $("fLast").value = p.last; }
  }

  function openTrip(tripId) {
    S.trip = tripById(tripId);
    if (!S.trip) return showJoin();
    Store.setLastTrip(tripId);
    S.day = Parse.baseDate(S.trip);
    S.channel = Store.getLastChannel(tripId);
    $("joinScreen").hidden = true;
    $("appScreen").hidden = false;
    const p = Store.getProfile();
    $("avatarText").textContent = p ? p.initials : "–";
    render();
  }

  /* ---------- program ---------- */
  function nextEvent(trip) {
    const now = new Date();
    const t = now.toTimeString().slice(0, 5);
    const d = trip.days.find(x => x.date === today());
    if (d) {
      const item = d.items.find(i => i.t > t);
      if (item) return { day: d, item };
      const nd = trip.days.find(x => x.date > today());
      if (nd) return { day: nd, item: nd.items[0] };
      return null;
    }
    const upcoming = trip.days.find(x => x.date >= today());
    return upcoming ? { day: upcoming, item: upcoming.items[0] } : null;
  }

  function viewProgram() {
    const trip = S.trip;
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
        <p class="muted" style="margin-top:4px;color:var(--ink-2)">Første punkt: ${esc(trip.days[0].items[0].title)} kl ${trip.days[0].items[0].t}</p></div>`;
    } else {
      const p = ne.item.place ? trip.places[ne.item.place] : null;
      const sameDay = ne.day.date === today();
      head = `<div class="nextup">
        <div class="lbl">${sameDay ? "Neste i dag" : "Neste · " + esc(ne.day.label)}</div>
        <div class="t">${ne.item.t}</div>
        <div class="w">${esc(ne.item.title)}</div>
        <div class="p">${p ? esc(p.name) : esc(ne.item.note || "")}</div>
        ${p ? `<div class="acts">
          <a class="btn solid" href="${mapsGoogle(p)}" target="_blank" rel="noopener">${ICON.nav} Veibeskrivelse</a>
          <button class="btn" data-sheet="place" data-place="${ne.item.place}">Detaljer</button>
        </div>` : ""}
      </div>`;
    }

    const d = trip.days.find(x => x.date === S.day) || trip.days[0];
    const chips = trip.days.map(x =>
      `<button class="chip" aria-pressed="${x.date === d.date}" data-day="${x.date}">${x.chip}<span>${x.num}</span></button>`
    ).join("");

    const rows = d.items.map(i => {
      const p = i.place ? trip.places[i.place] : null;
      const isNext = ne && ne.day.date === d.date && ne.item.t === i.t && d.date === today();
      return `<button class="ev ${isNext ? "now" : ""}" ${p ? `data-sheet="place" data-place="${i.place}"` : "disabled"}>
        <div class="time">${i.t}${isNext ? "<em>neste</em>" : ""}</div>
        <div>
          <div class="title">${esc(i.title)}</div>
          <div class="place">${p ? ICON.pin + esc(p.name) : `<span style="color:var(--ink-3)">${esc(i.note || "Ikke stedfestet")}</span>`}</div>
          <div class="src"><span class="tag">${esc(i.src)}</span></div>
        </div>
      </button>`;
    }).join("");

    return `${head}
      <div class="chips">${chips}</div>
      <div>
        <div class="eyebrow" style="margin-bottom:7px">${esc(d.label)} · bor på ${esc(trip.places[d.hotel].name)}</div>
        <div class="card pad"><div class="tl">${rows}</div></div>
      </div>`;
  }

  /* ---------- chat ---------- */
  function actionCard(a) {
    const p = S.trip.places[a.place];
    if (!p) return "";
    const day = Parse.dayOf(S.trip, a.date);
    return `<div class="aicard">
      <div class="hd">${ICON.spark}<span>Turkompis fant en avtale</span></div>
      <div class="dest">${esc(p.name)}</div>
      <div class="meta">${a.time ? `<span class="mono">${esc(a.time)}</span> · ` : ""}${esc(day ? day.label : a.date)}<br>${esc(p.addr)}</div>
      <div class="why">${esc(a.why)}</div>
      <div class="acts">
        <a class="btn primary" href="${mapsGoogle(p)}" target="_blank" rel="noopener">${ICON.nav} Google Maps</a>
        <a class="btn" href="${mapsApple(p)}" target="_blank" rel="noopener">${ICON.pin} Apple Maps</a>
      </div>
    </div>`;
  }

  function viewChat() {
    const list = Store.channels(S.trip.id);
    const chips = list.map(c =>
      `<button class="chip" aria-pressed="${c.id === S.channel}" data-channel="${c.id}">${esc(c.name)}<span>${esc(c.sub || "")}</span></button>`
    ).join("") + `<button class="chip" data-sheet="newchannel" style="border-style:dashed">+ Ny chat<span>i denne turen</span></button>`;

    const msgs = Store.messages(S.trip.id, S.channel);
    const body = msgs.length
      ? msgs.map(m => `<div class="msg ${m.mine ? "me" : ""}">
          ${m.mine ? "" : `<div class="who">${esc(m.who)}${m.role ? ` <b>· ${esc(m.role)}</b>` : ""}</div>`}
          <div class="bubble">${esc(m.txt)}</div>
          <div class="stamp">${esc(dayStamp(m.ts))}</div>
          ${m.action ? actionCard(m.action) : ""}
        </div>`).join("")
      : `<p class="muted" style="text-align:center;padding:30px 0">Ingen meldinger her ennå. Skriv den første.</p>`;

    return `<div class="chips">${chips}</div><div class="msgs" id="msgs">${body}</div>`;
  }

  /* ---------- filer ---------- */
  function viewFiles() {
    const trip = S.trip;
    const rows = trip.files.map(f => `<div class="filerow">
      <div class="ficon ${f.type}">${f.type.toUpperCase()}</div>
      <div><div class="nm">${esc(f.name)}</div><div class="sub">${esc(f.by)} · ${esc(f.when)}</div>
        <div style="margin-top:6px"><span class="tag moss">Lest: ${esc(f.read)}</span></div></div>
    </div>`).join("");

    const points = trip.days.reduce((n, d) => n + d.items.length, 0);
    const addresses = Object.keys(trip.places).length;
    const hotels = new Set(trip.days.map(d => d.hotel)).size;

    return `
      <div>
        <div class="eyebrow" style="margin-bottom:8px">Hentet ut av filene</div>
        <div class="card pad" style="padding-block:12px">
          <dl class="kv">
            <dt>Punkter</dt><dd>${points} programpunkter over ${trip.days.length} dager</dd>
            <dt>Hoteller</dt><dd>${hotels}</dd>
            <dt>Adresser</dt><dd>${addresses} steder med veibeskrivelse</dd>
          </dl>
        </div>
      </div>
      <div class="card pad">${rows}</div>
      <p class="muted">Reiselederne laster opp program, romlister og billetter. Opplasting og filtolkning kobles på sammen med resten av serverdelen.</p>`;
  }

  /* ---------- meg ---------- */
  function viewMe() {
    const p = Store.getProfile();
    const trips = Store.joinedTripIds().map(tripById).filter(Boolean);
    const rows = trips.map(t => `<button class="listrow" data-opentrip="${t.id}" aria-current="${t.id === S.trip.id}">
      <div class="grow"><div class="nm">${esc(t.name)}</div><div class="sub">${esc(t.org)} · ${esc(t.dates)}</div></div>
      <span class="chev">${ICON.chev}</span>
    </button>`).join("");

    return `
      <div>
        <div class="eyebrow" style="margin-bottom:8px">Deg</div>
        <div class="card pad" style="padding-block:14px">
          <dl class="kv">
            <dt>Navn</dt><dd>${esc(p ? p.name : "—")}</dd>
            <dt>Turkode</dt><dd class="mono">${esc(S.trip.code)}</dd>
            <dt>Reiseleder</dt><dd>${esc(S.trip.leaders)}</dd>
          </dl>
        </div>
      </div>

      <div>
        <div class="eyebrow" style="margin-bottom:8px">Dine turer</div>
        <div class="card pad"><div class="list">${rows}</div></div>
      </div>

      <div class="stack">
        <button class="btn" data-sheet="jointrip">Bli med på en ny tur</button>
        <button class="btn" data-sheet="about">Om appen og personvern</button>
        <button class="btn danger" id="resetBtn">Logg ut og slett alt på denne enheten</button>
      </div>

      <p class="muted">Meldinger lagres foreløpig bare på denne enheten. Andre ser dem ikke før serverdelen er koblet på.</p>`;
  }

  /* ---------- tegning ---------- */
  function render() {
    $("tripName").textContent = S.trip.name;
    $("tripSub").textContent = `${S.trip.org} · ${S.trip.dates}`;

    const sc = $("screen");
    sc.innerHTML = S.tab === "program" ? viewProgram()
                 : S.tab === "chat" ? viewChat()
                 : S.tab === "filer" ? viewFiles()
                 : viewMe();

    const slot = $("composerSlot");
    if (S.tab === "chat") {
      const ch = Store.channels(S.trip.id).find(c => c.id === S.channel);
      slot.innerHTML = `<form class="composer" id="composer">
        <input id="msgInput" placeholder="Melding til ${esc(ch ? ch.name : "chatten")}…" autocomplete="off" enterkeyhint="send">
        <button class="send" type="submit" aria-label="Send melding">${ICON.send}</button>
      </form>`;
      $("composer").addEventListener("submit", onSend);
      sc.scrollTop = sc.scrollHeight;
    } else {
      slot.innerHTML = "";
    }

    $("tabbar").innerHTML = [
      ["program","Program",ICON.cal], ["chat","Chat",ICON.chat],
      ["filer","Filer",ICON.file], ["meg","Meg",ICON.me]
    ].map(([id,label,ic]) =>
      `<button role="tab" aria-selected="${S.tab === id}" data-tab="${id}">${ic}<span>${label}</span></button>`
    ).join("");
  }

  /* ---------- send melding ---------- */
  function onSend(e) {
    e.preventDefault();
    const inp = $("msgInput");
    const txt = inp.value.trim();
    if (!txt) return;
    const p = Store.getProfile();
    const msg = {
      id: "m" + Date.now().toString(36),
      who: p ? p.name : "Du", role: "", txt,
      ts: new Date().toISOString(), mine: true
    };
    Store.addMessage(S.trip.id, S.channel, msg);
    inp.value = "";
    render();

    const found = Parse.analyse(S.trip, txt);
    if (found) {
      Store.updateMessage(S.trip.id, S.channel, msg.id, { action: found });
      setTimeout(() => { if (S.tab === "chat") render(); }, 450);
    }
  }

  /* ---------- ark ---------- */
  function openSheet(html) {
    $("sheet").innerHTML = `<div class="grab"></div>${html}`;
    $("sheetBg").hidden = false;
  }
  function closeSheet() { $("sheetBg").hidden = true; }

  function sheetPlace(id) {
    const p = S.trip.places[id];
    openSheet(`
      <div class="eyebrow">${esc(p.kind)}</div>
      <h3>${esc(p.name)}</h3>
      <div class="addr">${esc(p.addr)}</div>
      <div class="acts">
        <a class="btn primary" href="${mapsGoogle(p)}" target="_blank" rel="noopener">${ICON.nav} Google Maps</a>
        <a class="btn" href="${mapsApple(p)}" target="_blank" rel="noopener">${ICON.pin} Apple Maps</a>
      </div>
      <button class="btn close" data-close>Lukk</button>`);
  }

  function sheetTrips() {
    const trips = Store.joinedTripIds().map(tripById).filter(Boolean);
    const rows = trips.map(t => `<button class="listrow" data-opentrip="${t.id}" aria-current="${t.id === S.trip.id}">
      <div class="grow"><div class="nm">${esc(t.name)}</div><div class="sub">${esc(t.dates)}</div></div>
      <span class="chev">${ICON.chev}</span></button>`).join("");
    openSheet(`<h3>Dine turer</h3>
      <div class="list" style="margin-top:8px">${rows}</div>
      <button class="btn" style="width:100%;margin-top:12px" data-sheet="jointrip">Bli med på en ny tur</button>
      <button class="btn close" data-close>Lukk</button>`);
  }

  function sheetJoinTrip() {
    openSheet(`<h3>Bli med på en ny tur</h3>
      <p class="muted" style="margin:6px 0 14px">Skriv turkoden du fikk av reiselederen.</p>
      <form id="joinTripForm">
        <div class="field"><label for="jCode">Turkode</label>
          <input id="jCode" autocapitalize="characters" spellcheck="false" style="font-family:'IBM Plex Mono',monospace;text-transform:uppercase"></div>
        <p class="err" id="jErr" hidden></p>
        <button class="btn primary big" type="submit">Bli med</button>
      </form>
      <button class="btn close" data-close>Avbryt</button>`);
    $("joinTripForm").addEventListener("submit", e => {
      e.preventDefault();
      const trip = tripByCode($("jCode").value);
      if (!trip) { $("jErr").textContent = "Fant ingen tur med den koden."; $("jErr").hidden = false; return; }
      Store.joinTrip(trip);
      closeSheet();
      openTrip(trip.id);
      toast("Du er med på " + trip.name);
    });
  }

  function sheetNewChannel() {
    openSheet(`<h3>Ny chat i ${esc(S.trip.name)}</h3>
      <p class="muted" style="margin:6px 0 14px">For eksempel en gruppe som skal et annet sted enn resten.</p>
      <form id="newChForm">
        <div class="field"><label for="cName">Navn på chatten</label><input id="cName" placeholder="Gruppe Eiffeltårnet"></div>
        <div class="field"><label for="cSub">Kort beskrivelse</label><input id="cSub" placeholder="Onsdag · 6 stk"></div>
        <button class="btn primary big" type="submit">Opprett chat</button>
      </form>
      <button class="btn close" data-close>Avbryt</button>`);
    $("newChForm").addEventListener("submit", e => {
      e.preventDefault();
      const name = $("cName").value.trim();
      if (!name) return;
      const id = Store.addChannel(S.trip.id, name, $("cSub").value);
      S.channel = id;
      Store.setLastChannel(S.trip.id, id);
      closeSheet();
      render();
    });
  }

  function sheetAbout() {
    openSheet(`<h3>Om appen</h3>
      <p style="margin:10px 0;font-size:14.5px;color:var(--ink-2)">
        Turkompis samler program, beskjeder og veibeskrivelser for én klassetur. Når noen avtaler
        et møtested i chatten, kobler appen det mot programmet og finner riktig adresse for den dagen.</p>
      <div class="card pad" style="padding-block:12px;margin-top:6px">
        <dl class="kv">
          <dt>Versjon</dt><dd>Tidlig utgave under utprøving</dd>
          <dt>Lagring</dt><dd>Kun på denne enheten — ingenting sendes til noen server</dd>
          <dt>Kart</dt><dd>Adressen åpnes i Google Maps eller Apple Maps</dd>
        </dl>
      </div>
      <p class="muted" style="margin-top:12px">Turkoden er en nøkkel til et rom, ikke innlogging.
      Ordentlig pålogging, tilgangsstyring og sletting av data kommer når serverdelen bygges.</p>
      <button class="btn close" data-close>Lukk</button>`);
  }

  /* ---------- hendelser ---------- */
  document.addEventListener("click", e => {
    const t = e.target.closest("[data-tab],[data-day],[data-channel],[data-sheet],[data-opentrip],[data-close],[data-fill],#tripBtn,#meBtn,#resetBtn");
    if (!t) return;

    if (t.dataset.fill) { $("fCode").value = t.dataset.fill; return; }
    if (t.hasAttribute("data-close")) return closeSheet();
    if (t.id === "tripBtn") return sheetTrips();
    if (t.id === "meBtn") { S.tab = "meg"; return render(); }
    if (t.id === "resetBtn") {
      if (confirm("Slette navn, turer og alle meldinger på denne enheten?")) { Store.reset(); location.reload(); }
      return;
    }
    if (t.dataset.opentrip) { closeSheet(); S.tab = "program"; return openTrip(t.dataset.opentrip); }
    if (t.dataset.tab) { S.tab = t.dataset.tab; return render(); }
    if (t.dataset.day) { S.day = t.dataset.day; return render(); }
    if (t.dataset.channel) { S.channel = t.dataset.channel; Store.setLastChannel(S.trip.id, S.channel); return render(); }

    switch (t.dataset.sheet) {
      case "place": return sheetPlace(t.dataset.place);
      case "jointrip": return sheetJoinTrip();
      case "newchannel": return sheetNewChannel();
      case "about": return sheetAbout();
    }
  });

  $("sheetBg").addEventListener("click", e => { if (e.target.id === "sheetBg") closeSheet(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeSheet(); });

  $("joinForm").addEventListener("submit", e => {
    e.preventDefault();
    const first = $("fFirst").value.trim(), last = $("fLast").value.trim();
    const err = $("joinErr");
    if (!first || !last) { err.textContent = "Skriv både fornavn og etternavn."; err.hidden = false; return; }
    const trip = tripByCode($("fCode").value);
    if (!trip) { err.textContent = "Fant ingen tur med den koden. Sjekk med reiselederen."; err.hidden = false; return; }
    err.hidden = true;
    Store.setProfile(first, last);
    Store.joinTrip(trip);
    openTrip(trip.id);
  });

  return { boot };
})();

UI.boot();
