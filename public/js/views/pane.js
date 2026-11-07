/* Panel lateral: muestra la sección activa (Chats, Tareas, Organizar o Ajustes). */
import { $ } from '../utils.js';
import { S } from '../state.js';
import { chatsPaneHtml, refreshChats, updateSyncIndicator } from './chatList.js';
import { tasksPaneHtml, taskView } from './tasks.js';
import { orgPaneHtml } from './organize.js';
import { settingsPaneHtml, updatePushBox } from './settings.js';
import { docsPaneHtml } from './docs.js';
import { trashPaneHtml } from './trash.js';
import { autoPaneHtml, backupsPaneHtml, privacyPaneHtml, loadServer, loadBackups, fillFeedUrl } from './server.js';

const VIEWS = { chats: chatsPaneHtml, tasks: tasksPaneHtml, org: orgPaneHtml, settings: settingsPaneHtml };
/** Vistas dentro de Ajustes. */
const SUBS = { docs: docsPaneHtml, trash: trashPaneHtml, auto: autoPaneHtml, backups: backupsPaneHtml, privacy: privacyPaneHtml };
let loadingSub = null;

/** Redibuja el panel. Sin `force`, la lista de chats se actualiza sin perder el foco del buscador. */
export function renderPane(force = false) {
  if (S.nav === 'chats' && !force && $('#search')) { refreshChats(); return; }
  const pane = $('#pane');
  // No se redibuja Ajustes mientras escribes en uno de sus campos.
  const focused = document.activeElement;
  if (!force && S.nav === 'settings' && pane.contains(focused) && focused.matches('input:not([type=checkbox]), textarea, select')) return;
  const sub = S.nav === 'settings' && SUBS[S.sub] ? S.sub : null;
  const key = sub || S.nav;
  const scroll = pane.dataset.nav === key ? ($('.list', pane)?.scrollTop || 0) : 0;
  pane.innerHTML = sub ? SUBS[sub]() : VIEWS[S.nav]();
  pane.dataset.nav = key;
  // El tablero necesita más ancho en escritorio.
  $('#app').classList.toggle('wide-pane', S.nav === 'tasks' && taskView() === 'board');
  const list = $('.list', pane);
  if (list) list.scrollTop = scroll;
  if (S.nav === 'chats') updateSyncIndicator();
  if (S.nav === 'settings' && !sub) updatePushBox();
  if (sub === 'auto') fillFeedUrl();
  // Las vistas del servidor se cargan al abrirlas (y se redibujan al llegar los datos).
  if ((sub === 'auto' || sub === 'backups') && force && loadingSub !== sub) {
    loadingSub = sub;
    Promise.all([loadServer(), sub === 'backups' ? loadBackups() : null]).finally(() => {
      loadingSub = null;
      if (S.sub === sub && S.nav === 'settings') renderPane();
    });
  }
}
