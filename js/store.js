/* store.js — alt som leser og skriver data går gjennom denne filen.
   I dag: nettleserens localStorage (kun denne enheten).
   Når backend kobles på byttes kroppen i disse funksjonene — resten av
   appen kaller de samme navnene og trenger ingen endring.

   MERK: ingenting her er sikkerhet. Turkoden er en nøkkel til et rom,
   ikke innlogging, og navnet er selvvalgt. Se README.md. */

const Store = (() => {
  const K = {
    profile: "tk.profile",
    joined: "tk.joined",
    lastTrip: "tk.lastTrip",
    lastChannel: id => `tk.lastChannel.${id}`,
    msgs: (t, c) => `tk.msgs.${t}.${c}`,
    channels: t => `tk.channels.${t}`
  };

  function read(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch { return false; }
  }

  /* ---- profil ---- */
  function getProfile() { return read(K.profile, null); }
  function setProfile(first, last) {
    const p = {
      first: first.trim(),
      last: last.trim(),
      name: `${first.trim()} ${last.trim()}`.trim(),
      initials: ((first.trim()[0] || "") + (last.trim()[0] || "")).toUpperCase()
    };
    write(K.profile, p);
    return p;
  }

  /* ---- turer ---- */
  function joinedTripIds() { return read(K.joined, []); }
  function joinTrip(trip) {
    const ids = joinedTripIds();
    if (!ids.includes(trip.id)) write(K.joined, ids.concat([trip.id]));
    setLastTrip(trip.id);
  }
  function leaveTrip(tripId) {
    write(K.joined, joinedTripIds().filter(x => x !== tripId));
    const rest = joinedTripIds();
    if (getLastTrip() === tripId) {
      if (rest.length) write(K.lastTrip, rest[0]);
      else localStorage.removeItem(K.lastTrip);
    }
  }
  function getLastTrip() {
    const id = read(K.lastTrip, null);
    return id && joinedTripIds().includes(id) ? id : (joinedTripIds()[0] || null);
  }
  function setLastTrip(id) { write(K.lastTrip, id); }

  /* ---- kanaler ---- */
  function channels(tripId) {
    const trip = tripById(tripId);
    if (!trip) return [];
    const extra = read(K.channels(tripId), []);
    return trip.channels.concat(extra);
  }
  function addChannel(tripId, name, sub) {
    const extra = read(K.channels(tripId), []);
    const id = "c" + Date.now().toString(36);
    extra.push({ id, name: name.trim(), sub: (sub || "").trim(), seed: [], custom: true });
    write(K.channels(tripId), extra);
    return id;
  }
  function getLastChannel(tripId) {
    const id = read(K.lastChannel(tripId), null);
    const list = channels(tripId);
    return list.some(c => c.id === id) ? id : (list[0] ? list[0].id : null);
  }
  function setLastChannel(tripId, channelId) { write(K.lastChannel(tripId), channelId); }

  /* ---- meldinger ---- */
  function seedTimestamp(rel) {
    const m = String(rel).match(/^-(\d+)([dh])$/);
    if (!m) return new Date().toISOString();
    const ms = Number(m[1]) * (m[2] === "d" ? 86400000 : 3600000);
    return new Date(Date.now() - ms).toISOString();
  }

  function messages(tripId, channelId) {
    const ch = channels(tripId).find(c => c.id === channelId);
    const seeded = (ch && ch.seed ? ch.seed : []).map((m, i) => ({
      id: `seed-${channelId}-${i}`,
      who: m.who, role: m.role, txt: m.txt,
      ts: seedTimestamp(m.t),
      mine: false
    }));
    const own = read(K.msgs(tripId, channelId), []);
    return seeded.concat(own).sort((a, b) => a.ts.localeCompare(b.ts));
  }

  function addMessage(tripId, channelId, msg) {
    const own = read(K.msgs(tripId, channelId), []);
    own.push(msg);
    write(K.msgs(tripId, channelId), own);
  }

  function updateMessage(tripId, channelId, id, patch) {
    const own = read(K.msgs(tripId, channelId), []);
    const i = own.findIndex(m => m.id === id);
    if (i === -1) return;
    own[i] = Object.assign({}, own[i], patch);
    write(K.msgs(tripId, channelId), own);
  }

  function reset() {
    Object.keys(localStorage)
      .filter(k => k.startsWith("tk."))
      .forEach(k => localStorage.removeItem(k));
  }

  return {
    getProfile, setProfile,
    joinedTripIds, joinTrip, leaveTrip, getLastTrip, setLastTrip,
    channels, addChannel, getLastChannel, setLastChannel,
    messages, addMessage, updateMessage,
    reset
  };
})();
