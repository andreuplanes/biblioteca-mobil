/* PANELL · Biblioteca Mòbil · service worker (v2.5, 16/10/2026)
   Desa la pàgina i els visors (3D, PDF, DXF) perquè l'app s'obri SENSE INTERNET. Els fitxers dels projectes NO passen per
   aquí: es desen a IndexedDB des de la fitxa («⬇ Guardar per a sense connexió»). Dropbox (un altre domini) no es toca mai.
   · La pàgina (index.html): primer internet (així arriben les versions noves); si no n'hi ha, la desada.
   · La resta (visors, icones): la desada; si no hi és, internet.
   Si canvien els visors, canviar el nom de CAU. */
const CAU = 'bm-app-1';
const FITXERS = ['./', 'index.html', 'manifest.webmanifest', 'icon.png', 'icon-512.png',
  'model-viewer.min.js', 'pdf.min.js', 'pdf.worker.min.js', 'visordxf.js'];

self.addEventListener('install', ev => {
  ev.waitUntil(caches.open(CAU).then(c => Promise.all(FITXERS.map(f => c.add(new Request(f, { cache: 'reload' })).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', ev => {
  ev.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('bm-app-') && k !== CAU).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
function ambTemps(p, ms) { return new Promise((ok, ko) => { const t = setTimeout(() => ko(new Error('temps')), ms); p.then(r => { clearTimeout(t); ok(r); }, e => { clearTimeout(t); ko(e); }); }); }
self.addEventListener('fetch', ev => {
  const req = ev.request; if (req.method !== 'GET') return;
  const url = new URL(req.url); if (url.origin !== self.location.origin) return;
  const pagina = req.mode === 'navigate' || /\/(index\.html)?$/.test(url.pathname);
  if (pagina) {
    ev.respondWith((async () => {
      try {
        const r = await ambTemps(fetch(req, { cache: 'no-store' }), 6000);
        if (r && r.ok) { const c = await caches.open(CAU); c.put('index.html', r.clone()); }
        return r;
      } catch (e) {
        const c = await caches.open(CAU);
        return (await c.match('index.html')) || (await c.match('./')) || Response.error();
      }
    })());
    return;
  }
  ev.respondWith((async () => {
    const c = await caches.open(CAU), m = await c.match(req, { ignoreSearch: true });
    if (m) return m;
    const r = await fetch(req); if (r && r.ok) c.put(req, r.clone()); return r;
  })());
});
