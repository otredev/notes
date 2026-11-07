/*
 * Recordatorios: cada minuto se buscan mensajes con `remindAt` vencido que aún no se avisaron
 * y se envía una notificación push a todos los dispositivos suscritos.
 */
import { sendPush } from './webpush.js';

const ITEM_RE = /^(\s*(?:-\s*)?)\[([ xX]?)\]\s?(.*)$/;

/** Texto corto del mensaje para la notificación (igual que en la app). */
function summary(m) {
  const lines = String(m.text || '').split('\n');
  const items = lines.filter((l) => ITEM_RE.test(l));
  let text;
  if (items.length && (items.length > 1 || lines.filter((l) => l.trim()).length > 1)) {
    const done = items.filter((l) => l.match(ITEM_RE)[2].toLowerCase() === 'x').length;
    text = `☑ ${done}/${items.length} ` + lines.map((l) => l.match(ITEM_RE)?.[3] ?? l).filter((l) => l.trim()).join(' · ');
  } else {
    text = (m.kind === 'task' ? (m.done ? '☑ ' : '☐ ') : '') + m.text;
  }
  const att = m.attachments || [];
  if (att.length) {
    const a = att[0];
    const label = a.type?.startsWith('audio/') ? '🎤 Audio' : a.type?.startsWith('image/') ? (att.length > 1 ? `📷 ${att.length} fotos` : '📷 Foto')
      : a.type?.startsWith('video/') ? '🎬 Vídeo' : `📎 ${a.name}`;
    text = String(m.text || '').trim() ? `${label} · ${text}` : label;
  }
  text = text.replace(/```html[^\n]*\n?[\s\S]*?(?:\n```|$)/g, ' </> HTML ').replace(/^#{1,3}\s+/gm, '').replace(/[*_~`]/g, '');
  if (m.poll) text = `📊 ${m.poll.question}`;
  if (m.repeat?.freq) text = `🔁 ${text}`;
  return text.length > 180 ? `${text.slice(0, 177)}…` : text;
}

export const vapidReady = (vapid) => !!(vapid && vapid.publicKey && vapid.privateKey && vapid.subject);

/** Envía a todas las suscripciones; borra las que ya no existen. */
export async function pushToAll(repo, vapid, data, subs = null) {
  const list = subs || await repo.listSubs();
  let sent = 0;
  await Promise.all(list.map(async (s) => {
    try {
      const r = await sendPush(s, data, vapid);
      if (r.ok) sent++;
      else if (r.gone) await repo.deleteSub(s.endpoint);
      else console.warn('Push rechazado', r.status, new URL(s.endpoint).host);
    } catch (err) {
      console.warn('Push falló:', err.message);
    }
  }));
  return sent;
}

export async function runReminders(repo, vapid, now = Date.now()) {
  if (!vapidReady(vapid)) return 0;
  const due = await repo.dueReminders(now);
  if (!due.length) return 0;
  const subs = await repo.listSubs();
  for (const m of due) {
    // Se marca antes de enviar para no repetir el aviso si el siguiente minuto se solapa.
    await repo.markReminded(m.id, m.remindAt);
    if (!subs.length) continue;
    const chat = await repo.getChat(m.chatId);
    await pushToAll(repo, vapid, {
      title: chat ? `⏰ ${chat.emoji || ''} ${chat.name}`.replace(/\s+/g, ' ') : '⏰ Recordatorio',
      body: summary(m),
      msgId: m.id,
      tag: `remind-${m.id}`,
      // Botones de la notificación: los gestiona el service worker (POST /api/push/action).
      actions: m.kind === 'task' && !/^\s*(?:-\s*)?\[[ xX]?\]/m.test(m.text || '')
        ? [{ action: 'done', title: '✅ Hecho' }, { action: 'snooze', title: '⏰ Posponer' }]
        : [{ action: 'snooze', title: '⏰ Posponer 10 min' }],
    }, subs);
  }
  return due.length;
}
