/* Texto de los mensajes: atajos al escribir, etiquetas y formato tipo WhatsApp. */
import { S } from './state.js';
import { esc, norm, uniq, todayKey, addDays } from './utils.js';

export const extractTags = (text) => uniq([...text.matchAll(/(?:^|\s)#([\p{L}\p{N}_-]+)/gu)].map((x) => x[1].toLowerCase()));
export const splitTags = (s = '') => uniq(s.split(/[,\s]+/).map((t) => t.replace(/^#/, '').trim().toLowerCase()).filter(Boolean));
/* Quita un atajo (!fecha, @categoría) del texto sin juntar líneas. */
const cut = (text, m) => {
  const before = text.slice(0, m.index), after = text.slice(m.index + m[0].length);
  const lead = /\n$/.test(before) || !before ? '' : ' ';
  return (before + lead + after.replace(/^[ \t]+/, '')).replace(/[ \t]+$/gm, '').trim();
};

/* ---------- Listas de casillas dentro de un mensaje ---------- */

/** Una línea de casilla: `[] algo`, `[ ] algo`, `[x] algo` o `- [ ] algo`. Grupos: sangría, marca, texto. */
export const ITEM_RE = /^(\s*(?:-\s*)?)\[([ xX]?)\]\s?(.*)$/;

/**
 * Si el texto es una lista de casillas devuelve { total, done }; si no, null.
 * Una sola línea `[] algo` no es lista: es una tarea normal.
 */
export function checklistOf(text = '') {
  const lines = text.split('\n');
  let total = 0, done = 0;
  for (const l of lines) {
    const x = l.match(ITEM_RE);
    if (x) { total++; if (x[2].toLowerCase() === 'x') done++; }
  }
  if (!total || (total === 1 && lines.filter((l) => l.trim()).length === 1)) return null;
  return { total, done };
}

/** Escribe todas las casillas igual: `[ ] texto` o `[x] texto`. */
const normalizeItems = (text) => text.split('\n')
  .map((l) => { const x = l.match(ITEM_RE); return x ? `${x[2].toLowerCase() === 'x' ? '[x]' : '[ ]'} ${x[3]}` : l; })
  .join('\n');

/** Marca o desmarca la casilla de la línea `i`. Devuelve el texto nuevo (o null si no es casilla). */
export function toggleItemLine(text, i) {
  const lines = text.split('\n');
  const x = lines[i]?.match(ITEM_RE);
  if (!x) return null;
  lines[i] = `${x[2].toLowerCase() === 'x' ? '[ ]' : '[x]'} ${x[3]}`;
  return lines.join('\n');
}

/**
 * Interpreta lo escrito en el cuadro de texto.
 * `[]` `/t` tarea · `[x]` tarea hecha · `/n` nota · `/m` mensaje · `!hoy` `!mañana` `!AAAA-MM-DD` fecha
 * (con hora opcional `!mañana 9:30` = recordatorio) · `!9:30` solo recordatorio · `@categoría`
 */
export function parse(raw, defKind) {
  // Quita casillas vacías sueltas (p. ej. la última "[ ]" que deja el Enter).
  let text = raw.split('\n').filter((l) => { const x = l.match(ITEM_RE); return !x || x[3].trim(); }).join('\n').trim();
  let kind = defKind, explicit = false, done = false, due = null, categoryId = null;
  const isChecklist = !!checklistOf(text);
  // Varias casillas en un mensaje: se guarda como nota con su lista.
  const pre = isChecklist ? null : text.match(/^(?:-\s*)?(\[[ xX]?\]|\/t|\/n|\/m)(?=\s|$)\s*/i);
  if (isChecklist) {
    kind = 'note';
    explicit = true;
    text = normalizeItems(text);
  } else if (pre) {
    explicit = true;
    const k = pre[1].toLowerCase();
    kind = k === '/n' ? 'note' : k === '/m' ? 'message' : 'task';
    done = k === '[x]';
    text = text.slice(pre[0].length);
  }
  // Fecha, con hora opcional: !hoy · !mañana 9:30 · !2026-12-24 18:00 → fecha límite (+ recordatorio)
  let remindAt = null;
  const d = text.match(/(?<!\S)!(hoy|ma[nñ]ana|\d{4}-\d{2}-\d{2})(?:[ \t]+(\d{1,2})[:.](\d{2}))?(?=\s|$)/i);
  if (d) {
    const v = norm(d[1]);
    due = v === 'hoy' ? todayKey() : v === 'manana' ? addDays(1) : d[1];
    if (d[2] !== undefined) remindAt = atTime(due, +d[2], +d[3]);
    text = cut(text, d);
  }
  // Solo hora: !9:30 → recordatorio hoy a esa hora (o mañana si ya pasó)
  const t = !remindAt && text.match(/(?<!\S)!(\d{1,2})[:.](\d{2})(?=\s|$)/);
  if (t) {
    remindAt = atTime(todayKey(), +t[1], +t[2]);
    if (remindAt && remindAt <= Date.now()) remindAt = atTime(addDays(1), +t[1], +t[2]);
    text = cut(text, t);
  }
  const c = [...text.matchAll(/(?<!\S)@([\p{L}\p{N}_-]+)/gu)].find((x) => S.categories.some((k) => norm(k.name) === norm(x[1])));
  if (c) {
    categoryId = S.categories.find((k) => norm(k.name) === norm(c[1])).id;
    text = cut(text, c);
  }
  return { text, kind, explicit, done, due, categoryId, remindAt, tags: extractTags(text) };
}

/** Fecha (AAAA-MM-DD) + hora local → milisegundos. null si la hora no es válida. */
function atTime(dateKey, h, min) {
  if (h > 23 || min > 59) return null;
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d, h, min).getTime();
}

/** Convierte el texto en HTML seguro con *negrita*, _cursiva_, ~tachado~, `código`, enlaces y #etiquetas. */
export function fmt(t = '') {
  return esc(t)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*([^*\n]+)\*/g, '<b>$1</b>')
    .replace(/(^|[\s>(])_([^_\n]+)_(?=$|[\s<.,;:!?)])/g, '$1<i>$2</i>')
    .replace(/~([^~\n]+)~/g, '<s>$1</s>')
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
    .replace(/(^|\s)#([\p{L}\p{N}_-]+)/gu, '$1<span class="tag" data-act="tag" data-tag="$2">#$2</span>')
    .replace(/\n/g, '<br>');
}
