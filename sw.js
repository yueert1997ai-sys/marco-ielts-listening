const CACHE = "ielts-listening-v8";
const CORE = ["./", "./index.html", "./style.css", "./app.js", "./data/listening.json", "./manifest.webmanifest", "./icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then(async (cache) => {
    await cache.addAll(CORE);
    const data = await fetch("./data/listening.json").then((response) => response.json());
    const audio = [...new Set(data.filter((item) => item.audioPath).map((item) => `./${item.audioPath}`))];
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
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
      if (response.ok && new URL(event.request.url).origin === location.origin) {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
      }
      return response;
    }))
  );
});
