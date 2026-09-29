// GenZ Reading — service worker
// Bump CACHE_NAME on every content/app update to invalidate old caches.
const CACHE_NAME = "genz-reading-fefd961389";
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

  // Ses dosyaları (uygulamayla aynı yerden, /audio/ altından). Ayrı ve sürümsüz bir önbellekte
  // tutulur: uygulama güncellense de indirilen sesler silinmez, çevrimdışı da çalar.
  if (/\/audio\//.test(url.pathname)) {
    if (/\.json$/.test(url.pathname)) {
      // manifest.json ve kelime damgaları: ÖNCE AĞ (yeni eklenen sesler hemen görünsün),
      // çevrimdışıysa önbellekteki son sürüm.
      event.respondWith(audioJsonNetworkFirst(req));
    } else {
      event.respondWith(serveAudio(req));
    }
    return;
  }

  // Sayfanın kendisi (index.html, ogretmen.html): ÖNCE AĞ. Yeni sürüm yayınlanınca bir sonraki açılışta
  // hemen gelir; çevrimdışıysa önbellekteki son sürüm açılır.
  if (isCoreAsset && (req.mode === "navigate" || /\.html$/.test(url.pathname) || url.pathname.endsWith("/"))) {
    event.respondWith(
      fetch(req).then((res) => {
        if (res.ok) { const c = res.clone(); caches.open(CACHE_NAME).then((cache) => cache.put(req, c)); }
        return res;
      }).catch(() => caches.match(req).then((hit) => hit || caches.match("./index.html")))
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

// ---------------------------------------------------------------- ses yardımcıları
async function audioJsonNetworkFirst(req) {
  const cache = await caches.open(AUDIO_CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req.url, res.clone());
    return res;
  } catch (e) {
    return (await cache.match(req.url)) || new Response("", { status: 404 });
  }
}

// <audio> öğesi ses dosyasını Range isteğiyle ister (iPhone Safari'de zorunlu, seek için gerekli).
// Cache API kısmi (206) yanıtları saklayamaz; bu yüzden dosya bir kez TAM indirilip önbelleğe
// konur, Range istekleri de önbellekten dilimlenerek 206 olarak yanıtlanır.
async function serveAudio(req) {
  const cache = await caches.open(AUDIO_CACHE);
  let res = await cache.match(req.url);
  if (!res) {
    const net = await fetch(req.url);              // Range'siz, tam dosya
    if (!net.ok) return net;
    await cache.put(req.url, net.clone());
    res = net;
  }
  const range = req.headers.get("range");
  if (!range) return res;

  const buf = await res.arrayBuffer();
  const size = buf.byteLength;
  const m = /bytes=(\d*)-(\d*)/.exec(range);
  let start = m && m[1] !== "" ? parseInt(m[1], 10) : 0;
  let end = m && m[2] !== "" ? parseInt(m[2], 10) : size - 1;
  if (m && m[1] === "" && m[2] !== "") { start = Math.max(0, size - parseInt(m[2], 10)); end = size - 1; }  // bytes=-N
  if (isNaN(start) || start >= size) {
    return new Response("", { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  }
  end = Math.min(end, size - 1);
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    statusText: "Partial Content",
    headers: {
      "Content-Type": res.headers.get("Content-Type") || "audio/mpeg",
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Content-Length": String(end - start + 1),
      "Accept-Ranges": "bytes"
    }
  });
}
