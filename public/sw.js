// QWX POKER — офлайн-кэш. Повторный вход: код, модели, текстуры и шрифты берутся с устройства.
// HTML всегда сначала из сети (чтобы обновления игры приходили сразу), при обрыве — из кэша.
const VER = 'qwx-v1';
const STATIC = /\/(assets|models|textures|icons)\//;
const FONTS = /fonts\.(googleapis|gstatic)\.com/;

self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(VER).then(c => c.addAll(['/', '/manifest.webmanifest']).catch(() => {}))); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VER).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.pathname.startsWith('/ws') || url.pathname.startsWith('/auth') || url.pathname.startsWith('/club') || url.hostname === 'telegram.org') return;
  const same = url.origin === location.origin;
  // файлы с хэшем в имени, модели, текстуры, шрифты — навсегда из кэша
  if ((same && STATIC.test(url.pathname)) || FONTS.test(url.hostname)) {
    e.respondWith(caches.open(VER).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') c.put(req, res.clone());
      return res;
    }));
    return;
  }
  // страница: из сети, запасной вариант — кэш
  if (same && (req.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html') || url.pathname.endsWith('.webmanifest'))) {
    e.respondWith(fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VER).then(c => c.put(req.mode === 'navigate' ? '/' : req, copy)); }
      return res;
    }).catch(() => caches.match(req.mode === 'navigate' ? '/' : req).then(r => r || caches.match('/'))));
  }
});
