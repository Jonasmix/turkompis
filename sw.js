/* sw.js — gjør appen tilgjengelig uten nett, og sørger for at en ny
   utgave faktisk når fram.

   BUILD må være det samme tallet som ?v= i index.html. Bump begge når du
   endrer noe, så får alle den nye versjonen: nye filadresser går utenom
   både service workeren og nettleserens eget mellomlager. */

const BUILD = 15;
const CACHE = "turkompis-b" + BUILD;

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
