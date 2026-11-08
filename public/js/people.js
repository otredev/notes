/*
 * Personas y permisos en la app (el servidor los vuelve a comprobar siempre).
 *  - Sin cuentas (servidor sin APP_TOKEN o datos antiguos) todo es del propietario: "owner".
 */
import { S, settings } from './state.js';
import { mentionNames } from './text.js';
import { onMe } from './data/sync.js';

/**
 * Mi id. Si aún no llegó "me" del servidor (arranque sin conexión, sincronización pendiente…),
 * se saca del token de sesión (rd1.<usuario>.<sesión>.<firma>) para no confundirme con el propietario.
 */
export const myId = () => S.me?.id || settings.token?.match(/^rd1\.([^.]+)\./)?.[1] || 'owner';
export const personById = (id) => S.people.find((p) => p.id === id) || (id === myId() ? S.me : null);
export const nameOf = (id) => (id === myId() ? 'Tú' : personById(id)?.name || 'Alguien');
export const colorOf = (id) => personById(id)?.color || 'var(--green)';

/** Lo que aún no pasó por el servidor no tiene autor: es mío. */
const authorOf = (m) => m.authorId || myId();
/** ¿Lo escribí yo? */
export const isMine = (m) => authorOf(m) === myId();
export const isShared = (chat) => !!chat?.shared || (chat?.members?.length || 0) > 1;
export const isChatAdmin = (chat) => !chat?.members?.length || chat.members.some((x) => x.id === myId() && x.role === 'admin');
// Un chat sin ownerId aún no ha pasado por el servidor: lo creé yo en este dispositivo.
export const isChatOwner = (chat) => !chat?.ownerId || chat.ownerId === myId();
/** ¿Puedo escribir en este chat? ("Solo los administradores pueden enviar") */
export const canPost = (chat) => !chat?.onlyAdmins || isChatAdmin(chat);
export const canEdit = (m) => isMine(m);
export const canDelete = (m, chat) => isMine(m) || isChatAdmin(chat);
/** Bloquear / proteger un mensaje: quien lo escribió o un administrador del chat. */
export const canGuard = (m, chat) => isMine(m) || isChatAdmin(chat);
/** Miembros del chat (con su ficha). */
export const membersOf = (chat) => (chat?.members?.length ? chat.members : [{ id: myId(), role: 'admin' }])
  .map((x) => ({ ...x, ...(personById(x.id) || { name: 'Alguien' }) }));

/** Menciones: los @usuario de los miembros del chat que aparecen en el texto. */
export function mentionsIn(text, chat) {
  if (!isShared(chat)) return [];
  const handles = new Set([...String(text).matchAll(/(?:^|\s)@([a-z0-9_]{2,24})(?![a-z0-9_])/g)].map((x) => x[1]));
  return membersOf(chat).filter((p) => p.handle && handles.has(p.handle) && p.id !== myId()).map((p) => p.id);
}

function refreshMentionNames() {
  mentionNames.clear();
  for (const p of S.people) if (p.handle) mentionNames.add(p.handle);
}
onMe(refreshMentionNames);
export const initPeople = () => refreshMentionNames();
