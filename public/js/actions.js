/* Acciones del usuario: abrir chats, enviar, completar, seleccionar, exportar… */
import { $, uid, esc, isMobile, todayKey, remindLabel } from './utils.js';
import { pushState, enablePush } from './push.js';
import { TYPES } from './constants.js';
import { S } from './state.js';
import { parse, toggleItemLine, ITEM_RE } from './text.js';
import { chatById, msgById, put, remove, touch, seed } from './data/store.js';
import { api, resetLocal, syncNow, notifyUploads } from './data/sync.js';
import { toast, closeSheet, confirmSheet, sheet } from './ui/dom.js';
import { ic } from './icons.js';
import { prepareFile, storeForUpload, isImage, fmtDur, fmtSize, startRecording, stopRecording, downloadAttachment, hydrateMedia } from './files.js';
import { refreshAll } from './render.js';
import { renderNav } from './views/nav.js';
import { renderPane } from './views/pane.js';
import {
  buildMain, renderChatHead, renderFilters, renderMessages, renderReplyBar, effKind, filterFn, autosize,
  renderAttachBar, showRecording, findAttachment,
} from './views/chat.js';

/* ---------- Navegación ---------- */
export function openChat(id, highlightId = null) {
  if (!chatById(id)) return;
  if (S.active !== id) { clearPending(); stopRecording(false); }
  Object.assign(S, { active: id, chatFilter: 'all', chatCat: null, chatSearch: '', kind: null, replyTo: null });
  S.selection.clear();
  buildMain();
  $('#app').classList.add('chat-open');
  renderPane();
  if (highlightId) flash(highlightId);
  else if (!isMobile()) $('#composer-input')?.focus();
}

/** Cierra el chat (en móvil vuelve a la lista). El botón Atrás lo gestiona backnav.js. */
export function closeChat() {
  $('#app').classList.remove('chat-open');
  S.selection.clear();
  renderPane();
}

