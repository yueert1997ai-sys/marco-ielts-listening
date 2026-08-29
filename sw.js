const APP_VERSION = "v2.13.0";
const CACHE = "ielts-listening-v28";
const CORE = [
  "./",
  `./index.html?v=${APP_VERSION}`,
  `./style.css?v=${APP_VERSION}`,
  `./vendor/phosphor/phosphor-regular.css?v=${APP_VERSION}`,
  `./app.js?v=${APP_VERSION}`,
  `./data/listening.json?v=${APP_VERSION}`,
  `./data/directions.json?v=${APP_VERSION}`,
  `./manifest.webmanifest?v=${APP_VERSION}`,
  `./version.json?v=${APP_VERSION}`,
  "./icon.svg",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png",
  "./vendor/phosphor/Phosphor.woff2",
  "./vendor/phosphor/LICENSE",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then(async (cache) => {
    await cache.addAll(CORE);
    const [data, directions] = await Promise.all([
      fetch(`./data/listening.json?v=${APP_VERSION}`).then((response) => response.json()),
      fetch(`./data/directions.json?v=${APP_VERSION}`).then((response) => response.json()),
    ]);
    const audio = [...new Set([...data, ...directions].filter((item) => item.audioPath).map((item) => `./${item.audioPath}`))];
    for (let index = 0; index < audio.length; index += 20) {
      await cache.addAll(audio.slice(index, index + 20));
    }
    await self.skipWaiting();
  }));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  const isCoreRequest = event.request.mode === "navigate" || (
    url.origin === location.origin && (
      url.pathname.endsWith("/index.html") ||
      url.pathname.endsWith("/app.js") ||
      url.pathname.endsWith("/style.css") ||
      url.pathname.endsWith("/manifest.webmanifest") ||
      url.pathname.endsWith("/version.json") ||
      url.pathname.endsWith("/data/listening.json") ||
      url.pathname.endsWith("/data/directions.json")
    )
  );

  if (isCoreRequest) {
    event.respondWith(
      fetch(event.request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      }).catch(() => caches.match(event.request, { ignoreSearch: true }))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
      if (response.ok && url.origin === location.origin) {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
      }
      return response;
    }))
  );
});
