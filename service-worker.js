/* ============================================================
   service-worker.js — caché básico para que Mini Desktop
   funcione sin internet después de la primera visita.

   IMPORTANTE: cuando cambies cualquier archivo del proyecto,
   sube CACHE_VERSION en 1 (ej: 'v1' -> 'v2') para que los
   teléfonos que ya instalaron la app bajen la versión nueva.
   ============================================================ */
var CACHE_VERSION = 'mini-desktop-v1';

var APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/shell.js',
  './js/app-notepad.js',
  './js/app-sheet.js',
  './js/app-pdf.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function (cache) {
      return cache.addAll(APP_SHELL);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (key) { return key !== CACHE_VERSION; })
            .map(function (key) { return caches.delete(key); })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  // Solo controlamos peticiones del mismo origen (el propio repo).
  // Las peticiones a otros orígenes (como el CDN de PDF.js) se dejan
  // pasar directo a la red: si no hay internet, simplemente fallarán,
  // pero el resto de la app (bloc de notas y hoja de cálculo) sigue
  // funcionando sin problema.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then(function (cached) {
      if (cached) return cached;
      return fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE_VERSION).then(function (cache) { cache.put(req, copy); });
        return res;
      }).catch(function () {
        if (req.mode === 'navigate') return caches.match('./index.html');
      });
    })
  );
});
