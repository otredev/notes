/* Chat abierto: cabecera, filtros, burbujas y cuadro de texto. */
import { $, esc, norm, plain, hm, dayKey, dayLabel } from '../utils.js';
import { ic } from '../icons.js';
import { TYPES, KINDS, FILTERS } from '../constants.js';
import { S } from '../state.js';
import { fmt, checklistOf, ITEM_RE } from '../text.js';
import { chatById, catById, msgById, msgsOf, inboxList, summary } from '../data/store.js';
import { avatar, catChip, dueChip, catPick, remindChip } from '../ui/parts.js';
import { isImage, isAudio, isVideo, fmtSize, fmtDur, hydrateMedia, canRecord } from '../files.js';
import { refreshPlayer } from '../player.js';

/** Tareas sin hacer, o listas con alguna casilla sin marcar. */
const isPending = (m) => {
  if (m.kind === 'task') return !m.done;
  const cl = checklistOf(m.text);
  return !!cl && cl.done < cl.total;
};
export const filterFn = (f) => (m) => f === 'all' || (f === 'pending' ? isPending(m) : f === 'starred' ? m.starred : m.kind === f);

/** Cuerpo de un mensaje con lista de casillas; cada una se marca tocándola. */
function checklistHtml(m) {
  return `<div class="b-text cl">${m.text.split('\n').map((line, i) => {
    const x = line.match(ITEM_RE);
    if (!x) return line.trim() ? `<div class="cl-line">${fmt(line)}</div>` : '<div class="cl-gap"></div>';
    const done = x[2].toLowerCase() === 'x';
    return `<div class="cl-item ${done ? 'done' : ''}">
      <button class="check sm ${done ? 'on' : ''}" data-act="cl-toggle" data-id="${m.id}" data-i="${i}" aria-label="${done ? 'Desmarcar' : 'Marcar'}">${ic('check')}</button>
      <span>${fmt(x[3])}</span></div>`;
  }).join('')}</div>`;
}

/** Tipo con el que se enviará el próximo mensaje. */
export const effKind = () => S.kind || TYPES[chatById(S.active)?.type || 'chat'].kind;

export function buildMain() {
  const main = $('#main');
  if (!chatById(S.active)) {
    main.innerHTML = `<div class="main-empty"><div class="me-logo">${ic('chats')}</div><h2>RetroDark</h2>
      <p>Escribe como en un chat. Organiza como en una libreta.</p>
      <p class="small">Tus notas se guardan en tu base de datos MongoDB.</p></div>`;
    return;
  }
  main.innerHTML = `<header class="chat-head" id="chat-head"></header>
    <div class="chat-progress" id="chat-progress" hidden></div>
    <div class="chat-search" id="chat-search" hidden><input id="chat-search-input" type="search" placeholder="Buscar en este chat" autocomplete="off"></div>
    <div class="chips filters scroll-x" id="chat-filters"></div>
    <div class="pinned-bar" id="pinned-bar" data-act="goto-msg" hidden></div>
    <div class="messages" id="messages"></div>
    <footer class="composer-area" id="composer-area">
      <div class="reply-bar" id="reply-bar" hidden></div>
      <div class="attach-bar" id="attach-bar" hidden></div>
      <div class="composer" id="composer">
        <button class="icon-btn kind-btn" id="kind-btn" data-act="cycle-kind"></button>
        <div class="composer-box">
          <textarea id="composer-input" rows="1" placeholder="Mensaje" enterkeyhint="send"></textarea>
          <button class="icon-btn clip-btn" data-act="attach" title="Adjuntar archivos" aria-label="Adjuntar archivos">${ic('clip')}</button>
        </div>
        <button class="send-btn" id="send-btn" data-act="send" title="Enviar" aria-label="Enviar">${ic('send')}</button>
      </div>
      <div class="rec-bar" id="rec-bar" hidden>
        <button class="icon-btn" data-act="rec-cancel" title="Descartar" aria-label="Descartar">${ic('trash')}</button>
        <span class="rec-dot"></span><span class="rec-time" id="rec-time">0:00</span><span class="grow muted small">Grabando nota de voz…</span>
        <button class="send-btn" data-act="rec-send" title="Enviar nota de voz" aria-label="Enviar nota de voz">${ic('send')}</button>
      </div>
      <input type="file" id="attach-input" multiple hidden>
    </footer>`;
  renderChatHead();
  renderFilters();
  renderMessages(true);
  renderKind();
  renderReplyBar();
  renderAttachBar();
}

