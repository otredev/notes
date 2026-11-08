/* Texto de los mensajes: atajos al escribir, etiquetas y formato (negrita, títulos, listas, código, HTML). */
import { highlightLines } from './highlight.js';
import { S } from './state.js';
import { esc, norm, uniq, todayKey, addDays } from './utils.js';
import { ic } from './icons.js';
import { parseRepeat, firstDate } from './recurrence.js';

/** Bloques de código ```…``` (incluido uno sin cerrar al final). */
const FENCE_RE = /```[^\n]*\n?[\s\S]*?(?:\n```|$)/g;
const withoutCode = (text) => text.replace(FENCE_RE, ' ');

export const extractTags = (text) => uniq([...withoutCode(text).matchAll(/(?:^|\s)#([\p{L}\p{N}_-]+)/gu)].map((x) => x[1].toLowerCase()));
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
 * `!cada lunes 9:00` `!cada día` `!laborables` `!cada mes` … tarea recurrente
 */
export function parse(raw, defKind) {
  // Los bloques de código no se interpretan: se apartan y se devuelven al final.
  const blocks = [];
  let text = raw.replace(FENCE_RE, (m) => `\u0000${blocks.push(m) - 1}\u0000`);
  // Quita casillas vacías sueltas (p. ej. la última "[ ]" que deja el Enter).
  text = text.split('\n').filter((l) => { const x = l.match(ITEM_RE); return !x || x[3].trim(); }).join('\n').trim();
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
  // Repetición: !cada lunes · !cada día · !laborables · !cada mes … (con hora opcional: !cada lunes 9:00)
  let remindAt = null, repeat = null;
  const r = text.match(/(?<!\S)!(cada\s+(?:d[ií]a|semana|mes|a[ñn]o|lunes|martes|mi[ée]rcoles|jueves|viernes|s[áa]bado|domingo)|laborables|diario|semanal|mensual|anual)(?:[ \t]+(\d{1,2})[:.](\d{2}))?(?=\s|$)/i);
  if (r && (repeat = parseRepeat(r[1]))) {
    due = firstDate(repeat, todayKey());
    if (r[2] !== undefined) {
      remindAt = atTime(due, +r[2], +r[3]);
      // Si la hora de hoy ya pasó, la primera vez es la siguiente.
      if (remindAt && remindAt <= Date.now() && repeat.freq !== 'week') { due = firstDate(repeat, addDays(1)); remindAt = atTime(due, +r[2], +r[3]); }
    }
    if (!explicit) kind = 'task';
    text = cut(text, r);
  }
  // Fecha, con hora opcional: !hoy · !mañana 9:30 · !2026-12-24 18:00 → fecha límite (+ recordatorio)
  const d = text.match(/(?<!\S)!(hoy|ma[nñ]ana|\d{4}-\d{2}-\d{2})(?:[ \t]+(\d{1,2})[:.](\d{2}))?(?=\s|$)/i);
  if (d) {
    const keepTime = remindAt && d[2] === undefined ? new Date(remindAt) : null;
    const v = norm(d[1]);
    due = v === 'hoy' ? todayKey() : v === 'manana' ? addDays(1) : d[1];
    if (d[2] !== undefined) remindAt = atTime(due, +d[2], +d[3]);
    else if (keepTime) remindAt = atTime(due, keepTime.getHours(), keepTime.getMinutes());
    text = cut(text, d);
  }
  // Solo hora: !9:30 → recordatorio hoy a esa hora (o mañana si ya pasó)
  const t = !remindAt && text.match(/(?<!\S)!(\d{1,2})[:.](\d{2})(?=\s|$)/);
  if (t) {
    remindAt = atTime(due || todayKey(), +t[1], +t[2]);
    if (remindAt && remindAt <= Date.now() && !due) remindAt = atTime(addDays(1), +t[1], +t[2]);
    text = cut(text, t);
  }
  const c = [...text.matchAll(/(?<!\S)@([\p{L}\p{N}_-]+)/gu)].find((x) => S.categories.some((k) => norm(k.name) === norm(x[1])));
  if (c) {
    categoryId = S.categories.find((k) => norm(k.name) === norm(c[1])).id;
    text = cut(text, c);
  }
  text = text.replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[+i]).trim();
  return { text, kind, explicit, done, due, categoryId, remindAt, repeat, tags: extractTags(text) };
}

/** Fecha (AAAA-MM-DD) + hora local → milisegundos. null si la hora no es válida. */
function atTime(dateKey, h, min) {
  if (h > 23 || min > 59) return null;
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d, h, min).getTime();
}

/* ---------- Formato ---------- */

/** Usuarios (@usuario) que se resaltan como mención. Lo rellena people.js. */
export const mentionNames = new Set();

/** Formato dentro de una línea: `código`, __subrayado__, *negrita*, _cursiva_, ~tachado~, enlaces y #etiquetas. */
function inline(src) {
  const codes = [];
  let h = esc(src).replace(/`([^`\n]+)`/g, (_, c) => `\u0001${codes.push(c) - 1}\u0001`);
  h = h
    .replace(/__([^_\n]+)__/g, '<u>$1</u>')
    .replace(/\*([^*\n]+)\*/g, '<b>$1</b>')
    .replace(/(^|[\s>(])_([^_\n]+)_(?=$|[\s<.,;:!?)])/g, '$1<i>$2</i>')
    .replace(/~([^~\n]+)~/g, '<s>$1</s>')
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/(^|\s)#([\p{L}\p{N}_-]+)/gu, '$1<span class="tag" data-act="tag" data-tag="$2">#$2</span>')
    .replace(/(^|\s)@([a-z0-9_]{2,24})(?![a-z0-9_])/g, (m, p, h) => (mentionNames.has(h) ? `${p}<span class="mention">@${h}</span>` : m));
  return h.replace(/\u0001(\d+)\u0001/g, (_, i) => `<code>${codes[+i]}</code>`);
}

/* ---------- Bloque de código HTML (iframe aislado) ---------- */

/** Alturas ya conocidas de cada bloque, para que no salte al redibujar. */
export const embedSizes = new Map();
export const EMBED_MAX_PX = 3000;

/**
 * Documento del iframe: el código del usuario + un script que SOLO envía su alto (un número)
 * a la página. El iframe va con sandbox="allow-scripts" y sin allow-same-origin: no puede leer
 * la app, sus datos, cookies ni almacenamiento.
 */
export function embedDoc(code) {
  const dark = document.documentElement.dataset.mode !== 'light';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html{color-scheme:${dark ? 'dark' : 'light'}}body{margin:0;padding:10px;font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:${dark ? '#e6e9e7' : '#111b21'};background:transparent;overflow-wrap:anywhere}</style>
</head><body>
${code}
<script>(function(){var last=-1;function send(){var b=document.body;if(!b)return;var h=b.getBoundingClientRect().height,y=scrollY;for(var i=0;i<b.children.length;i++){var r=b.children[i].getBoundingClientRect();if(r.bottom+y+10>h)h=r.bottom+y+10;}h=Math.ceil(h);if(h!==last){last=h;parent.postMessage(h,"*");}}addEventListener("load",send);if(window.ResizeObserver)new ResizeObserver(send).observe(document.body);setTimeout(send,30);})();<\/script>
</body></html>`;
}

