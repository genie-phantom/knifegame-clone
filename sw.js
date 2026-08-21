// Offline-first service worker. The game is fully static, so every asset is
// precached on install and served cache-first; a bumped CACHE drops the old one.
const CACHE = 'kkk-v5';

const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './js/main.js',
  './js/game.js',
  './js/patterns.js',
  './js/save.js',
  './js/skins.js',
  './js/quests.js',
  './assets/img/bg.png',
  './assets/img/log.png',
  './assets/img/dagger.png',
  './assets/img/spark.png',
  './assets/sfx/hit1.mp3',
  './assets/sfx/fail.mp3',
  './assets/sfx/click.mp3',
  './assets/sfx/bang.mp3',
  './assets/icon/icon-192.png',
  './assets/icon/icon-512.png',
  './assets/icon/maskable-192.png',
  './assets/icon/maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      // addAll rejects the whole batch on one failure; tolerate per-asset misses
      .then((c) => Promise.allSettled(ASSETS.map((a) => c.add(a))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // let fonts/CDN go to network

  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match('./index.html'));
    }),
  );
});