function flash(id) {
  requestAnimationFrame(() => {
    const el = document.querySelector(`.msg[data-id="${id}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1700);
  });
}

export function gotoMsg(id) {
  const m = msgById(id);
  if (!m) return;
  if (S.active === m.chatId && $('#app').classList.contains('chat-open') && $('#messages')) {
    Object.assign(S, { chatFilter: 'all', chatCat: null, chatSearch: '' });
    const input = $('#chat-search-input');
    if (input) input.value = '';
    renderFilters();
    renderMessages();
    flash(id);
  } else openChat(m.chatId, id);
}

export function openTag(tag) {
  S.search = '#' + tag;
  S.nav = 'chats';
  closeSheet();
  if (isMobile() && $('#app').classList.contains('chat-open')) closeChat();
  renderNav();
  renderPane(true);
}

/** Vuelve a la vista inicial (tras importar o borrar todo). */
export function resetView() {
  S.groupFilter = 'all';
  S.search = '';
  S.selection.clear();
  if (isMobile()) { S.active = null; closeChat(); buildMain(); } else openChat('general');
  renderNav();
  renderPane(true);
}

/* ---------- Mensajes ---------- */
export async function send() {
  const ta = $('#composer-input'), chat = chatById(S.active);
  if (!ta || !chat) return;
  const p = parse(ta.value, effKind());
  if (!p.text && !S.pending.length) return;
  const pending = S.pending;
  S.pending = [];

  // En General, una #etiqueta vinculada a otro chat manda el mensaje allí.
  let target = chat;
  if (chat.id === 'general' && p.tags.length) {
    const linked = S.chats.find((c) => c.id !== 'general' && (c.tags || []).some((t) => p.tags.includes(t)));
    if (linked) {
      target = linked;
      if (!p.explicit && !S.kind) p.kind = TYPES[linked.type].kind;
    }
  }

  const now = Date.now();
  const msg = {
    id: uid(), chatId: target.id, text: p.text, kind: p.kind,
    done: p.kind === 'task' && p.done, doneAt: p.done ? now : null,
    tags: p.tags, categoryId: p.categoryId, due: p.due, starred: false, pinned: false, from: 'me',
    triaged: target.id !== 'general' || p.kind !== 'message', createdAt: now,
    replyTo: S.replyTo && msgById(S.replyTo) ? S.replyTo : null,
    remindAt: p.remindAt || null,
    ...(pending.length ? { attachments: pending.map((x) => x.att) } : {}),
  };
  S.replyTo = null;
  ta.value = '';
  autosize(ta);
  ta.focus();
  // Los archivos se guardan aquí y se suben en la próxima sincronización.
  for (const x of pending) { await storeForUpload(x.att, x.blob); if (x.url) URL.revokeObjectURL(x.url); }
  renderAttachBar();
  if (pending.length) notifyUploads();
  await put('messages', msg);
  await touch(target.id);
  if (S.chatFilter !== 'all' && !filterFn(S.chatFilter)(msg)) S.chatFilter = 'all';
  refreshAll(true);
  if (target !== chat) toast(`Movido a ${target.emoji} ${target.name}`, { action: 'Ver', fn: () => gotoMsg(msg.id) });
  else if (msg.remindAt) confirmReminder(msg.remindAt);
}

/* ---------- Adjuntos y notas de voz ---------- */

/** Prepara archivos (botón 📎, pegar o arrastrar) para el próximo mensaje. */
export async function addFiles(fileList) {
  const files = [...(fileList || [])];
  if (!files.length || !chatById(S.active)) return;
  for (const f of files) {
    try {
      const { att, blob } = await prepareFile(f);
      S.pending.push({ att, blob, url: isImage(att) ? URL.createObjectURL(blob) : null });
    } catch (err) {
      toast(err.message);
    }
  }
  renderAttachBar();
  $('#composer-input')?.focus();
}

export function removePending(id) {
  const x = S.pending.find((p) => p.att.id === id);
  if (x?.url) URL.revokeObjectURL(x.url);
  S.pending = S.pending.filter((p) => p.att.id !== id);
  renderAttachBar();
}

export function clearPending() {
  S.pending.forEach((x) => x.url && URL.revokeObjectURL(x.url));
  S.pending = [];
}

const MAX_RECORDING_S = 600;

export async function startVoice() {
  try {
    await startRecording((secs) => {
      const t = $('#rec-time');
      if (t) t.textContent = fmtDur(secs);
      if (secs >= MAX_RECORDING_S) finishVoice(true);
    });
    showRecording(true);
    navigator.vibrate?.(20);
  } catch (err) {
    toast(err?.name === 'NotAllowedError' ? 'Sin permiso para usar el micrófono' : 'No se pudo grabar audio en este dispositivo');
  }
}

/** Termina la nota de voz: `keep` la envía (con el texto que haya escrito); si no, se descarta. */
export async function finishVoice(keep) {
  const out = await stopRecording(keep);
  showRecording(false);
  if (!out) return;
  if (out.att.duration < 0.8) { toast('Nota de voz demasiado corta'); return; }
  S.pending.push({ att: out.att, blob: out.blob, url: null });
  await send();
}

/** Abre un adjunto: las fotos en grande; el resto se descarga. */
export async function openAttachment(attId) {
  const att = findAttachment(attId);
  if (!att) return;
  if (!isImage(att)) {
    toast(`Descargando ${att.name}…`);
    try { await downloadAttachment(att); } catch (err) { toast(err.message); }
    return;
  }
  sheet(att.name, `<div class="viewer"><img data-file="${att.id}" alt="${esc(att.name)}"></div>`, {
    actions: `<span class="muted small">${fmtSize(att.size)}</span><span class="grow"></span><button class="btn primary" data-s="dl">${ic('download', 'tiny')} Descargar</button>`,
    onMount: (sh) => {
      hydrateMedia(sh, findAttachment);
      sh.addEventListener('click', (e) => { if (e.target.closest('[data-s=dl]')) downloadAttachment(att).catch((err) => toast(err.message)); });
    },
  });
}

/**
 * Empieza a responder a un mensaje. Con `inChatId` la respuesta se escribe en otro chat
 * (para citar una nota antigua donde haga falta).
 */
export function startReply(id, inChatId = null) {
  const m = msgById(id);
  if (!m) return;
  const chatId = inChatId || m.chatId;
  if (S.active !== chatId || !$('#app').classList.contains('chat-open') || !$('#messages')) openChat(chatId);
  S.selection.clear();
  S.replyTo = id;
  renderChatHead();
  renderMessages();
  $('#composer-input')?.focus();
}

export function cancelReply() {
  S.replyTo = null;
  renderReplyBar();
}

/** Confirma un recordatorio y, si este dispositivo no tiene los avisos activados, ofrece activarlos. */
export async function confirmReminder(ts) {
  if (ts <= Date.now()) { toast('Esa hora ya pasó: no habrá aviso'); return; }
  const state = await pushState();
  if (state === 'on') { toast(`⏰ Te aviso ${remindLabel(ts)}`); return; }
  if (state === 'off') {
    toast(`⏰ Guardado para ${remindLabel(ts)}. Activa las notificaciones para recibirlo`, {
      action: 'Activar',
      fn: () => enablePush().then(() => toast('Notificaciones activadas')).catch((err) => toast(err.message)),
    });
    return;
  }
  toast(`⏰ Guardado para ${remindLabel(ts)}. Revisa Ajustes → Notificaciones para recibirlo`);
}

/** Marca o desmarca una casilla dentro de un mensaje con lista. */
export async function toggleItem(id, line) {
  const m = msgById(id);
  const text = m && toggleItemLine(m.text, Number(line));
  if (!text) return;
  m.text = text;
  await put('messages', m);
  navigator.vibrate?.(8);
  refreshAll();
}

/**
 * Enter dentro de una casilla del cuadro de texto:
 *  - con texto → crea otra casilla debajo
 *  - vacía → la quita y envía el mensaje (si "Enviar con Enter" está activo)
 * Devuelve true si se encargó del Enter.
 */
export function listEnter(ta, sendOnEmpty) {
  if (ta.selectionStart !== ta.selectionEnd) return false;
  const v = ta.value, pos = ta.selectionStart;
  const start = v.lastIndexOf('\n', pos - 1) + 1;
  let end = v.indexOf('\n', pos);
  if (end < 0) end = v.length;
  const x = v.slice(start, end).match(ITEM_RE);
  if (!x) return false;
  if (!x[3].trim()) {
    const before = v.slice(0, Math.max(0, start - 1));
    ta.value = before + v.slice(end);
    ta.setSelectionRange(before.length, before.length);
    autosize(ta);
    if (sendOnEmpty) send();
    return true;
  }
  ta.setRangeText(`\n${x[1]}[ ] `, pos, pos, 'end');
  autosize(ta);
  return true;
}

export async function toggleDone(id) {
  const m = msgById(id);
  if (!m) return;
  Object.assign(m, { kind: 'task', done: !m.done, triaged: true });
  m.doneAt = m.done ? Date.now() : null;
  await put('messages', m);
  if (m.done) navigator.vibrate?.(10);
  refreshAll();
}

/* ---------- Selección múltiple ---------- */
export function toggleSel(id) {
  if (!id) return;
  if (S.selection.has(id)) S.selection.delete(id); else S.selection.add(id);
  renderChatHead();
  renderMessages();
}

export function clearSel() {
  S.selection.clear();
  renderChatHead();
  renderMessages();
}

export const selMsgs = () => [...S.selection].map(msgById).filter(Boolean);

/** Aplica `fn` a cada mensaje seleccionado y lo guarda. */
export async function bulk(fn) {
  for (const m of selMsgs()) { fn(m); await put('messages', m); }
  S.selection.clear();
  refreshAll();
}

/* ---------- Datos ---------- */
export function exportData() {
  const data = { app: 'retrodark', version: 1, exportedAt: new Date().toISOString(), chats: S.chats, messages: S.messages, categories: S.categories, groups: S.groups };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  a.download = `retrodark-${todayKey()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export async function importData(file) {
  if (!file) return;
  let data;
  try {
    data = JSON.parse(await file.text());
    if (data.app !== 'retrodark' || !Array.isArray(data.messages)) throw new Error();
  } catch {
    toast('Ese archivo no es una copia de RetroDark');
    return;
  }
  confirmSheet(`Se reemplazarán todos tus datos (en MongoDB y en todos tus dispositivos) por los del archivo: ${data.messages.length} mensajes.`, 'Importar', async () => {
    try {
      const res = await api('import', { method: 'POST', body: data });
      await resetLocal(res.resetAt);
      await syncNow();
    } catch (err) {
      toast(`No se pudo importar: ${err.message}`);
      return;
    }
    if (!chatById('general')) await seed();
    resetView();
    toast('Copia importada');
  });
}

export function wipe() {
  confirmSheet('Se borrarán todos tus chats, notas y tareas de MongoDB y de todos tus dispositivos. No se puede deshacer.', 'Borrar todo', async () => {
    try {
      const res = await api('reset', { method: 'POST' });
      await resetLocal(res.resetAt);
    } catch (err) {
      toast(`No se pudo borrar: ${err.message}`);
      return;
    }
    await seed();
    resetView();
    toast('Datos borrados');
  });
}

export async function deleteMessages(ids) {
  for (const id of ids) await remove('messages', id);
}
