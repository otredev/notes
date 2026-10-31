/*
 * Copia local en IndexedDB. Permite abrir y usar la app sin conexión;
 * MongoDB (en el servidor) es donde se guarda todo de forma permanente.
 */
const DB_NAME = 'retrodark';
const DB_VERSION = 3;

/** Tipos de documento que se guardan y sincronizan. */
export const DATA_STORES = ['chats', 'messages', 'categories', 'groups'];

let dbPromise = null;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        for (const s of DATA_STORES) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' });
        // Cambios pendientes de subir al servidor
        if (!d.objectStoreNames.contains('outbox')) d.createObjectStore('outbox', { keyPath: 'key' });
        // Estado de la sincronización (cursor, resetAt)
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' });
        // Archivos adjuntos (copia local) y los que faltan por subir
        if (!d.objectStoreNames.contains('files')) d.createObjectStore('files', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('uploads')) d.createObjectStore('uploads', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function tx(stores, mode, fn) {
  const d = await open();
  return new Promise((resolve, reject) => {
    const t = d.transaction(stores, mode);
    const out = fn(t);
    t.oncomplete = () => resolve(out instanceof IDBRequest ? out.result : out);
    t.onerror = t.onabort = () => reject(t.error);
  });
}

export const idb = {
  all: (store) => tx(store, 'readonly', (t) => t.objectStore(store).getAll()),
  keys: (store) => tx(store, 'readonly', (t) => t.objectStore(store).getAllKeys()),
  get: (store, key) => tx(store, 'readonly', (t) => t.objectStore(store).get(key)),
  count: (store) => tx(store, 'readonly', (t) => t.objectStore(store).count()),
  put: (store, value) => tx(store, 'readwrite', (t) => t.objectStore(store).put(value)),
  putMany: (store, values) => tx(store, 'readwrite', (t) => { values.forEach((v) => t.objectStore(store).put(v)); }),
  del: (store, key) => tx(store, 'readwrite', (t) => t.objectStore(store).delete(key)),
  clear: (stores) => tx(stores, 'readwrite', (t) => { stores.forEach((s) => t.objectStore(s).clear()); }),
};
