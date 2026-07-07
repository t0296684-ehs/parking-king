// 找位子 Service Worker v1 — App 殼快取優先、API 一律走網路
const CACHE = "zhaoweizi-v4";
const SHELL = ["./", "./index.html", "./app.js", "./manifest.json", "./icon-192.png", "./icon-512.png", "./logo.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // API 與地圖圖磚不快取，直接走網路
  if (url.hostname.endsWith("workers.dev") || url.hostname.includes("openstreetmap")) return;
  // 同源 App 殼：快取優先
  if (url.origin === self.location.origin) {
    e.respondWith(
      caches.match(e.request).then((hit) => hit ||
        fetch(e.request).then((resp) => {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
          return resp;
        }))
    );
  }
});
