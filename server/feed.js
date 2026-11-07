/*
 * Feed de calendario suscribible: GET /cal/<clave>.ics
 * Google Calendar, Apple Calendario u Outlook lo consultan cada cierto tiempo y muestran
 * tus tareas y recordatorios. La clave deriva de APP_TOKEN (no la revela) y solo permite leer.
 */
import { feedKey, feedDoc } from '../public/js/calendar.js';
import { withDefaults } from './settings.js';

function sameText(a, b) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/** @returns {Promise<{ status: number, raw?: string, type?: string, body?: object }>} */
export async function handleFeed({ getRepo, token, tz: fallbackTz }, { file, origin }) {
  const key = String(file || '').replace(/\.ics$/i, '');
  const repo = await getRepo();
  // ¿De quién es esta clave?
  let uid = null;
  for (const p of await repo.activeUsers()) if (sameText(key, await feedKey(token, p.id))) { uid = p.id; break; }
  if (!uid) return { status: 404, body: { error: 'not found' } };
  const prefs = await repo.getUserPrefs(uid);
  const settings = withDefaults({ ...(await repo.getServerSettings()), ...(prefs.tz ? { tz: prefs.tz } : {}) }, fallbackTz);
  const { messages, chats } = await repo.liveData(uid);
  const locked = new Set(chats.filter((c) => c.locked).map((c) => c.id));
  // Los chats bloqueados no salen en el calendario.
  return { status: 200, raw: feedDoc(messages.filter((m) => !locked.has(m.chatId)), { tz: settings.tz, origin }), type: 'text/calendar; charset=utf-8' };
}
