/* Hoja para crear o editar un grupo de chats. */
import { $, uid, esc } from '../utils.js';
import { S } from '../state.js';
import { chatById, put, remove } from '../data/store.js';
import { sheet, closeSheet, toast } from '../ui/dom.js';
import { avatar } from '../ui/parts.js';
import { refreshAll } from '../render.js';

export function groupSheet(id) {
  const g = id ? S.groups.find((x) => x.id === id) : null;
  const rows = S.chats.map((c) => {
    const other = c.groupId && (!g || c.groupId !== g.id) ? S.groups.find((x) => x.id === c.groupId)?.name : '';
    return `<label><input type="checkbox" value="${c.id}" ${g && c.groupId === g.id ? 'checked' : ''}>${avatar(c, 'sm')}
      <span class="grow">${esc(c.name)}</span>${other ? `<small class="muted">en ${esc(other)}</small>` : ''}</label>`;
  }).join('');
  const body = `<label class="field"><span>Nombre</span><input id="g-name" value="${esc(g?.name || '')}" placeholder="Ej. Trabajo" maxlength="40" autocomplete="off"></label>
    <div class="field"><span>Chats en este grupo</span><div class="check-list">${rows}</div></div>`;

  sheet(g ? 'Editar grupo' : 'Nuevo grupo', body, {
    actions: `${g ? '<button class="btn danger ghost" data-s="del">Eliminar</button>' : ''}<span class="grow"></span><button class="btn ghost" data-act="sheet-close">Cancelar</button><button class="btn primary" data-s="save">Guardar</button>`,
    onMount: (sh) => {
      setTimeout(() => $('#g-name', sh).focus(), 60);
      sh.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-s]');
        if (!b) return;
        if (b.dataset.s === 'del') {
          for (const c of S.chats.filter((x) => x.groupId === g.id)) { c.groupId = null; await put('chats', c); }
          await remove('groups', g.id);
          if (S.groupFilter === g.id) S.groupFilter = 'all';
          closeSheet();
          refreshAll();
          toast('Grupo eliminado');
          return;
        }
        const name = $('#g-name', sh).value.trim();
        if (!name) { toast('Ponle un nombre al grupo'); return; }
        const data = g ? { ...g, name } : { id: uid(), name, order: S.groups.length, createdAt: Date.now() };
        await put('groups', data);
        for (const box of sh.querySelectorAll('.check-list input')) {
          const c = chatById(box.value);
          if (!c) continue;
          if (box.checked && c.groupId !== data.id) { c.groupId = data.id; await put('chats', c); }
          else if (!box.checked && c.groupId === data.id) { c.groupId = null; await put('chats', c); }
        }
        closeSheet();
        refreshAll();
      });
    },
  });
}
