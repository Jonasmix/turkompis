/* sw.js — gjør appen tilgjengelig uten nett, og sørger for at en ny
   utgave faktisk når fram.

   BUILD må være det samme tallet som ?v= i index.html. Bump begge når du
   endrer noe, så får alle den nye versjonen: nye filadresser går utenom
   både service workeren og nettleserens eget mellomlager. */

const BUILD = 52;
const CACHE = "tourflow-b" + BUILD;

const SHELL = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-180.png",
  "styles.css?v=" + BUILD,
  "vendor/supabase.js?v=" + BUILD,
  "js/config.js?v=" + BUILD,
  "js/templates.js?v=" + BUILD,
  "js/api.js?v=" + BUILD,
  "js/parse.js?v=" + BUILD,
  "js/ui.js?v=" + BUILD
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(
        SHELL.map(u => c.add(new Request(u, { cache: "reload" })))
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* ───────────────── varsler ─────────────────
   Dette er den eneste delen av appen som kjører når appen er lukket.
   Serveren sender en kort tekst hit, og vi viser den. Innholdet er
   allerede kryptert på veien, og ligger aldri hos Apple eller Google i
   lesbar form. */
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { /* tomt varsel */ }
  e.waitUntil(self.registration.showNotification(d.t || "TourFlow", {
    body: d.b || "",
    tag: d.tag || "tourflow",          // nye varsel om samme chat erstatter det gamle
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    data: { url: d.u || "./" }
  }));
});

// Trykker du på varselet, skal du havne i riktig chat — i vinduet som
// allerede er åpent hvis det finnes, ellers i et nytt.
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const maal = (e.notification.data && e.notification.data.url) || "./";
  e.waitUntil((async () => {
    const vinduer = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const hjemme = new URL(self.registration.scope);
    for (const v of vinduer) {
      if (new URL(v.url).pathname.startsWith(hjemme.pathname)) {
        v.postMessage({ aapne: maal });
        return v.focus();
      }
    }
    return self.clients.openWindow(new URL(maal, hjemme).href);
  })());
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;

  // Selve siden hentes alltid ferskt, utenom nettleserens mellomlager.
  // Uten cache:"reload" kan en gammel index.html bli liggende i timevis.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(new Request(req.url, { cache: "reload" }))
        .catch(() => caches.match("index.html", { ignoreSearch: true }))
        .then(r => r || caches.match("./"))
    );
    return;
  }

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;  // API og skrifter går rett på nett

  e.respondWith(
    caches.open(CACHE).then(cache =>
      cache.match(req).then(hit => {
        const nett = fetch(req).then(res => {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        }).catch(() => hit);
        return hit || nett;
      })
    )
  );
});
