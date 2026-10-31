/* Eventos de la interfaz. Los botones declaran su acción con data-act="…". */
import { $, esc, isMobile } from './utils.js';
import { TYPES } from './constants.js';
import { S, settings, saveSettings, applyTheme } from './state.js';
import { chatById, touch } from './data/store.js';
import { syncNow } from './data/sync.js';
import { closeSheet, isSheetOpen, confirmSheet, pickSheet, toast, copyText } from './ui/dom.js';
import { avatar } from './ui/parts.js';
import { refreshAll } from './render.js';
import { renderNav } from './views/nav.js';
import { renderPane } from './views/pane.js';
import { refreshChats } from './views/chatList.js';
import { renderFilters, renderMessages, renderKind, effKind, autosize, updateSendBtn, findAttachment } from './views/chat.js';
import {
  openChat, closeChat, gotoMsg, openTag, send, toggleDone, toggleSel, clearSel, selMsgs, bulk,
  exportData, importData, wipe, deleteMessages, startReply, cancelReply, toggleItem, listEnter,
  addFiles, removePending, startVoice, finishVoice, openAttachment,
} from './actions.js';
import { toggleAudio, seekAudio } from './player.js';
import { enablePush, disablePush, testPush } from './push.js';
import { updatePushBox, mcpBoxHtml } from './views/settings.js';
import { messageSheet } from './sheets/message.js';
import { chatSheet } from './sheets/chat.js';
import { groupSheet } from './sheets/group.js';
import { categorySheet } from './sheets/category.js';
import { triageSheet } from './sheets/triage.js';

