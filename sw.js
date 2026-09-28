// GenZ Reading — service worker
// Bump CACHE_NAME on every content/app update to invalidate old caches.
const CACHE_NAME = "genz-reading-e2730eb140";
const AUDIO_CACHE = "genz-reading-audio";   // sürümden bağımsız: sesler yeniden inmesin
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./ogretmen.html",
  "./app.js",
  "./manifest.json",
  "./data/stories.json",
  "./data/lexicon.json",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-maskable-192.png",
  "./icons/icon-maskable-512.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    // addAll tek bir 404'te tümüyle başarısız olur; korumalı dağıtımda (dist/)
    // app.js ve data/*.json bulunmadığı için önbellek hiç kurulmuyordu.
    // Dosyalar tek tek eklenir, bulunmayanlar sessizce atlanır.
    caches.open(CACHE_NAME)
      .then((cache) => Promise.all(CORE_ASSETS.map((u) => cache.add(u).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      // Ses önbelleği (AUDIO_CACHE) sürüm yükseltmesinde SİLİNMEZ; yalnızca eski uygulama önbellekleri gider.
      Promise.all(keys.filter((k) => k !== CACHE_NAME && k !== AUDIO_CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Cache-first for app shell & data, network-first fallback for anything else (e.g. Google Fonts),
// so the reading app still works fully offline once installed.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const isCoreAsset = url.origin === self.location.origin;

  // Ses dosyaları (uygulamayla aynı yerden, /audio/ altından): önce önbellek. Bir kez indirilen
  // hikaye sesi çevrimdışı da çalar ve sürüm yükseltmelerinde silinmez —
  // bu yüzden ayrı ve sürümsüz bir önbellekte tutulur.
  if (/\/audio\//.test(url.pathname)) {
    event.respondWith(
      caches.open(AUDIO_CACHE).then((cache) =>
        cache.match(req).then((hit) => hit || fetch(req).then((res) => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        }))
      )
    );
    return;
  }

  if (isCoreAsset) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          const resClone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
          return res;
        }).catch(() => cached);
      })
    );
  } else {
    // external (e.g. font) requests: try network, fall back to cache, never hard-fail
    event.respondWith(
      fetch(req).then((res) => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
        return res;
      }).catch(() => caches.match(req))
    );
  }
});
