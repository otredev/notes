/* Redibuja todo lo que depende de los datos. */
import { $ } from './utils.js';
import { S } from './state.js';
import { chatById } from './data/store.js';
import { renderNav } from './views/nav.js';
import { renderPane } from './views/pane.js';
import { markRead, updateAppBadge, viewing } from './unread.js';
import { buildMain, renderChatHead, renderFilters, renderMessages } from './views/chat.js';

export function refreshAll(stick = false) {
  // Lo que llega mientras miras el chat ya está leído.
  if (S.active && viewing(S.active)) markRead(S.active);
  renderNav();
  renderPane();
  if (S.active && !chatById(S.active)) {
    // El chat abierto se borró (aquí o en otro dispositivo)
    S.active = null;
    $('#app').classList.remove('chat-open');
    buildMain();
    return;
  }
  if (S.active && $('#messages')) {
    renderChatHead();
    renderFilters();
    renderMessages(stick);
  }
  updateAppBadge();
}

// Al volver a la app, el chat que tenías abierto queda leído.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && S.active && viewing(S.active)) markRead(S.active).then((ch) => ch && renderPane());
});
