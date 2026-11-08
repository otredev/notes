/*
 * Resaltado de código sencillo (HTML con su <style> y <script>, CSS y JavaScript). Sin dependencias.
 * Devuelve HTML seguro: todo el texto va escapado y solo se añaden <span class="t-…">.
 *   t-k palabra clave · t-s texto · t-c comentario · t-n número · t-f función · t-t etiqueta · t-a atributo · t-p propiedad
 */
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const span = (cls, s) => (s ? `<span class="${cls}">${esc(s)}</span>` : '');

const JS_KW = new Set(('break case catch class const continue debugger default delete do else export extends finally for function if import in instanceof let new of return super switch this throw try typeof var void while with yield async await true false null undefined NaN Infinity').split(' '));

function js(code) {
  const re = /(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|("(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?|`(?:\\[\s\S]|[^`\\])*`?)|(\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b|\b0x[\da-f]+\b)|([A-Za-z_$][\w$]*)(?=\s*\()|([A-Za-z_$][\w$]*)/gi;
  let out = '', last = 0, m;
  while ((m = re.exec(code))) {
    out += esc(code.slice(last, m.index));
    if (m[1]) out += span('t-c', m[1]);
    else if (m[2]) out += span('t-s', m[2]);
    else if (m[3]) out += span('t-n', m[3]);
    else if (m[4]) out += JS_KW.has(m[4]) ? span('t-k', m[4]) : span('t-f', m[4]);
    else out += JS_KW.has(m[5]) ? span('t-k', m[5]) : esc(m[5]);
    last = re.lastIndex;
  }
  return out + esc(code.slice(last));
}

function css(code) {
  const re = /(\/\*[\s\S]*?(?:\*\/|$))|("(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?)|(@[\w-]+)|(#[\da-f]{3,8}\b|-?\b\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|s|ms|deg|fr)?)|([\w-]+)(?=\s*:(?![^{]*\{))|([\w-]+)(?=\s*\()/gi;
  let out = '', last = 0, m;
  while ((m = re.exec(code))) {
    out += esc(code.slice(last, m.index));
    if (m[1]) out += span('t-c', m[1]);
    else if (m[2]) out += span('t-s', m[2]);
    else if (m[3]) out += span('t-k', m[3]);
    else if (m[4]) out += span('t-n', m[4]);
    else if (m[5]) out += span('t-p', m[5]);
    else out += span('t-f', m[6]);
    last = re.lastIndex;
  }
  return out + esc(code.slice(last));
}

function tag(t) {
  // <nombre atributo="valor" …>
  const m = t.match(/^(<\/?)([\w:-]*)([\s\S]*?)(\/?>?)$/);
  if (!m) return esc(t);
  const attrs = m[3].replace(/([^\s=]+)(\s*=\s*)?("[^"]*"?|'[^']*'?|[^\s>]+)?/g, (all, name, eq, val) => {
    // (se trabaja sobre texto sin escapar y se escapa cada trozo)
    return `\u0001${name}\u0002${eq || ''}\u0003${val || ''}\u0004`;
  });
  const attrHtml = attrs.split(/(\u0001[^\u0004]*\u0004)/).map((p) => {
    const a = p.match(/^\u0001([^\u0002]*)\u0002([^\u0003]*)\u0003([^\u0004]*)\u0004$/);
    return a ? span('t-a', a[1]) + esc(a[2]) + span('t-s', a[3]) : esc(p);
  }).join('');
  return esc(m[1]) + span('t-t', m[2]) + attrHtml + esc(m[4]);
}

function html(code) {
  const re = /(<!--[\s\S]*?(?:-->|$))|(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>|$)|(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>|$)|(<\/?[\w:-]+(?:\s+(?:[^\s=>"']+(?:\s*=\s*(?:"[^"]*"?|'[^']*'?|[^\s>]+))?))*\s*\/?>?)|(&[#\w]+;)/gi;
  let out = '', last = 0, m;
  while ((m = re.exec(code))) {
    out += esc(code.slice(last, m.index));
    if (m[1]) out += span('t-c', m[1]);
    else if (m[2]) out += tag(m[2]) + js(m[3]) + (m[4] ? tag(m[4]) : '');
    else if (m[5]) out += tag(m[5]) + css(m[6]) + (m[7] ? tag(m[7]) : '');
    else if (m[8]) out += tag(m[8]);
    else out += span('t-n', m[9]);
    last = re.lastIndex;
    if (!m[0]) re.lastIndex++;
  }
  return out + esc(code.slice(last));
}

const LANGS = { html, htm: html, xml: html, svg: html, js, javascript: js, json: js, ts: js, css };

/** Código → HTML resaltado (lenguaje desconocido: se trata como JavaScript, que sirve para la mayoría). */
export function highlight(code, lang = '') {
  const fn = LANGS[String(lang).toLowerCase()] || (/^\s*</.test(code) ? html : js);
  return fn(String(code));
}

/**
 * Igual, pero una línea por <span class="ln"> (para numerarlas con CSS sin que el número se copie).
 * `block`: para el editor (líneas como bloques, sin saltos entre ellas y con las vacías rellenas).
 */
export function highlightLines(code, lang = '', { block = false } = {}) {
  // Se resalta todo junto (un comentario puede ocupar varias líneas) y luego se corta por líneas
  // cerrando y reabriendo los <span> que queden abiertos.
  const h = highlight(code, lang);
  const lines = [];
  let open = [], cur = '';
  const tokens = h.split(/(<span class="[^"]+">|<\/span>|\n)/);
  for (const t of tokens) {
    if (t === '\n') { cur += '</span>'.repeat(open.length); lines.push(cur); cur = open.join(''); continue; }
    if (t.startsWith('<span')) open.push(t);
    else if (t === '</span>') open.pop();
    cur += t;
  }
  lines.push(cur + '</span>'.repeat(open.length));
  return lines.map((l) => `<span class="ln">${l || (block ? '\u200b' : '')}</span>`).join(block ? '' : '\n');
}
