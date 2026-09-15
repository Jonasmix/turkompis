/* api.js — all kontakt med databasen.
   Ingen andre filer snakker med Supabase. Skjermene kaller bare herfra.

   Lokalt på enheten lagres tre ting: navnet ditt, hvilken tur du så sist,
   og en kopi av siste turdata så appen kan vises uten nett. Alt annet
   ligger i basen, og hva du får se der bestemmes av reglene i
   supabase/schema.sql — ikke av denne filen. */

const Api = (() => {

  let sb = null;                 // Supabase-klienten
  let userId = null;
  let liveSub = null;            // abonnement på nye meldinger
  const cache = { trip: null, messages: {}, recent: {} };
  const listeners = new Set();

  const LS = {
    profile: "tk.profile",
    lastTrip: "tk.lastTrip",
    lastChannel: id => `tk.lastChannel.${id}`,
    snapshot: id => `tk.snapshot.${id}`
  };

  function lsGet(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }

  /* ───────── datoformat ───────── */
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  function fmtDay(date) {
    const d = new Date(date + "T12:00:00");
    return {
      chip: cap(d.toLocaleDateString("nb-NO", { weekday: "short" }).replace(".", "")),
      num: d.toLocaleDateString("nb-NO", { day: "numeric", month: "short" }).replace(".", ""),
      label: d.toLocaleDateString("nb-NO", { weekday: "long", day: "numeric", month: "long" })
    };
  }


  /* Perioden regnes ut av dagene i programmet, ikke av en tekst noen skrev
     en gang. Da kan den ikke bli stående og lyve når programmet endres. */
  function datoSpenn(fra, til) {
    if (!fra) return "";
    const d1 = new Date(fra + "T12:00:00"), d2 = new Date((til || fra) + "T12:00:00");
    const dag = d => d.toLocaleDateString("nb-NO", { day: "numeric" });
    const full = d => d.toLocaleDateString("nb-NO", { day: "numeric", month: "long" });
    if (fra === til) return full(d1);
    if (d1.getMonth() === d2.getMonth()) return `${dag(d1)}.–${full(d2)}`;
    return `${full(d1)} – ${full(d2)}`;
  }
  /* ───────── oppstart ───────── */
  async function init() {
    if (!CONFIG.ready) return { ok: false, reason: "mangler_config" };
    if (!window.supabase) return { ok: false, reason: "mangler_bibliotek" };

    sb = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true }
    });

    try {
      let { data } = await sb.auth.getSession();
      if (!data.session) {
        const res = await sb.auth.signInAnonymously();
        if (res.error) return { ok: false, reason: "innlogging_feilet", error: res.error.message };
        data = { session: res.data.session };
      }
      userId = data.session.user.id;
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: "nettverk", error: String(e.message || e) };
    }
  }

  const online = () => Boolean(sb && userId);

  /* ───────── profil og sist brukte tur ───────── */
  function getProfile() { return lsGet(LS.profile, null); }
  function setProfile(first, last) {
    const p = {
      first: first.trim(), last: last.trim(),
      name: `${first.trim()} ${last.trim()}`.trim(),
      initials: ((first.trim()[0] || "") + (last.trim()[0] || "")).toUpperCase()
    };
    lsSet(LS.profile, p);
    return p;
  }
  const getLastTrip = () => lsGet(LS.lastTrip, null);
  const setLastTrip = id => lsSet(LS.lastTrip, id);
  const getLastChannel = tripId => lsGet(LS.lastChannel(tripId), null);
  const setLastChannel = (tripId, ch) => lsSet(LS.lastChannel(tripId), ch);

  /* ───────── turer ───────── */
  async function myTrips() {
    if (!online()) return [];
    const { data, error } = await sb
      .from("members")
      .select("role, trips ( id, code, name, org )")
      .eq("user_id", userId);
    if (error) throw error;

    const rader = (data || []).filter(r => r.trips);
    const ids = rader.map(r => r.trips.id);

    // Perioden hentes fra dagene, ikke fra et tekstfelt.
    const spenn = {};
    if (ids.length) {
      const { data: dager } = await sb.from("days").select("trip_id, date").in("trip_id", ids);
      for (const d of (dager || [])) {
        const s = spenn[d.trip_id] || (spenn[d.trip_id] = { fra: d.date, til: d.date });
        if (d.date < s.fra) s.fra = d.date;
        if (d.date > s.til) s.til = d.date;
      }
    }

    return rader.map(r => ({
      id: r.trips.id, code: r.trips.code, name: r.trips.name, org: r.trips.org,
      dates: spenn[r.trips.id] ? datoSpenn(spenn[r.trips.id].fra, spenn[r.trips.id].til) : "",
      role: r.role
    }));
  }

  async function joinByCode(code, name) {
    const { data, error } = await sb.rpc("join_trip", { p_code: code, p_name: name });
    if (error) throw friendly(error);
    const t = Array.isArray(data) ? data[0] : data;
    return { id: t.id, code: t.code, name: t.name, org: t.org, dates: "" };
  }

  async function createTrip({ name, org, dates, leaderName }) {
    const { data, error } = await sb.rpc("create_trip", {
      p_name: name, p_org: org || "", p_dates: dates || "", p_leader_name: leaderName
    });
    if (error) throw friendly(error);
    const t = Array.isArray(data) ? data[0] : data;
    return { id: t.id, code: t.code, name: t.name, org: t.org, dates: "", role: "leader" };
  }

  function friendly(error) {
    const m = String(error.message || "");
    if (m.includes("ukjent_kode")) return new Error("Fant ingen tur med den koden.");
    if (m.includes("mangler_navn")) return new Error("Navn mangler.");
    if (m.includes("for_mange_turer")) return new Error("Du har laget for mange turer.");
    if (m.includes("ikke_medlem")) return new Error("Du er ikke med på denne turen.");
    if (m.includes("ingen_tilgang")) return new Error("Du har ikke tilgang til denne chatten.");
    if (m.includes("ikke_paa_turen")) return new Error("Personen er ikke med på turen.");
    if (m.includes("ukjent_chat")) return new Error("Fant ikke chatten.");
    if (m.includes("ikke_leder")) return new Error("Bare reiseledere kan endre roller.");
    if (m.includes("eier_beholder_rollen")) return new Error("Den som laget turen beholder lederrollen.");
    if (m.includes("siste_leder")) return new Error("Turen må ha minst én reiseleder.");
    if (m.includes("ikke_innlogget")) return new Error("Appen fikk ikke kontakt med serveren. Prøv igjen.");
    return new Error(m || "Noe gikk galt.");
  }

  /* ───────── last hele turen ───────── */
  async function loadTrip(tripId) {
    if (!online()) return loadSnapshot(tripId);
    try {
      const [trip, member, places, days, items, channels] = await Promise.all([
        sb.from("trips").select("*").eq("id", tripId).single(),
        sb.from("members").select("role, name").eq("trip_id", tripId).eq("user_id", userId).single(),
        sb.from("places").select("*").eq("trip_id", tripId),
        sb.from("days").select("*").eq("trip_id", tripId).order("date"),
        sb.from("items").select("*").eq("trip_id", tripId),
        sb.from("channels").select("*").eq("trip_id", tripId).order("created_at")
      ]);
      for (const r of [trip, member, places, days, items, channels]) if (r.error) throw r.error;

      const built = build(trip.data, member.data, places.data, days.data, items.data, channels.data);
      cache.trip = built;
      lsSet(LS.snapshot(tripId), built);
      return built;
    } catch (e) {
      const snap = loadSnapshot(tripId);
      if (snap) { snap.stale = true; return snap; }
      throw e;
    }
  }

  function loadSnapshot(tripId) {
    const snap = lsGet(LS.snapshot(tripId), null);
    if (snap) cache.trip = snap;
    return snap;
  }


  /* Rekkefølgen i heftet bærer mening når klokkeslettet mangler, så «sort»
     bestemmer. Faller den bort (gammel base), sorteres det på tid i stedet. */
  function rekkefolge(a, b) {
    const sa = a.sort, sb2 = b.sort;
    if (sa != null && sb2 != null && sa !== sb2) return sa - sb2;
    return (a.t || "99:99").localeCompare(b.t || "99:99");
  }
  function build(trip, member, places, days, items, channels) {
    const placeMap = {};
    for (const p of places) {
      const words = p.name.toLowerCase().split(/[\s,()]+/).filter(w => w.length > 3);
      placeMap[p.id] = {
        id: p.id, name: p.name, addr: p.addr, kind: p.kind, url: p.url || "",
        alias: Array.from(new Set([p.name.toLowerCase(), ...words, ...(p.aliases || [])]))
      };
    }
    const byDay = {};
    for (const it of items) (byDay[it.day_id] = byDay[it.day_id] || []).push(it);

    return {
      id: trip.id, code: trip.code, name: trip.name, org: trip.org,
      dates: days.length ? datoSpenn(days[0].date, days[days.length - 1].date) : "",
      role: member ? member.role : "member",
      places: placeMap,
      days: days.map(d => Object.assign({
        id: d.id, date: d.date, hotel: d.hotel_place_id,
        items: (byDay[d.id] || []).sort(rekkefolge).map(i => ({
          id: i.id, t: i.t || "", title: i.title, place: i.place_id, note: i.note, src: i.src,
          sort: (i.sort === undefined || i.sort === null) ? null : i.sort
        }))
      }, fmtDay(d.date))),
      channels: channels.map(c => ({ id: c.id, name: c.name, sub: c.sub, private: c.private === true }))
    };
  }

  const currentTrip = () => cache.trip;
  const isLeader = () => Boolean(cache.trip && cache.trip.role === "leader");

  /* ───────── meldinger ───────── */
  function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  function fire() { listeners.forEach(f => { try { f(); } catch {} }); }

  function messages(channelId) { return cache.messages[channelId] || []; }

  /* Siste melding i hver chat — det chatlista viser under navnet. */
  function lastByChannel() { return cache.recent || {}; }

  async function loadRecent(tripId) {
    if (!online()) return lastByChannel();
    const { data, error } = await sb
      .from("messages").select("channel_id, txt, author_name, created_at, author_id")
      .eq("trip_id", tripId).order("created_at", { ascending: false }).limit(300);
    if (error) throw error;
    const map = {};
    for (const m of (data || [])) {
      if (!map[m.channel_id]) {
        map[m.channel_id] = { txt: m.txt, who: m.author_name, ts: m.created_at, mine: m.author_id === userId };
      }
    }
    cache.recent = map;
    return map;
  }

  async function loadMessages(tripId, channelId) {
    if (!online()) return messages(channelId);
    const { data, error } = await sb
      .from("messages").select("*")
      .eq("channel_id", channelId).order("created_at").limit(300);
    if (error) throw error;
    cache.messages[channelId] = (data || []).map(shape);
    return cache.messages[channelId];
  }

  const shape = m => ({
    id: m.id, who: m.author_name, role: m.role, txt: m.txt,
    ts: m.created_at, action: m.action || null, mine: m.author_id === userId
  });

  /* Ett abonnement for hele turen, ikke ett per chat: da oppdateres både
     chatlista og den samtalen som står åpen. Radsikkerheten sørger for at
     vi bare får hendelser fra chatter vi har lov til å lese. */
  function subscribeTrip(tripId) {
    if (liveSub) { sb.removeChannel(liveSub); liveSub = null; }
    liveSub = sb.channel("trip-" + tripId)
      .on("postgres_changes",
          { event: "INSERT", schema: "public", table: "messages", filter: `trip_id=eq.${tripId}` },
          payload => {
            const m = payload.new;
            const list = cache.messages[m.channel_id];
            if (list && !list.some(x => x.id === m.id)) {
              list.push(shape(m));
              list.sort((a, b) => a.ts.localeCompare(b.ts));
            }
            cache.recent = cache.recent || {};
            cache.recent[m.channel_id] = {
              txt: m.txt, who: m.author_name, ts: m.created_at, mine: m.author_id === userId
            };
            fire();
          })
      .on("postgres_changes",
          { event: "DELETE", schema: "public", table: "messages", filter: `trip_id=eq.${tripId}` },
          payload => {
            const list = cache.messages[payload.old.channel_id];
            if (!list) return;
            const i = list.findIndex(m => m.id === payload.old.id);
            if (i > -1) { list.splice(i, 1); fire(); }
          })
      .subscribe();
  }

  async function sendMessage(tripId, channelId, txt, action) {
    const p = getProfile();
    const row = {
      trip_id: tripId, channel_id: channelId,
      author_name: p ? p.name : "Ukjent",
      role: isLeader() ? "Reiseleder" : "",
      txt, action: action || null
    };
    const { data, error } = await sb.from("messages").insert(row).select().single();
    if (error) throw error;
    const list = cache.messages[channelId] || (cache.messages[channelId] = []);
    if (!list.some(m => m.id === data.id)) { list.push(shape(data)); }
    cache.recent[channelId] = { txt: data.txt, who: data.author_name, ts: data.created_at, mine: true };
    return data.id;
  }

  async function deleteMessage(id, channelId) {
    const { error } = await sb.from("messages").delete().eq("id", id);
    if (error) throw error;
    const list = cache.messages[channelId];
    if (list) {
      const i = list.findIndex(m => m.id === id);
      if (i > -1) list.splice(i, 1);
    }
  }

  /* ───────── chatter ───────── */
  async function addChannel(tripId, name, sub, isPrivate, memberIds) {
    const { data, error } = await sb.rpc("create_channel", {
      p_trip: tripId, p_name: name, p_sub: sub || "",
      p_private: Boolean(isPrivate), p_members: memberIds || []
    });
    if (error) throw friendly(error);
    const c = Array.isArray(data) ? data[0] : data;
    if (cache.trip) cache.trip.channels.push({ id: c.id, name: c.name, sub: c.sub, private: c.private });
    return c.id;
  }

  /* Hvem er med på turen — grunnlaget for å plukke deltakere til en chat. */
  async function tripMembers(tripId) {
    const { data, error } = await sb.from("members")
      .select("user_id, name, role").eq("trip_id", tripId).order("name");
    if (error) throw error;
    return (data || []).map(m => ({ id: m.user_id, name: m.name, role: m.role, me: m.user_id === userId }));
  }

  async function channelMembers(channelId) {
    const { data, error } = await sb.from("channel_members")
      .select("user_id").eq("channel_id", channelId);
    if (error) throw error;
    return (data || []).map(r => r.user_id);
  }

  async function addChannelMember(channelId, personId) {
    const { error } = await sb.rpc("add_channel_member", { p_channel: channelId, p_user: personId });
    if (error) throw friendly(error);
  }

  async function removeChannelMember(channelId, personId) {
    const { error } = await sb.from("channel_members").delete()
      .eq("channel_id", channelId).eq("user_id", personId);
    if (error) throw error;
  }

  /* ───────── program (kun reiseleder) ───────── */
  async function addPlace(tripId, { name, addr, kind, url }) {
    const { data, error } = await sb.from("places")
      .insert({ trip_id: tripId, name, addr: addr || "", kind: kind || "Sted", url: url || "" }).select().single();
    if (error) throw error;
    return data.id;
  }

  async function addDay(tripId, date) {
    const { data, error } = await sb.from("days")
      .insert({ trip_id: tripId, date }).select().single();
    if (error) throw error;
    return data.id;
  }

  async function setHotel(dayId, placeId) {
    const { error } = await sb.from("days").update({ hotel_place_id: placeId }).eq("id", dayId);
    if (error) throw error;
  }

  async function addItem(tripId, dayId, { t, title, placeId, note, sort }) {
    const rad = {
      trip_id: tripId, day_id: dayId, t: t || null, title,
      place_id: placeId || null, note: note || ""
    };
    let svar = await sb.from("items").insert({ ...rad, sort: sort || 0 }).select().single();
    // Er ikke rekkefolge-kolonnen lagt til enda, legg inn punktet uten den.
    if (svar.error && /sort/.test(svar.error.message || "")) {
      svar = await sb.from("items").insert(rad).select().single();
    }
    if (svar.error) throw svar.error;
    return svar.data.id;
  }

  /* Endre et punkt som allerede ligger inne: tid, tittel, sted eller notat. */
  async function updateItem(id, felter) {
    const rad = {};
    if ("t" in felter) rad.t = felter.t || null;
    if ("title" in felter) rad.title = felter.title;
    if ("placeId" in felter) rad.place_id = felter.placeId || null;
    if ("note" in felter) rad.note = felter.note || "";
    if ("sort" in felter) rad.sort = felter.sort;
    const { error } = await sb.from("items").update(rad).eq("id", id);
    if (error) throw error;
  }

  /* Gi eller ta lederrollen. Reglene ligger i basen, ikke her. */
  async function setMemberRole(tripId, personId, rolle) {
    const { error } = await sb.rpc("set_member_role", {
      p_trip: tripId, p_user: personId, p_role: rolle
    });
    if (error) throw friendly(error);
  }

  /* Endre et sted — for eksempel legge inn adressen som manglet i heftet. */
  async function updatePlace(id, felter) {
    const rad = {};
    if ("name" in felter) rad.name = felter.name;
    if ("addr" in felter) rad.addr = felter.addr;
    if ("kind" in felter) rad.kind = felter.kind;
    const { error } = await sb.from("places").update(rad).eq("id", id);
    if (error) throw error;
  }

  async function deleteItem(id) {
    const { error } = await sb.from("items").delete().eq("id", id);
    if (error) throw error;
  }

  async function deleteDay(id) {
    const { error } = await sb.from("days").delete().eq("id", id);
    if (error) throw error;
  }

  async function deleteTrip(tripId) {
    const { error } = await sb.from("trips").delete().eq("id", tripId);
    if (error) throw error;
    // Uten sletteregelen i basen svarer API-et med suksess uten aa slette noe.
    // Sjekk derfor at raden faktisk er borte for vi melder at det gikk bra.
    const { data } = await sb.from("trips").select("id").eq("id", tripId).maybeSingle();
    if (data) throw new Error("Databasen tillot ikke sletting. Kjor supabase/schema.sql i Supabase paa nytt.");
    try { localStorage.removeItem(LS.snapshot(tripId)); } catch {}
  }

  async function leaveTrip(tripId) {
    const { error } = await sb.from("members").delete().eq("trip_id", tripId).eq("user_id", userId);
    if (error) throw error;
    try { localStorage.removeItem(LS.snapshot(tripId)); } catch {}
  }

  /* ───────── fyll en tur fra en mal ───────── */
  async function applyTemplate(tripId, tpl, dates) {
    const ids = {};
    for (const [key, p] of Object.entries(tpl.places)) {
      ids[key] = await addPlace(tripId, { name: p.name, addr: p.addr, kind: p.kind });
    }
    for (let n = 0; n < tpl.days.length; n++) {
      const d = tpl.days[n];
      const dayId = await addDay(tripId, dates[n]);
      if (d.hotel && ids[d.hotel]) await setHotel(dayId, ids[d.hotel]);
      for (const it of d.items) {
        await addItem(tripId, dayId, {
          t: it.t, title: it.title,
          placeId: it.place ? ids[it.place] : null,
          note: it.note || ""
        });
      }
    }
    for (const c of (tpl.channels || [])) {
      await addChannel(tripId, c.name, c.sub, false, []);
    }
  }

  /* ───────── les program fra PDF ───────── */
  /* Selve modellkallet skjer på serveren; her sender vi bare filene dit
     og får et forslag tilbake. Ingenting lagres før brukeren godkjenner. */
  async function lesProgramFraPdf(tripId, filer) {
    const { data } = await sb.auth.getSession();
    if (!data.session) throw new Error("Du er ikke innlogget.");

    const res = await fetch(CONFIG.supabaseUrl + "/functions/v1/les-program", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + data.session.access_token,
        "apikey": CONFIG.supabaseAnonKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ tripId, filer })
    });

    let svar = null;
    try { svar = await res.json(); } catch { /* tomt svar */ }
    if (!res.ok) throw new Error((svar && svar.feil) || "Klarte ikke lese filen.");
    return svar;
  }

  function signOutLocal() {
    Object.keys(localStorage).filter(k => k.startsWith("tk.")).forEach(k => localStorage.removeItem(k));
    if (sb) sb.auth.signOut().catch(() => {});
  }

  return {
    init, online, fmtDay,
    getProfile, setProfile, getLastTrip, setLastTrip, getLastChannel, setLastChannel,
    myTrips, joinByCode, createTrip, loadTrip, currentTrip, isLeader, leaveTrip, deleteTrip,
    messages, loadMessages, loadRecent, lastByChannel, subscribeTrip, sendMessage, deleteMessage, onChange,
    addChannel, tripMembers, channelMembers, addChannelMember, removeChannelMember, setMemberRole,
    addPlace, updatePlace, addDay, setHotel, addItem, updateItem, deleteItem, deleteDay,
    applyTemplate, lesProgramFraPdf, signOutLocal
  };
})();
