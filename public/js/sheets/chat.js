/* Hojas para crear, editar y eliminar chats. */
import { $, uid, esc, isMobile, byOrder } from '../utils.js';
import { COLORS, EMOJIS, TYPES } from '../constants.js';
import { S } from '../state.js';
import { splitTags } from '../text.js';
import { chatById, msgsOf, put, remove, trashMessages } from '../data/store.js';
import { sheet, closeSheet, toast, confirmSheet } from '../ui/dom.js';
import { avatar } from '../ui/parts.js';
import { refreshAll } from '../render.js';
import { openChat, closeChat } from '../actions.js';
import { buildMain } from '../views/chat.js';
import { hasPin, pinSetupSheet, requireUnlock } from '../lock.js';
import { membersOf, isChatAdmin, isChatOwner, myId } from '../people.js';
import { api, syncNow } from '../data/sync.js';
import { personDot, isOwnerUser, multiUser, inviteLink } from '../views/account.js';
import { pickSheet } from '../ui/dom.js';
import { ic } from '../icons.js';

/** Miembros del chat: lista, roles y (si eres admin) añadir, sacar y "solo admins". */
function membersHtml(c) {
  const admin = isChatAdmin(c);
  const rows = membersOf(c).map((p) => {
    const owner = p.id === (c.ownerId || 'owner');
    const me = p.id === myId();
    return `<div class="member-row">${personDot(p)}<span class="grow"><b>${esc(me ? 'Tú' : p.name)}</b> <span class="muted small">@${esc(p.handle || '')}</span>
      ${p.role === 'admin' ? '<span class="role-chip">Admin</span>' : ''}</span>
      ${admin && !me && !owner ? `<button class="btn ghost" data-s="m-role" data-v="${p.id}" data-r="${p.role === 'admin' ? 'member' : 'admin'}">${p.role === 'admin' ? 'Quitar admin' : 'Hacer admin'}</button>
        <button class="icon-btn danger" data-s="m-remove" data-v="${p.id}" title="Sacar del chat" aria-label="Sacar del chat">${ic('close')}</button>` : ''}</div>`;
  }).join('');
  return `<div class="field members"><span>👥 Miembros (${(c.members || []).length || 1})</span>${rows}
    ${admin ? `<div class="btn-row"><button class="btn outline" data-s="m-add">+ Añadir persona</button>${isOwnerUser() ? '<button class="btn ghost" data-s="m-invite">Invitar con enlace</button>' : ''}</div>
      <label class="toggle"><input type="checkbox" id="c-only" ${c.onlyAdmins ? 'checked' : ''}> Solo los administradores pueden enviar</label>`
      : c.onlyAdmins ? '<p class="muted small">Solo los administradores pueden enviar mensajes.</p>' : ''}
  </div>`;
}

async function members(op, id) {
  try {
    await api('chats/members', { method: 'POST', body: { chatId: id, ...op } });
    await syncNow();
    return true;
  } catch (err) { toast(err.message); return false; }
}

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
    ${orig && !isGeneral && multiUser() ? membersHtml(c) : ''}
    ${orig && !isChatAdmin(c) ? '<p class="readonly-note">El nombre, el icono, el tipo y la descripción los cambian los administradores. Lo demás (grupo, fijar, archivar, bloquear) es solo tuyo.</p>' : ''}
    ${isGeneral ? '' : `<div class="field row"><label class="toggle"><input type="checkbox" id="c-pin" ${c.pinned ? 'checked' : ''}> Fijar arriba en la lista</label>
      <label class="toggle"><input type="checkbox" id="c-mute" ${c.muted ? 'checked' : ''}> 🔕 Silenciar avisos</label>
      ${orig ? `<label class="toggle"><input type="checkbox" id="c-arch" ${c.archived ? 'checked' : ''}> Archivado</label>` : ''}
      <label class="toggle"><input type="checkbox" id="c-lock" ${c.locked ? 'checked' : ''}> 🔒 Bloquear con PIN</label></div>
      <small class="muted">Los chats archivados no salen en la lista (filtro "Archivados"), pero siguen recibiendo lo de sus etiquetas.</small>`}`;

  sheet(orig ? 'Información del chat' : 'Nuevo chat', body, {
    actions: `${orig && !isGeneral ? (isChatOwner(c) ? '<button class="btn danger ghost" data-s="del">Eliminar</button>' : '<button class="btn danger ghost" data-s="leave">Salir del chat</button>') : ''}<span class="grow"></span><button class="btn ghost" data-act="sheet-close">Cancelar</button><button class="btn primary" data-s="save">${orig ? 'Guardar' : 'Crear chat'}</button>`,
    onMount: (sh) => {
      const updateAvatar = () => { $('#cp-avatar', sh).innerHTML = avatar({ emoji: st.emoji, color: st.color }, 'lg'); };
      if (orig && !isChatAdmin(orig)) sh.querySelectorAll('#c-name, #c-emoji, #c-desc, [data-s=type], [data-s=emoji], [data-s=color]').forEach((x) => { x.disabled = true; });
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
        if (s === 'leave') {
          confirmSheet(`¿Salir de ${orig.emoji} ${orig.name}? Dejarás de ver sus mensajes; un administrador puede volver a añadirte.`, 'Salir', async () => {
            if (await members({ leave: true }, orig.id)) { refreshAll(); toast('Has salido del chat'); }
          });
          return;
        }
        if (s === 'm-add') {
          const inChat = new Set((orig.members || []).map((x) => x.id));
          const candidates = S.people.filter((p) => !inChat.has(p.id));
          if (!candidates.length) { toast(isOwnerUser() ? 'No hay más personas: invita a alguien con "Invitar con enlace"' : 'No hay más personas en ChatNote'); return; }
          pickSheet('Añadir al chat', candidates.map((p) => ({ id: p.id, html: `${personDot(p)} ${esc(p.name)} <small class="muted">@${esc(p.handle)}</small>` })),
            async (uid) => { if (await members({ add: [uid] }, orig.id)) { toast('Añadido'); chatSheet(orig.id); } });
          return;
        }
        if (s === 'm-remove') {
          const p = S.people.find((x) => x.id === b.dataset.v);
          confirmSheet(`¿Sacar a ${p?.name || 'esta persona'} del chat?`, 'Sacar', async () => { if (await members({ remove: b.dataset.v }, orig.id)) chatSheet(orig.id); });
          return;
        }
        if (s === 'm-role') { if (await members({ role: { id: b.dataset.v, role: b.dataset.r } }, orig.id)) chatSheet(orig.id); return; }
        if (s === 'm-invite') {
          const url = await inviteLink(orig.id);
          if (url) toast('Enlace copiado: quien lo abra entrará en ChatNote y en este chat');
          return;
        }
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
            locked: !isGeneral && !!$('#c-lock', sh)?.checked,
            muted: !isGeneral && !!$('#c-mute', sh)?.checked,
            ...($('#c-only', sh) ? { onlyAdmins: $('#c-only', sh).checked } : {}),
          };
          // Bloquear necesita un PIN en este dispositivo; desbloquear, el PIN actual.
          if (data.locked && !hasPin() && !(await pinSetupSheet())) return;
          if (!data.locked && orig?.locked && !(await requireUnlock('Quitar el bloqueo'))) return;
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