const ACTIONS = {
  nav: (el) => { S.nav = el.dataset.nav; renderNav(); renderPane(true); },
  'open-chat': (el) => openChat(el.dataset.id),
  'new-chat': () => chatSheet(null),
  'edit-chat': () => chatSheet(S.active),
  back: () => closeChat(),
  'group-filter': (el) => { S.groupFilter = el.dataset.id; refreshChats(); },
  'new-group': () => groupSheet(null),
  'edit-group': (el) => groupSheet(el.dataset.id),
  'new-cat': () => categorySheet(null),
  'edit-cat': (el) => categorySheet(el.dataset.id),
  tag: (el) => openTag(el.dataset.tag),
  'goto-msg': (el) => { closeSheet(); gotoMsg(el.dataset.id); },
  reply: (el) => startReply(el.dataset.id),
  'reply-cancel': () => { cancelReply(); $('#composer-input')?.focus(); },
  'sel-reply': () => startReply([...S.selection][0]),
  toggle: (el) => toggleDone(el.dataset.id),
  attach: () => $('#attach-input')?.click(),
  'attach-remove': (el) => removePending(el.dataset.id),
  record: () => startVoice(),
  'rec-cancel': () => finishVoice(false),
  'rec-send': () => finishVoice(true),
  'att-open': (el) => openAttachment(el.dataset.att),
  'audio-play': (el) => {
    const att = findAttachment(el.dataset.att);
    if (att) toggleAudio(att).catch((err) => toast(err.message || 'No se pudo reproducir'));
  },
  'cl-toggle': (el) => toggleItem(el.dataset.id, el.dataset.i),
  msg: (el) => messageSheet(el.dataset.id),
  send: () => send(),
  triage: () => triageSheet(),

  'cycle-kind': () => {
    const order = ['message', 'note', 'task'];
    S.kind = order[(order.indexOf(effKind()) + 1) % order.length];
    renderKind();
    $('#composer-input').focus();
  },
  'chat-search': () => {
    const bar = $('#chat-search');
    bar.hidden = !bar.hidden;
    if (!bar.hidden) $('#chat-search-input').focus();
    else { S.chatSearch = ''; $('#chat-search-input').value = ''; renderMessages(); }
  },
  'chat-filter': (el) => { S.chatFilter = el.dataset.v; renderFilters(); renderMessages(true); },
  'chat-cat': (el) => { S.chatCat = S.chatCat === el.dataset.v ? null : el.dataset.v; renderFilters(); renderMessages(true); },

  /* ---------- Selección múltiple ---------- */
  'sel-clear': () => clearSel(),
  'sel-kind': (el) => bulk((m) => { m.kind = el.dataset.v; m.triaged = true; }),
  'sel-star': () => { const allStarred = selMsgs().every((m) => m.starred); bulk((m) => { m.starred = !allStarred; }); },
  'sel-cat': () => pickSheet('Asignar categoría', [
    { id: '', html: '<span class="dot" style="--c:transparent;border:2px solid var(--muted)"></span> Sin categoría' },
    ...S.categories.map((c) => ({ id: c.id, html: `<span class="dot" style="--c:${c.color}"></span> ${esc(c.name)}` })),
  ], (cid) => bulk((m) => { m.categoryId = cid || null; })),
  'sel-move': () => pickSheet('Mover a…',
    S.chats.filter((c) => c.id !== S.active).map((c) => ({ id: c.id, html: `${avatar(c, 'sm')} ${esc(c.name)}` })),
    async (cid) => {
      const target = chatById(cid), n = S.selection.size;
      await bulk((m) => {
        m.chatId = cid;
        m.triaged = true;
        if (m.kind === 'message' && target.type !== 'chat') m.kind = TYPES[target.type].kind;
      });
      await touch(cid);
      refreshAll();
      toast(`${n} movido${n > 1 ? 's' : ''} a ${target.emoji} ${target.name}`, { action: 'Ver', fn: () => openChat(cid) });
    }),
  'sel-copy': () => {
    copyText(selMsgs().sort((a, b) => a.createdAt - b.createdAt).map((m) => m.text).join('\n'));
    clearSel();
  },
  'sel-del': () => {
    const n = S.selection.size;
    confirmSheet(`¿Eliminar ${n} mensaje${n > 1 ? 's' : ''}?`, 'Eliminar', async () => {
      await deleteMessages([...S.selection]);
      S.selection.clear();
      refreshAll();
      toast('Eliminado');
    });
  },

  /* ---------- Ajustes ---------- */
  theme: (el) => { settings.theme = el.dataset.v; saveSettings(); renderPane(true); },
  'sync-now': () => syncNow(),
  'copy-mcp': (el) => copyText(el.dataset.v === 'url' ? $('#mcp-url').value : $('.mcp-cmd').textContent),
  'push-on': () => enablePush().then(() => toast('Notificaciones activadas')).catch((err) => toast(err.message)).finally(updatePushBox),
  'push-off': () => disablePush().then(() => toast('Notificaciones desactivadas')).catch((err) => toast(err.message)).finally(updatePushBox),
  'push-test': () => testPush().then(() => toast('Prueba enviada: debería llegarte en unos segundos')).catch((err) => toast(err.message)),
  export: () => exportData(),
  wipe: () => wipe(),
  install: () => { if (S.installEvt) { S.installEvt.prompt(); S.installEvt = null; renderPane(true); } },
  'task-cat': (el) => { S.taskCat = el.dataset.v; renderPane(true); },
  'toggle-done-list': () => { S.showDone = !S.showDone; renderPane(); },
  'sheet-close': () => closeSheet(),
};

/*
 * Gestos sobre los mensajes, como en WhatsApp:
 *  - mantener pulsado (o clic derecho) → seleccionar
 *  - deslizar a la derecha (pantallas táctiles) → responder
 */
let lpTimer = null, lpFired = false, lpStart = null, swipe = null;
const SWIPE_MAX = 80, SWIPE_TRIGGER = 60;

function endSwipe(trigger) {
  if (!swipe) return;
  const { bubble, id } = swipe;
  bubble.style.transition = 'transform .18s ease';
  bubble.style.transform = '';
  setTimeout(() => { bubble.style.transition = ''; }, 200);
  swipe = null;
  if (trigger) { lpFired = true; navigator.vibrate?.(10); startReply(id); }
}