/* ---------- Adjuntos ---------- */

/** Archivos preparados para enviar (encima del cuadro de texto). */
export function renderAttachBar() {
  const bar = $('#attach-bar');
  if (!bar) return;
  bar.hidden = !S.pending.length;
  bar.innerHTML = S.pending.map(({ att, url }) => `<div class="pend">
      ${isImage(att) ? `<img src="${url}" alt="">` : `<span class="pend-ic">${ic(isAudio(att) ? 'mic' : 'file')}</span>`}
      <span class="pend-name">${esc(att.name)}<small>${fmtSize(att.size)}</small></span>
      <button class="icon-btn" data-act="attach-remove" data-id="${att.id}" aria-label="Quitar">${ic('close')}</button></div>`).join('');
  updateSendBtn();
}

/** Con el cuadro vacío el botón graba una nota de voz; con texto o adjuntos, envía. */
export function updateSendBtn() {
  const b = $('#send-btn'), ta = $('#composer-input');
  if (!b || !ta) return;
  const mic = !ta.value.trim() && !S.pending.length && canRecord();
  b.dataset.act = mic ? 'record' : 'send';
  b.innerHTML = ic(mic ? 'mic' : 'send');
  b.title = mic ? 'Grabar nota de voz' : 'Enviar';
  b.setAttribute('aria-label', b.title);
}

/** Muestra u oculta la barra de grabación. */
export function showRecording(on) {
  const comp = $('#composer'), bar = $('#rec-bar');
  if (!comp || !bar) return;
  comp.hidden = on;
  bar.hidden = !on;
  if (on) $('#rec-time').textContent = '0:00';
}

function attachmentsHtml(m) {
  const list = m.attachments || [];
  if (!list.length) return '';
  const imgs = list.filter(isImage), others = list.filter((a) => !isImage(a));
  let h = '';
  if (imgs.length) {
    h += `<div class="att-grid n${Math.min(imgs.length, 4)}">${imgs.map((a) => `<div class="att att-img loading" data-act="att-open" data-msg="${m.id}" data-att="${a.id}" role="button" tabindex="0">
      <img data-file="${a.id}" alt="${esc(a.name)}" ${a.w ? `style="aspect-ratio:${a.w}/${a.h}"` : ''}></div>`).join('')}</div>`;
  }
  for (const a of others) {
    if (isAudio(a)) {
      h += `<div class="att att-audio" data-audio="${a.id}">
        <button class="ap-play" data-act="audio-play" data-msg="${m.id}" data-att="${a.id}" aria-label="Reproducir">${ic('play')}</button>
        <input type="range" class="ap-seek" min="0" max="1000" value="0" data-att="${a.id}" aria-label="Posición">
        <span class="ap-time">${fmtDur(a.duration)}</span><span class="ap-mic">${ic('mic', 'tiny')}</span></div>`;
    } else if (isVideo(a)) {
      h += `<div class="att att-video loading"><video data-file="${a.id}" controls preload="metadata" playsinline></video></div>`;
    } else {
      h += `<button class="att att-file" data-act="att-open" data-msg="${m.id}" data-att="${a.id}">
        <span class="af-ic">${ic('file')}</span><span class="af-body"><span class="af-name">${esc(a.name)}</span><small>${fmtSize(a.size)} · ${esc((a.name.split('.').pop() || '').toUpperCase())}</small></span>${ic('download', 'tiny')}</button>`;
    }
  }
  return `<div class="atts">${h}</div>`;
}

