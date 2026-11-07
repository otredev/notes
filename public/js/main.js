/* RetroDark — notas y tareas con forma de chat. Punto de entrada. */
import { isMobile } from './utils.js';
import { S, applyTheme } from './state.js';
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
import { initBackNav } from './backnav.js';
import { openChat, gotoMsg } from './actions.js';

async function init() {
  applyTheme();
  try {
    await loadLocal();
  } catch (err) {
    console.error(err);
    document.body.innerHTML = '<p style="padding:24px">No se pudo abrir el almacenamiento de este navegador.</p>';
    return;
  }

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
  if (wantedMsg || wantedChat) history.replaceState(history.state, '', location.pathname);
  if (wantedChat && chatById(wantedChat)) openChat(wantedChat);
  else if (!isMobile()) openChat('general');
  else buildMain();

  startAutoSync();
  storeToken();
  if (hadLocalData) await syncNow();
  // Plantillas de ejemplo y limpieza de la papelera (más de 30 días).
  seedTemplates().then(() => { if (S.nav === 'org') renderPane(true); }).catch(() => {});
  purgeTrash().then((n) => { if (n) refreshAll(); }).catch(() => {});
  if (wantedMsg) openFromNotification(wantedMsg);
  // Libera espacio: copias de archivos que ya no usa ningún mensaje.
  setTimeout(() => pruneLocalFiles([...S.messages, ...S.trash]).catch(() => {}), 10000);

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
    // Tocar una notificación con la app ya abierta.
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data?.type === 'open-msg') openFromNotification(e.data.id);
      if (e.data?.type === 'sync') syncNow();
    });
    refreshPushSubscription();
  }
}

/** Abre el mensaje de una notificación (si aún no llegó, sincroniza antes). */
async function openFromNotification(id) {
  if (!id) return;
  if (!msgById(id)) await syncNow();
  if (msgById(id)) gotoMsg(id);
}

init();
