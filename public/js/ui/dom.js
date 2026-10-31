/* Avisos (toast) y hojas modales. */
import { $, esc } from '../utils.js';
import { ic } from '../icons.js';

let toastTimer;
export function toast(text, opt = {}) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(text)}</span>${opt.action ? `<button id="toast-act">${esc(opt.action)}</button>` : ''}`;
  el.classList.add('show');
  if (opt.action) $('#toast-act').onclick = () => { el.classList.remove('show'); opt.fn(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), opt.action ? 5000 : 3000);
}

export function copyText(t) {
  if (!navigator.clipboard) return toast('No se pudo copiar');
  navigator.clipboard.writeText(t).then(() => toast('Copiado')).catch(() => toast('No se pudo copiar'));
}

let onCloseCb = null;

/**
 * Abre una hoja modal. `onMount(sheetEl)` recibe el elemento para añadir eventos;
 * `onClose()` se llama al cerrarla (por cualquier motivo).
 */
export function sheet(title, body, { onMount, onClose, actions = '' } = {}) {
  const prev = onCloseCb;
  onCloseCb = null;
  prev?.();
  onCloseCb = onClose || null;
  const root = $('#sheet-root');
  root.innerHTML = `<div class="sheet-backdrop" data-act="sheet-close"></div>
    <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="sheet-head"><h3>${esc(title)}</h3><button class="icon-btn" data-act="sheet-close" aria-label="Cerrar">${ic('close')}</button></div>
      <div class="sheet-body">${body}</div>
      ${actions ? `<div class="sheet-actions">${actions}</div>` : ''}
    </div>`;
  root.classList.add('open');
  onMount?.(root.querySelector('.sheet'));
}

export function closeSheet() {
  const root = $('#sheet-root');
  root.classList.remove('open');
  root.innerHTML = '';
  const cb = onCloseCb;
  onCloseCb = null;
  cb?.();
}

export const isSheetOpen = () => $('#sheet-root').classList.contains('open');

export function confirmSheet(text, okLabel, cb) {
  sheet('Confirmar', `<p>${esc(text)}</p>`, {
    actions: `<span class="grow"></span><button class="btn ghost" data-act="sheet-close">Cancelar</button><button class="btn danger" data-s="ok">${esc(okLabel)}</button>`,
    onMount: (sh) => sh.addEventListener('click', (e) => { if (e.target.closest('[data-s=ok]')) { closeSheet(); cb(); } }),
  });
}

/** Lista de opciones; `items` = [{ id, html }]. */
export function pickSheet(title, items, cb) {
  sheet(title, `<div class="pick-list">${items.map((i) => `<button class="pick" data-s="pick" data-id="${i.id}">${i.html}</button>`).join('')}</div>`, {
    onMount: (sh) => sh.addEventListener('click', (e) => {
      const b = e.target.closest('[data-s=pick]');
      if (b) { closeSheet(); cb(b.dataset.id); }
    }),
  });
}
