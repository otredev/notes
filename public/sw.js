/* Service worker: la app abre sin conexión (la API /api nunca se guarda en caché) y muestra las notificaciones push. */
const CACHE = 'retrodark-v13';
const ASSETS = [
  './', './index.html', './manifest.webmanifest',
  './css/base.css', './css/layout.css', './css/pane.css', './css/chat.css', './css/sheets.css', './css/responsive.css', './css/features.css', './css/theme.css',
  './js/main.js', './js/utils.js', './js/icons.js', './js/constants.js', './js/state.js', './js/text.js',
  './js/render.js', './js/actions.js', './js/events.js', './js/backnav.js', './js/push.js', './js/files.js', './js/player.js',
  './js/editor.js', './js/recurrence.js', './js/calendar.js', './js/poll.js', './js/ai.js', './js/lock.js', './js/people.js', './js/live.js', './js/storage.js',
  './js/data/idb.js', './js/data/store.js', './js/data/sync.js',
  './js/ui/dom.js', './js/ui/parts.js',
  './js/views/nav.js', './js/views/pane.js', './js/views/chatList.js', './js/views/tasks.js',
  './js/views/organize.js', './js/views/settings.js', './js/views/chat.js', './js/views/docs.js', './js/views/trash.js', './js/views/server.js', './js/views/account.js',
  './js/sheets/message.js', './js/sheets/chat.js', './js/sheets/group.js', './js/sheets/category.js', './js/sheets/triage.js', './js/sheets/template.js',
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

/* ---------- "Compartir con RetroDark" (share_target) ---------- */
/** Guarda lo compartido en IndexedDB (meta → share) para que la app lo ponga en el cuadro de texto. */
function saveShare(data) {
  return new Promise((resolve) => {
    const req = indexedDB.open('retrodark');
    req.onerror = () => resolve(false);
    req.onsuccess = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('meta')) { d.close(); resolve(false); return; }
      const t = d.transaction('meta', 'readwrite');
      t.objectStore('meta').put({ key: 'share', ...data, at: Date.now() });
      t.oncomplete = () => { d.close(); resolve(true); };
      t.onerror = () => { d.close(); resolve(false); };
    };
  });
}

async function handleShare(req) {
  try {
    const form = await req.formData();
    const files = form.getAll('files').filter((f) => f && typeof f === 'object' && f.size);
    const ok = await saveShare({ title: form.get('title') || '', text: form.get('text') || '', url: form.get('url') || '', files });
    return Response.redirect(ok ? './?share=1' : './?share=0', 303);
  } catch {
    return Response.redirect('./?share=0', 303);
  }
}

/* Primero la red (siempre la última versión) y, si no hay conexión, la copia guardada. */
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method === 'POST' && url.origin === location.origin && url.pathname.endsWith('/share')) { e.respondWith(handleShare(req)); return; }
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/') || url.pathname.includes('/cal/')) return;
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
    actions: Array.isArray(data.actions) ? data.actions.slice(0, 2) : [],
    data: { msgId: data.msgId || null, url: typeof data.url === 'string' && data.url.startsWith('./') ? data.url : null },
  }));
});

/* ---------- Botones de la notificación: ✅ Hecho / ⏰ Posponer ---------- */

/** La app guarda la clave de acceso en IndexedDB (meta → token) para poder usarla aquí. */
function readToken() {
  return new Promise((resolve) => {
    const req = indexedDB.open('retrodark');
    req.onerror = () => resolve('');
    req.onsuccess = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('meta')) { d.close(); resolve(''); return; }
      const get = d.transaction('meta', 'readonly').objectStore('meta').get('token');
      get.onsuccess = () => { resolve(get.result?.value || ''); d.close(); };
      get.onerror = () => { resolve(''); d.close(); };
    };
  });
}

async function notificationAction(id, action) {
  const token = await readToken();
  const res = await fetch(new URL('api/push/action', self.registration.scope), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ id, action, tz: Intl.DateTimeFormat().resolvedOptions().timeZone }),
  });
  if (!res.ok) throw new Error(`Error ${res.status}`);
  // Si la app está abierta, que traiga el cambio.
  for (const w of await self.clients.matchAll({ type: 'window' })) w.postMessage({ type: 'sync' });
}

/* Tocar la notificación: abre la app (o la trae al frente) en ese mensaje. */
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const id = e.notification.data?.msgId;
  if (id && (e.action === 'done' || e.action === 'snooze')) {
    e.waitUntil(notificationAction(id, e.action).catch(() => self.registration.showNotification('RetroDark', {
      body: 'No se pudo guardar desde la notificación. Ábrela para hacerlo en la app.', tag: `fail-${id}`, icon: 'icons/icon-192.png', data: { msgId: id },
    })));
    return;
  }
  const url = e.notification.data?.url;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const win = wins.find((w) => new URL(w.url).origin === location.origin);
    if (win) {
      await win.focus();
      if (id) win.postMessage({ type: 'open-msg', id });
      else if (url) win.postMessage({ type: 'open-url', url });
    } else {
      await self.clients.openWindow(id ? `./?msg=${encodeURIComponent(id)}` : url || './');
    }
  })());
});
