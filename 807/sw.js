const CACHE = "ielts-807-v1.3.0";
const CORE = ["./", "./index.html", "./version.json", "./style.css?v=2", "../style.css", "./app.js?v=4", "./priorities.js?v=1", "./data/terms.json", "./data/meanings.json", "./data/priority-rules.json", "../source/807.txt", "./variants.js", "../shared/module-audio.js?v=1", "../shared/module-store.js?v=1", "../module-audio/manifest.json", "../vendor/phosphor/phosphor-regular.css", "../vendor/phosphor/Phosphor.woff2"];
self.addEventListener("install", event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(CORE)).then(() => self.skipWaiting())));
self.addEventListener("activate", event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith("ielts-807-") && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== location.origin) return;
  event.respondWith((async () => {
    if (url.pathname.endsWith(".mp3")) {
      const cache = await caches.open("ielts-module-audio-v1");
      const cached = await cache.match(url.href);
      if (cached) return cached;
      const response = await fetch(url.href);
      if (response.ok) await cache.put(url.href, response.clone());
      return response;
    }
    try {
      const response = await fetch(event.request);
      if (response.ok) await (await caches.open(CACHE)).put(event.request, response.clone());
      return response;
    } catch (_) { return await caches.match(event.request, { ignoreSearch: true }) || Response.error(); }
  })());
});
