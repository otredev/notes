/* Papelera: mensajes eliminados en los últimos 30 días. */
import { esc, shortWhen } from '../utils.js';
import { ic } from '../icons.js';
import { S } from '../state.js';
import { chatById, summary, TRASH_DAYS } from '../data/store.js';
import { empty } from '../ui/parts.js';

const daysLeft = (m) => Math.max(0, Math.ceil((m.trashedAt + TRASH_DAYS * 864e5 - Date.now()) / 864e5));

export function trashPaneHtml() {
  const list = [...S.trash].sort((a, b) => b.trashedAt - a.trashedAt);
  const rows = list.map((m) => {
    const c = chatById(m.chatId);
    const left = daysLeft(m);
    return `<div class="trash-row">
      <div class="grow"><div class="cr-top"><span class="res-chat">${c ? `${esc(c.emoji)} ${esc(c.name)}` : 'Chat eliminado → General'}</span><span class="cr-time">${shortWhen(m.trashedAt)}</span></div>
        <div class="res-text">${esc(summary(m))}</div>
        <small class="muted">Se borrará ${left <= 1 ? 'mañana' : `en ${left} días`}</small></div>
      <div class="trash-acts">
        <button class="icon-btn" data-act="trash-restore" data-id="${m.id}" title="Recuperar" aria-label="Recuperar">${ic('restore')}</button>
        <button class="icon-btn danger" data-act="trash-delete" data-id="${m.id}" title="Borrar para siempre" aria-label="Borrar para siempre">${ic('trash')}</button>
      </div></div>`;
  }).join('');
  return `<header class="pane-head"><button class="icon-btn" data-act="sub" data-v="" aria-label="Volver a Ajustes">${ic('back')}</button><h1>Papelera</h1>
      ${list.length ? '<button class="link-btn danger" data-act="trash-empty">Vaciar</button>' : ''}</header>
    <div class="list"><p class="muted small pad">Lo que eliminas se guarda aquí ${TRASH_DAYS} días y luego se borra solo (en todos tus dispositivos).</p>
      ${rows || empty('La papelera está vacía')}</div>`;
}
