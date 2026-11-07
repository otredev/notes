/* RetroDark — notas y tareas con forma de chat. Punto de entrada. */
import { $, isMobile } from './utils.js';
import { S, settings, saveSettings, applyTheme } from './state.js';
import { idb } from './data/idb.js';
import { toast } from './ui/dom.js';
import { renderKind, autosize, updateSendBtn } from './views/chat.js';
import { loadLocal, seed, chatById, msgById, seedTemplates, purgeTrash } from './data/store.js';
import { refreshPushSubscription } from './push.js';
import { pruneLocalFiles } from './files.js';
import { syncNow, onStatus, onRemote, startAutoSync, storeToken } from './data/sync.js';
import { isSheetOpen } from './ui/dom.js';
import { refreshAll } from './render.js';
import { renderNav } from './views/nav.js';
import { renderPane } from './views/pane.js';
import { updateSyncIndicator } from './views/chatList.js';
import { updateSyncBox } from './views/settings.js';
import { buildMain } from './views/chat.js';
import { bindEvents } from './events.js';
import { loadServer } from './views/server.js';
import { initLock, onLockChange, isLocked } from './lock.js';
import { loadMe, onMe, onRejected } from './data/sync.js';
import { initPeople } from './people.js';
import { startLive } from './live.js';
import { checkStorageOnStart, storageBarsHtml } from './storage.js';
import { joinSheet, loginSheet } from './views/account.js';
import { initBackNav } from './backnav.js';
import { openChat, gotoMsg, closeChat, addFiles } from './actions.js';

async function init() {
  applyTheme();
  try {
    await loadLocal();
  } catch (err) {
    console.error(err);
    document.body.innerHTML = '<p style="padding:24px">No se pudo abrir el almacenamiento de este navegador.</p>';
    return;
  }

  await loadMe();
  initPeople();
  onMe(() => { initPeople(); refreshAll(); if (S.nav === 'settings') renderPane(true); });
  onRejected((list) => toast(`⚠️ ${list[0].reason}${list.length > 1 ? ` (y ${list.length - 1} más)` : ''}`));
  onStatus(() => { updateSyncIndicator(); updateSyncBox(); });
  // Cambios desde otro dispositivo: se redibuja (salvo con una hoja abierta, para no molestar).
  onRemote(() => { if (!isSheetOpen()) refreshAll(); });
  bindEvents();
  initBackNav();

  // Dispositivo nuevo: primero se traen los datos de MongoDB y solo si no hay nada se crean los ejemplos.
  const hadLocalData = S.chats.length > 0;
  if (!hadLocalData) await syncNow();
  if (!chatById('general')) await seed();

  renderNav();
  renderPane(true);
  const params = new URLSearchParams(location.search);
  const wantedChat = params.get('chat'), wantedMsg = params.get('msg');
  if (location.search) history.replaceState(history.state, '', location.pathname);
  if (wantedChat && chatById(wantedChat)) openChat(wantedChat);
  else if (!isMobile()) openChat('general');
  else buildMain();
  openFromParams(params);

  startAutoSync();
  storeToken();
  if (hadLocalData) await syncNow();
  // Plantillas de ejemplo y limpieza de la papelera (más de 30 días).
  seedTemplates().then(() => { if (S.nav === 'org') renderPane(true); }).catch(() => {});
  purgeTrash().then((n) => { if (n) refreshAll(); }).catch(() => {});
  // Qué ofrece el servidor (IA, copias, tiempo real, espacio…).
  const afterServer = (s) => {
    const box = document.getElementById('storage-box');
    if (box) box.innerHTML = storageBarsHtml();
    return s;
  };
  loadServer().then((s) => {
    afterServer(s);
    if (s?.features?.ai) refreshAll();
    checkStorageOnStart();
    startLive();
  });
  setInterval(() => { if (document.visibilityState === 'visible') loadServer().then(afterServer); }, 10 * 60e3);
  onLockChange(() => {
    if (S.active && isLocked(S.active)) { if (isMobile()) { S.active = null; closeChat(); buildMain(); } else openChat('general'); }
    refreshAll();
  });
  initLock();
  if (wantedMsg) openFromNotification(wantedMsg);
  // Libera espacio: copias de archivos que ya no usa ningún mensaje.
  setTimeout(() => pruneLocalFiles([...S.messages, ...S.trash]).catch(() => {}), 10000);

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
    // Tocar una notificación con la app ya abierta.
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data?.type === 'open-msg') openFromNotification(e.data.id);
      if (e.data?.type === 'sync') syncNow();
      if (e.data?.type === 'open-url') openFromParams(new URL(e.data.url, location.href).searchParams);
    });
    refreshPushSubscription();
  }
}

/**
 * Accesos directos del icono y "Compartir con RetroDark":
 *   ?new=task|note → General listo para escribir · ?nav=tasks&view=agenda → sección
 *   ?share=1 → lo compartido (texto, enlace, archivos) va al cuadro de texto de General
 */
async function openFromParams(params) {
  if (params.get('join')) { joinSheet(params.get('join')); return; }
  if (params.get('login')) { loginSheet(params.get('login')); return; }
  const nav = params.get('nav');
  if (nav && ['chats', 'tasks', 'org', 'settings'].includes(nav)) {
    S.nav = nav;
    if (nav === 'tasks' && ['list', 'agenda', 'board'].includes(params.get('view'))) { settings.taskView = params.get('view'); saveSettings(); }
    renderNav();
    renderPane(true);
    if (isMobile()) closeChat();
  }
  const kind = params.get('new');
  if (kind === 'task' || kind === 'note') {
    openChat('general');
    S.kind = kind;
    renderKind();
    $('#composer-input')?.focus();
  }
  if (params.has('share')) {
    const shared = params.get('share') === '1' ? await idb.get('meta', 'share') : null;
    if (shared) await idb.del('meta', 'share');
    openChat('general');
    if (!shared) { toast('No se pudo recibir lo compartido. Inténtalo otra vez con la app abierta.'); return; }
    const parts = [shared.title, shared.text, shared.url].map((x) => String(x || '').trim()).filter(Boolean);
    // Muchas apps ponen el enlace también dentro del texto: no se repite.
    const text = parts.filter((p, i) => !parts.some((q, j) => j !== i && q.includes(p) && q.length > p.length)).filter((p, i, a) => a.indexOf(p) === i).join('\n');
    const ta = $('#composer-input');
    if (ta && text) { ta.value = text; autosize(ta); updateSendBtn(); }
    if (shared.files?.length) await addFiles(shared.files);
    ta?.focus();
    toast('Revisa y envía lo que compartiste');
  }
}

/** Abre el mensaje de una notificación (si aún no llegó, sincroniza antes). */
async function openFromNotification(id) {
  if (!id) return;
  if (!msgById(id)) await syncNow();
  if (msgById(id)) gotoMsg(id);
}

init();
