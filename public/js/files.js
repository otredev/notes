/*
 * Archivos adjuntos y notas de voz.
 *  - Al adjuntar, el archivo se guarda en este dispositivo (IndexedDB) y se pone en la cola de subida.
 *  - La sincronización lo sube a /api/files/<id> antes que los mensajes.
 *  - Para mostrarlo se usa la copia local o se descarga (y se guarda) la primera vez.
 */
import { idb } from './data/idb.js';
import { settings } from './state.js';
import { uid } from './utils.js';

export const MAX_FILE_BYTES = 50 * 1024 * 1024;

const authHeaders = () => (settings.token ? { Authorization: `Bearer ${settings.token}` } : {});

/* ---------- Tipos y etiquetas ---------- */
export const isImage = (a) => /^image\//.test(a.type || '');
export const isAudio = (a) => /^audio\//.test(a.type || '');
export const isVideo = (a) => /^video\//.test(a.type || '');

export function fmtSize(n = 0) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1).replace('.0', '')} MB`;
}
export function fmtDur(s = 0) {
  s = Math.max(0, Math.round(s || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** "🎤 Audio 0:12", "📷 Foto", "📷 3 fotos", "🎬 Vídeo", "📎 factura.pdf". */
export function attachmentsLabel(list = []) {
  if (!list.length) return '';
  const a = list[0];
  if (isAudio(a)) return `🎤 Audio ${fmtDur(a.duration)}`;
  if (isImage(a)) return list.length > 1 ? `📷 ${list.length} fotos` : '📷 Foto';
  if (isVideo(a)) return '🎬 Vídeo';
  return list.length > 1 ? `📎 ${list.length} archivos` : `📎 ${a.name}`;
}

/* ---------- Preparar un archivo para adjuntar ---------- */

/**
 * Devuelve { att, blob }. Las fotos grandes se reducen (máx. 2048 px, JPEG) para ahorrar espacio.
 * Lanza un error si el archivo supera el límite.
 */
export async function prepareFile(file) {
  let blob = file, name = file.name || 'archivo', type = file.type || 'application/octet-stream';
  let w, h;
  if (/^image\/(jpeg|png|webp|heic|heif)$/.test(type) && 'createImageBitmap' in window) {
    try {
      const bmp = await createImageBitmap(file);
      w = bmp.width; h = bmp.height;
      const scale = Math.min(1, 2048 / Math.max(w, h));
      if (file.size > 1.5 * 1024 * 1024 || scale < 1) {
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(w * scale);
        canvas.height = Math.round(h * scale);
        canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
        const out = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
        if (out && out.size < file.size) {
          blob = out; type = 'image/jpeg'; name = name.replace(/\.\w+$/, '') + '.jpg';
          w = canvas.width; h = canvas.height;
        }
      }
      bmp.close?.();
    } catch { /* se adjunta tal cual */ }
  }
  if (blob.size > MAX_FILE_BYTES) throw new Error(`"${name}" pesa ${fmtSize(blob.size)}; el máximo es 50 MB`);
  const att = { id: uid(), name, type, size: blob.size, ...(w ? { w, h } : {}) };
  return { att, blob };
}

/** Guarda el archivo en el dispositivo y lo pone en la cola de subida. */
export async function storeForUpload(att, blob) {
  await idb.put('files', { id: att.id, blob, name: att.name, type: att.type, size: att.size });
  await idb.put('uploads', { id: att.id });
}

/* ---------- Subida (la llama la sincronización) ---------- */
let onFull = () => {};
/** storage.js se registra aquí para mostrar el aviso de espacio lleno. */
export const setStorageFullHandler = (fn) => { onFull = fn; };
const storageFull = (st) => onFull(st);
export async function uploadPending() {
  const ids = await idb.keys('uploads');
  for (const id of ids) {
    const rec = await idb.get('files', id);
    if (!rec) { await idb.del('uploads', id); continue; }
    const res = await fetch(`api/files/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { ...authHeaders(), 'Content-Type': rec.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(rec.name || 'archivo') },
      body: rec.blob,
    });
    if (res.status === 401) throw Object.assign(new Error('Clave de acceso incorrecta'), { auth: true });
    if (res.status === 413) { await idb.del('uploads', id); continue; } // demasiado grande: no se reintenta
    if (res.status === 503) return; // servidor sin almacenamiento de archivos (local): se quedan aquí y se reintenta luego
    if (res.status === 507) {
      // Espacio en la nube casi lleno: el archivo se queda en este dispositivo y se avisa.
      const data = await res.json().catch(() => ({}));
      storageFull(data.storage);
      return;
    }
    if (!res.ok) throw new Error(`No se pudo subir un archivo (${res.status})`);
    await idb.del('uploads', id);
  }
}

