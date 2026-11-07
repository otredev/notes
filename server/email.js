/*
 * Correo a nota: lo que envíes a la dirección que configures en Cloudflare Email Routing
 * llega como mensaje (✉️) a ChatNote. Solo se aceptan los remitentes permitidos (Ajustes → Correo).
 *
 *   Asunto       → primera línea en negrita (#etiquetas del asunto mandan el mensaje a su chat vinculado)
 *   "[] …" o "tarea: …" en el asunto → tarea · "nota: …" → nota
 *   Cuerpo       → texto del mensaje · Adjuntos → a R2 (máx. 10, 50 MB cada uno)
 */
import { withDefaults } from './settings.js';

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const MAX_TEXT = 20000;
export const MAX_EMAIL_ATTACHMENTS = 10;

export const senderAllowed = (settings, from) => withDefaults(settings).email.allowed.includes(String(from || '').trim().toLowerCase());

/** Texto plano de un correo HTML (si no trae versión de texto). */
export function htmlToText(html = '') {
  return String(html)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n').trim();
}

/** Quita la cita del correo anterior ("El … escribió:", "> …") y la firma "-- ". */
function cleanBody(text = '') {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  for (const l of lines) {
    if (/^-- ?$/.test(l) || /^(El|On) .{5,200}(escribió|wrote):\s*$/.test(l)) break;
    if (/^>/.test(l)) continue;
    out.push(l);
  }
  return out.join('\n').trim();
}

const tagsOf = (t) => [...new Set([...String(t).matchAll(/(?:^|\s)#([\p{L}\p{N}_-]+)/gu)].map((x) => x[1].toLowerCase()))];

/** Crea el mensaje. Devuelve { id, chatId }. */
export async function emailToMessage(repo, { from, subject = '', text = '', attachments = [] }, { tz } = {}) {
  const settings = withDefaults(await repo.getServerSettings(), tz);
  const { chats } = await repo.liveData();
  let subj = String(subject).replace(/^\s*((re|fw|fwd|rv)\s*:\s*)+/i, '').trim();
  let kind = 'message';
  const k = subj.match(/^(\[\s?\]|tarea:|\/t\b)\s*/i) || subj.match(/^(nota:|\/n\b)\s*/i);
  if (k) { kind = /nota|\/n/i.test(k[1]) ? 'note' : 'task'; subj = subj.slice(k[0].length); }
  const body = cleanBody(text).slice(0, MAX_TEXT);
  const full = [subj ? `*${subj.replace(/\*/g, '')}*` : '', body].filter(Boolean).join('\n') || '(correo sin texto)';
  const tags = tagsOf(full);

  // Igual que en General: una #etiqueta vinculada a un chat lo manda allí.
  // Solo chats donde el propietario puede escribir.
  const writable = chats.filter((c) => !c.onlyAdmins || c.myRole === 'admin');
  let chat = writable.find((c) => c.id !== 'general' && (c.tags || []).some((t) => tags.includes(t)))
    || writable.find((c) => c.id === settings.email.chat) || { id: 'general', type: 'chat' };
  if (kind === 'message' && chat.type === 'list') kind = 'task';
  if (kind === 'message' && chat.type === 'notes') kind = 'note';

  const now = Date.now();
  const id = uid();
  const doc = {
    chatId: chat.id, text: full, kind, done: false, doneAt: null, tags, categoryId: null, due: null,
    starred: false, pinned: false, from: 'email', fromAddress: String(from || '').slice(0, 200),
    triaged: chat.id !== 'general' || kind !== 'message', createdAt: now, remindAt: null,
    ...(attachments.length ? { attachments } : {}),
  };
  await repo.applyChanges([{ store: 'messages', id, updatedAt: now, doc }], 'owner');
  return { id, chatId: chat.id };
}
