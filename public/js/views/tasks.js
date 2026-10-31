/* Vista global de tareas: vencidas, hoy, próximas, sin fecha y completadas. */
import { esc, todayKey } from '../utils.js';
import { ic } from '../icons.js';
import { S } from '../state.js';
import { fmt } from '../text.js';
import { chatById, catById } from '../data/store.js';
import { catChip, dueChip, empty, catPick, remindChip } from '../ui/parts.js';

function taskRow(m) {
  const c = chatById(m.chatId), cat = catById(m.categoryId);
  return `<div class="task-row ${m.done ? 'done' : ''}" data-act="goto-msg" data-id="${m.id}" role="button" tabindex="0">
    <button class="check ${m.done ? 'on' : ''}" data-act="toggle" data-id="${m.id}" aria-label="${m.done ? 'Marcar como pendiente' : 'Completar'}">${ic('check')}</button>
    <div class="tr-body"><div class="tr-text">${fmt(m.text)}</div>
      <div class="tr-meta">${c ? `<span>${esc(c.emoji)} ${esc(c.name)}</span>` : ''}${cat ? catChip(cat) : ''}${m.due ? dueChip(m) : ''}${remindChip(m)}${m.starred ? ic('star', 'tiny') : ''}</div>
    </div></div>`;
}

export function tasksPaneHtml() {
  const t = todayKey();
  const all = S.messages.filter((m) => m.kind === 'task');
  const usedCats = S.categories.filter((c) => all.some((m) => m.categoryId === c.id));
  if (S.taskCat !== 'all' && !usedCats.some((c) => c.id === S.taskCat)) S.taskCat = 'all';
  const tasks = all.filter((m) => S.taskCat === 'all' || m.categoryId === S.taskCat);
  const pending = tasks.filter((m) => !m.done).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || a.createdAt - b.createdAt);
  const done = tasks.filter((m) => m.done).sort((a, b) => (b.doneAt || b.updatedAt) - (a.doneAt || a.updatedAt));
  const sections = [
    ['Vencidas', (m) => m.due && m.due < t, 'danger'],
    ['Hoy', (m) => m.due === t, ''],
    ['Próximas', (m) => m.due && m.due > t, ''],
    ['Sin fecha', (m) => !m.due, ''],
  ];

  let h = `<header class="pane-head"><h1>Tareas</h1><span class="muted small">${all.filter((m) => !m.done).length} pendientes</span></header>`;
  if (usedCats.length) {
    h += `<div class="chips scroll-x"><button class="chip ${S.taskCat === 'all' ? 'on' : ''}" data-act="task-cat" data-v="all">Todas</button>${usedCats.map((c) => catPick(c, S.taskCat === c.id, `data-act="task-cat" data-v="${c.id}"`)).join('')}</div>`;
  }
  h += '<div class="list">';
  if (!tasks.length) h += empty('No hay tareas. Escribe "[] algo" en cualquier chat para crear una.');
  for (const [label, fn, cls] of sections) {
    const items = pending.filter(fn);
    if (items.length) h += `<div class="sec-title ${cls}">${label} <span>${items.length}</span></div>${items.map(taskRow).join('')}`;
  }
  if (done.length) {
    h += `<button class="sec-title collapse-btn" data-act="toggle-done-list">Completadas (${done.length}) <span>${S.showDone ? '▾' : '▸'}</span></button>`;
    if (S.showDone) h += done.map(taskRow).join('');
  }
  return h + '</div>';
}
