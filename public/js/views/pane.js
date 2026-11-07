/* Panel lateral: muestra la sección activa (Chats, Tareas, Organizar o Ajustes). */
import { $ } from '../utils.js';
import { S } from '../state.js';
import { chatsPaneHtml, refreshChats, updateSyncIndicator } from './chatList.js';
import { tasksPaneHtml } from './tasks.js';
import { orgPaneHtml } from './organize.js';
import { settingsPaneHtml, updatePushBox } from './settings.js';
import { docsPaneHtml } from './docs.js';
import { trashPaneHtml } from './trash.js';

const VIEWS = { chats: chatsPaneHtml, tasks: tasksPaneHtml, org: orgPaneHtml, settings: settingsPaneHtml };
/** Vistas dentro de Ajustes. */
const SUBS = { docs: docsPaneHtml, trash: trashPaneHtml };

/** Redibuja el panel. Sin `force`, la lista de chats se actualiza sin perder el foco del buscador. */
export function renderPane(force = false) {
  if (S.nav === 'chats' && !force && $('#search')) { refreshChats(); return; }
  const pane = $('#pane');
  const sub = S.nav === 'settings' && SUBS[S.sub] ? S.sub : null;
  const key = sub || S.nav;
  const scroll = pane.dataset.nav === key ? ($('.list', pane)?.scrollTop || 0) : 0;
  pane.innerHTML = sub ? SUBS[sub]() : VIEWS[S.nav]();
  pane.dataset.nav = key;
  const list = $('.list', pane);
  if (list) list.scrollTop = scroll;
  if (S.nav === 'chats') updateSyncIndicator();
  if (S.nav === 'settings' && !sub) updatePushBox();
}
