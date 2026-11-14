// App-shell service worker: the app opens with no coverage. Pages: network first,
// falling back to the cached app. Built files (hashed names) and fonts: cache first.
// Data (Supabase) is not cached here — the app keeps its own offline copy.
const CACHE = 'fieldops-shell-v1';
const SCOPE = new URL(self.registration.scope).pathname;

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll([SCOPE]).catch(() => undefined)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('fieldops-shell-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (req.mode === 'navigate' && url.origin === self.location.origin && url.pathname.startsWith(SCOPE)) {
    event.respondWith(fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(SCOPE, copy)); }
      return res;
    }).catch(() => caches.match(SCOPE).then((r) => r || Response.error())));
    return;
  }

  const ownFile = url.origin === self.location.origin && url.pathname.startsWith(SCOPE);
  const font = /(^|\.)fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (!ownFile && !font) return;
  event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  })));
});
