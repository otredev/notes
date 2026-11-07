/*
 * Mensajes sin leer (como en WhatsApp).
 * Cuentan los mensajes de otras personas, del asistente (MCP) y del correo que llegaron después de la
 * última vez que abriste el chat (chat.readAt, que es tuyo y se sincroniza entre tus dispositivos).
 */
import { S } from './state.js';
import { chatById, put } from './data/store.js';
import { isMine } from './people.js';

/** Al estrenar esta función no se marca como "sin leer" todo lo anterior. */
const START = (() => {
  const KEY = 'retrodark-unread-since';
  try {
    let v = Number(localStorage.getItem(KEY));
    if (!v) { v = Date.now(); localStorage.setItem(KEY, String(v)); }
    return v;
  } catch { return Date.now(); }
})();

const counts = (m) => !m.trashedAt && (!isMine(m) || m.from === 'mcp' || m.from === 'email');

export function unreadOf(c) {
  if (!c) return 0;
  const since = Math.max(c.readAt || 0, START);
  let n = 0;
  for (const m of S.messages) if (m.chatId === c.id && (m.createdAt || 0) > since && counts(m)) n++;
  return n;
}

/** Número en el icono de la app instalada (donde el sistema lo permite). */
export function updateAppBadge() {
  const n = S.chats.reduce((sum, c) => sum + (c.muted ? 0 : unreadOf(c)), 0);
  try { if (n) navigator.setAppBadge?.(n); else navigator.clearAppBadge?.(); } catch { /* sin soporte */ }
}

/** El chat está abierto y a la vista (no en otra pestaña ni con la app en segundo plano). */
export const viewing = (id) => S.active === id && document.visibilityState === 'visible'
  && !!document.getElementById('app')?.classList.contains('chat-open');

/** Abrir o ver un chat lo marca como leído. Devuelve true si había algo sin leer. */
export async function markRead(chatId) {
  const c = chatById(chatId);
  if (!c || !unreadOf(c)) return false;
  c.readAt = Math.max(Date.now(), ...S.messages.filter((m) => m.chatId === chatId).map((m) => m.createdAt || 0));
  await put('chats', c);
  updateAppBadge();
  return true;
}