/* ---------- Descarga y caché ---------- */
const urls = new Map();
const loading = new Map();

/** URL local (blob:) de un adjunto: copia del dispositivo o descarga del servidor. */
export function fileUrl(att) {
  if (urls.has(att.id)) return Promise.resolve(urls.get(att.id));
  if (!loading.has(att.id)) {
    loading.set(att.id, (async () => {
      let rec = await idb.get('files', att.id);
      if (!rec) {
        const res = await fetch(`api/files/${encodeURIComponent(att.id)}`, { headers: authHeaders() });
        if (!res.ok) throw new Error(res.status === 404 ? 'El archivo aún no está en el servidor' : `Error ${res.status}`);
        rec = { id: att.id, blob: await res.blob(), name: att.name, type: att.type, size: att.size };
        await idb.put('files', rec).catch(() => {});
      }
      const url = URL.createObjectURL(rec.blob);
      urls.set(att.id, url);
      return url;
    })().finally(() => loading.delete(att.id)));
  }
  return loading.get(att.id);
}

/** Rellena las imágenes y vídeos de un trozo de la página (elementos con data-file). */
export function hydrateMedia(root, findAtt) {
  if (!root) return;
  root.querySelectorAll('[data-file]:not([data-ready])').forEach((el) => {
    el.dataset.ready = '1';
    const att = findAtt(el.dataset.file);
    if (!att) return;
    fileUrl(att)
      .then((url) => { el.src = url; el.closest('.att')?.classList.remove('loading'); })
      .catch(() => { el.closest('.att')?.classList.add('missing'); delete el.dataset.ready; });
  });
}

/** Descarga un adjunto con su nombre. */
export async function downloadAttachment(att) {
  const a = document.createElement('a');
  a.href = await fileUrl(att);
  a.download = att.name || 'archivo';
  a.click();
}

/** Quita del dispositivo las copias de archivos que ya no usa ningún mensaje. */
export async function pruneLocalFiles(messages) {
  const used = new Set(messages.flatMap((m) => (m.attachments || []).map((a) => a.id)));
  const pending = new Set(await idb.keys('uploads'));
  for (const id of await idb.keys('files')) {
    if (!used.has(id) && !pending.has(id)) await idb.del('files', id);
  }
}

/* ---------- Notas de voz ---------- */
let rec = null;

export const canRecord = () => !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);

/** Empieza a grabar. `onTick(segundos)` se llama cada medio segundo. */
export async function startRecording(onTick) {
  if (rec) return;
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm']
    .find((t) => MediaRecorder.isTypeSupported(t)) || '';
  const recorder = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : undefined);
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  recorder.start(250);
  const started = Date.now();
  const timer = setInterval(() => onTick?.((Date.now() - started) / 1000), 500);
  rec = { stream, recorder, chunks, started, timer };
}

export const isRecording = () => !!rec;

/** Termina la grabación. Con `keep` devuelve { att, blob }; si no, la descarta. */
export function stopRecording(keep = true) {
  if (!rec) return Promise.resolve(null);
  const { stream, recorder, chunks, started, timer } = rec;
  rec = null;
  clearInterval(timer);
  return new Promise((resolve) => {
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      if (!keep || !chunks.length) return resolve(null);
      const type = (recorder.mimeType || 'audio/webm').split(';')[0];
      const blob = new Blob(chunks, { type });
      const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
      const d = new Date();
      const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
      resolve({ att: { id: uid(), name: `audio-${stamp}.${ext}`, type, size: blob.size, duration: (Date.now() - started) / 1000 }, blob });
    };
    recorder.stop();
  });
}