/** Busca un adjunto por id en todos los mensajes. */
export function findAttachment(id) {
  for (const m of S.messages) for (const a of m.attachments || []) if (a.id === id) return a;
  return null;
}

/* ---------- Citas (responder a un mensaje) ---------- */

/** Bloque con el mensaje citado. Al tocarlo lleva al original, aunque esté en otro chat. */
export function quoteHtml(id, { bar = false } = {}) {
  const q = msgById(id);
  if (!q) return `<div class="quote gone">${ic('quote', 'tiny')} Mensaje eliminado</div>`;
  const chat = chatById(q.chatId);
  const cat = catById(q.categoryId);
  const where = q.chatId !== S.active && chat ? `${chat.emoji} ${chat.name} · ` : '';
  const who = q.from === 'app' ? 'RetroDark' : KINDS[q.kind].label;
  return `<div class="quote ${bar ? 'in-bar' : ''}" style="--qc:${cat?.color || chat?.color || 'var(--green)'}" data-act="goto-msg" data-id="${q.id}" role="button" tabindex="0">
    <b>${esc(where + who)}</b><span>${esc(summary(q))}</span></div>`;
}

export function renderReplyBar() {
  const bar = $('#reply-bar');
  if (!bar) return;
  if (S.replyTo && !msgById(S.replyTo)) S.replyTo = null;
  bar.hidden = !S.replyTo;
  bar.innerHTML = S.replyTo
    ? `${ic('reply', 'tiny')}${quoteHtml(S.replyTo, { bar: true })}<button class="icon-btn" data-act="reply-cancel" aria-label="Cancelar respuesta">${ic('close')}</button>`
    : '';
}

export function renderChatHead() {
  const c = chatById(S.active), h = $('#chat-head');
  if (!c || !h) return;
  if (S.selection.size) {
    h.className = 'chat-head selecting';
    h.innerHTML = `<button class="icon-btn" data-act="sel-clear" aria-label="Cancelar selección">${ic('close')}</button>
      <div class="ch-title"><b>${S.selection.size}</b></div>
      <div class="head-actions">
        ${S.selection.size === 1 ? `<button class="icon-btn" data-act="sel-reply" title="Responder">${ic('reply')}</button>` : ''}
        <button class="icon-btn" data-act="sel-kind" data-v="task" title="Convertir en tarea">${ic('tasks')}</button>
        <button class="icon-btn" data-act="sel-kind" data-v="note" title="Convertir en nota">${ic('note')}</button>
        <button class="icon-btn" data-act="sel-cat" title="Asignar categoría">${ic('org')}</button>
        <button class="icon-btn" data-act="sel-move" title="Mover a otro chat">${ic('move')}</button>
        <button class="icon-btn" data-act="sel-star" title="Destacar">${ic('star')}</button>
        <button class="icon-btn" data-act="sel-copy" title="Copiar">${ic('copy')}</button>
        <button class="icon-btn" data-act="sel-del" title="Eliminar">${ic('trash')}</button>
      </div>`;
    return;
  }
  const all = msgsOf(c.id), tasks = all.filter((m) => m.kind === 'task'), done = tasks.filter((m) => m.done).length;
  const notes = all.filter((m) => m.kind === 'note').length;
  const sub = [`${notes} ${notes === 1 ? 'nota' : 'notas'}`, `${done}/${tasks.length} tareas`];
  const group = S.groups.find((x) => x.id === c.groupId);
  if (group) sub.unshift(group.name);
  const inbox = c.id === 'general' ? inboxList().length : 0;
  h.className = 'chat-head';
  h.innerHTML = `<button class="icon-btn back" data-act="back" aria-label="Volver">${ic('back')}</button>
    <div class="ch-main" data-act="edit-chat" role="button" tabindex="0">${avatar(c, 'sm')}
      <div class="ch-title"><b>${esc(c.name)}</b><small>${esc(sub.join(' · '))}</small></div></div>
    <div class="head-actions">
      ${inbox ? `<button class="icon-btn" data-act="triage" title="Clasificar mensajes" aria-label="Clasificar mensajes">${ic('inbox')}<b class="badge">${inbox}</b></button>` : ''}
      <button class="icon-btn" data-act="chat-search" title="Buscar en el chat" aria-label="Buscar en el chat">${ic('search')}</button>
      <button class="icon-btn" data-act="edit-chat" title="Información del chat" aria-label="Información del chat">${ic('more')}</button>
    </div>`;
  const progress = $('#chat-progress');
  if (c.type === 'list' && tasks.length) {
    progress.hidden = false;
    progress.innerHTML = `<i style="width:${Math.round((done / tasks.length) * 100)}%"></i>`;
  } else progress.hidden = true;
}

