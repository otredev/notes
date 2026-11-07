/*
 * Avisos de mensajes nuevos en chats compartidos (push a los demás miembros).
 *  - Si te mencionan (@usuario), siempre te llega.
 *  - Si no, solo si no has silenciado el chat.
 *  - Si el chat está bloqueado en tu cuenta, no se muestra el texto.
 */
import { pushToAll, vapidReady, summary } from './reminders.js';
import { membersOf } from './repo.js';

export async function notifyNewMessages(repo, vapid, { created = [], by }) {
  if (!vapidReady(vapid) || !created.length) return 0;
  let sent = 0;
  const author = await repo.getUser(by);
  for (const m of created) {
    const members = membersOf(m.chat).filter((x) => x.id !== by);
    if (!members.length) continue;
    const mentions = new Set(Array.isArray(m.mentions) ? m.mentions : []);
    for (const mem of members) {
      const chat = await repo.getChat(m.chatId, mem.id);
      if (!chat) continue;
      const mentioned = mentions.has(mem.id);
      if (chat.muted && !mentioned) continue;
      const subs = await repo.listSubs(mem.id);
      if (!subs.length) continue;
      const who = author?.name || 'Alguien';
      sent += await pushToAll(repo, vapid, {
        title: mentioned ? `${who} te mencionó en ${chat.emoji || ''} ${chat.name}`.replace(/\s+/g, ' ') : `${chat.emoji || ''} ${chat.name}`.trim(),
        body: chat.locked ? '🔒 Mensaje nuevo en un chat bloqueado' : `${mentioned ? '' : `${who}: `}${summary(m)}`,
        msgId: m._id,
        tag: `chat-${m.chatId}`,
      }, subs);
    }
  }
  return sent;
}
