/*
 * Calendario: "Añadir al calendario" (Google Calendar y .ics) y el feed suscribible (/cal/<clave>.ics).
 * Con recordatorio → evento de 30 min a esa hora (con aviso). Solo con fecha límite → evento de todo el día.
 * Las tareas recurrentes llevan RRULE. Módulo sin DOM en lo principal: también lo usa el servidor.
 */
import { plain } from './utils.js';
import { checklistOf, ITEM_RE } from './text.js';
import { localParts, localTz } from './recurrence.js';

const pad = (n) => String(n).padStart(2, '0');
const utcStamp = (ts) => { const d = new Date(ts); return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`; };
const dateStamp = (k) => k.replace(/-/g, '');
const nextDay = (k) => { const [y, m, d] = k.split('-').map(Number); const x = new Date(Date.UTC(y, m - 1, d + 1)); return x.toISOString().slice(0, 10).replace(/-/g, ''); };
const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/** ¿Tiene algo que poner en un calendario? */
export const hasDate = (m) => !!(m.remindAt || m.due);

/** Título (primera línea) y descripción (el resto) del evento. */
export function eventText(m) {
  const lines = String(m.text || '').split('\n').map((l) => plain(l.match(ITEM_RE)?.[3] ?? l).trim()).filter(Boolean);
  const title = (m.poll?.question || lines[0] || 'RetroDark').slice(0, 140);
  let desc = lines.slice(1).join('\n');
  if (checklistOf(m.text)) desc = String(m.text).split('\n').filter((l) => ITEM_RE.test(l)).map((l) => `☐ ${plain(l.match(ITEM_RE)[3])}`).join('\n');
  return { title, desc };
}

export function rrule(r) {
  if (!r?.freq) return '';
  if (r.freq === 'day') return 'FREQ=DAILY';
  if (r.freq === 'weekdays') return 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';
  if (r.freq === 'week') return `FREQ=WEEKLY${Number.isInteger(r.dow) ? `;BYDAY=${BYDAY[r.dow]}` : ''}`;
  if (r.freq === 'month') return 'FREQ=MONTHLY';
  if (r.freq === 'year') return 'FREQ=YEARLY';
  return '';
}

/** Inicio y fin. Con zona horaria, las horas van en hora local (así las repeticiones respetan el cambio de horario). */
function when(m, tz) {
  if (m.remindAt) {
    if (tz) {
      const s = localParts(m.remindAt, tz), e = localParts(m.remindAt + 30 * 60e3, tz);
      const stamp = (p) => `${dateStamp(p.date)}T${pad(p.h)}${pad(p.m)}00`;
      return { start: `;TZID=${tz}:${stamp(s)}`, end: `;TZID=${tz}:${stamp(e)}`, g: [stamp(s), stamp(e)], allDay: false };
    }
    return { start: `:${utcStamp(m.remindAt)}`, end: `:${utcStamp(m.remindAt + 30 * 60e3)}`, g: [utcStamp(m.remindAt), utcStamp(m.remindAt + 30 * 60e3)], allDay: false };
  }
  return { start: `;VALUE=DATE:${dateStamp(m.due)}`, end: `;VALUE=DATE:${nextDay(m.due)}`, g: [dateStamp(m.due), nextDay(m.due)], allDay: true };
}

export function googleCalendarUrl(m, tz = localTz()) {
  const { title, desc } = eventText(m);
  const w = when(m, tz);
  const p = new URLSearchParams({ action: 'TEMPLATE', text: title, dates: `${w.g[0]}/${w.g[1]}`, details: desc });
  if (!w.allDay) p.set('ctz', tz);
  const rule = rrule(m.repeat);
  if (rule) p.set('recur', `RRULE:${rule}`);
  return `https://calendar.google.com/calendar/render?${p}`;
}

/* ---------- .ics (RFC 5545) ---------- */
const icsEscape = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** Líneas de máximo 75 bytes; las siguientes empiezan con un espacio. */
function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = '', bytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

/** Un VEVENT. Para el feed: url (abre el mensaje en la app), prefix (☐/✔) y sin aviso. */
export function eventLines(m, { tz = null, url = '', alarm = true, prefix = '' } = {}) {
  const { title, desc } = eventText(m);
  const w = when(m, tz);
  const rule = rrule(m.repeat);
  return [
    'BEGIN:VEVENT',
    `UID:${m.id}@retrodark`,
    `DTSTAMP:${utcStamp(m.updatedAt || Date.now())}`,
    `DTSTART${w.start}`,
    `DTEND${w.end}`,
    ...(rule ? [`RRULE:${rule}`] : []),
    `SUMMARY:${icsEscape(prefix + title)}`,
    ...(desc ? [`DESCRIPTION:${icsEscape(desc)}`] : []),
    ...(url ? [`URL:${url}`] : []),
    ...(alarm && m.remindAt ? ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape(title)}`, 'TRIGGER:PT0M', 'END:VALARM'] : []),
    'END:VEVENT',
  ];
}

/** Documento .ics completo. */
export function calendarDoc(eventBlocks, { name = '' } = {}) {
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//RetroDark//Notas//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    ...(name ? [`X-WR-CALNAME:${icsEscape(name)}`, 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H'] : []),
    ...eventBlocks.flat(),
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}

export const icsText = (m, tz = localTz()) => calendarDoc([eventLines(m, { tz })]);

export function downloadIcs(m) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([icsText(m)], { type: 'text/calendar;charset=utf-8' }));
  a.download = `${(eventText(m).title.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'evento').slice(0, 40)}.ics`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ---------- Feed suscribible ---------- */

/** Clave del feed: deriva de APP_TOKEN (HMAC), así la URL no revela la clave de acceso. */
export async function feedKey(token) {
  if (!token) return 'feed';
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(token), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode('retrodark-ics-feed')));
  return [...sig.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Todo lo que tiene fecha y no está hecho ni en la papelera (más lo hecho en los últimos 7 días). */
export function feedDoc(messages, { tz, origin = '' }) {
  const weekAgo = Date.now() - 7 * 864e5;
  const events = messages
    .filter((m) => !m.trashedAt && hasDate(m) && (!m.done || (m.doneAt || 0) > weekAgo))
    .map((m) => eventLines(m, {
      tz, alarm: false,
      prefix: m.kind === 'task' ? (m.done ? '✔ ' : '☐ ') : '',
      url: origin ? `${origin}/?msg=${encodeURIComponent(m.id)}` : '',
    }));
  return calendarDoc(events, { name: 'RetroDark' });
}