export function renderFilters() {
  const box = $('#chat-filters');
  if (!box) return;
  const all = msgsOf(S.active);
  let h = FILTERS.map(([k, label]) => {
    const n = k === 'all' ? all.length : all.filter(filterFn(k)).length;
    if (!n && k !== 'all' && S.chatFilter !== k) return '';
    return `<button class="chip ${S.chatFilter === k ? 'on' : ''}" data-act="chat-filter" data-v="${k}">${label}${k === 'all' ? '' : ` <span>${n}</span>`}</button>`;
  }).join('');
  const cats = S.categories.filter((c) => all.some((m) => m.categoryId === c.id));
  if (cats.length) h += `<span class="chip-sep"></span>${cats.map((c) => catPick(c, S.chatCat === c.id, `data-act="chat-cat" data-v="${c.id}"`)).join('')}`;
  box.innerHTML = h;
  box.hidden = all.length < 2;
}

function bubble(m, replies) {
  const cat = catById(m.categoryId);
  const r = replies.get(m.id);
  const replyCount = r
    ? `<button class="reply-count" data-act="goto-msg" data-id="${r.last}" title="Ir a la última respuesta">${ic('reply', 'tiny')} ${r.n}</button>` : '';
  // Mensajes de la app y del asistente (MCP) se ven como recibidos, a la izquierda.
  const side = m.from === 'app' || m.from === 'mcp' ? 'in' : 'out';
  const sender = m.from === 'mcp' ? '<div class="b-sender">🤖 Asistente</div>' : '';
  const chips = [cat ? catChip(cat) : '', m.due ? dueChip(m) : '', remindChip(m), m.pinned ? `<span class="mini">${ic('pin', 'tiny')}</span>` : ''].join('');
  const cl = checklistOf(m.text);
  const kindHeader = cl
    ? `<div class="b-kind">${ic('tasks', 'tiny')} Lista · ${cl.done}/${cl.total}<span class="cl-bar"><i style="width:${Math.round((cl.done / cl.total) * 100)}%"></i></span></div>`
    : m.kind === 'note' ? `<div class="b-kind">${ic('note', 'tiny')} Nota</div>` : '';
  const allDone = m.kind === 'task' ? m.done : cl ? cl.done === cl.total : false;
  const ticks = m.kind === 'task' || cl ? `<span class="ticks ${allDone ? 'read' : ''}">${ic(allDone ? 'done2' : 'check', 'tiny')}</span>` : '';
  const check = m.kind === 'task'
    ? `<button class="check ${m.done ? 'on' : ''}" data-act="toggle" data-id="${m.id}" aria-label="${m.done ? 'Marcar como pendiente' : 'Completar'}">${ic('check')}</button>` : '';
  return `<div class="msg ${side} k-${m.kind} ${m.done ? 'done' : ''} ${S.selection.has(m.id) ? 'sel' : ''}" data-act="msg" data-id="${m.id}">
    <button class="b-reply" data-act="reply" data-id="${m.id}" title="Responder" aria-label="Responder">${ic('reply', 'tiny')}</button>
    <div class="bubble ${cat ? 'has-cat' : ''}" ${cat ? `style="--cat:${cat.color}"` : ''}>
      ${sender}${kindHeader}
      ${m.replyTo ? quoteHtml(m.replyTo) : ''}
      ${attachmentsHtml(m)}
      ${cl ? checklistHtml(m) : m.text?.trim() || check ? `<div class="b-row">${check}<div class="b-text">${fmt(m.text)}</div></div>` : ''}
      ${chips ? `<div class="b-chips">${chips}</div>` : ''}
      <div class="b-meta">${replyCount}${m.starred ? ic('star', 'tiny star') : ''}<span>${hm(m.createdAt)}</span>${ticks}</div>
    </div></div>`;
}

