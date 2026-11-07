/*
 * Inteligencia artificial con Cloudflare Workers AI (binding AI). Lee el archivo de R2:
 *   POST /api/ai/transcribe { fileId, language? }  → { text }  nota de voz → texto (Whisper)
 *   POST /api/ai/ocr        { fileId }             → { text }  texto de una foto (modelo de visión)
 * La app guarda el resultado en el adjunto (attachment.text), así se puede buscar.
 */
import { tokenOk } from './api.js';

export const STT_MODEL = '@cf/openai/whisper-large-v3-turbo';
export const VISION_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';
const MAX_AUDIO = 25 * 1024 * 1024;
const MAX_IMAGE = 10 * 1024 * 1024;
const ID_RE = /^[a-z0-9]{6,40}$/i;

const OCR_PROMPT = 'Transcribe exactamente todo el texto que aparece en la imagen, respetando los saltos de línea. '
  + 'No añadas comentarios ni explicaciones. Si no hay texto, responde solo: (sin texto)';

function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function readFile(store, id, max) {
  const f = await store.get(id);
  if (!f) return null;
  if (f.size > max) throw Object.assign(new Error(`El archivo es demasiado grande para la IA (máx. ${Math.round(max / 1048576)} MB)`), { status: 413 });
  return { ...f, bytes: new Uint8Array(await new Response(f.body).arrayBuffer()) };
}

const textOf = (out) => (out?.text ?? out?.transcription_info?.text ?? out?.response ?? out?.result?.response ?? (typeof out?.result === 'string' ? out.result : '') ?? '').trim();

/** Los modelos de Meta piden aceptar su licencia una vez por cuenta. */
async function runVision(ai, input) {
  try {
    return await ai.run(VISION_MODEL, input);
  } catch (err) {
    if (!/agree|licen[cs]e|5016/i.test(err.message || '')) throw err;
    await ai.run(VISION_MODEL, { prompt: 'agree' });
    return ai.run(VISION_MODEL, input);
  }
}

export async function handleAi({ ai, store, token }, { method, path, auth, body }) {
  if (!tokenOk(token, auth)) return { status: 401, body: { error: 'unauthorized' } };
  if (!ai) return { status: 503, body: { error: 'Falta Workers AI (binding AI en wrangler.jsonc)' } };
  if (!store) return { status: 503, body: { error: 'Falta el bucket de R2' } };
  if (method !== 'POST') return { status: 405, body: { error: 'Solo POST' } };
  const id = body?.fileId;
  if (!ID_RE.test(id || '')) return { status: 400, body: { error: 'fileId no válido' } };

  try {
    if (path === '/transcribe') {
      const f = await readFile(store, id, MAX_AUDIO);
      if (!f) return { status: 404, body: { error: 'No existe el archivo (¿aún no se subió?)' } };
      const language = /^[a-z]{2}$/.test(body.language || '') ? body.language : 'es';
      const out = await ai.run(STT_MODEL, { audio: toBase64(f.bytes), language, vad_filter: true });
      return { status: 200, body: { text: textOf(out) } };
    }
    if (path === '/ocr') {
      const f = await readFile(store, id, MAX_IMAGE);
      if (!f) return { status: 404, body: { error: 'No existe el archivo (¿aún no se subió?)' } };
      if (!/^image\//.test(f.type)) return { status: 400, body: { error: 'No es una imagen' } };
      const out = await runVision(ai, {
        messages: [{ role: 'user', content: OCR_PROMPT }],
        image: `data:${f.type};base64,${toBase64(f.bytes)}`,
        max_tokens: 1024,
      });
      const text = textOf(out);
      return { status: 200, body: { text: /^\(sin texto\)$/i.test(text) ? '' : text } };
    }
  } catch (err) {
    console.error('IA', err);
    return { status: err.status || 502, body: { error: err.status ? err.message : `La IA no respondió: ${err.message}` } };
  }
  return { status: 404, body: { error: 'not found' } };
}