function htmlEmbed(code, key) {
  const size = embedSizes.get(key);
  const style = size?.pct ? `height:auto;aspect-ratio:100 / ${size.pct}` : `height:${size?.px || 160}px`;
  return `<div class="html-embed" data-key="${esc(key)}">
    <div class="he-head">${ic('code', 'tiny')}<span>HTML</span><button class="he-toggle" data-act="embed-code">Ver código</button><button class="he-toggle he-full" data-act="embed-full" title="Pantalla completa" aria-label="Pantalla completa">${ic('expand', 'tiny')}</button></div>
    <iframe class="he-frame" data-key="${esc(key)}" sandbox="allow-scripts" referrerpolicy="no-referrer" loading="lazy" title="Bloque HTML" style="${style}" srcdoc="${esc(embedDoc(code))}"></iframe>
    <pre class="code he-src" hidden><code>${highlightLines(code, 'html')}</code></pre></div>`;
}

/**
 * Convierte el texto de un mensaje en HTML seguro.
 *  # Título · ## Título 2 · ### Título 3 · - lista · ```código``` · ```html (bloque ejecutable)
 *  `embedKey`: id del mensaje; sin él los bloques HTML se muestran como un aviso (listas, citas…).
 */
export function fmt(t = '', { embedKey = '' } = {}) {
  const out = [];
  let para = [], list = null, nEmbed = 0;
  const flushPara = () => { if (para.length) { out.push(para.join('<br>')); para = []; } };
  const flushList = () => { if (list) { out.push(`<ul class="md-ul">${list.join('')}</ul>`); list = null; } };
  const lines = String(t).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^```\s*([\w-]*)\s*$/);
    if (fence) {
      const body = [];
      for (i++; i < lines.length && !/^```\s*$/.test(lines[i]); i++) body.push(lines[i]);
      flushPara(); flushList();
      const code = body.join('\n');
      if (fence[1].toLowerCase() === 'html') {
        out.push(embedKey ? htmlEmbed(code, `${embedKey}:${nEmbed++}`) : `<span class="he-chip">${ic('code', 'tiny')} Bloque HTML</span>`);
      } else {
        out.push(`<pre class="code"><code>${highlightLines(code, fence[1])}</code></pre>`);
      }
      continue;
    }
    const h = line.match(/^(#{1,3})\s+(\S.*)$/);
    if (h) { flushPara(); flushList(); out.push(`<div class="md-h${h[1].length}">${inline(h[2])}</div>`); continue; }
    const li = !ITEM_RE.test(line) && line.match(/^\s*[-•]\s+(\S.*)$/);
    if (li) { flushPara(); (list ||= []).push(`<li>${inline(li[1])}</li>`); continue; }
    flushList();
    para.push(inline(line));
  }
  flushPara(); flushList();
  return out.join('');
}

/** ¿El cursor está dentro de un bloque ```…``` abierto? (Enter añade una línea en vez de enviar). */
export const insideFence = (text, pos) => ((text.slice(0, pos).match(/^```/gm) || []).length % 2) === 1;

/**
 * Valida el tamaño que envía un bloque HTML. Solo se acepta:
 *  - un número (alto en px), que se limita a 24…3000
 *  - un texto como "56.25%" (alto en % del ancho), entre 0 y 300 %
 * Cualquier otra cosa → null (se ignora).
 */
export function parseEmbedSize(v) {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? { px: Math.round(Math.min(Math.max(v, 24), EMBED_MAX_PX)) } : null;
  if (typeof v === 'string' && /^\d{1,3}(\.\d{1,2})?%$/.test(v)) {
    const pct = parseFloat(v);
    return pct > 0 && pct <= 300 ? { pct } : null;
  }
  return null;
}
