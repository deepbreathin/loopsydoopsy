// Offline support, one whole version at a time.
//
// Each published version gets its own complete cache, filled in one go when this worker
// installs; pages are served only from it, so old and new files can never be mixed. A new
// version is a new sw.js (BUILD is stamped on publish): the browser installs it alongside,
// it takes over once every file is in, and the page reloads into it.
const BUILD = '__BUILD__';
const CACHE = `loopsy-${BUILD}`;
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
  e.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // "?v=" gets this version's files fresh past every cache on the way (GitHub's servers
      // keep files for a few minutes); they're stored under their plain names.
      await Promise.all(
        SHELL.map(async (u) => {
          const res = await fetch(`${u}${u.includes('?') ? '&' : '?'}v=${BUILD}`, { cache: 'reload' });
          if (!res.ok) throw new Error(`${u}: ${res.status}`);
          await cache.put(u, res);
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = (await cache.match(e.request, { ignoreSearch: true })) || (e.request.mode === 'navigate' && (await cache.match('./')));
      if (hit) return hit;
      try {
        return await fetch(e.request);
      } catch {
        return Response.error();
      }
    })(),
  );
});
