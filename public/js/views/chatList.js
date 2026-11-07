/* Lista de chats, filtros por grupo y búsqueda global. */
import { $, esc, norm, plain, shortWhen, byOrder } from '../utils.js';
import { ic } from '../icons.js';
import { TYPES } from '../constants.js';
import { S } from '../state.js';
import { chatById, catById, lastOf, pendingOf, summary } from '../data/store.js';
import { getStatus } from '../data/sync.js';
import { avatar, catChip, empty } from '../ui/parts.js';

function groupChipsHtml() {
  const chips = [['all', 'Todos'], ['pinned', 'Fijados'], ...[...S.groups].sort(byOrder).map((g) => [g.id, g.name])];
  const archived = S.chats.filter((c) => c.archived).length;
  if (archived || S.groupFilter === 'archived') chips.push(['archived', `🗄 Archivados${archived ? ` ${archived}` : ''}`]);
  return chips.map(([id, label]) => `<button class="chip ${S.groupFilter === id ? 'on' : ''}" data-act="group-filter" data-id="${id}">${esc(label)}</button>`).join('')
    + `<button class="chip ghost" data-act="new-group" title="Nuevo grupo" aria-label="Nuevo grupo">${ic('plus')}</button>`;
}

export function chatsPaneHtml() {
  const q = S.search.trim();
  return `<header class="pane-head"><h1>Retro<em>Dark</em></h1>
      <div class="head-actions">
        <button class="icon-btn sync-ind" id="sync-ind" data-act="nav" data-nav="settings" hidden>${ic('cloudOff')}</button>
        <button class="icon-btn" data-act="new-chat" title="Nuevo chat" aria-label="Nuevo chat">${ic('plus')}</button>
      </div></header>
    <div class="searchbar">${ic('search')}<input id="search" type="search" placeholder="Buscar chats, notas o #etiquetas" value="${esc(S.search)}" autocomplete="off"></div>
    <div class="chips scroll-x" id="group-chips" ${q ? 'hidden' : ''}>${groupChipsHtml()}</div>
    <div class="list" id="pane-list">${q ? searchResults(q) : chatList()}</div>
    <button class="fab" data-act="new-chat" aria-label="Nuevo chat">${ic('plus')}</button>`;
}

export function refreshChats() {
  const q = S.search.trim();
  const chips = $('#group-chips');
  chips.hidden = !!q;
  if (!q) chips.innerHTML = groupChipsHtml();
  $('#pane-list').innerHTML = q ? searchResults(q) : chatList();
}

/** Icono de nube tachada cuando no se puede guardar en el servidor. */
export function updateSyncIndicator() {
  const el = $('#sync-ind');
  if (!el) return;
  const st = getStatus();
  const bad = st.state === 'offline' || st.state === 'error' || st.state === 'auth';
  el.hidden = !bad;
  const pending = st.pending ? ` ${st.pending} cambio${st.pending > 1 ? 's' : ''} sin subir.` : '';
  el.title = (st.state === 'auth' ? 'Falta la clave de acceso del servidor.' : 'Sin conexión con el servidor. Lo que escribas se guarda aquí.') + pending;
  el.setAttribute('aria-label', el.title);
}

const lastTs = (c) => lastOf(c.id)?.createdAt || c.createdAt;

function chatList() {
  let chats = S.groupFilter === 'archived' ? S.chats.filter((c) => c.archived) : S.chats.filter((c) => !c.archived);
  if (S.groupFilter === 'pinned') chats = chats.filter((c) => c.pinned);
  else if (S.groupFilter !== 'all' && S.groupFilter !== 'archived') chats = chats.filter((c) => c.groupId === S.groupFilter);
  chats.sort((a, b) => (b.id === 'general') - (a.id === 'general') || (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || lastTs(b) - lastTs(a));
  if (!chats.length) return empty(S.groupFilter === 'archived' ? 'No hay chats archivados.' : 'No hay chats en este grupo. Asigna chats desde Organizar o al editar un chat.');
  return chats.map(chatRow).join('');
}

export function chatRow(c) {
  const last = lastOf(c.id), pending = pendingOf(c.id);
  const prev = last ? `${esc(summary(last))}` : `<i>${esc(c.desc || TYPES[c.type].hint)}</i>`;
  return `<div class="chat-row ${S.active === c.id ? 'on' : ''}" data-act="open-chat" data-id="${c.id}" role="button" tabindex="0">
    ${avatar(c)}
    <div class="cr-body">
      <div class="cr-top"><span class="cr-name">${esc(c.name)}</span><span class="cr-time ${pending ? 'hl' : ''}">${last ? shortWhen(last.createdAt) : ''}</span></div>
      <div class="cr-bot"><span class="cr-prev">${prev}</span>${c.pinned && c.id !== 'general' ? ic('pin', 'tiny') : ''}${pending ? `<b class="badge" title="Tareas pendientes">${pending}</b>` : ''}</div>
    </div></div>`;
}

function searchResults(q) {
  const isTag = q.startsWith('#');
  const nq = norm(isTag ? q.slice(1) : q);
  const chats = isTag ? [] : S.chats.filter((c) => norm(c.name).includes(nq));
  const msgs = S.messages
    .filter((m) => (isTag
      ? (m.tags || []).some((t) => norm(t).startsWith(nq))
      : norm(m.text).includes(nq) || (m.tags || []).some((t) => norm(t).includes(nq)) || (m.attachments || []).some((a) => norm(a.name).includes(nq))))
    .sort((a, b) => b.createdAt - a.createdAt).slice(0, 200);
  let h = '';
  if (chats.length) h += `<div class="sec-title">Chats</div>${chats.map(chatRow).join('')}`;
  h += `<div class="sec-title">Mensajes <span>${msgs.length || ''}</span></div>`;
  h += msgs.length ? msgs.map(resultRow).join('') : empty('Sin resultados');
  return h;
}

function resultRow(m) {
  const c = chatById(m.chatId), cat = catById(m.categoryId);
  return `<div class="res-row" data-act="goto-msg" data-id="${m.id}" role="button" tabindex="0">
    <div class="cr-top"><span class="res-chat">${c ? `${esc(c.emoji)} ${esc(c.name)}` : ''}</span>${cat ? catChip(cat) : ''}<span class="cr-time">${shortWhen(m.createdAt)}</span></div>
    <div class="res-text">${esc(summary(m))}</div></div>`;
}
