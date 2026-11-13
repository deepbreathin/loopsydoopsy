// Offline support: serve the app shell from cache, refresh it in the background.
const CACHE = 'loopsy-v19';
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
  'js/audio-files.js',
  'js/help.js',
  'js/mic.js',
  'js/device.js',
  'js/version.js',
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

// Network first, so a new version shows up as soon as it's published; the cache is the
// fallback when offline (or the network is very slow).
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await Promise.race([
          fetch(e.request.url, { cache: 'no-cache' }), // revalidate, don't trust the HTTP cache
          new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), 10000)),
        ]);
        if (res.ok) cache.put(e.request, res.clone());
        return res;
      } catch {
        return (await cache.match(e.request, { ignoreSearch: true })) || (await cache.match('./')) || Response.error();
      }
    })(),
  );
});
