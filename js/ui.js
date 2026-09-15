/* ui.js — skjermer, navigasjon og alt som tegnes. */

const UI = (() => {

  const S = { trip: null, tab: "program", day: null, openChat: null, loadingChat: false, trips: [], edit: false, offline: false };

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
    chev:'<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>'
  };

  const prikker = () => '<span class="prikker"><i></i><i></i><i></i></span>';
  const venter = tekst => `<div class="venter">${prikker()} ${esc(tekst)}</div>`;

  function toast(text) {
    const t = $("toast");
    t.textContent = text; t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.hidden = true; }, 3000);
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

    Api.onChange(() => { if (S.tab === "chat") render(); });

    const profile = Api.getProfile(), last = Api.getLastTrip();
    if (profile && last) {
      try { return await openTrip(last); }
      catch { /* turen finnes ikke lenger */ }
    }
    showJoin();
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
    $("joinScreen").hidden = false;
    const p = Api.getProfile();
    if (p) { $("fFirst").value = p.first; $("fLast").value = p.last; }
  }

  async function openTrip(tripId) {
    $("bootMsg").innerHTML = venter("Henter turen");
    const trip = await Api.loadTrip(tripId);
    if (!trip) throw new Error("Fant ikke turen");

    S.trip = trip;
    S.offline = Boolean(trip.stale);
    Api.setLastTrip(tripId);
    S.day = Parse.baseDate(trip) || (trip.days[0] ? trip.days[0].date : null);

    // Bytter du tur, lukkes samtalen du hadde åpen.
    S.openChat = null;

    $("bootScreen").hidden = true;
    $("joinScreen").hidden = true;
    $("appScreen").hidden = false;

    const p = Api.getProfile();
    $("avatarText").textContent = p ? p.initials : "–";

    render();
    if (!S.offline) {
      Api.subscribeTrip(tripId);
      Api.loadRecent(tripId).then(() => { if (S.tab === "chat" && !S.openChat) render(); }).catch(() => {});
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
        <div class="w">${esc(ne.item.title)}</div>
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
    const rows = d.items.length ? d.items.map((i, k) => {
      const p = i.place ? trip.places[i.place] : null;
      const isNext = ne && ne.day.date === d.date && ne.item.id === i.id && d.date === today();
      return `<div class="ev ${isNext ? "now" : ""}" data-item="${esc(i.id)}" role="button" tabindex="0">
        <div class="time">${i.t ? esc(i.t) : '<span style="color:var(--ink-3)">—</span>'}${isNext ? "<em>neste</em>" : ""}</div>
        <div>
          <div class="title">${esc(i.title)}</div>
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

  function viewConversation() {
    const msgs = Api.messages(S.openChat);
    if (!msgs.length && S.loadingChat) {
      return venter("Henter meldinger");
    }
    const body = msgs.length ? msgs.map(m => `<div class="msg ${m.mine ? "me" : ""}">
        ${m.mine ? "" : `<div class="who">${esc(m.who)}${m.role ? ` <b>· ${esc(m.role)}</b>` : ""}</div>`}
        <div class="bubble">${esc(m.txt)}</div>
        <div class="stamp">${esc(dayStamp(m.ts))}${m.mine ? ` · <button class="linkbtn" style="font-size:10.5px" data-delmsg="${esc(m.id)}">slett</button>` : ""}</div>
        ${m.action ? actionCard(m.action) : ""}
      </div>`).join("")
      : `<p class="muted" style="text-align:center;padding:30px 0">Ingen meldinger her ennå. Skriv den første.</p>`;
    return `<div class="msgs" id="msgs">${body}</div>`;
  }

  function viewChat() {
    return S.openChat ? viewConversation() : viewChatList();
  }

  /* ───────────────── meg ───────────────── */
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
      <div>
        <div class="eyebrow" style="margin-bottom:8px">Deg</div>
        <div class="card pad" style="padding-block:14px">
          <dl class="kv">
            <dt>Navn</dt><dd>${esc(p ? p.name : "—")}</dd>
            <dt>Rolle</dt><dd>${trip.role === "leader" ? "Reiseleder" : "Deltaker"}</dd>
          </dl>
        </div>
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
        <button class="btn" data-sheet="jointrip">Bli med på en ny tur</button>
        <button class="btn" data-sheet="newtrip">Lag en ny tur</button>
        <button class="btn" data-sheet="about">Om appen og personvern</button>
        <button class="btn danger" data-leave="${esc(trip.id)}">Meld deg av ${esc(trip.name)}</button>
        ${trip.role === "leader" ? `<button class="btn danger" data-deltrip="${esc(trip.id)}">Slett hele turen</button>` : ""}
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

    $("screen").innerHTML = S.tab === "program" ? viewProgram()
                          : S.tab === "chat" ? viewChat()
                          : viewMe();

    const slot = $("composerSlot");
    if (conv && !S.offline) {
      slot.innerHTML = `<form class="composer" id="composer">
        <input id="msgInput" placeholder="Melding til ${esc(conv.name)}…" autocomplete="off" enterkeyhint="send" maxlength="2000">
        <button class="send" type="submit" aria-label="Send melding">${ICON.send}</button>
      </form>`;
      $("composer").addEventListener("submit", onSend);
      const sc = $("screen"); sc.scrollTop = sc.scrollHeight;
    } else slot.innerHTML = "";

    settOppDraing();

    // Dagsvelgeren skal stå der du forlot den, ikke hoppe til mandag.
    const chipsEtter = $("screen").querySelector(".chips");
    if (chipsEtter) {
      chipsEtter.scrollLeft = chipsScroll;
      const valgt = chipsEtter.querySelector('[aria-pressed="true"]');
      if (valgt) {
        const v = valgt.getBoundingClientRect(), c = chipsEtter.getBoundingClientRect();
        if (v.left < c.left || v.right > c.right) {
          chipsEtter.scrollLeft += v.left - c.left - (c.width - v.width) / 2;
        }
      }
    }

    // Fanerada er i veien når du skriver i en samtale.
    $("tabbar").hidden = Boolean(conv);
    $("tabbar").innerHTML = [
      ["program","Program",ICON.cal], ["chat","Chat",ICON.chat], ["meg","Meg",ICON.me]
    ].map(([id,label,ic]) =>
      `<button role="tab" aria-selected="${S.tab === id}" data-tab="${id}">${ic}<span>${label}</span></button>`
    ).join("");
  }

  /* ───────────────── åpne og lukke en samtale ───────────────── */
  async function openChat(channelId, fromHistory) {
    S.openChat = channelId;
    S.loadingChat = true;
    Api.setLastChannel(S.trip.id, channelId);
    render();
    if (!fromHistory) history.pushState({ chat: channelId }, "");
    try { await Api.loadMessages(S.trip.id, channelId); }
    catch { toast("Klarte ikke hente meldingene."); }
    S.loadingChat = false;
    render();
  }

  function closeChat(fromHistory) {
    if (!S.openChat) return false;
    S.openChat = null;
    render();
    if (!fromHistory && history.state && history.state.chat) history.back();
    return true;
  }

  window.addEventListener("popstate", () => { if (S.openChat) closeChat(true); });


  /* ───────────────── send melding ───────────────── */
  async function onSend(e) {
    e.preventDefault();
    const inp = $("msgInput");
    const txt = inp.value.trim();
    if (!txt || S.busy) return;
    inp.value = "";
    const action = Parse.analyse(S.trip, txt);
    try {
      await Api.sendMessage(S.trip.id, S.openChat, txt, action);
      render();
    } catch (err) {
      inp.value = txt;
      toast("Meldingen ble ikke sendt. Sjekk nettet.");
    }
  }

  /* ───────────────── ark ───────────────── */
  function openSheet(html) {
    const s = $("sheet");
    s.innerHTML = `<div class="grab"></div>${html}`;
    s.style.transform = "";
    s.scrollTop = 0;
    $("sheetBg").hidden = false;
  }
  function closeSheet() {
    $("sheetBg").hidden = true;
    $("sheet").style.transform = "";
  }

  /* Dra arket nedover for å lukke det, slik man gjør i apper ellers.
     Draingen starter bare når arket er skrollet helt til toppen, og aldri
     oppå en knapp eller et skrivefelt. */
  /* Dra arket nedover for å lukke det.
     Skjemafelt og knapper skal fortsatt kunne trykkes, men alt annet —
     overskrifter, tekst, tomme flater — er gyldig å ta tak i. Tidligere
     utelot jeg også <label>, og siden nesten alt innhold i redigeringsark
     ligger inne i en label, var det i praksis umulig å dra dem bort. */
  (function dragToClose() {
    const s = $("sheet");
    let startY = 0, dy = 0, dragging = false, kandidat = false;

    s.addEventListener("pointerdown", e => {
      if (e.target.closest("input, textarea, select, button, a, [contenteditable]")) return;
      if (s.scrollTop > 0) return;
      kandidat = true; dragging = false;
      startY = e.clientY; dy = 0;
    });

    s.addEventListener("pointermove", e => {
      if (!kandidat) return;
      const d = e.clientY - startY;

      // Vent til bevegelsen tydelig går nedover før vi tar over, ellers
      // stjeler vi skrollingen i lange ark.
      if (!dragging) {
        if (d < 8) { if (d < -8) kandidat = false; return; }
        dragging = true;
        s.classList.add("dragging");
      }

      dy = Math.max(0, d);
      e.preventDefault();
      s.style.transform = `translateY(${dy}px)`;
    }, { passive: false });

    function slipp() {
      kandidat = false;
      if (!dragging) return;
      dragging = false;
      s.classList.remove("dragging");
      if (dy > 100) closeSheet();
      else s.style.transform = "";
    }
    s.addEventListener("pointerup", slipp);
    s.addEventListener("pointercancel", slipp);
  })();

  function sheetPlace(id) {
    const p = S.trip.places[id];
    if (!p) return;
    const leder = S.trip.role === "leader";
    openSheet(`
      <div class="eyebrow">${esc(p.kind)}</div>
      <h3>${esc(p.name)}</h3>
      <div class="addr">${esc(p.addr || "Ingen adresse lagt inn")}</div>
      ${p.url ? `<div class="addr"><a href="${esc(p.url)}" target="_blank" rel="noopener">${esc(p.url)}</a></div>` : ""}
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
      <div id="cmBody">${venter("Henter")}</div>
      <button class="btn close" data-close>Lukk</button>`);

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
      <div id="tmBody">${venter("Henter")}</div>
      <button class="btn close" data-close>Lukk</button>`);

    try {
      const folk = await Api.tripMembers(S.trip.id);
      const ledere = folk.filter(p => p.role === "leader");

      $("tmBody").innerHTML = `<div class="memberlist">${folk.map(p => `
        <div class="person">
          <span>${esc(p.name)}${p.me ? " <em>deg</em>" : ""}${p.role === "leader" ? ' <em>reiseleder</em>' : ""}</span>
          ${leder ? (p.role === "leader"
            ? (ledere.length > 1 ? `<button class="linkbtn" data-rolle="${esc(p.id)}" data-til="member">fjern rolle</button>` : "")
            : `<button class="linkbtn" data-rolle="${esc(p.id)}" data-til="leader">gjør til leder</button>`) : ""}
        </div>`).join("")}</div>
        ${leder ? `<p class="muted" style="margin-top:12px">Den som laget turen beholder lederrollen,
          og turen må alltid ha minst én.</p>` : ""}`;

      $("tmBody").addEventListener("click", async ev => {
        const b = ev.target.closest("[data-rolle]");
        if (!b) return;
        const navn = b.closest(".person").innerText.split("\n")[0];
        if (b.dataset.til === "leader" && !confirm(`Gi ${navn} lederrollen? Da kan hen endre programmet.`)) return;
        try {
          await Api.setMemberRole(S.trip.id, b.dataset.rolle, b.dataset.til);
          await openTrip(S.trip.id);
          sheetTripMembers();
          toast("Rollen er endret.");
        } catch (e) { toast(e.message || "Klarte ikke endre rollen."); }
      });
    } catch {
      $("tmBody").innerHTML = `<p class="muted">Klarte ikke hente deltakerlista.</p>`;
    }
  }
  function sheetAbout() {
    openSheet(`<h3>Om appen</h3>
      <p style="margin:10px 0;font-size:14.5px;color:var(--ink-2)">
        Turkompis samler program, beskjeder og veibeskrivelser for én klassetur. Når noen avtaler
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
    const t = e.target.closest("[data-tab],[data-day],[data-channel],[data-sheet],[data-opentrip],[data-close],[data-copy],[data-edit],[data-delitem],[data-delday],[data-delmsg],[data-leave],[data-deltrip],[data-members],[data-openchat],[data-item],[data-kopi],#tripBtn,#meBtn,#resetBtn,#backBtn");
    if (!t) return;

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
    if (t.dataset.sheet === "about") return sheetAbout();
    if (t.dataset.sheet === "importpdf") return sheetImportPdf();

    if (t.dataset.day) { S.day = t.dataset.day; return render(); }
  });

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
