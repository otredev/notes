/* Redibuja todo lo que depende de los datos. */
import { $ } from './utils.js';
import { S } from './state.js';
import { chatById } from './data/store.js';
import { renderNav } from './views/nav.js';
import { renderPane } from './views/pane.js';
import { buildMain, renderChatHead, renderFilters, renderMessages } from './views/chat.js';

export function refreshAll(stick = false) {
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
}
