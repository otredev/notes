/*
 * Tareas diarias (las lanza el cron de cada minuto):
 *  - Resumen del día por notificación, a la hora elegida (en tu zona horaria).
 *  - Copia de seguridad automática en R2 a partir de las 3:00.
 */
import { localParts } from '../public/js/recurrence.js';
import { withDefaults } from './settings.js';
import { pushToAll, vapidReady } from './reminders.js';
import { createBackup } from './backups.js';

const plain = (t = '') => String(t).replace(/```[\s\S]*?(```|$)/g, ' ').replace(/^#{1,3}\s+/gm, '').replace(/[*_~`]/g, '').replace(/\s+/g, ' ').trim();
const firstLine = (m) => plain((m.poll?.question || m.text || '').split('\n')[0]).slice(0, 60) || 'Sin texto';

/** Contenido del resumen: vencidas, de hoy y recordatorios de hoy. null si no hay nada. */
export function buildSummary({ messages, chats }, tz, now = Date.now()) {
  const today = localParts(now, tz).date;
  const locked = new Set(chats.filter((c) => c.locked).map((c) => c.id));
  const open = messages.filter((m) => m.kind === 'task' && !m.done);
  const overdue = open.filter((m) => m.due && m.due < today);
  const dueToday = open.filter((m) => m.due === today);
  const reminders = messages.filter((m) => m.remindAt && localParts(m.remindAt, tz).date === today && !(m.kind === 'task' && m.done));
  if (!overdue.length && !dueToday.length && !reminders.length) return null;
  const parts = [];
  if (dueToday.length) parts.push(`${dueToday.length} para hoy`);
  if (overdue.length) parts.push(`${overdue.length} vencida${overdue.length > 1 ? 's' : ''}`);
  if (reminders.length) parts.push(`${reminders.length} recordatorio${reminders.length > 1 ? 's' : ''}`);
  const seen = new Set();
  const lines = [...overdue, ...dueToday, ...reminders]
    .filter((m) => !seen.has(m.id) && seen.add(m.id))
    .slice(0, 5)
    .map((m) => `• ${locked.has(m.chatId) ? '🔒 (chat bloqueado)' : firstLine(m)}`);
  return { title: `☀️ Tu día: ${parts.join(' · ')}`, body: lines.join('\n') };
}

export async function sendSummary(repo, vapid, tz, now = Date.now()) {
  const s = buildSummary(await repo.liveData(), tz, now);
  if (!s) return { sent: 0, empty: true };
  return { sent: await pushToAll(repo, vapid, { ...s, tag: 'daily-summary', url: './?nav=tasks' }), empty: false };
}

/**
 * @param {{ vapid?: object, backups?: object, tz: string, now?: number }} opt  backups: almacén de copias (R2) o null
 */
export async function runDaily(repo, { vapid, backups, tz: fallbackTz, now = Date.now() }) {
  const settings = withDefaults(await repo.getServerSettings(), fallbackTz);
  const { date, h, m } = localParts(now, settings.tz);
  const minutes = h * 60 + m;
  const out = {};

  if (settings.summary.enabled && vapidReady(vapid)) {
    const [sh, sm] = settings.summary.time.split(':').map(Number);
    // Ventana de 1 hora: si el cron se salta un minuto, se envía igual.
    if (minutes >= sh * 60 + sm && minutes < sh * 60 + sm + 60 && await repo.claimDaily('summary', date)) {
      out.summary = await sendSummary(repo, vapid, settings.tz, now);
    }
  }
  if (backups && settings.backups.enabled && h >= 3 && await repo.claimDaily('backup', date)) {
    out.backup = (await createBackup(repo, backups, `${date}.json`)).name;
  }
  return out;
}
