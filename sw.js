// Permite usar la app sin conexión (en obra o en campo).
// Abre siempre al instante desde el teléfono y busca la versión nueva por detrás.
const V = 31; // igual que ?v= en index.html
const CACHE = 'reportplus-v' + V;
const ASSETS = ['./', 'index.html', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
  'vendor/jspdf.umd.min.js', 'vendor/jszip.min.js',
  ...['styles.css', 'i18n.js', 'icons.js', 'db.js', 'annotate.js', 'pdf.js', 'app.js'].map(f => `${f}?v=${V}`)];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const nav = req.mode === 'navigate';
  e.respondWith(caches.open(CACHE).then(async c => {
    const hit = await c.match(req, { ignoreSearch: nav }) || (nav ? await c.match('index.html') : null);
    const net = fetch(req, { cache: 'no-cache' }).then(r => { if (r.ok) c.put(req, r.clone()); return r; });
    if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
    return net;
  }));
});
