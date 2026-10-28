// Offline support: keeps the app on the phone so it opens without signal.
// Firebase handles offline data itself; this only caches the app's own files.
const VERSION = '2026.10.27-859042';
const CACHE = 'bubfeed-' + VERSION;
const SHELL = ['./', './index.html', './config.js', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('bubfeed-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Never cache live Google traffic (data, sign-in, App Check, Drive).
  if (/firestore\.googleapis\.com|identitytoolkit|securetoken|firebaseappcheck|recaptcha|www\.googleapis\.com|accounts\.google\.com|apis\.google\.com/.test(url.href)) return;

  const sameOrigin = url.origin === self.location.origin;
  // the "is there a new version?" check always asks the server
  if (sameOrigin && url.pathname.endsWith('/version.json')) return;
  const library = /www\.gstatic\.com\/firebasejs\/|fonts\.googleapis\.com|fonts\.gstatic\.com/.test(url.href);

  if (sameOrigin && (req.mode === 'navigate' || /\/(index\.html)?$/.test(url.pathname) || url.pathname.endsWith('config.js'))) {
    // Network first, so app updates arrive; the cached copy is used offline.
    event.respondWith(
      fetch(req)
        .then(res => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); } return res; })
        .catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
    );
    return;
  }
  if (sameOrigin || library) {
    event.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      }))
    );
  }
});
