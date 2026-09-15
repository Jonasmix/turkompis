/* sw.js — gjør appen tilgjengelig uten nett.
   Bump CACHE når filene endres, ellers får folk den gamle versjonen. */

const CACHE = "turkompis-v5";
const SHELL = [
  "./",
  "index.html",
  "styles.css",
  "vendor/supabase.js",
  "js/config.js",
  "js/templates.js",
  "js/api.js",
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

  // Sidenavigasjon: nett først, lagret skall som reserve.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .catch(() => caches.match("index.html", { ignoreSearch: true }))
        .then(r => r || caches.match("./"))
    );
    return;
  }

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;  // API og skrifter går rett på nett

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
