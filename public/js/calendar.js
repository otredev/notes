/*
 * "Añadir al calendario": enlace de Google Calendar y archivo .ics (Apple, Outlook, cualquier calendario).
 * Con recordatorio → evento de 30 min a esa hora (con aviso). Solo con fecha límite → evento de todo el día.
 */
import { plain } from './utils.js';
import { checklistOf, ITEM_RE } from './text.js';

const pad = (n) => String(n).padStart(2, '0');
const utcStamp = (ts) => { const d = new Date(ts); return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00Z`; };
const dateStamp = (k) => k.replace(/-/g, '');
const nextDay = (k) => { const [y, m, d] = k.split('-').map(Number); const x = new Date(Date.UTC(y, m - 1, d + 1)); return x.toISOString().slice(0, 10).replace(/-/g, ''); };

/** ¿Tiene algo que poner en un calendario? */
export const hasDate = (m) => !!(m.remindAt || m.due);

/** Título (primera línea) y descripción (el resto) del evento. */
function eventText(m) {
  const lines = String(m.text || '').split('\n').map((l) => plain(l.match(ITEM_RE)?.[3] ?? l).trim()).filter(Boolean);
  const title = (m.poll?.question || lines[0] || 'RetroDark').slice(0, 140);
  let desc = lines.slice(1).join('\n');
  if (checklistOf(m.text)) desc = String(m.text).split('\n').filter((l) => ITEM_RE.test(l)).map((l) => `☐ ${plain(l.match(ITEM_RE)[3])}`).join('\n');
  return { title, desc };
}

function when(m) {
  if (m.remindAt) return { start: utcStamp(m.remindAt), end: utcStamp(m.remindAt + 30 * 60e3), allDay: false };
  return { start: dateStamp(m.due), end: nextDay(m.due), allDay: true };
}

export function googleCalendarUrl(m) {
  const { title, desc } = eventText(m);
  const w = when(m);
  const p = new URLSearchParams({ action: 'TEMPLATE', text: title, dates: `${w.start}/${w.end}`, details: desc });
  return `https://calendar.google.com/calendar/render?${p}`;
}

/* ---------- .ics (RFC 5545) ---------- */
const icsEscape = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

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

export function icsText(m) {
  const { title, desc } = eventText(m);
  const w = when(m);
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//RetroDark//Notas//ES', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${m.id}@retrodark`,
    `DTSTAMP:${utcStamp(Date.now())}`,
    w.allDay ? `DTSTART;VALUE=DATE:${w.start}` : `DTSTART:${w.start}`,
    w.allDay ? `DTEND;VALUE=DATE:${w.end}` : `DTEND:${w.end}`,
    `SUMMARY:${icsEscape(title)}`,
    ...(desc ? [`DESCRIPTION:${icsEscape(desc)}`] : []),
    ...(m.remindAt ? ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape(title)}`, 'TRIGGER:PT0M', 'END:VALARM'] : []),
    'END:VEVENT', 'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}

export function downloadIcs(m) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([icsText(m)], { type: 'text/calendar;charset=utf-8' }));
  a.download = `${(eventText(m).title.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'evento').slice(0, 40)}.ics`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
