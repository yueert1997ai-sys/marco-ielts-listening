const CONFUSIONS_VERSION = "v1.2.0";
const CACHE_PREFIX = "ielts-confusions-";
const CACHE = `${CACHE_PREFIX}v4`;
const CORE = [
  "./",
  "./?mode=flash",
  "./flash.js?v=1",
  "./flash-logic.js?v=1",
  "../shared/module-audio.js?v=1",
  "../shared/module-store.js?v=1",
  "../module-audio/manifest.json",
  `./index.html?v=${CONFUSIONS_VERSION}`,
  `./style.css?v=${CONFUSIONS_VERSION}`,
  `./logic.js?v=${CONFUSIONS_VERSION}`,
  `./app.js?v=${CONFUSIONS_VERSION}`,
  `./version.json?v=${CONFUSIONS_VERSION}`,
  `./data/confusions.json?v=${CONFUSIONS_VERSION}`,
  `../vendor/phosphor/phosphor-regular.css?v=${CONFUSIONS_VERSION}`,
  "../vendor/phosphor/Phosphor.woff2",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin === location.origin && url.pathname.endsWith(".mp3")) {
    event.respondWith(caches.open("ielts-module-audio-v1").then(async cache => {
      const cached = await cache.match(url.href);
      if (cached) return cached;
      const response = await fetch(url.href);
      if (response.ok) await cache.put(url.href, response.clone());
      return response;
    }));
    return;
  }
  const isModuleAsset = url.origin === location.origin && (
    url.pathname.includes("/confusions/")
    || url.pathname.includes("/vendor/phosphor/")
    || url.pathname.includes("/shared/")
    || url.pathname.includes("/module-audio/")
  );
  if (!isModuleAsset) return;

  const networkFirst = event.request.mode === "navigate"
    || url.pathname.endsWith("/data/confusions.json")
    || url.pathname.endsWith("/version.json")
    || url.pathname.endsWith("/app.js")
    || url.pathname.endsWith("/logic.js")
    || url.pathname.endsWith("/style.css");

  if (networkFirst) {
    event.respondWith(fetch(event.request).then((response) => {
      if (response.ok) caches.open(CACHE).then((cache) => cache.put(event.request, response.clone()));
      return response;
    }).catch(() => caches.match(event.request, { ignoreSearch: true })));
    return;
  }

  event.respondWith(caches.match(event.request, { ignoreSearch: true }).then((cached) => cached || fetch(event.request).then((response) => {
    if (response.ok) caches.open(CACHE).then((cache) => cache.put(event.request, response.clone()));
    return response;
  })));
});