export function renderMessages(stick = false) {
  const box = $('#messages');
  if (!box) return;
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  const prevTop = box.scrollTop;
  const c = chatById(S.active);
  const q = norm(S.chatSearch.trim());
  let list = msgsOf(S.active).filter(filterFn(S.chatFilter));
  if (S.chatCat) list = list.filter((m) => m.categoryId === S.chatCat);
  if (q) list = list.filter((m) => norm(m.text).includes(q) || (m.tags || []).some((t) => t.includes(q)) || (m.attachments || []).some((a) => norm(a.name).includes(q)));

  // Cuántas respuestas tiene cada mensaje (de cualquier chat) y cuál es la última.
  const replies = new Map();
  for (const x of S.messages) {
    if (!x.replyTo) continue;
    const r = replies.get(x.replyTo) || { n: 0, last: null, at: 0 };
    r.n++;
    if (x.createdAt > r.at) { r.at = x.createdAt; r.last = x.id; }
    replies.set(x.replyTo, r);
  }

  let h = '', lastDay = '';
  if (!list.length) {
    h = `<div class="sys-note">${S.chatFilter === 'all' && !q && !S.chatCat ? `${esc(TYPES[c.type].hint)}<br>Escribe tu primer mensaje 👇` : 'Nada por aquí con este filtro'}</div>`;
  }
  for (const m of list) {
    const k = dayKey(new Date(m.createdAt));
    if (k !== lastDay) { h += `<div class="day-sep"><span>${dayLabel(k)}</span></div>`; lastDay = k; }
    h += bubble(m, replies);
  }
  box.innerHTML = h;
  box.scrollTop = stick || nearBottom ? box.scrollHeight : prevTop;
  hydrateMedia(box, findAttachment);
  // Las imágenes cambian el alto al cargar: se mantiene el final a la vista.
  if (stick || nearBottom) box.querySelectorAll('img[data-file]').forEach((img) => img.addEventListener('load', () => { box.scrollTop = box.scrollHeight; }, { once: true }));
  refreshPlayer();
  renderPinned();
  renderReplyBar();
}

function renderPinned() {
  const bar = $('#pinned-bar');
  if (!bar) return;
  const pins = msgsOf(S.active).filter((m) => m.pinned);
  if (!pins.length) { bar.hidden = true; return; }
  const m = pins[pins.length - 1];
  bar.hidden = false;
  bar.dataset.id = m.id;
  bar.innerHTML = `${ic('pin', 'tiny')}<span>${esc(summary(m))}</span>${pins.length > 1 ? `<small>+${pins.length - 1}</small>` : ''}`;
}

export function renderKind() {
  const b = $('#kind-btn');
  if (!b) return;
  const k = effKind();
  b.innerHTML = `<span>${KINDS[k].icon}</span>`;
  b.classList.toggle('forced', !!S.kind);
  b.title = `Enviar como: ${KINDS[k].label}. Toca para cambiar.`;
  b.setAttribute('aria-label', b.title);
  $('#composer-input').placeholder = k === 'task' ? 'Nueva tarea' : k === 'note' ? 'Escribe una nota' : 'Mensaje';
}

export function autosize(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
}
