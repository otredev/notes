/* Lectura y escritura de datos. Toda escritura se guarda en local y se encola para MongoDB. */
import { S } from '../state.js';
import { uid, todayKey, plain } from '../utils.js';
import { extractTags, checklistOf, ITEM_RE } from '../text.js';
import { attachmentsLabel } from '../files.js';
import { idb, DATA_STORES } from './idb.js';
import { enqueue, enqueueMany, listFor, dropLocal } from './sync.js';

/* ---------- Consultas ---------- */
export const chatById = (id) => S.chats.find((c) => c.id === id);
export const catById = (id) => S.categories.find((c) => c.id === id);
export const msgById = (id) => S.messages.find((m) => m.id === id);
export const msgsOf = (chatId) => S.messages.filter((m) => m.chatId === chatId).sort((a, b) => a.createdAt - b.createdAt);

export function lastOf(chatId) {
  let last = null;
  for (const m of S.messages) if (m.chatId === chatId && (!last || m.createdAt > last.createdAt)) last = m;
  return last;
}

export const pendingOf = (chatId) => S.messages.filter((m) => m.chatId === chatId && m.kind === 'task' && !m.done).length;
/** Mensajes de General que aún no se han clasificado. */
export const inboxList = () => S.messages
  .filter((m) => m.chatId === 'general' && m.from === 'me' && m.kind === 'message' && !m.triaged)
  .sort((a, b) => a.createdAt - b.createdAt);
export const dueNowCount = () => S.messages.filter((m) => m.kind === 'task' && !m.done && m.due && m.due <= todayKey()).length;
export function kindPrefix(m) {
  if (m.poll) return '📊 ';
  if (m.shop) return '🛒 ';
  if (m.kind === 'task') return m.done ? '☑ ' : '☐ ';
  const cl = checklistOf(m.text);
  if (cl) return `☑ ${cl.done}/${cl.total} `;
  return m.kind === 'note' ? '📝 ' : '';
}

/** Texto corto de un mensaje para listas, citas y búsquedas. */
export function summary(m) {
  const text = checklistOf(m.text)
    ? m.text.split('\n').map((l) => l.match(ITEM_RE)?.[3] ?? l).filter((l) => l.trim()).join(' · ')
    : m.text;
  const att = attachmentsLabel(m.attachments);
  const body = plain(text).trim();
  return kindPrefix(m) + (att ? (body ? `${att} · ${body}` : att) : body);
}

export function allTags() {
  const map = new Map();
  for (const m of S.messages) for (const t of m.tags || []) map.set(t, (map.get(t) || 0) + 1);
  for (const c of S.chats) for (const t of c.tags || []) if (!map.has(t)) map.set(t, 0);
  return [...map].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/* ---------- Escritura ---------- */
export async function put(store, obj) {
  obj.updatedAt = Math.max(Date.now(), (obj.updatedAt || 0) + 1);
  dropLocal(store, obj.id);
  listFor(store, obj).push(obj);
  await idb.put(store, obj);
  await enqueue(store, obj);
}

export async function remove(store, id) {
  const obj = S[store].find((x) => x.id === id) || (store === 'messages' ? S.trash.find((x) => x.id === id) : null);
  dropLocal(store, id);
  await idb.del(store, id);
  await enqueue(store, { id, updatedAt: Math.max(Date.now(), (obj?.updatedAt || 0) + 1) }, true);
}

async function putMany(store, docs) {
  S[store].push(...docs);
  await idb.putMany(store, docs);
  await enqueueMany(store, docs);
}

/** Marca un chat como actualizado (para ordenarlo arriba en la lista). */
export async function touch(chatId) { const c = chatById(chatId); if (c) await put('chats', c); }

/* ---------- Carga inicial ---------- */
export async function loadLocal() {
  const data = await Promise.all(DATA_STORES.map((s) => idb.all(s)));
  DATA_STORES.forEach((s, i) => { S[s] = data[i]; });
  S.trash = S.messages.filter((m) => m.trashedAt);
  S.messages = S.messages.filter((m) => !m.trashedAt);
}

/* ---------- Papelera ---------- */
export const TRASH_DAYS = 30;

/** Mueve mensajes a la papelera (se pueden recuperar durante 30 días). */
export async function trashMessages(ids) {
  const now = Date.now(), done = [];
  for (const id of ids) {
    const m = msgById(id);
    if (!m || m.protected) continue; // protegido: no se elimina hasta quitarle la protección
    m.trashedAt = now;
    await put('messages', m);
    done.push(id);
  }
  return done;
}

/** Saca mensajes de la papelera. Si su chat ya no existe, vuelven a General. */
export async function restoreMessages(ids) {
  for (const id of ids) {
    const m = S.trash.find((x) => x.id === id);
    if (!m) continue;
    m.trashedAt = null;
    if (!chatById(m.chatId)) m.chatId = 'general';
    await put('messages', m);
  }
}

/** Borra para siempre (todos, o solo los indicados). */
export async function emptyTrash(ids = S.trash.map((m) => m.id)) {
  for (const id of ids) await remove('messages', id);
}

/** Borra lo que lleva más de 30 días en la papelera. */
export async function purgeTrash() {
  const cutoff = Date.now() - TRASH_DAYS * 864e5;
  const old = S.trash.filter((m) => m.trashedAt < cutoff).map((m) => m.id);
  if (old.length) await emptyTrash(old);
  return old.length;
}

/* ---------- Plantillas ---------- */
export const tplSorted = () => [...S.templates].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name));

