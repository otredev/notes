/*
 * Tareas: tres vistas.
 *  - Lista: vencidas, hoy, próximas, sin fecha y completadas.
 *  - Agenda: calendario del mes con tareas, fechas y recordatorios (incluidas las repeticiones).
 *  - Tablero: Por hacer · En curso · Hecho (arrastrar o con las flechas).
 */
import { esc, todayKey, hm, fromKey, dayKey } from '../utils.js';
import { ic } from '../icons.js';
import { S, settings } from '../state.js';
import { fmt } from '../text.js';
import { chatById, catById } from '../data/store.js';
import { catChip, dueChip, empty, catPick, remindChip, repeatChip } from '../ui/parts.js';
import { nextDate } from '../recurrence.js';
import { hiddenChatIds } from '../lock.js';

const VIEWS = [['list', 'Lista'], ['agenda', 'Agenda'], ['board', 'Tablero']];
export const taskView = () => (VIEWS.some(([k]) => k === settings.taskView) ? settings.taskView : 'list');

function taskRow(m, { time = '' } = {}) {
  const c = chatById(m.chatId), cat = catById(m.categoryId);
  const isTask = m.kind === 'task';
  return `<div class="task-row ${m.done ? 'done' : ''}" data-act="goto-msg" data-id="${m.id}" role="button" tabindex="0">
    ${isTask ? `<button class="check ${m.done ? 'on' : ''}" data-act="toggle" data-id="${m.id}" aria-label="${m.done ? 'Marcar como pendiente' : 'Completar'}">${ic('check')}</button>` : `<span class="tr-bullet">${m.kind === 'note' ? '📝' : '💬'}</span>`}
    <div class="tr-body">${time ? `<span class="tr-time">${time}</span>` : ''}<div class="tr-text">${fmt(m.poll?.question || m.text)}</div>
      <div class="tr-meta">${c ? `<span>${esc(c.emoji)} ${esc(c.name)}</span>` : ''}${cat ? catChip(cat) : ''}${!time && m.due ? dueChip(m) : ''}${time ? '' : remindChip(m)}${repeatChip(m)}${m.status === 'doing' && !m.done ? '<span class="doing-chip">En curso</span>' : ''}${m.starred ? ic('star', 'tiny') : ''}</div>
    </div></div>`;
}

/** Mensajes visibles (sin chats bloqueados) y filtrados por categoría. */
function visible() {
  const hidden = hiddenChatIds();
  return S.messages.filter((m) => !hidden.has(m.chatId) && (S.taskCat === 'all' || m.categoryId === S.taskCat));
}

function header(all) {
  const usedCats = S.categories.filter((c) => S.messages.some((m) => m.kind === 'task' && m.categoryId === c.id));
  if (S.taskCat !== 'all' && !usedCats.some((c) => c.id === S.taskCat)) S.taskCat = 'all';
  const v = taskView();
  const hiddenN = hiddenChatIds().size ? S.messages.filter((m) => hiddenChatIds().has(m.chatId) && m.kind === 'task' && !m.done).length : 0;
  let h = `<header class="pane-head"><h1>Tareas</h1><span class="muted small">${all.filter((m) => m.kind === 'task' && !m.done).length} pendientes</span></header>
    <div class="seg task-views">${VIEWS.map(([k, l]) => `<button class="${v === k ? 'on' : ''}" data-act="task-view" data-v="${k}">${l}</button>`).join('')}</div>`;
  if (usedCats.length) {
    h += `<div class="chips scroll-x"><button class="chip ${S.taskCat === 'all' ? 'on' : ''}" data-act="task-cat" data-v="all">Todas</button>${usedCats.map((c) => catPick(c, S.taskCat === c.id, `data-act="task-cat" data-v="${c.id}"`)).join('')}</div>`;
  }
  if (hiddenN) h += `<button class="locked-note" data-act="unlock">🔒 ${hiddenN} tarea${hiddenN > 1 ? 's' : ''} en chats bloqueados · Desbloquear</button>`;
  return h;
}

