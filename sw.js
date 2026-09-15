/* sw.js — gjør appen tilgjengelig uten nett.
   Bump CACHE når filene endres, ellers får folk den gamle versjonen. */

const CACHE = "turkompis-v1";
const SHELL = [
  "./",
  "index.html",
  "styles.css",
  "js/data.js",
  "js/store.js",
  "js/parse.js",
  "js/ui.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-180.png"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(SHELL.map(u => c.add(u))))
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

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;

  // Sidenavigasjon: prøv nett først, fall tilbake til lagret skall offline.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).catch(() => caches.match("index.html", { ignoreSearch: true }))
                .then(r => r || caches.match("./"))
    );
    return;
  }

  const sameOrigin = new URL(req.url).origin === self.location.origin;
  if (!sameOrigin) return; // skrifter o.l. håndteres av nettleseren

  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    }).catch(() => hit))
  );
});
