/*
 * Copias de seguridad en Cloudflare R2 (carpeta "backups/" del bucket de adjuntos).
 * Una al día automática (si está activada) + las que hagas a mano. Se guardan las 30 más recientes.
 *   GET  /api/backups          → lista
 *   POST /api/backups          → crear una ahora
 *   GET  /api/backups/<nombre> → descargar (JSON igual que "Exportar")
 * Restaurar = importar ese JSON (la app lo hace con la confirmación de siempre).
 */
const PREFIX = 'backups/';
const KEEP = 30;
const NAME_RE = /^\d{4}-\d{2}-\d{2}(-\d{6})?\.json$/;

/** Almacén de copias sobre un bucket de R2. */
export const r2Backups = (bucket) => ({
  put: (name, text) => bucket.put(PREFIX + name, text, { httpMetadata: { contentType: 'application/json' } }),
  async get(name) { const o = await bucket.get(PREFIX + name); return o ? o.text() : null; },
  async list() {
    const out = [];
    let cursor;
    do {
      const r = await bucket.list({ prefix: PREFIX, cursor, limit: 1000 });
      for (const o of r.objects) out.push({ name: o.key.slice(PREFIX.length), size: o.size, createdAt: o.uploaded.getTime() });
      cursor = r.truncated ? r.cursor : undefined;
    } while (cursor);
    return out.sort((a, b) => b.name.localeCompare(a.name));
  },
  delete: (name) => bucket.delete(PREFIX + name),
});

export async function createBackup(repo, store, name) {
  const data = { app: 'retrodark', version: 1, exportedAt: new Date().toISOString(), ...(await repo.exportAll()) };
  const text = JSON.stringify(data);
  await store.put(name, text);
  // Solo se guardan las más recientes.
  const list = await store.list();
  for (const old of list.slice(KEEP)) await store.delete(old.name);
  return { name, size: text.length, messages: data.messages?.length || 0 };
}

const stamp = (d = new Date()) => d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15).replace(/^(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');

/** Rutas /backups (dentro de handleApi). `store` null → 503 (servidor local sin R2). */
export async function handleBackups({ getRepo, store, storage }, { method, path }) {
  if (!store) return { status: 503, body: { error: 'Las copias en la nube solo funcionan en Cloudflare (R2)' } };
  if (path === '/backups' && method === 'GET') return { status: 200, body: { backups: await store.list() } };
  if (path === '/backups' && method === 'POST') {
    const repo = await getRepo();
    if (storage) {
      const { storageState } = await import('./storage.js');
      if (storageState(await repo.getStorage(), storage).state === 'full') return { status: 507, body: { error: 'El espacio en la nube está casi lleno: no se crean más copias' } };
    }
    return { status: 200, body: await createBackup(repo, store, `${stamp()}.json`) };
  }
  const name = decodeURIComponent(path.slice('/backups/'.length));
  if (method === 'GET' && NAME_RE.test(name)) {
    const text = await store.get(name);
    return text ? { status: 200, raw: text, type: 'application/json' } : { status: 404, body: { error: 'No existe esa copia' } };
  }
  return { status: 404, body: { error: 'not found' } };
}
