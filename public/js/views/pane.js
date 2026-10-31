/* Panel lateral: muestra la sección activa (Chats, Tareas, Organizar o Ajustes). */
import { $ } from '../utils.js';
import { S } from '../state.js';
import { chatsPaneHtml, refreshChats, updateSyncIndicator } from './chatList.js';
import { tasksPaneHtml } from './tasks.js';
import { orgPaneHtml } from './organize.js';
import { settingsPaneHtml, updatePushBox } from './settings.js';

const VIEWS = { chats: chatsPaneHtml, tasks: tasksPaneHtml, org: orgPaneHtml, settings: settingsPaneHtml };

/** Redibuja el panel. Sin `force`, la lista de chats se actualiza sin perder el foco del buscador. */
export function renderPane(force = false) {
  if (S.nav === 'chats' && !force && $('#search')) { refreshChats(); return; }
  const pane = $('#pane');
  const scroll = pane.dataset.nav === S.nav ? ($('.list', pane)?.scrollTop || 0) : 0;
  pane.innerHTML = VIEWS[S.nav]();
  pane.dataset.nav = S.nav;
  const list = $('.list', pane);
  if (list) list.scrollTop = scroll;
  if (S.nav === 'chats') updateSyncIndicator();
  if (S.nav === 'settings') updatePushBox();
}
