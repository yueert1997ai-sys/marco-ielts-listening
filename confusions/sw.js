const CONFUSIONS_VERSION = "v1.0.1";
const CACHE_PREFIX = "ielts-confusions-";
const CACHE = `${CACHE_PREFIX}v2`;
const CORE = [
  "./",
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
  const isModuleAsset = url.origin === location.origin && (
    url.pathname.includes("/confusions/")
    || url.pathname.includes("/vendor/phosphor/")
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

  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
    if (response.ok) caches.open(CACHE).then((cache) => cache.put(event.request, response.clone()));
    return response;
  })));
});
