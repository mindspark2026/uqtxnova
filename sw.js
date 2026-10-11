/* UQTxNova service worker
   - Works under any base path (e.g. https://user.github.io/uqtxnova/): every URL is relative to this file.
   - Pages: network first, falling back to the cached app shell when offline.
   - Same-origin static files: cached copy served instantly, refreshed in the background.
   - Firebase / Google APIs and anything non-GET are never cached (no account or user data is stored here).
   - Bump CACHE_VERSION on each deploy; old caches are deleted on activate. */
const CACHE_VERSION = 'v16';
const CACHE_NAME = 'uqtxnova-' + CACHE_VERSION;
const CDN_CACHE = 'uqtxnova-cdn-1';
const SHELL = [
  './', './index.html', './manifest.json',
  './style.css', './theme.css',
  './utils.js', './storage.js', './attachments.js', './firebase.js', './auth.js',
  './app.js', './enhancements.js', './revision.js', './syllabus.js', './calendar.js', './charts.js', './reminders.js',
  './logo-mark.png', './abhishek-logo.webp',
  './icon-192.png', './icon-512.png', './icon-maskable-192.png', './icon-maskable-512.png',
  './favicon.ico', './favicon-16x16.png', './favicon-32x32.png', './favicon-48x48.png',
  './favicon-64x64.png', './favicon-128x128.png', './apple-touch-icon.png'
];
// Versioned third-party script that the dashboard charts need — safe to keep for offline use.
const CDN_ALLOW = ['https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Add files one by one so a single missing file can't silently break the whole install.
    await Promise.all(SHELL.map(url => cache.add(url).catch(() => console.warn('[sw] could not precache', url))));
    try {
      const cdn = await caches.open(CDN_CACHE);
      await Promise.all(CDN_ALLOW.map(u => cdn.match(u).then(hit => hit || cdn.add(new Request(u, { mode:'cors' })))).map(p => p.catch(() => {})));
    } catch(e){}
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keep = new Set([CACHE_NAME, CDN_CACHE]);
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => !keep.has(k)).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);

  // Third-party: only the allow-listed, versioned Chart.js file is cached; everything else goes straight to the network.
  if(url.origin !== self.location.origin){
    if(CDN_ALLOW.includes(req.url)){
      event.respondWith(caches.open(CDN_CACHE).then(c => c.match(req).then(hit => hit || fetch(req).then(r => { if(r.ok) c.put(req, r.clone()); return r; }))));
    }
    return;
  }

  // Page loads: always try the network first so a new deploy is picked up; offline → cached shell.
  if(req.mode === 'navigate'){
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        if(fresh && fresh.ok){ const c = await caches.open(CACHE_NAME); c.put('./index.html', fresh.clone()); }
        return fresh;
      } catch(e){
        const c = await caches.open(CACHE_NAME);
        return (await c.match('./index.html')) || (await c.match('./')) || Response.error();
      }
    })());
    return;
  }

  // Same-origin static files: stale-while-revalidate.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(req);
    const network = fetch(req).then(resp => {
      if(resp && resp.ok && resp.type === 'basic') cache.put(req, resp.clone());
      return resp;
    }).catch(() => null);
    return cached || (await network) || Response.error();
  })());
});
