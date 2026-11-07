/*
 * IA de Cloudflare (Workers AI): transcribir notas de voz y sacar el texto de las fotos.
 * El resultado se guarda en el adjunto (attachment.text) y así también se puede buscar.
 */
import { S } from './state.js';
import { msgById, put } from './data/store.js';
import { api, syncNow } from './data/sync.js';
import { idb } from './data/idb.js';
import { toast } from './ui/dom.js';
import { refreshAll } from './render.js';

export const aiAvailable = () => !!S.server?.features?.ai;
const busy = new Set();

/** kind: 'transcribe' (audio) u 'ocr' (imagen). */
export async function runAi(kind, msgId, attId) {
  const m = msgById(msgId);
  const att = m?.attachments?.find((a) => a.id === attId);
  if (!att || busy.has(attId)) return;
  if (!aiAvailable()) { toast('La IA solo está disponible con el servidor de Cloudflare'); return; }
  // El archivo tiene que estar ya en la nube.
  if (await idb.get('uploads', attId)) {
    await syncNow();
    if (await idb.get('uploads', attId)) { toast('El archivo aún se está subiendo. Inténtalo en un momento.'); return; }
  }
  busy.add(attId);
  refreshAll();
  toast(kind === 'ocr' ? 'Leyendo el texto de la foto…' : 'Transcribiendo…');
  try {
    const r = await api(`ai/${kind}`, { method: 'POST', body: { fileId: attId, language: (navigator.language || 'es').slice(0, 2) } });
    const cur = msgById(msgId);
    if (!cur) return;
    cur.attachments = cur.attachments.map((a) => (a.id === attId ? { ...a, text: r.text || '', textKind: kind } : a));
    await put('messages', cur);
    toast(r.text ? (kind === 'ocr' ? 'Texto extraído' : 'Transcripción lista') : (kind === 'ocr' ? 'No se encontró texto en la foto' : 'No se entendió nada en el audio'));
  } catch (err) {
    toast(err.message || 'La IA no respondió');
  } finally {
    busy.delete(attId);
    refreshAll();
  }
}

export const aiBusy = (attId) => busy.has(attId);
