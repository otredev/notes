/*
 * Formato al seleccionar texto: al marcar texto en un cuadro con formato (mensaje, edición, plantilla)
 * aparece encima una barrita con negrita, cursiva, subrayado, tachado, títulos, lista y código.
 * Los botones no quitan el foco ni la selección, así que se pueden combinar (negrita + cursiva…).
 */
import { applyFormat } from './editor.js';
import { ic } from './icons.js';

const BUTTONS = [
  ['b', '<b>B</b>', 'Negrita (Ctrl+B)'],
  ['i', '<i>I</i>', 'Cursiva (Ctrl+I)'],
  ['u', '<u>U</u>', 'Subrayado (Ctrl+U)'],
  ['s', '<s>S</s>', 'Tachado'],
  ['h1', 'H1', 'Título'],
  ['h3', 'H3', 'Subtítulo'],
  ['ul', '•', 'Lista'],
  ['code', ic('code', 'tiny'), 'Código'],
];
const TARGETS = 'textarea[data-fmt]';
let bar = null, target = null;

function ensureBar() {
  if (bar) return bar;
  bar = document.createElement('div');
  bar.id = 'sel-fmt';
  bar.className = 'sel-fmt';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Formato');
  bar.hidden = true;
  bar.innerHTML = BUTTONS.map(([v, label, title]) => `<button type="button" data-v="${v}" title="${title}" aria-label="${title}">${label}</button>`).join('');
  // pointerdown sin acción por defecto: el cuadro conserva el foco y la selección.
  bar.addEventListener('pointerdown', (e) => e.preventDefault());
  bar.addEventListener('mousedown', (e) => e.preventDefault());
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]');
    if (!b || !target) return;
    applyFormat(target, b.dataset.v);
    requestAnimationFrame(update);
  });
  document.body.appendChild(bar);
  return bar;
}

function hide() { if (bar) bar.hidden = true; target = null; }

function update() {
  const ta = document.activeElement;
  if (!ta?.matches?.(TARGETS) || ta.disabled || ta.readOnly || ta.selectionStart === ta.selectionEnd || !ta.value.slice(ta.selectionStart, ta.selectionEnd).trim()) { hide(); return; }
  target = ta;
  const b = ensureBar();
  b.hidden = false;
  // Táctil: el menú del sistema (Cortar, Copiar, Pegar…) sale encima de la selección y la web no puede
  // añadirle botones. Para que no se tapen, la barra va DEBAJO del cuadro, dentro de la página.
  if (matchMedia('(pointer: coarse)').matches) {
    const anchor = ta.id === 'composer-input' ? document.getElementById('composer') : ta;
    if (anchor && b.previousElementSibling !== anchor) anchor.after(b);
    b.classList.add('docked');
    b.style.top = b.style.left = '';
    return;
  }
  if (b.parentElement !== document.body) document.body.appendChild(b);
  b.classList.remove('docked');
  // Encima del cuadro (o debajo si no cabe arriba), dentro de la pantalla.
  const r = ta.getBoundingClientRect(), vv = window.visualViewport;
  const top0 = vv ? vv.offsetTop : 0, w = b.offsetWidth, h = b.offsetHeight;
  let top = r.top - h - 8;
  if (top < top0 + 4) top = Math.min(r.bottom + 8, (vv ? vv.offsetTop + vv.height : innerHeight) - h - 4);
  const left = Math.max(8, Math.min(r.left + Math.min(24, r.width / 2), innerWidth - w - 8));
  b.style.top = `${Math.round(top)}px`;
  b.style.left = `${Math.round(left)}px`;
}

export function bindSelectionFormat() {
  const later = () => requestAnimationFrame(update);
  document.addEventListener('selectionchange', later);
  // (no todos los navegadores avisan de la selección dentro de un textarea con selectionchange)
  for (const ev of ['select', 'keyup', 'mouseup', 'touchend', 'input']) document.addEventListener(ev, (e) => { if (e.target?.matches?.(TARGETS) || ev === 'mouseup') later(); }, true);
  document.addEventListener('focusout', (e) => { if (e.target === target) setTimeout(update, 0); });
  window.addEventListener('resize', () => bar && !bar.hidden && update());
  window.visualViewport?.addEventListener('resize', () => bar && !bar.hidden && update());
  document.addEventListener('scroll', () => bar && !bar.hidden && update(), true);
}
