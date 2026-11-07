/* Eventos de la interfaz. Los botones declaran su acción con data-act="…". */
import { $, esc, isMobile } from './utils.js';
import { TYPES } from './constants.js';
import { S, settings, saveSettings, applyTheme } from './state.js';
import { chatById, touch } from './data/store.js';
import { syncNow, storeToken } from './data/sync.js';
import { embedSizes, parseEmbedSize, insideFence } from './text.js';
import { applyFormat, formatShortcut } from './editor.js';
import { vote, pollSheet } from './poll.js';
import { templatePicker, templateSheet } from './sheets/template.js';
import { restoreMessages, emptyTrash, msgById } from './data/store.js';
import { api } from './data/sync.js';
import { runAi } from './ai.js';
import { requireUnlock, lockNow, pinSetupSheet, enableBiometric, disableBiometric, biometricSupported } from './lock.js';
import { loadServer, loadBackups } from './views/server.js';
import { localTz } from './recurrence.js';
import { closeSheet, isSheetOpen, confirmSheet, pickSheet, toast, copyText } from './ui/dom.js';
import { avatar } from './ui/parts.js';
import { refreshAll } from './render.js';
import { renderNav } from './views/nav.js';
import { renderPane } from './views/pane.js';
import { refreshChats } from './views/chatList.js';
import { renderFilters, renderMessages, renderKind, effKind, autosize, updateSendBtn, findAttachment } from './views/chat.js';
import {
  moveTask, restoreData,
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

/** Guarda ajustes del servidor (y la zona horaria de este dispositivo). */
async function saveServer(patch, msg = '') {
  try {
    S.server = { ...S.server, ...(await api('settings', { method: 'POST', body: { ...patch, tz: localTz() } })) };
    if (msg) toast(msg);
  } catch (err) {
    toast(err.message);
    await loadServer();
    renderPane(true);
  }
}

const ACTIONS = {
  nav: (el) => { S.nav = el.dataset.nav; S.sub = null; renderNav(); renderPane(true); },
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
    const ids = [...S.selection];
    deleteMessages(ids).then(() => {
      S.selection.clear();
      refreshAll();
      toast(`${n} mensaje${n > 1 ? 's' : ''} en la papelera`, { action: 'Deshacer', fn: async () => { await restoreMessages(ids); refreshAll(); } });
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

  /* ---------- Formato, encuestas y plantillas ---------- */
  fmt: (el) => applyFormat(document.getElementById(el.dataset.target), el.dataset.v),
  'fmt-toggle': (el) => {
    settings.fmtBar = !settings.fmtBar;
    saveSettings();
    $('#fmt-bar').hidden = !settings.fmtBar;
    el.classList.toggle('on', settings.fmtBar);
    el.setAttribute('aria-pressed', settings.fmtBar);
    $('#composer-input')?.focus();
  },
  'embed-code': (el) => {
    const src = el.closest('.html-embed')?.querySelector('.he-src');
    if (!src) return;
    src.hidden = !src.hidden;
    el.textContent = src.hidden ? 'Ver código' : 'Ocultar código';
  },
  'poll-new': () => pollSheet($('#composer-input')?.value.trim().split('\n')[0] || ''),
  'poll-vote': (el) => vote(el.dataset.id, el.dataset.o),
  'tpl-pick': () => templatePicker(),
  'new-tpl': () => templateSheet(null),
  'edit-tpl': (el) => templateSheet(el.dataset.id),

  /* ---------- IA ---------- */
  'ai-transcribe': (el) => runAi('transcribe', el.dataset.msg, el.dataset.att),
  'ai-ocr': (el) => runAi('ocr', el.dataset.msg, el.dataset.att),

  /* ---------- Tareas: vistas, agenda y tablero ---------- */
  'task-view': (el) => { settings.taskView = el.dataset.v; saveSettings(); renderPane(true); },
  'agenda-day': (el) => { S.agendaDay = el.dataset.v; renderPane(); },
  'agenda-month': (el) => {
    const base = S.agendaMonth || new Date().toISOString().slice(0, 7);
    const [y, m] = base.split('-').map(Number);
    const d = new Date(y, m - 1 + Number(el.dataset.v), 1);
    S.agendaMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    S.agendaDay = null;
    renderPane();
  },
  'agenda-today': () => { S.agendaMonth = null; S.agendaDay = null; renderPane(); },
  'kb-move': (el) => moveTask(el.dataset.id, el.dataset.v),

  /* ---------- Privacidad ---------- */
  unlock: () => requireUnlock().then((ok) => ok && renderPane(true)),
  'lock-now': () => { lockNow(); toast('Chats bloqueados'); },
  'pin-set': () => pinSetupSheet().then(() => renderPane(true)),
  'bio-on': async () => {
    if (!(await biometricSupported())) { toast('Este dispositivo no tiene huella ni Face ID para la web'); return; }
    try { await enableBiometric(); toast('Huella / Face ID activada'); } catch { toast('No se pudo activar'); }
    renderPane(true);
  },
  'bio-off': () => { disableBiometric(); renderPane(true); },

  /* ---------- Servidor: resumen, calendario, correo y copias ---------- */
  'srv-summary-test': () => api('summary/test', { method: 'POST' })
    .then((r) => toast(r.empty ? 'Hoy no hay nada pendiente: no se envió nada' : r.sent ? 'Resumen enviado' : 'No hay dispositivos con notificaciones activadas'))
    .catch((err) => toast(err.message)),
  'feed-copy': () => copyText($('#feed-url').value),
  'email-save': () => saveServer({
    email: { allowed: $('#email-allowed').value.split(/[\s,;]+/).filter(Boolean), chat: $('#email-chat').value },
  }, 'Guardado'),
  'backup-now': () => {
    toast('Creando copia…');
    api('backups', { method: 'POST' }).then(async (r) => { toast(`Copia creada: ${r.messages} mensajes`); await loadBackups(); renderPane(); }).catch((err) => toast(err.message));
  },
  'backup-dl': async (el) => {
    try {
      const data = await api(`backups/${encodeURIComponent(el.dataset.v)}`);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      a.download = `retrodark-${el.dataset.v}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (err) { toast(err.message); }
  },
  'backup-restore': async (el) => {
    try { restoreData(await api(`backups/${encodeURIComponent(el.dataset.v)}`), `de la copia ${el.dataset.v.replace(/\.json$/, '')}`); } catch (err) { toast(err.message); }
  },

  /* ---------- Documentación y papelera (vistas dentro de Ajustes) ---------- */
  sub: (el) => { S.sub = el.dataset.v || null; renderPane(true); $('#pane .list')?.scrollTo(0, 0); },
  'trash-restore': async (el) => {
    await restoreMessages([el.dataset.id]);
    refreshAll();
    toast('Mensaje recuperado', { action: 'Ver', fn: () => gotoMsg(el.dataset.id) });
  },
  'trash-delete': (el) => confirmSheet('¿Borrar este mensaje para siempre? No se puede deshacer.', 'Borrar', async () => {
    await emptyTrash([el.dataset.id]);
    refreshAll();
  }),
  'trash-empty': () => confirmSheet(`¿Vaciar la papelera? Se borrarán ${S.trash.length} mensajes para siempre.`, 'Vaciar', async () => {
    await emptyTrash();
    refreshAll();
    toast('Papelera vaciada');
  }),
};

/*
 * Bloques HTML: el iframe (sandbox sin allow-same-origin) solo puede enviar su alto.
 * Se acepta únicamente si el mensaje viene de uno de esos iframes (event.source) y es
 * un número (px) o un porcentaje ("56.25%"); todo lo demás se ignora.
 */
function onEmbedMessage(e) {
  if (e.origin !== 'null') return; // los iframes aislados tienen origen opaco
  const frame = [...document.querySelectorAll('iframe.he-frame')].find((f) => f.contentWindow === e.source);
  if (!frame) return;
  const size = parseEmbedSize(e.data);
  if (!size) return;
  const prev = embedSizes.get(frame.dataset.key);
  if (prev && prev.px === size.px && prev.pct === size.pct) return;
  embedSizes.set(frame.dataset.key, size);
  const box = $('#messages');
  const stick = box && box.contains(frame) && box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  if (size.pct) { frame.style.height = 'auto'; frame.style.aspectRatio = `100 / ${size.pct}`; }
  else { frame.style.aspectRatio = ''; frame.style.height = `${size.px}px`; }
  if (stick) box.scrollTop = box.scrollHeight;
}

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
  window.addEventListener('message', onEmbedMessage);

  document.addEventListener('click', (e) => {
    if (e.target.closest('a[href], .ap-seek, video, summary, .att-ai-text')) return;
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
  // Tablero: arrastrar tarjetas entre columnas.
  document.addEventListener('dragstart', (e) => {
    const c = e.target.closest?.('.kb-card');
    if (!c) return;
    e.dataTransfer.setData('text/x-retrodark-task', c.dataset.id);
    e.dataTransfer.effectAllowed = 'move';
    c.classList.add('dragging');
  });
  document.addEventListener('dragend', (e) => e.target.closest?.('.kb-card')?.classList.remove('dragging'));
  document.addEventListener('dragover', (e) => {
    const col = e.target.closest?.('.kb-col');
    if (!col || !e.dataTransfer?.types?.includes('text/x-retrodark-task')) return;
    e.preventDefault();
    document.querySelectorAll('.kb-col.over').forEach((x) => x !== col && x.classList.remove('over'));
    col.classList.add('over');
  });
  document.addEventListener('drop', (e) => {
    const col = e.target.closest?.('.kb-col');
    const id = e.dataTransfer?.getData('text/x-retrodark-task');
    document.querySelectorAll('.kb-col.over').forEach((x) => x.classList.remove('over'));
    if (!col || !id) return;
    e.preventDefault();
    moveTask(id, col.dataset.col);
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
    if (t.matches?.('#composer-input, #f-text, #t-text') && formatShortcut(e)) return;
    if (t.id === 'composer-input' && e.key === 'Enter' && !e.isComposing) {
      // Ctrl/Cmd + Enter envía siempre.
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); send(); return; }
      // Dentro de un bloque ```código```, Enter es un salto de línea.
      if (insideFence(t.value, t.selectionStart)) return;
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
    if (t.id === 'srv-summary-on' || t.id === 'srv-summary-time') {
      saveServer({ summary: { enabled: $('#srv-summary-on').checked, time: $('#srv-summary-time').value || '08:00' } },
        $('#srv-summary-on').checked ? `Resumen diario a las ${$('#srv-summary-time').value}` : 'Resumen diario desactivado');
    }
    if (t.id === 'srv-backups-on') saveServer({ backups: { enabled: t.checked } }, t.checked ? 'Copias diarias activadas' : 'Copias diarias desactivadas');
    if (t.id === 'set-token') {
      settings.token = t.value.trim(); saveSettings(); storeToken(); t.blur(); syncNow();
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
