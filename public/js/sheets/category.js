/* Hoja para crear o editar una categoría. */
import { $, uid, esc, norm } from '../utils.js';
import { COLORS } from '../constants.js';
import { S } from '../state.js';
import { catById, put, remove } from '../data/store.js';
import { sheet, closeSheet, toast } from '../ui/dom.js';
import { refreshAll } from '../render.js';

export function categorySheet(id) {
  const c = id ? catById(id) : null;
  let color = c?.color || COLORS[(S.categories.length + 1) % COLORS.length];
  const n = c ? S.messages.filter((m) => m.categoryId === c.id).length : 0;
  const hint = c
    ? `${n} mensaje${n === 1 ? '' : 's'} con esta categoría. Escribe <b>@${esc(norm(c.name))}</b> al enviar para asignarla.`
    : 'Después podrás asignarla escribiendo @nombre en un mensaje.';
  const body = `<label class="field"><span>Nombre</span><input id="k-name" value="${esc(c?.name || '')}" placeholder="Ej. Salud" maxlength="30" autocomplete="off"></label>
    <div class="field"><span>Color</span><div class="color-row">${COLORS.map((col) => `<button data-s="color" data-v="${col}" style="--c:${col}" class="${color === col ? 'on' : ''}" aria-label="Color ${col}"></button>`).join('')}</div></div>
    <p class="muted small">${hint}</p>`;

  sheet(c ? 'Editar categoría' : 'Nueva categoría', body, {
    actions: `${c ? '<button class="btn danger ghost" data-s="del">Eliminar</button>' : ''}<span class="grow"></span><button class="btn ghost" data-act="sheet-close">Cancelar</button><button class="btn primary" data-s="save">Guardar</button>`,
    onMount: (sh) => {
      setTimeout(() => $('#k-name', sh).focus(), 60);
      sh.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-s]');
        if (!b) return;
        const s = b.dataset.s;
        if (s === 'color') {
          color = b.dataset.v;
          sh.querySelectorAll('[data-s=color]').forEach((x) => x.classList.toggle('on', x === b));
          return;
        }
        if (s === 'del') {
          for (const m of S.messages.filter((x) => x.categoryId === c.id)) { m.categoryId = null; await put('messages', m); }
          await remove('categories', c.id);
          closeSheet();
          refreshAll();
          toast('Categoría eliminada');
          return;
        }
        const name = $('#k-name', sh).value.trim();
        if (!name) { toast('Ponle un nombre a la categoría'); return; }
        if (S.categories.some((k) => k.id !== c?.id && norm(k.name) === norm(name))) { toast('Ya existe una categoría con ese nombre'); return; }
        await put('categories', { ...(c || { id: uid(), order: S.categories.length, createdAt: Date.now() }), name, color });
        closeSheet();
        refreshAll();
      });
    },
  });
}