/* ---------- Lista ---------- */
function listHtml(msgs) {
  const t = todayKey();
  const tasks = msgs.filter((m) => m.kind === 'task');
  const pending = tasks.filter((m) => !m.done).sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || a.createdAt - b.createdAt);
  const done = tasks.filter((m) => m.done).sort((a, b) => (b.doneAt || b.updatedAt) - (a.doneAt || a.updatedAt));
  const sections = [
    ['Vencidas', (m) => m.due && m.due < t, 'danger'],
    ['Hoy', (m) => m.due === t, ''],
    ['Próximas', (m) => m.due && m.due > t, ''],
    ['Sin fecha', (m) => !m.due, ''],
  ];
  let h = '';
  if (!tasks.length) h += empty('No hay tareas. Escribe "[] algo" en cualquier chat para crear una.');
  for (const [label, fn, cls] of sections) {
    const items = pending.filter(fn);
    if (items.length) h += `<div class="sec-title ${cls}">${label} <span>${items.length}</span></div>${items.map((m) => taskRow(m)).join('')}`;
  }
  if (done.length) {
    h += `<button class="sec-title collapse-btn" data-act="toggle-done-list">Completadas (${done.length}) <span>${S.showDone ? '▾' : '▸'}</span></button>`;
    if (S.showDone) h += done.map((m) => taskRow(m)).join('');
  }
  return h;
}

/* ---------- Agenda ---------- */
const monthKey = (k) => k.slice(0, 7);
const pad = (n) => String(n).padStart(2, '0');

/** Fecha de un mensaje en la agenda: su fecha límite o el día de su recordatorio. */
const baseDate = (m) => m.due || (m.remindAt ? dayKey(new Date(m.remindAt)) : null);

/** Apariciones de cada mensaje entre `from` y `to` (incluidas las repeticiones futuras). */
export function occurrences(msgs, from, to) {
  const out = [];
  for (const m of msgs) {
    const base = baseDate(m);
    if (!base) continue;
    if (m.kind === 'task' && m.done && !(base >= from && base <= to)) continue;
    if (!m.repeat?.freq || m.done) {
      if (base >= from && base <= to) out.push({ m, date: base, projected: false });
      continue;
    }
    let k = base;
    for (let i = 0; k && k <= to && i < 400; i++) {
      if (k >= from) out.push({ m, date: k, projected: k !== base });
      k = nextDate(m.repeat, k, k);
    }
  }
  return out;
}

function agendaHtml(msgs) {
  const t = todayKey();
  const month = S.agendaMonth || monthKey(t);
  const day = S.agendaDay && monthKey(S.agendaDay) === month ? S.agendaDay : (monthKey(t) === month ? t : `${month}-01`);
  const [y, mo] = month.split('-').map(Number);
  const first = new Date(y, mo - 1, 1), daysIn = new Date(y, mo, 0).getDate();
  const from = `${month}-01`, to = `${month}-${pad(daysIn)}`;
  const occ = occurrences(msgs.filter((m) => m.due || m.remindAt), from, to);
  const byDay = new Map();
  for (const o of occ) (byDay.get(o.date) || byDay.set(o.date, []).get(o.date)).push(o);

  const title = first.toLocaleDateString('es', { month: 'long', year: 'numeric' });
  let grid = ['L', 'M', 'X', 'J', 'V', 'S', 'D'].map((d) => `<span class="ag-wd">${d}</span>`).join('');
  const lead = (first.getDay() + 6) % 7;
  grid += '<span></span>'.repeat(lead);
  for (let d = 1; d <= daysIn; d++) {
    const k = `${month}-${pad(d)}`;
    const items = byDay.get(k) || [];
    const late = items.some(({ m }) => m.kind === 'task' && !m.done && k < t);
    const dots = items.slice(0, 3).map(({ m }) => `<i style="--c:${catById(m.categoryId)?.color || (m.kind === 'task' ? 'var(--green)' : 'var(--muted)')}"></i>`).join('');
    grid += `<button class="ag-day ${k === t ? 'today' : ''} ${k === day ? 'sel' : ''} ${late ? 'late' : ''}" data-act="agenda-day" data-v="${k}" aria-label="${d}: ${items.length} elementos">
      <span>${d}</span><span class="ag-dots">${dots}${items.length > 3 ? '<b>+</b>' : ''}</span></button>`;
  }
  const list = (byDay.get(day) || []).sort((a, b) => (a.m.remindAt ? hm(a.m.remindAt) : '99') .localeCompare(b.m.remindAt ? hm(b.m.remindAt) : '99'));
  const dayTitle = fromKey(day).toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' });
  return `<div class="agenda">
      <div class="ag-head">
        <button class="icon-btn" data-act="agenda-month" data-v="-1" aria-label="Mes anterior">‹</button>
        <b class="grow">${esc(title)}</b>
        ${month !== monthKey(t) ? '<button class="link-btn" data-act="agenda-today">Hoy</button>' : ''}
        <button class="icon-btn" data-act="agenda-month" data-v="1" aria-label="Mes siguiente">›</button>
      </div>
      <div class="ag-grid">${grid}</div>
    </div>
    <div class="sec-title">${esc(dayTitle)} <span>${list.length || ''}</span></div>
    ${list.length ? list.map(({ m, projected }) => (projected
      ? `<div class="task-row projected" data-act="goto-msg" data-id="${m.id}" role="button" tabindex="0"><span class="tr-bullet">🔁</span><div class="tr-body">${m.remindAt ? `<span class="tr-time">${hm(m.remindAt)}</span>` : ''}<div class="tr-text">${fmt(m.text)}</div><div class="tr-meta">${repeatChip(m)}</div></div></div>`
      : taskRow(m, { time: m.remindAt && dayKey(new Date(m.remindAt)) === day ? hm(m.remindAt) : '' }))).join('') : empty('Nada para este día')}`;
}

