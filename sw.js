/* TaskxNova service worker — caches the app shell for offline use */
const CACHE_NAME = 'taskxnova-v8';
const SHELL = [
  './', './index.html', './style.css',
  './utils.js', './storage.js', './attachments.js', './firebase.js', './auth.js',
  './app.js', './revision.js', './syllabus.js', './calendar.js', './charts.js',
  './reminders.js',
  './manifest.json', './icon-192.png', './icon-512.png', './logo-mark.png',
  './favicon.ico', './favicon-16x16.png', './favicon-32x32.png', './favicon-48x48.png',
  './favicon-64x64.png', './favicon-128x128.png', './apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL)).catch(()=>{})
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if(event.request.method !== 'GET') return;
  // Never cache Firebase/API calls — always go to network for those.
  if(event.request.url.includes('googleapis') || event.request.url.includes('firebase')) return;
  event.respondWith(
    caches.match(event.request).then(cached => {
      const fetchPromise = fetch(event.request).then(resp => {
        if(resp && resp.status === 200){
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return resp;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
