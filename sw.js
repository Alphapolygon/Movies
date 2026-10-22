// Increment this cache version whenever deploying changed application files.
// No API responses, watch-provider listings, or third-party resources are stored.
const CACHE = 'whattowatchnext-shell-v3.1.0';
const SHELL = ['./', './index.html', './style.css', './js/app.js', './js/core.js', './js/api.js', './js/store.js', './js/config.js', './data/library.json', './site.webmanifest', './favicon.ico', './web-app-manifest-192x192.png', './web-app-manifest-512x512.png', './apple-touch-icon.png'];
const root = self.registration.scope;
const assets = new Set(SHELL.map(path => new URL(path, root).href));
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll([...assets])));
  // No skipWaiting: a new version cannot replace a running editing session.
});
self.addEventListener('activate', event => event.waitUntil((async () => {
  for (const name of await caches.keys()) if (name.startsWith('whattowatchnext-shell-') && name !== CACHE) await caches.delete(name);
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || !assets.has(event.request.url)) return;
  event.respondWith((async () => {
    const cached = await caches.match(event.request, { cacheName: CACHE });
    return cached || fetch(event.request);
  })());
});
