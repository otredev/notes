/*
 * Tareas recurrentes: siguiente fecha y recordatorio.
 * Módulo sin dependencias: lo usan la app y el servidor (Worker / Node), con zona horaria explícita.
 *
 * Regla: { freq: 'day' | 'weekdays' | 'week' | 'month' | 'year', dow?: 0-6 }  (dow = día de la semana, 0 = domingo)
 */
export const REPEATS = { day: 'Cada día', weekdays: 'Días laborables', week: 'Cada semana', month: 'Cada mes', year: 'Cada año' };
export const DOW = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

export function repeatLabel(r) {
  if (!r?.freq) return '';
  if (r.freq === 'week' && Number.isInteger(r.dow)) return `Cada ${DOW[r.dow]}`;
  return REPEATS[r.freq] || '';
}

/* ---------- Fechas AAAA-MM-DD (sin zona horaria) ---------- */
const toUTC = (k) => { const [y, m, d] = k.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const fromUTC = (t) => new Date(t).toISOString().slice(0, 10);
const addDaysKey = (k, n) => fromUTC(toUTC(k) + n * 864e5);
const dowOf = (k) => new Date(toUTC(k)).getUTCDay();
const isWeekend = (k) => dowOf(k) === 0 || dowOf(k) === 6;

function addMonths(k, n) {
  const [y, m, d] = k.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, last)); // 31 de enero + 1 mes = 28/29 de febrero
  return fromUTC(first.getTime());
}

function step(r, k) {
  switch (r.freq) {
    case 'day': return addDaysKey(k, 1);
    case 'weekdays': { let x = addDaysKey(k, 1); while (isWeekend(x)) x = addDaysKey(x, 1); return x; }
    case 'week': return addDaysKey(k, 7);
    case 'month': return addMonths(k, 1);
    case 'year': return addMonths(k, 12);
    default: return null;
  }
}

/** Primera fecha (hoy o después) que cumple la regla. */
export function firstDate(r, today) {
  let k = today;
  if (r.freq === 'week' && Number.isInteger(r.dow)) while (dowOf(k) !== r.dow) k = addDaysKey(k, 1);
  if (r.freq === 'weekdays') while (isWeekend(k)) k = addDaysKey(k, 1);
  return k;
}

/** Siguiente fecha tras `from`; si se quedó atrás, la primera que no sea anterior a hoy. */
export function nextDate(r, from, today) {
  let k = step(r, from);
  for (let guard = 0; k && k < today && guard < 5000; guard++) k = step(r, k);
  return k;
}

/* ---------- Zona horaria ---------- */
export const localTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Fecha y hora locales de un instante en la zona `tz`. */
export function localParts(ts, tz) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(ts);
  const g = (t) => parts.find((p) => p.type === t).value;
  return { date: `${g('year')}-${g('month')}-${g('day')}`, h: Number(g('hour')), m: Number(g('minute')) };
}

function tzOffset(ts, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(ts);
  const g = (t) => Number(parts.find((p) => p.type === t).value);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - ts;
}

/** Fecha + hora locales en la zona `tz` → milisegundos. */
export function zonedTime(dateKey, h, min, tz) {
  const naive = toUTC(dateKey) + h * 3600e3 + min * 60e3;
  const ts = naive - tzOffset(naive, tz);
  return naive - tzOffset(ts, tz); // ajuste por cambio de horario
}

/**
 * Completar una tarea recurrente: en vez de quedar hecha, pasa a su siguiente fecha
 * (el recordatorio se mueve a la misma hora). Devuelve los campos a cambiar.
 */
export function advance(m, { tz = localTz(), now = Date.now() } = {}) {
  const today = localParts(now, tz).date;
  const base = m.due || (m.remindAt ? localParts(m.remindAt, tz).date : today);
  const due = nextDate(m.repeat, base, today);
  let remindAt = null;
  if (m.remindAt) {
    const p = localParts(m.remindAt, tz);
    remindAt = zonedTime(due, p.h, p.m, tz);
  }
  return { due, remindAt, done: false, doneAt: null, lastDoneAt: now };
}

/** Atajo de texto → regla. "cada lunes", "cada día", "laborables", "semanal"… */
export function parseRepeat(word) {
  const w = word.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
  const map = { 'cada dia': 'day', diario: 'day', laborables: 'weekdays', 'cada semana': 'week', semanal: 'week', 'cada mes': 'month', mensual: 'month', 'cada ano': 'year', anual: 'year' };
  if (map[w]) return { freq: map[w] };
  const d = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'].indexOf(w.replace(/^cada /, ''));
  return d >= 0 && w.startsWith('cada ') ? { freq: 'week', dow: d } : null;
}
