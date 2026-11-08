/*
 * Sincronización con el servidor (MongoDB).
 *
 * - Cada cambio local se guarda en IndexedDB y en una cola ("outbox").
 * - syncNow() sube la cola y baja lo que cambió en el servidor desde la última vez.
 * - Si dos dispositivos editan lo mismo, gana la edición más reciente (updatedAt).
 */
import { S, settings } from '../state.js';
import { mergeShop, sameShop } from '../shopcore.js';
import { idb, DATA_STORES } from './idb.js';
import { uploadPending } from '../files.js';

const BATCH = 400;
const status = { state: 'idle', pending: 0, lastSync: null };
const listeners = { status: new Set(), remote: new Set(), rejected: new Set() };

export const getStatus = () => status;
export const onStatus = (fn) => listeners.status.add(fn);
/** Cambios que el servidor no aceptó (permisos de un chat compartido). */
export const onRejected = (fn) => listeners.rejected.add(fn);
/** Se llama cuando llegan cambios de otro dispositivo. */
export const onRemote = (fn) => listeners.remote.add(fn);

function setStatus(patch) {
  Object.assign(status, patch);
  listeners.status.forEach((fn) => fn(status));
}

/* ---------- API ---------- */
const authListeners = new Set();
/** El servidor pidió iniciar sesión (401). */
export const onAuthRequired = (fn) => authListeners.add(fn);
export async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (settings.token) headers.Authorization = `Bearer ${settings.token}`;
  const res = await fetch(`api/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (res.status === 401) {
    authListeners.forEach((fn) => fn());
    throw Object.assign(new Error(settings.token ? 'Tu sesión ya no es válida: vuelve a entrar' : 'Inicia sesión para sincronizar'), { auth: true });
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Error ${res.status}`);
  }
  return res.json();
}

/* ---------- Estado guardado ---------- */
const getMeta = async () => (await idb.get('meta', 'sync')) || { key: 'sync', cursor: null, resetAt: null };
const saveMeta = (m) => idb.put('meta', m);

/* ---------- Cola de cambios ---------- */
const entry = (store, doc, deleted) => ({
  key: `${store}:${doc.id}`, store, id: doc.id, updatedAt: doc.updatedAt || Date.now(), deleted, doc: deleted ? null : doc,
});

async function refreshPending() { setStatus({ pending: await pendingCount() }); }
const pendingCount = async () => (await idb.count('outbox')) + (await idb.count('uploads'));
/** Para avisar de que hay archivos nuevos por subir. */
export const notifyUploads = () => { refreshPending(); schedule(); };

export async function enqueue(store, doc, deleted = false) {
  await idb.put('outbox', entry(store, doc, deleted));
  await refreshPending();
  schedule();
}

export async function enqueueMany(store, docs) {
  await idb.putMany('outbox', docs.map((d) => entry(store, d, false)));
  await refreshPending();
  schedule();
}

let timer = null;
export function schedule(ms = 700) {
  clearTimeout(timer);
  timer = setTimeout(() => syncNow(), ms);
}

/* ---------- Listas en memoria ---------- */
/** Los mensajes de la papelera viven en S.trash; el resto, en su lista. */
export const listFor = (store, doc) => (store === 'messages' && doc?.trashedAt ? S.trash : S[store]);
const listsOf = (store) => (store === 'messages' ? [S.messages, S.trash] : [S[store]]);
export const findLocal = (store, id) => { for (const l of listsOf(store)) { const x = l.find((d) => d.id === id); if (x) return x; } return null; };
export function dropLocal(store, id) {
  for (const l of listsOf(store)) { const i = l.findIndex((d) => d.id === id); if (i >= 0) l.splice(i, 1); }
}

/* ---------- Aplicar cambios que vienen del servidor ---------- */
async function applyRemote(store, doc) {
  // Lista de compras: lo de los demás se fusiona producto a producto, aunque lo local sea más nuevo.
  const mine = store === 'messages' && !doc.deleted && doc.shop ? findLocal(store, doc.id) : null;
  if (mine?.shop) {
    const merged = mergeShop(mine.shop, doc.shop);
    doc = { ...doc, shop: merged };
    const pend = await idb.get('outbox', `${store}:${doc.id}`);
    if ((pend && pend.updatedAt > doc.updatedAt) || (mine.updatedAt || 0) >= doc.updatedAt) {
      if (sameShop(merged, mine.shop)) return false;
      mine.shop = merged;
      await idb.put(store, mine);
      return true;
    }
  }
  const pending = await idb.get('outbox', `${store}:${doc.id}`);
  if (pending && pending.updatedAt > doc.updatedAt) return false; // lo local es más nuevo
  const local = findLocal(store, doc.id);
  if (local && (local.updatedAt || 0) >= doc.updatedAt) return false; // ya lo tenemos (o es más nuevo)
  dropLocal(store, doc.id);
  if (doc.deleted) {
    // Un chat que desaparece (lo borraron o me sacaron) se lleva sus mensajes de este dispositivo.
    if (store === 'chats') await dropChatMessages(doc.id);
    if (!local) return false;
    await idb.del(store, doc.id);
    return true;
  }
  const { deleted, ...clean } = doc;
  listFor(store, clean).push(clean);
  await idb.put(store, clean);
  return true;
}