const DEFAULT_TEMPLATES = [
  ['tpl-compras', 'Lista de compras', '🛒 *Compras*\n[ ] \n[ ] \n[ ] '],
  ['tpl-reunion', 'Reunión', '# Reunión\n*Asistentes:* \n\n### Temas\n- \n\n### Acuerdos\n[ ] '],
  ['tpl-diario', 'Diario', '### Hoy\n- Lo mejor: \n- Aprendí: \n- Mañana quiero: '],
  ['tpl-semanal', 'Revisión semanal', '[] Revisión semanal !cada lunes 9:00'],
];

/** Plantillas de ejemplo (una sola vez por dispositivo y solo si no hay ninguna). */
export async function seedTemplates() {
  if (S.templates.length || (await idb.get('meta', 'tplSeeded'))) return;
  const now = Date.now();
  await putMany('templates', DEFAULT_TEMPLATES.map(([id, name, text], order) => ({ id, name, text, order, createdAt: now, updatedAt: now })));
  await idb.put('meta', { key: 'tplSeeded', value: true });
}

/** Crea el chat General y, si no hay nada, unos ejemplos. */
export async function seed() {
  const now = Date.now();
  const general = { id: 'general', name: 'General', emoji: '💬', color: '#00a884', type: 'chat', groupId: null, tags: [], desc: 'Tu bandeja de entrada: escribe aquí y clasifica después.', pinned: true, createdAt: now, updatedAt: now };
  if (S.chats.length) { if (!chatById('general')) await put('chats', general); return; }

  // Usuario nuevo: solo el chat General, con unos consejos para empezar (sin chats, grupos ni categorías de ejemplo).
  let t = now - 60000;
  const tips = [
    '¡Hola! 👋 Este es tu chat *General*. Escribe aquí todo lo que se te ocurra y clasifícalo después.',
    'Empieza un mensaje con *[]* o */t* para crear una tarea, y con */n* para una nota. También puedes tocar el icono a la izquierda del cuadro de texto.',
    'Añade #etiquetas. Con *!hoy*, *!mañana* o *!2026-12-24* le pones fecha límite, y con *!18:00* un recordatorio.',
    'Con el clip 📎 adjuntas archivos o creas una encuesta, una lista de compras o un bloque HTML.',
    'Mantén pulsado un mensaje (o clic derecho) para seleccionarlo: desde ahí lo editas ✏️, lo mueves o lo eliminas. Con ＋ creas tus propios chats.',
  ].map((text) => {
    t += 1000;
    return { id: uid(), chatId: 'general', text, kind: 'message', done: false, tags: [], categoryId: null, due: null, starred: false, pinned: false, from: 'app', triaged: true, createdAt: t, updatedAt: now };
  });
  await put('chats', general);
  await putMany('messages', tips);
}
