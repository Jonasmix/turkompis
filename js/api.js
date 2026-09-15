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
  const cache = { trip: null, messages: {} };
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
      .select("role, trips ( id, code, name, org, dates_label )")
      .eq("user_id", userId);
    if (error) throw error;
    return (data || [])
      .filter(r => r.trips)
      .map(r => ({ id: r.trips.id, code: r.trips.code, name: r.trips.name,
                   org: r.trips.org, dates: r.trips.dates_label, role: r.role }));
  }

  async function joinByCode(code, name) {
    const { data, error } = await sb.rpc("join_trip", { p_code: code, p_name: name });
    if (error) throw friendly(error);
    const t = Array.isArray(data) ? data[0] : data;
    return { id: t.id, code: t.code, name: t.name, org: t.org, dates: t.dates_label };
  }

  async function createTrip({ name, org, dates, leaderName }) {
    const { data, error } = await sb.rpc("create_trip", {
      p_name: name, p_org: org || "", p_dates: dates || "", p_leader_name: leaderName
    });
    if (error) throw friendly(error);
    const t = Array.isArray(data) ? data[0] : data;
    return { id: t.id, code: t.code, name: t.name, org: t.org, dates: t.dates_label, role: "leader" };
  }

  function friendly(error) {
    const m = String(error.message || "");
    if (m.includes("ukjent_kode")) return new Error("Fant ingen tur med den koden.");
    if (m.includes("mangler_navn")) return new Error("Navn mangler.");
    if (m.includes("for_mange_turer")) return new Error("Du har laget for mange turer.");
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
        sb.from("items").select("*").eq("trip_id", tripId).order("t"),
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

  function build(trip, member, places, days, items, channels) {
    const placeMap = {};
    for (const p of places) {
      const words = p.name.toLowerCase().split(/[\s,()]+/).filter(w => w.length > 3);
      placeMap[p.id] = {
        id: p.id, name: p.name, addr: p.addr, kind: p.kind,
        alias: Array.from(new Set([p.name.toLowerCase(), ...words, ...(p.aliases || [])]))
      };
    }
    const byDay = {};
    for (const it of items) (byDay[it.day_id] = byDay[it.day_id] || []).push(it);

    return {
      id: trip.id, code: trip.code, name: trip.name, org: trip.org, dates: trip.dates_label,
      role: member ? member.role : "member",
      places: placeMap,
      days: days.map(d => Object.assign({
        id: d.id, date: d.date, hotel: d.hotel_place_id,
        items: (byDay[d.id] || []).sort((a, b) => a.t.localeCompare(b.t)).map(i => ({
          id: i.id, t: i.t, title: i.title, place: i.place_id, note: i.note, src: i.src
        }))
      }, fmtDay(d.date))),
      channels: channels.map(c => ({ id: c.id, name: c.name, sub: c.sub }))
    };
  }

  const currentTrip = () => cache.trip;
  const isLeader = () => Boolean(cache.trip && cache.trip.role === "leader");

  /* ───────── meldinger ───────── */
  function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
  function fire() { listeners.forEach(f => { try { f(); } catch {} }); }

  function messages(channelId) { return cache.messages[channelId] || []; }

  async function loadMessages(tripId, channelId) {
    if (!online()) return messages(channelId);
    const { data, error } = await sb
      .from("messages").select("*")
      .eq("channel_id", channelId).order("created_at").limit(300);
    if (error) throw error;
    cache.messages[channelId] = (data || []).map(shape);
    subscribe(channelId);
    return cache.messages[channelId];
  }

  const shape = m => ({
    id: m.id, who: m.author_name, role: m.role, txt: m.txt,
    ts: m.created_at, action: m.action || null, mine: m.author_id === userId
  });

  function subscribe(channelId) {
    if (liveSub) { sb.removeChannel(liveSub); liveSub = null; }
    liveSub = sb.channel("msg-" + channelId)
      .on("postgres_changes",
          { event: "INSERT", schema: "public", table: "messages", filter: `channel_id=eq.${channelId}` },
          payload => {
            const list = cache.messages[channelId] || (cache.messages[channelId] = []);
            if (list.some(m => m.id === payload.new.id)) return;
            list.push(shape(payload.new));
            list.sort((a, b) => a.ts.localeCompare(b.ts));
            fire();
          })
      .on("postgres_changes",
          { event: "DELETE", schema: "public", table: "messages", filter: `channel_id=eq.${channelId}` },
          payload => {
            const list = cache.messages[channelId];
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
  async function addChannel(tripId, name, sub) {
    const { data, error } = await sb.from("channels")
      .insert({ trip_id: tripId, name, sub: sub || "" }).select().single();
    if (error) throw error;
    if (cache.trip) cache.trip.channels.push({ id: data.id, name: data.name, sub: data.sub });
    return data.id;
  }

  /* ───────── program (kun reiseleder) ───────── */
  async function addPlace(tripId, { name, addr, kind }) {
    const { data, error } = await sb.from("places")
      .insert({ trip_id: tripId, name, addr: addr || "", kind: kind || "Sted" }).select().single();
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

  async function addItem(tripId, dayId, { t, title, placeId, note }) {
    const { data, error } = await sb.from("items").insert({
      trip_id: tripId, day_id: dayId, t, title,
      place_id: placeId || null, note: note || ""
    }).select().single();
    if (error) throw error;
    return data.id;
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
    if (data) throw new Error("Databasen tillot ikke sletting. Kjor supabase/patch-01-slett-tur.sql i Supabase.");
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
      await addChannel(tripId, c.name, c.sub);
    }
  }

  function signOutLocal() {
    Object.keys(localStorage).filter(k => k.startsWith("tk.")).forEach(k => localStorage.removeItem(k));
    if (sb) sb.auth.signOut().catch(() => {});
  }

  return {
    init, online, fmtDay,
    getProfile, setProfile, getLastTrip, setLastTrip, getLastChannel, setLastChannel,
    myTrips, joinByCode, createTrip, loadTrip, currentTrip, isLeader, leaveTrip, deleteTrip,
    messages, loadMessages, sendMessage, deleteMessage, onChange,
    addChannel, addPlace, addDay, setHotel, addItem, deleteItem, deleteDay,
    applyTemplate, signOutLocal
  };
})();
