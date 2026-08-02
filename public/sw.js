// Bump CACHE on every release — the cache-first strategy below will otherwise
// keep serving the previously installed build forever.
const CACHE = 'flappy-pad-v2';

// Relative paths: root-absolute ones ('/index.html') 404 when the app is served
// from a subpath such as GitHub Pages, which rejects install and silently leaves
// the app with no offline support at all.
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/core.js',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request))
  );
});
