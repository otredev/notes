/* Hojas para crear, editar y eliminar chats. */
import { $, uid, esc, isMobile, byOrder } from '../utils.js';
import { COLORS, EMOJIS, TYPES } from '../constants.js';
import { S } from '../state.js';
import { splitTags } from '../text.js';
import { chatById, msgsOf, put, remove, trashMessages } from '../data/store.js';
import { sheet, closeSheet, toast } from '../ui/dom.js';
import { avatar } from '../ui/parts.js';
import { refreshAll } from '../render.js';
import { openChat, closeChat } from '../actions.js';
import { buildMain } from '../views/chat.js';

export function chatSheet(id) {
  const orig = id ? chatById(id) : null;
  const isGeneral = id === 'general';
  const presetGroup = S.groupFilter !== 'all' && S.groupFilter !== 'pinned' ? S.groupFilter : null;
  const c = orig
    ? { ...orig, tags: [...(orig.tags || [])] }
    : { name: '', emoji: '📝', color: COLORS[1], type: 'notes', groupId: presetGroup, tags: [], desc: '', pinned: false };
  const st = { emoji: c.emoji, color: c.color, type: c.type };

  let stats = '';
  if (orig) {
    const ms = msgsOf(id), tk = ms.filter((m) => m.kind === 'task');
    stats = `<div class="stats"><div><b>${ms.filter((m) => m.kind === 'message').length}</b>mensajes</div><div><b>${ms.filter((m) => m.kind === 'note').length}</b>notas</div><div><b>${tk.filter((m) => m.done).length}/${tk.length}</b>tareas</div></div>`;
  }

  const body = `
    <div class="chat-preview"><span id="cp-avatar">${avatar(c, 'lg')}</span>
      <label class="field grow"><span>Nombre</span><input id="c-name" value="${esc(c.name)}" placeholder="Ej. Proyecto casa" maxlength="60" autocomplete="off"></label></div>
    ${stats}
    <div class="field"><span>Tipo</span><div class="seg">${Object.entries(TYPES).map(([k, v]) => `<button data-s="type" data-v="${k}" class="${c.type === k ? 'on' : ''}">${v.icon} ${v.label}</button>`).join('')}</div>
      <small class="muted" id="c-type-hint">${TYPES[c.type].hint}</small></div>
    <div class="field"><span>Icono</span><div class="emoji-grid">${EMOJIS.map((e) => `<button data-s="emoji" data-v="${e}" class="${c.emoji === e ? 'on' : ''}">${e}</button>`).join('')}</div>
      <input id="c-emoji" maxlength="8" placeholder="…o escribe otro emoji" value="${EMOJIS.includes(c.emoji) ? '' : esc(c.emoji)}" autocomplete="off"></div>
    <div class="field"><span>Color</span><div class="color-row">${COLORS.map((col) => `<button data-s="color" data-v="${col}" style="--c:${col}" class="${c.color === col ? 'on' : ''}" aria-label="Color ${col}"></button>`).join('')}</div></div>
    <label class="field"><span>Grupo</span><select id="c-group"><option value="">Sin grupo</option>${[...S.groups].sort(byOrder).map((g) => `<option value="${g.id}" ${c.groupId === g.id ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select></label>
    ${isGeneral ? '' : `<label class="field"><span>Etiquetas vinculadas</span><input id="c-tags" value="${esc(c.tags.join(', '))}" placeholder="compras, super" autocomplete="off">
      <small class="muted">Lo que escribas en General con estas #etiquetas llegará aquí automáticamente.</small></label>`}
    <label class="field"><span>Descripción</span><textarea id="c-desc" rows="2" placeholder="Opcional">${esc(c.desc || '')}</textarea></label>
    ${isGeneral ? '' : `<div class="field row"><label class="toggle"><input type="checkbox" id="c-pin" ${c.pinned ? 'checked' : ''}> Fijar arriba en la lista</label>
      ${orig ? `<label class="toggle"><input type="checkbox" id="c-arch" ${c.archived ? 'checked' : ''}> Archivado</label>` : ''}</div>
      <small class="muted">Los chats archivados no salen en la lista (filtro "Archivados"), pero siguen recibiendo lo de sus etiquetas.</small>`}`;

  sheet(orig ? 'Información del chat' : 'Nuevo chat', body, {
    actions: `${orig && !isGeneral ? '<button class="btn danger ghost" data-s="del">Eliminar</button>' : ''}<span class="grow"></span><button class="btn ghost" data-act="sheet-close">Cancelar</button><button class="btn primary" data-s="save">${orig ? 'Guardar' : 'Crear chat'}</button>`,
    onMount: (sh) => {
      const updateAvatar = () => { $('#cp-avatar', sh).innerHTML = avatar({ emoji: st.emoji, color: st.color }, 'lg'); };
      $('#c-emoji', sh).addEventListener('input', (e) => {
        const v = e.target.value.trim();
        if (!v) return;
        st.emoji = v;
        sh.querySelectorAll('[data-s=emoji]').forEach((x) => x.classList.remove('on'));
        updateAvatar();
      });
      sh.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-s]');
        if (!b) return;
        const s = b.dataset.s;
        if (s === 'type' || s === 'emoji' || s === 'color') {
          st[s] = b.dataset.v;
          sh.querySelectorAll(`[data-s=${s}]`).forEach((x) => x.classList.toggle('on', x === b));
          if (s === 'type') $('#c-type-hint', sh).textContent = TYPES[st.type].hint;
          if (s === 'emoji') $('#c-emoji', sh).value = '';
          updateAvatar();
          return;
        }
        if (s === 'del') { deleteChatSheet(orig); return; }
        if (s === 'save') {
          const name = $('#c-name', sh).value.trim();
          if (!name) { $('#c-name', sh).focus(); toast('Ponle un nombre al chat'); return; }
          const data = {
            ...(orig || { id: uid(), createdAt: Date.now() }),
            name, emoji: st.emoji, color: st.color, type: st.type,
            groupId: $('#c-group', sh).value || null, desc: $('#c-desc', sh).value.trim(),
            tags: isGeneral ? [] : splitTags($('#c-tags', sh).value),
            pinned: isGeneral ? true : $('#c-pin', sh).checked,
            archived: !isGeneral && !!$('#c-arch', sh)?.checked,
          };
          await put('chats', data);
          closeSheet();
          if (!orig) { openChat(data.id); toast('Chat creado'); }
          refreshAll();
        }
      });
      if (!orig) setTimeout(() => $('#c-name', sh).focus(), 60);
    },
  });
}

function deleteChatSheet(c) {
  const n = msgsOf(c.id).length;
  const body = `<p>¿Eliminar <b>${esc(`${c.emoji} ${c.name}`)}</b>?</p>${n ? `<p class="muted">Tiene ${n} mensaje${n > 1 ? 's' : ''}. Puedes moverlos a General, o se irán a la Papelera (30 días para recuperarlos).</p>` : ''}`;
  sheet('Eliminar chat', body, {
    actions: `<button class="btn ghost" data-act="sheet-close">Cancelar</button><span class="grow"></span>${n ? '<button class="btn outline" data-s="move">Mover a General</button>' : ''}<button class="btn danger" data-s="all">Eliminar${n ? ' todo' : ''}</button>`,
    onMount: (sh) => sh.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-s]');
      if (!b) return;
      for (const m of msgsOf(c.id)) {
        if (b.dataset.s === 'move') { m.chatId = 'general'; await put('messages', m); }
      }
      // Sus mensajes van a la papelera (al recuperarlos vuelven a General).
      if (b.dataset.s !== 'move') await trashMessages(msgsOf(c.id).map((m) => m.id));
      await remove('chats', c.id);
      closeSheet();
      if (S.active === c.id) {
        if (isMobile()) { S.active = null; closeChat(); buildMain(); } else openChat('general');
      }
      refreshAll();
      toast('Chat eliminado');
    }),
  });
}
