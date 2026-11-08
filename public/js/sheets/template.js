/* Plantillas: textos reutilizables que se insertan en el cuadro de texto. Se sincronizan entre dispositivos. */
import { $, uid, esc, plain } from '../utils.js';
import { ic } from '../icons.js';
import { S } from '../state.js';
import { put, remove, tplSorted } from '../data/store.js';
import { sheet, closeSheet, toast } from '../ui/dom.js';
import { renderPane } from '../views/pane.js';
import { autosize, updateSendBtn } from '../views/chat.js';

const preview = (t) => esc(plain(t).replace(/\s+/g, ' ').trim().slice(0, 80));

/** Inserta una plantilla en el cuadro de texto, donde esté el cursor. */
export function insertTemplate(t) {
  const ta = $('#composer-input');
  if (!ta) return;
  ta.focus();
  const { selectionStart: a, selectionEnd: b, value: v } = ta;
  const before = a > 0 && v[a - 1] !== '\n' ? '\n' : '';
  ta.setRangeText(before + t.text, a, b, 'end');
  // El cursor se queda en la primera casilla vacía, si la hay.
  const firstEmpty = ta.value.indexOf('[ ] \n', a);
  if (firstEmpty >= 0) ta.setSelectionRange(firstEmpty + 4, firstEmpty + 4);
  autosize(ta);
  updateSendBtn();
}

/** Elegir una plantilla para el mensaje que se está escribiendo. */
export function templatePicker() {
  const list = tplSorted();
  const rows = list.map((t) => `<button class="pick tpl-pick" data-s="use" data-id="${t.id}">${ic('template')}<span class="grow"><b>${esc(t.name)}</b><small class="muted">${preview(t.text)}</small></span></button>`).join('');
  sheet('Plantillas', `${rows ? `<div class="pick-list">${rows}</div>` : '<p class="muted">Todavía no tienes plantillas.</p>'}`, {
    actions: '<button class="btn ghost" data-s="new">+ Nueva plantilla</button><span class="grow"></span>',
    onMount: (sh) => sh.addEventListener('click', (e) => {
      const b = e.target.closest('[data-s]');
      if (!b) return;
      if (b.dataset.s === 'new') { templateSheet(null, { fromComposer: true }); return; }
      const t = S.templates.find((x) => x.id === b.dataset.id);
      closeSheet();
      if (t) insertTemplate(t);
    }),
  });
}

/** Crear o editar una plantilla. `fromComposer`: propone el texto que hay escrito. */
export function templateSheet(id, { fromComposer = false } = {}) {
  const orig = id ? S.templates.find((t) => t.id === id) : null;
  const draft = !orig && fromComposer ? ($('#composer-input')?.value || '') : '';
  const body = `<label class="field"><span>Nombre</span><input id="t-name" maxlength="60" value="${esc(orig?.name || '')}" placeholder="Ej. Reunión" autocomplete="off"></label>
    <div class="field"><span>Texto</span>
      <textarea id="t-text" data-fmt rows="7" placeholder="Selecciona texto para darle formato. Casillas [ ] y atajos como !cada lunes 9:00">${esc(orig?.text ?? draft)}</textarea></div>`;
  sheet(orig ? 'Editar plantilla' : 'Nueva plantilla', body, {
    actions: `${orig ? `<button class="btn danger ghost" data-s="del">${ic('trash', 'tiny')} Eliminar</button>` : ''}<span class="grow"></span>
      <button class="btn ghost" data-act="sheet-close">Cancelar</button><button class="btn primary" data-s="save">Guardar</button>`,
    onMount: (sh) => {
      sh.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-s]');
        if (!b) return;
        if (b.dataset.s === 'del') {
          await remove('templates', orig.id);
          closeSheet();
          renderPane(true);
          toast('Plantilla eliminada', { action: 'Deshacer', fn: async () => { await put('templates', orig); renderPane(true); } });
        }
        if (b.dataset.s === 'save') {
          const name = $('#t-name', sh).value.trim(), text = $('#t-text', sh).value;
          if (!name) { $('#t-name', sh).focus(); toast('Ponle un nombre'); return; }
          if (!text.trim()) { toast('La plantilla está vacía'); return; }
          const now = Date.now();
          await put('templates', { ...(orig || { id: uid(), createdAt: now, order: S.templates.length }), name, text });
          closeSheet();
          renderPane(true);
          toast('Plantilla guardada');
        }
      });
      setTimeout(() => $(orig ? '#t-text' : '#t-name', sh).focus(), 60);
    },
  });
}