function bindLongPress() {
  document.addEventListener('pointerdown', (e) => {
    lpFired = false;
    const m = e.target.closest('.msg[data-id]');
    if (!m || e.button !== 0 || e.target.closest('input, video, audio')) return;
    lpStart = [e.clientX, e.clientY, m, e.pointerType];
    clearTimeout(lpTimer);
    lpTimer = setTimeout(() => { lpFired = true; toggleSel(m.dataset.id); navigator.vibrate?.(15); }, 450);
  });
  document.addEventListener('pointermove', (e) => {
    if (!lpStart) return;
    const dx = e.clientX - lpStart[0], dy = e.clientY - lpStart[1];
    if (Math.hypot(dx, dy) > 10) clearTimeout(lpTimer);
    if (lpStart[3] === 'mouse' || S.selection.size) return;
    if (!swipe && dx > 14 && Math.abs(dy) < 12) {
      swipe = { id: lpStart[2].dataset.id, bubble: lpStart[2].querySelector('.bubble'), dx: 0 };
    }
    if (swipe) {
      swipe.dx = Math.max(0, Math.min(dx, SWIPE_MAX));
      swipe.bubble.style.transform = `translateX(${swipe.dx}px)`;
    }
  });
  document.addEventListener('pointerup', () => {
    clearTimeout(lpTimer);
    lpStart = null;
    endSwipe(swipe && swipe.dx >= SWIPE_TRIGGER);
  });
  document.addEventListener('pointercancel', () => { clearTimeout(lpTimer); lpStart = null; endSwipe(false); });
  document.addEventListener('contextmenu', (e) => {
    const m = e.target.closest('.msg[data-id]');
    if (!m) return;
    e.preventDefault();
    if (!lpFired) toggleSel(m.dataset.id);
  });
}

export function bindEvents() {
  bindLongPress();

  document.addEventListener('click', (e) => {
    if (e.target.closest('a[href], .ap-seek, video')) return;
    if (lpFired) {
      lpFired = false;
      if (e.target.closest('.msg')) { e.preventDefault(); return; }
    }
    const el = e.target.closest('[data-act]');
    if (!el) return;
    // Con mensajes seleccionados, tocar otro mensaje lo añade o quita de la selección.
    const inMsg = el.closest('.msg[data-id]');
    if (S.selection.size && inMsg) { toggleSel(inMsg.dataset.id); return; }
    ACTIONS[el.dataset.act]?.(el, e);
  });

  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'search') { S.search = t.value; refreshChats(); }
    else if (t.id === 'chat-search-input') { S.chatSearch = t.value; renderMessages(true); }
    else if (t.id === 'composer-input') { autosize(t); updateSendBtn(); }
    else if (t.classList.contains('ap-seek')) seekAudio(t.dataset.att, Number(t.value) / 1000);
  });

  // Adjuntar: pegar imágenes en el cuadro de texto o arrastrar archivos al chat.
  document.addEventListener('paste', (e) => {
    if (e.target.id !== 'composer-input' || !e.clipboardData?.files?.length) return;
    e.preventDefault();
    addFiles(e.clipboardData.files);
  });
  document.addEventListener('dragover', (e) => {
    if (!e.target.closest('#main') || !S.active || !e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    $('#main').classList.add('dropping');
  });
  document.addEventListener('dragleave', (e) => { if (!e.relatedTarget || !e.relatedTarget.closest?.('#main')) $('#main')?.classList.remove('dropping'); });
  document.addEventListener('drop', (e) => {
    $('#main')?.classList.remove('dropping');
    if (!e.target.closest('#main') || !S.active || !e.dataTransfer?.files?.length) return;
    e.preventDefault();
    addFiles(e.dataTransfer.files);
  });

  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t.id === 'composer-input' && e.key === 'Enter' && !e.isComposing) {
      // Ctrl/Cmd + Enter envía siempre.
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); send(); return; }
      // En una casilla "[] …": Enter crea otra debajo; en una vacía, termina y envía.
      if (!e.shiftKey && listEnter(t, settings.enterSend)) { e.preventDefault(); return; }
      if (!e.shiftKey && settings.enterSend) { e.preventDefault(); send(); return; }
    }
    if ((e.key === 'Enter' || e.key === ' ') && t.matches?.('[role=button][data-act]')) { e.preventDefault(); t.click(); return; }
    if (e.key === 'Escape') {
      if (isSheetOpen()) closeSheet();
      else if (S.selection.size) clearSel();
      else if (S.replyTo) cancelReply();
    }
  });

  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'import-file') { importData(t.files[0]); t.value = ''; }
    if (t.id === 'attach-input') { addFiles(t.files); t.value = ''; }
    if (t.id === 'set-enter') { settings.enterSend = t.checked; saveSettings(); }
    if (t.id === 'set-exit') { settings.confirmExit = t.checked; saveSettings(); }
    if (t.id === 'set-token') {
      settings.token = t.value.trim(); saveSettings(); t.blur(); syncNow();
      const box = $('#mcp-box'); if (box) box.innerHTML = mcpBoxHtml();
    }
  });

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    S.installEvt = e;
    if (S.nav === 'settings') renderPane(true);
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
}
