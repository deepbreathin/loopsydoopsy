// Offline support: serve the app shell from cache, refresh it in the background.
const CACHE = 'loopsy-v10';
const SHELL = [
  './',
  'index.html',
  'css/style.css',
  'js/main.js',
  'js/engine.js',
  'js/timing.js',
  'js/pad-view.js',
  'js/trim.js',
  'js/storage.js',
  'js/wav.js',
  'js/capture-worklet.js',
  'js/boardfile.js',
  'js/layout.js',
  'js/pitch.js',
  'js/projects.js',
  'js/song.js',
  'js/audio-files.js',
  'js/help.js',
  'js/mp3-worker.js',
  'vendor/lame.min.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  // Fetch fresh copies (not the browser's HTTP cache) so a new version is all one version.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((hit) => {
      const net = fetch(e.request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || net;
    }),
  );
});
