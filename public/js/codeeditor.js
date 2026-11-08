/*
 * Editor de código ligero: números de línea, resaltado, ajuste de línea opcional,
 * sangría automática al pulsar Enter y Tab / Mayús+Tab para sangrar o quitar sangría.
 * Técnica: un <textarea> transparente encima de un <pre> resaltado, los dos del mismo alto
 * (el textarea crece con el contenido), dentro de un único contenedor con scroll.
 */
import { highlightLines } from './highlight.js';

const IND = '  ';
const WRAP_KEY = 'retrodark-code-wrap';

const readWrap = () => { try { return localStorage.getItem(WRAP_KEY) !== '0'; } catch { return true; } };
const saveWrap = (v) => { try { localStorage.setItem(WRAP_KEY, v ? '1' : '0'); } catch { /* sin almacenamiento */ } };

/** Inserta texto manteniendo el deshacer (Ctrl+Z) donde el navegador lo permite. */
function insert(ta, text, start = ta.selectionStart, end = ta.selectionEnd) {
  ta.setSelectionRange(start, end);
  if (!document.execCommand?.('insertText', false, text)) {
    ta.setRangeText(text, start, end, 'end');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

/**
 * Crea el editor dentro de `host`. Devuelve { get value, set value, focus(), setWrap(bool), wrap }.
 * `onChange(value)` se llama con cada cambio.
 */
export function createCodeEditor(host, { value = '', lang = 'html', placeholder = '', onChange } = {}) {
  host.classList.add('ce');
  host.innerHTML = `<div class="ce-scroll"><div class="ce-gutter" aria-hidden="true"></div>
    <div class="ce-body"><pre class="ce-hl" aria-hidden="true"><code></code></pre>
    <textarea class="ce-ta" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" wrap="soft" placeholder="${placeholder.replace(/"/g, '&quot;')}" aria-label="Código"></textarea></div></div>`;
  const scroll = host.querySelector('.ce-scroll'), gutter = host.querySelector('.ce-gutter');
  const code = host.querySelector('.ce-hl code'), ta = host.querySelector('.ce-ta');
  ta.value = value;
  let wrap = readWrap();

  function render() {
    code.innerHTML = highlightLines(ta.value, lang, { block: true });
    const lines = code.querySelectorAll('.ln');
    // Con ajuste de línea una línea puede ocupar varias filas: cada número toma el alto de su línea.
    gutter.innerHTML = [...lines].map((l, i) => `<span style="height:${wrap ? `${l.offsetHeight}px` : 'auto'}">${i + 1}</span>`).join('');
    ta.style.height = '0px';
    ta.style.height = `${Math.max(code.parentElement.offsetHeight, ta.scrollHeight)}px`;
  }
  function setWrap(v) {
    wrap = !!v;
    saveWrap(wrap);
    host.classList.toggle('ce-wrap', wrap);
    render();
  }

  ta.addEventListener('input', () => { render(); onChange?.(ta.value); });
  ta.addEventListener('keydown', (e) => {
    const { value: v, selectionStart: a, selectionEnd: b } = ta;
    if (e.key === 'Tab') {
      e.preventDefault();
      const ls = v.lastIndexOf('\n', a - 1) + 1;
      if (!e.shiftKey && a === b) { insert(ta, IND); return; }
      // Varias líneas (o Mayús+Tab): se sangran / se les quita la sangría.
      let le = v.indexOf('\n', b - (b > a && v[b - 1] === '\n' ? 1 : 0));
      if (le < 0) le = v.length;
      const block = v.slice(ls, le).split('\n');
      const out = block.map((l) => (e.shiftKey ? l.replace(/^( {1,2}|\t)/, '') : IND + l)).join('\n');
      insert(ta, out, ls, le);
      ta.setSelectionRange(ls, ls + out.length);
      return;
    }
    if (e.key === 'Enter' && !e.isComposing && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const ls = v.lastIndexOf('\n', a - 1) + 1;
      const indent = v.slice(ls, a).match(/^[ \t]*/)[0];
      const before = v.slice(ls, a), after = v.slice(b);
      // Más sangría tras abrir una etiqueta, { ( o [.
      const opens = /[{([]\s*$/.test(before) || (/<([a-z][\w-]*)\b[^>]*>\s*$/i.test(before) && !/<\/|\/>\s*$/.test(before.slice(before.lastIndexOf('<')))
        && !/^<(br|hr|img|input|meta|link|area|base|col|embed|source|track|wbr)\b/i.test(before.slice(before.lastIndexOf('<'))));
      const closes = /^\s*([})\]]|<\/)/.test(after);
      if (opens && closes) {
        insert(ta, `\n${indent}${IND}\n${indent}`);
        const pos = a + 1 + indent.length + IND.length;
        ta.setSelectionRange(pos, pos);
      } else insert(ta, `\n${indent}${opens ? IND : ''}`);
      return;
    }
  });
  // Al girar el móvil o cambiar el ancho, el ajuste de línea cambia los altos.
  if (window.ResizeObserver) new ResizeObserver(() => wrap && render()).observe(scroll);

  host.classList.toggle('ce-wrap', wrap);
  requestAnimationFrame(render);
  return {
    get value() { return ta.value; },
    set value(v) { ta.value = v; render(); },
    get wrap() { return wrap; },
    setWrap,
    focus(at = 'end') {
      ta.focus({ preventScroll: true });
      if (at === 'end') ta.setSelectionRange(ta.value.length, ta.value.length);
      if (at === 'all') ta.select();
    },
    textarea: ta,
  };
}