async function dropChatMessages(chatId) {
  const gone = [...S.messages, ...S.trash].filter((m) => m.chatId === chatId);
  for (const m of gone) { dropLocal('messages', m.id); await idb.del('messages', m.id); await idb.del('outbox', `messages:${m.id}`); }
}

/* ---------- Quién soy ---------- */
const meListeners = new Set();
export const onMe = (fn) => meListeners.add(fn);
export async function setMe(me, people) {
  if (!me) return;
  const changed = JSON.stringify([S.me, S.people]) !== JSON.stringify([me, people]);
  S.me = me;
  if (people) S.people = people;
  if (changed) { await idb.put('meta', { key: 'me', me, people: S.people }); meListeners.forEach((fn) => fn()); }
}
export async function loadMe() {
  const m = await idb.get('meta', 'me');
  if (m) { S.me = m.me; S.people = m.people || []; }
}
/** Al cambiar de clave/cuenta se empieza de cero en este dispositivo. */
export async function forgetAccount() {
  await idb.del('meta', 'me');
  S.me = null; S.people = [];
}

/** Borra todo lo local (cuando los datos del servidor se reiniciaron o se importaron). */
export async function resetLocal(resetAt) {
  await idb.clear([...DATA_STORES, 'outbox', 'uploads', 'files']);
  DATA_STORES.forEach((s) => { S[s] = []; });
  S.trash = [];
  await saveMeta({ key: 'sync', cursor: 0, resetAt });
  await refreshPending();
}

/* ---------- Sincronizar ---------- */
let running = null;
export function syncNow() {
  if (!running) running = doSync().finally(() => { running = null; });
  return running;
}

async function doSync() {
  clearTimeout(timer);
  if (!navigator.onLine) { setStatus({ state: 'offline' }); return false; }
  setStatus({ state: 'syncing' });
  try {
    // Primero los archivos adjuntos, para que estén en el servidor cuando lleguen sus mensajes.
    await uploadPending();

    let meta = await getMeta();

    // Primera sincronización de este dispositivo: sube lo que ya hubiera guardado en local.
    if (meta.cursor === null) {
      for (const s of DATA_STORES) {
        const docs = s === 'messages' ? [...S.messages, ...S.trash] : S[s];
        if (docs.length) await idb.putMany('outbox', docs.map((d) => entry(s, d, false)));
      }
    }

    let changed = false;
    let queue = await idb.all('outbox');
    do {
      const batch = queue.slice(0, BATCH);
      queue = queue.slice(BATCH);
      const res = await api('sync', {
        method: 'POST',
        body: {
          since: meta.cursor || 0,
          resetAt: meta.resetAt,
          changes: batch.map(({ store, id, updatedAt, deleted, doc }) => ({ store, id, updatedAt, deleted, doc })),
        },
      });

      if (res.reset) {
        // Otro dispositivo borró todo o importó una copia: empezamos de cero con lo del servidor.
        await resetLocal(res.resetAt);
        meta = await getMeta();
        queue = [];
        changed = true;
        const full = await api('sync', { method: 'POST', body: { since: 0, resetAt: res.resetAt, changes: [] } });
        for (const s of DATA_STORES) for (const d of full.changes[s] || []) await applyRemote(s, d);
        meta.cursor = full.cursor;
        await saveMeta(meta);
        break;
      }

      // Quita de la cola lo que se subió y no ha vuelto a cambiar mientras tanto.
      for (const e of batch) {
        const cur = await idb.get('outbox', e.key);
        if (cur && cur.updatedAt === e.updatedAt && cur.deleted === e.deleted) await idb.del('outbox', e.key);
      }
      for (const s of DATA_STORES) {
        for (const d of res.changes[s] || []) if (await applyRemote(s, d)) changed = true;
      }
      if (res.me) await setMe(res.me, res.people);
      if (res.rejected?.length) listeners.rejected.forEach((fn) => fn(res.rejected));
      meta = { ...meta, cursor: res.cursor, resetAt: res.resetAt };
      await saveMeta(meta);
    } while (queue.length);

    setStatus({ state: 'ok', lastSync: Date.now(), pending: await pendingCount() });
    if (changed) listeners.remote.forEach((fn) => fn());
    return true;
  } catch (err) {
    console.warn('Sincronización:', err.message);
    setStatus({ state: err.auth ? 'auth' : navigator.onLine ? 'error' : 'offline', error: err.message });
    return false;
  }
}

/** El service worker necesita la clave para los botones de las notificaciones (Hecho / Posponer). */
export const storeToken = () => idb.put('meta', { key: 'token', value: settings.token || '' }).catch(() => {});

/** Sincroniza al volver la conexión, al volver a la app y cada 30 s. */
export function startAutoSync() {
  refreshPending();
  addEventListener('online', () => syncNow());
  addEventListener('offline', () => setStatus({ state: 'offline' }));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
  setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 30000);
}
