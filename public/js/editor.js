/* Formato: aplica negrita, títulos, listas, código… al cuadro de texto (lo usan la barra de selección y los atajos). */

const INLINE = { b: '*', i: '_', u: '__', s: '~', code: '`' };
const LINE = { h1: '# ', h3: '### ', ul: '- ', chk: '[ ] ' };
const LINE_MARK = /^\s*(?:[-•]\s+|\[[ xX]?\]\s?)/; // viñeta o casilla al principio de la línea
const HEADINGS = /^(#{1,3})\s+/;

/** Reemplaza un trozo del textarea y avisa (para el autoajuste de alto y el botón de enviar). */
function replace(ta, start, end, text, selStart, selEnd) {
  ta.focus();
  ta.setSelectionRange(start, end);
  // execCommand mantiene el deshacer (Ctrl+Z) donde está disponible.
  if (!document.execCommand?.('insertText', false, text)) ta.setRangeText(text, start, end, 'end');
  ta.setSelectionRange(selStart, selEnd);
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}

function wrapInline(ta, mark) {
  const { value: v, selectionStart: a, selectionEnd: b } = ta;
  const sel = v.slice(a, b);
  // Ya está envuelto → se quita.
  if (v.slice(a - mark.length, a) === mark && v.slice(b, b + mark.length) === mark) {
    replace(ta, a - mark.length, b + mark.length, sel, a - mark.length, b - mark.length);
    return;
  }
  if (sel.startsWith(mark) && sel.endsWith(mark) && sel.length >= mark.length * 2) {
    const inner = sel.slice(mark.length, sel.length - mark.length);
    replace(ta, a, b, inner, a, a + inner.length);
    return;
  }
  // Los espacios de los bordes se quedan fuera (*hola* y no * hola *).
  const lead = sel.match(/^\s*/)[0], trail = sel.match(/\s*$/)[0];
  const core = sel.trim();
  replace(ta, a, b, `${lead}${mark}${core}${mark}${trail}`, a + lead.length + mark.length, a + lead.length + mark.length + core.length);
}

function prefixLines(ta, prefix) {
  const v = ta.value;
  const start = v.lastIndexOf('\n', ta.selectionStart - 1) + 1;
  let end = v.indexOf('\n', ta.selectionEnd);
  if (end < 0) end = v.length;
  const lines = v.slice(start, end).split('\n');
  const isHeading = prefix.startsWith('#'), isCheck = prefix === LINE.chk;
  // Si todas ya lo tienen, se quita (una casilla marcada [x] también cuenta como casilla).
  const has = (l) => (isCheck ? /^\s*\[[ xX]?\]\s?/.test(l) : l.startsWith(prefix));
  const all = lines.every(has);
  const out = lines.map((l) => {
    if (all) return isCheck ? l.replace(/^\s*\[[ xX]?\]\s?/, '') : l.slice(prefix.length);
    const clean = isHeading ? l.replace(HEADINGS, '') : l.replace(LINE_MARK, '');
    return prefix + clean;
  }).join('\n');
  replace(ta, start, end, out, start + out.length, start + out.length);
}

function codeBlock(ta, lang) {
  const { value: v, selectionStart: a, selectionEnd: b } = ta;
  const sel = v.slice(a, b);
  const before = a > 0 && v[a - 1] !== '\n' ? '\n' : '';
  const body = sel || (lang === 'html' ? '<h3>Hola 👋</h3>\n<button onclick="this.textContent=\'¡Funciona!\'">Púlsame</button>' : '');
  const text = `${before}\`\`\`${lang}\n${body}\n\`\`\`\n`;
  const bodyStart = a + before.length + 3 + lang.length + 1;
  replace(ta, a, b, text, bodyStart, bodyStart + body.length);
}

/** Aplica un formato (b, i, u, s, code, h1, h3, ul, html) al textarea. */
export function applyFormat(ta, v) {
  if (!ta) return;
  if (v === 'code' && ta.value.slice(ta.selectionStart, ta.selectionEnd).includes('\n')) return codeBlock(ta, '');
  if (INLINE[v]) return wrapInline(ta, INLINE[v]);
  if (LINE[v]) return prefixLines(ta, LINE[v]);
}

/** Atajos de teclado dentro de un textarea con formato. Devuelve true si lo gestionó. */
export function formatShortcut(e) {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return false;
  const v = { b: 'b', i: 'i', u: 'u' }[e.key.toLowerCase()];
  if (!v) return false;
  e.preventDefault();
  applyFormat(e.target, v);
  return true;
}
