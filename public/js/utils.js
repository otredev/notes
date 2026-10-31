/* Utilidades generales: DOM, texto y fechas. */

export const $ = (s, el = document) => el.querySelector(s);
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const norm = (s = '') => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
export const uniq = (a) => [...new Set(a)];
export const plain = (t = '') => t.replace(/[*_~`]/g, '');
export const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name);
export const isMobile = () => matchMedia('(max-width: 760px)').matches;

/* ---------- Fechas ---------- */
const pad = (n) => String(n).padStart(2, '0');
export const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayKey = () => dayKey(new Date());
export const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return dayKey(d); };
export const fromKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
export const hm = (ts) => { const d = new Date(ts); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const isOverdue = (k) => !!k && k < todayKey();

export function shortWhen(ts) {
  const d = new Date(ts), k = dayKey(d);
  if (k === todayKey()) return hm(ts);
  if (k === addDays(-1)) return 'Ayer';
  if (Date.now() - ts < 6 * 864e5) return d.toLocaleDateString('es', { weekday: 'long' });
  return d.toLocaleDateString('es', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

export function dayLabel(k) {
  if (k === todayKey()) return 'Hoy';
  if (k === addDays(-1)) return 'Ayer';
  const d = fromKey(k);
  const opts = { weekday: 'long', day: 'numeric', month: 'long' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString('es', opts);
}

/** "hoy 9:30", "mañana 18:00", "24 dic 9:30". */
export function remindLabel(ts) {
  const d = new Date(ts), k = dayKey(d);
  const day = k === todayKey() ? 'hoy' : k === addDays(1) ? 'mañana' : k === addDays(-1) ? 'ayer'
    : d.toLocaleDateString('es', { day: 'numeric', month: 'short', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
  return `${day} ${hm(ts)}`;
}

/** Valor para <input type="datetime-local"> en hora local, y al revés. */
export const toLocalInput = (ts) => (ts ? `${dayKey(new Date(ts))}T${hm(ts)}` : '');
export const fromLocalInput = (v) => (v ? new Date(v).getTime() || null : null);

export function dueLabel(k) {
  if (!k) return '';
  if (k === todayKey()) return 'Hoy';
  if (k === addDays(1)) return 'Mañana';
  if (k === addDays(-1)) return 'Ayer';
  return fromKey(k).toLocaleDateString('es', { day: 'numeric', month: 'short' });
}
