/* Service worker: la app abre sin conexión (la API /api nunca se guarda en caché) y muestra las notificaciones push. */
const CACHE = 'retrodark-v10';
const ASSETS = [
  './', './index.html', './manifest.webmanifest',
  './css/base.css', './css/layout.css', './css/pane.css', './css/chat.css', './css/sheets.css', './css/responsive.css', './css/theme.css',
  './js/main.js', './js/utils.js', './js/icons.js', './js/constants.js', './js/state.js', './js/text.js',
  './js/render.js', './js/actions.js', './js/events.js', './js/backnav.js', './js/push.js', './js/files.js', './js/player.js',
  './js/data/idb.js', './js/data/store.js', './js/data/sync.js',
  './js/ui/dom.js', './js/ui/parts.js',
  './js/views/nav.js', './js/views/pane.js', './js/views/chatList.js', './js/views/tasks.js',
  './js/views/organize.js', './js/views/settings.js', './js/views/chat.js',
  './js/sheets/message.js', './js/sheets/chat.js', './js/sheets/group.js', './js/sheets/category.js', './js/sheets/triage.js',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Primero la red (siempre la última versión) y, si no hay conexión, la copia guardada. */
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/')) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(async () => (await caches.match(req, { ignoreSearch: true }))
        || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error()))
  );
});

/* ---------- Notificaciones push ---------- */
self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { data = { body: e.data?.text() }; }
  e.waitUntil(self.registration.showNotification(data.title || 'RetroDark', {
    body: data.body || '',
    tag: data.tag || data.msgId || 'retrodark',
    renotify: true,
    icon: 'icons/icon-192.png',
    data: { msgId: data.msgId || null },
  }));
});

/* Tocar la notificación: abre la app (o la trae al frente) en ese mensaje. */
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const id = e.notification.data?.msgId;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find((w) => new URL(w.url).origin === location.origin);
    if (win) {
      await win.focus();
      if (id) win.postMessage({ type: 'open-msg', id });
    } else {
      await self.clients.openWindow(id ? `./?msg=${encodeURIComponent(id)}` : './');
    }
  })());
});
