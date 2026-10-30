// Offline support: keeps the app on the phone so it opens without signal.
// Firebase handles offline data itself; this only caches the app's own files.
const VERSION = '2026.10.30-d5da16';
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
  if (/firestore\.googleapis\.com|identitytoolkit|securetoken|firebaseappcheck|recaptcha|www\.googleapis\.com|accounts\.google\.com|apis\.google\.com|fcmregistrations|firebaseinstallations|cloudfunctions\.net/.test(url.href)) return;

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

// ---------- notifications ----------
// Firebase delivers a sealed message; it's opened here with the family key this phone already holds
// (the same key store the app uses), so the text never travels or sits anywhere readable.
const b64d = s => { let t = String(s || '').replace(/-/g, '+').replace(/_/g, '/'); while (t.length % 4) t += '='; const bin = atob(t); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; };
function idbGet(id) {
  return new Promise(res => {
    try {
      const r = indexedDB.open('bubfeed-keys', 1);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('k')) r.result.createObjectStore('k', { keyPath: 'id' }); };
      r.onerror = () => res(null);
      r.onsuccess = () => { try { const tx = r.result.transaction('k', 'readonly'); const q = tx.objectStore('k').get(id); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); } catch (e) { res(null); } };
    } catch (e) { res(null); }
  });
}
async function openWith(key, box, aad) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(box.iv), additionalData: new TextEncoder().encode(aad || '') }, key, b64d(box.c));
  return new Uint8Array(pt);
}
// rec: this phone's saved key record; box: {k, iv, c}
async function openBoxWith(rec, box, aad) {
  const ring = JSON.parse(new TextDecoder().decode(await openWith(rec.local, rec.ring, 'local-ring')));
  const raw = ring.keys && ring.keys[box.k];
  if (!raw) throw new Error('no key ' + box.k);
  const key = await crypto.subtle.importKey('raw', b64d(raw), 'AES-GCM', false, ['decrypt']);
  return JSON.parse(new TextDecoder().decode(await openWith(key, box, aad)));
}
async function showPush(d) {
  // the app is open and in front: it already shows what's new
  const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (d.tag !== 'test' && wins.some(w => w.visibilityState === 'visible' && w.focused)) return;
  let msg = null;
  try {
    const rec = await idbGet('dev:' + d.fid);
    const aad = d.rid ? `${d.fid}/r/${String(d.rid).slice(String(d.fid).length + 1)}` : `${d.fid}/n/${d.nid}`;
    if (rec && rec.ring) msg = await openBoxWith(rec, JSON.parse(d.box), aad);
  } catch (e) { msg = null; }
  const prefs = await idbGet('push-prefs');
  const details = !prefs || prefs.details !== false;
  const title = msg ? (details ? msg.t : 'Bub Feed Log') : 'Bub Feed Log';
  const body = msg ? (details ? msg.b : msg.g) : 'Something new in your log';
  const tag = String(d.tag || 'log');
  const actions = tag === 'feed' && d.snz ? [{ action: 'snooze', title: 'Snooze 15 min' }] : /^timer-/.test(tag) ? [{ action: 'stop', title: 'Stop it' }] : [];
  return self.registration.showNotification(title, {
    body, tag: tag === 'log' ? 'log-' + (d.nid || '') : tag, renotify: true,
    icon: 'icons/icon-192.png', badge: 'icons/icon-192.png',
    data: { tag, rid: d.rid || '', snz: d.snz || '', fn: d.fn || '' }, actions
  });
}
self.addEventListener('push', event => {
  let m = {};
  try { m = event.data ? event.data.json() : {}; } catch (e) { m = {}; }
  const d = m.data || m;
  event.waitUntil(showPush(d).catch(() => self.registration.showNotification('Bub Feed Log', { body: 'Something new in your log', icon: 'icons/icon-192.png' })));
});
self.addEventListener('notificationclick', event => {
  const n = event.notification, d = n.data || {};
  n.close();
  if (event.action === 'snooze' && d.rid && d.snz && d.fn) {
    // a tap on Snooze: move this reminder 15 minutes later, without opening the app
    event.waitUntil(fetch(`${d.fn}/snooze?r=${encodeURIComponent(d.rid)}&t=${encodeURIComponent(d.snz)}&m=15`, { method: 'GET', mode: 'no-cors' }).catch(() => {}));
    return;
  }
  const act = event.action === 'stop' ? 'stop-' + String(d.tag).replace('timer-', '') : '';
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const w = wins.find(x => new URL(x.url).pathname.startsWith(new URL(self.registration.scope).pathname));
    if (w) { await w.focus(); w.postMessage({ bub: 'open', tag: d.tag, act }); return; }
    await self.clients.openWindow(`${self.registration.scope}#notify=${encodeURIComponent(d.tag || 'log')}${act ? '~' + act : ''}`);
  })());
});
