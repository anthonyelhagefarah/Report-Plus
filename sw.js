// Permite usar la app sin conexión (en obra o en campo).
const CACHE = 'reportplus-v21';
const ASSETS = ['./', 'index.html', 'styles.css', 'icons.js', 'db.js', 'annotate.js', 'pdf.js', 'app.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png',
  'vendor/jspdf.umd.min.js', 'vendor/jszip.min.js'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // Siempre pregunta al servidor si hay versión nueva (sin usar la caché del navegador).
  const same = new URL(e.request.url).origin === location.origin;
  e.respondWith(fetch(e.request, same ? { cache: 'no-cache' } : undefined).then(r => {
    const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r;
  }).catch(() => caches.match(e.request)));
});