/* ---------- Tablero ---------- */
export const COLUMNS = [['todo', 'Por hacer'], ['doing', 'En curso'], ['done', 'Hecho']];
export const columnOf = (m) => (m.done ? 'done' : m.status === 'doing' ? 'doing' : 'todo');

function card(m) {
  const c = chatById(m.chatId), cat = catById(m.categoryId);
  const col = columnOf(m), i = COLUMNS.findIndex(([k]) => k === col);
  return `<div class="kb-card ${m.done ? 'done' : ''}" draggable="true" data-id="${m.id}" data-act="goto-msg" role="button" tabindex="0" ${cat ? `style="--cat:${cat.color}"` : ''}>
    <div class="kb-text">${fmt(m.text)}</div>
    <div class="tr-meta">${c ? `<span>${esc(c.emoji)} ${esc(c.name)}</span>` : ''}${cat ? catChip(cat) : ''}${m.due ? dueChip(m) : ''}${repeatChip(m)}</div>
    <div class="kb-move">
      ${i > 0 ? `<button class="icon-btn" data-act="kb-move" data-id="${m.id}" data-v="${COLUMNS[i - 1][0]}" title="Mover a ${COLUMNS[i - 1][1]}" aria-label="Mover a ${COLUMNS[i - 1][1]}">‹</button>` : '<span></span>'}
      ${i < COLUMNS.length - 1 ? `<button class="icon-btn" data-act="kb-move" data-id="${m.id}" data-v="${COLUMNS[i + 1][0]}" title="Mover a ${COLUMNS[i + 1][1]}" aria-label="Mover a ${COLUMNS[i + 1][1]}">›</button>` : ''}
    </div></div>`;
}

function boardHtml(msgs) {
  const tasks = msgs.filter((m) => m.kind === 'task');
  const twoWeeks = Date.now() - 14 * 864e5;
  const cols = COLUMNS.map(([k, label]) => {
    let items = tasks.filter((m) => columnOf(m) === k);
    if (k === 'done') items = items.filter((m) => (m.doneAt || m.updatedAt) > twoWeeks).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
    else items.sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || a.createdAt - b.createdAt);
    return `<section class="kb-col" data-col="${k}"><h3>${label} <span>${items.length}</span></h3>
      <div class="kb-list">${items.map(card).join('') || `<p class="kb-empty">${k === 'done' ? 'Lo completado en las últimas 2 semanas' : 'Arrastra tareas aquí'}</p>`}</div></section>`;
  }).join('');
  return `<div class="board">${cols}</div>`;
}

export function tasksPaneHtml() {
  const msgs = visible();
  const v = taskView();
  const body = v === 'agenda' ? agendaHtml(msgs) : v === 'board' ? boardHtml(msgs) : listHtml(msgs);
  return `${header(msgs)}<div class="list ${v === 'board' ? 'board-wrap' : ''}">${body}</div>`;
}
