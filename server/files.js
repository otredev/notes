/*
 * Archivos adjuntos (fotos, audios, vídeos, documentos).
 *   PUT /api/files/<id>   cuerpo = bytes del archivo · cabeceras Content-Type y X-File-Name
 *   GET /api/files/<id>   devuelve el archivo
 *
 * Se guardan solo en Cloudflare R2 (nunca en MongoDB). El servidor local (npm start)
 * no guarda archivos: responde 503 y la app los mantiene en el dispositivo hasta que
 * pueda subirlos a Cloudflare. Requiere la misma clave que la API.
 */
import { tokenOk } from './api.js';

export const MAX_FILE_BYTES = 50 * 1024 * 1024;
const ID_RE = /^[a-z0-9]{6,40}$/i;
// Tipos que el navegador podría ejecutar: se sirven como descarga, nunca dentro de la página.
const RISKY = /^(text\/html|application\/xhtml\+xml|image\/svg\+xml|text\/xml|application\/xml|application\/javascript|text\/javascript)/i;

const safeType = (t) => (/^[\w.+-]+\/[\w.+-]+(;\s*[\w-]+=[\w.+-]+)*$/.test(t || '') ? t : 'application/octet-stream');
const safeName = (n) => {
  let name = 'archivo';
  try { name = decodeURIComponent(n || 'archivo'); } catch { /* nombre tal cual */ }
  return name.replace(/[\r\n"\\/]/g, '_').slice(0, 200) || 'archivo';
};
const err = (status, error, headers) => ({ status, json: { error }, headers });

/* ---------- Almacenes ---------- */

/** Cloudflare R2 (binding del Worker). */
export const r2Store = (bucket) => ({
  async put(id, body, meta) {
    await bucket.put(id, body, {
      httpMetadata: { contentType: meta.type },
      customMetadata: { name: encodeURIComponent(meta.name) },
    });
  },
  async get(id) {
    const o = await bucket.get(id);
    if (!o) return null;
    let name = 'archivo';
    try { name = decodeURIComponent(o.customMetadata?.name || 'archivo'); } catch { /* */ }
    return { name, type: o.httpMetadata?.contentType || 'application/octet-stream', size: o.size, body: o.body };
  },
  async list() {
    const out = [];
    let cursor;
    do {
      const r = await bucket.list({ cursor, limit: 1000 });
      for (const o of r.objects) out.push({ id: o.key, createdAt: o.uploaded.getTime() });
      cursor = r.truncated ? r.cursor : undefined;
    } while (cursor);
    return out;
  },
  delete: (id) => bucket.delete(id),
});

/* ---------- API ---------- */

/**
 * @param {{ store: object, token: string }} ctx
 * @param {{ method: string, id: string, auth?: string, body?: ReadableStream|Uint8Array, size?: number, type?: string, name?: string }} req
 *   size: Content-Length de la subida.
 * @returns {Promise<{ status: number, json?: object, body?: ReadableStream|Uint8Array, headers?: object }>}
 */
export async function handleFiles({ store, token }, { method, id, auth, body, size, type, name }) {
  if (!tokenOk(token, auth)) return err(401, 'unauthorized');
  if (!ID_RE.test(id || '')) return err(400, 'Id de archivo no válido');

  if (method === 'PUT') {
    if (!body || !size) return err(411, 'Falta el archivo o su tamaño');
    if (size > MAX_FILE_BYTES) return err(413, 'El archivo supera los 50 MB');
    await store.put(id, body, { name: safeName(name), type: safeType(type), size });
    return { status: 200, json: { ok: true, size } };
  }

  if (method === 'GET') {
    const f = await store.get(id);
    if (!f) return err(404, 'No existe el archivo');
    const risky = RISKY.test(f.type);
    return {
      status: 200,
      body: f.body,
      headers: {
        'Content-Type': risky ? 'application/octet-stream' : f.type,
        ...(f.size ? { 'Content-Length': String(f.size) } : {}),
        'Content-Disposition': `${risky ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
        'Cache-Control': 'private, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    };
  }
  return err(405, 'Método no permitido', { Allow: 'GET, PUT' });
}

/** Borra los archivos que ya no usa ningún mensaje (con más de 1 hora, por si su mensaje aún no llegó). */
export async function gcFiles(repo, store, now = Date.now()) {
  const used = await repo.usedFileIds();
  let removed = 0;
  for (const f of await store.list()) {
    if (used.has(f.id) || now - (f.createdAt || 0) < 3600e3) continue;
    await store.delete(f.id);
    removed++;
  }
  return removed;
}
