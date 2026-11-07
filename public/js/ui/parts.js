/* Piezas de HTML reutilizables. */
import { esc, todayKey, dueLabel, isOverdue, remindLabel } from '../utils.js';
import { repeatLabel } from '../recurrence.js';

/** Chip de tarea recurrente: 🔁 Cada lunes. */
export const repeatChip = (m) => (m.repeat?.freq ? `<span class="repeat-chip" title="Se repite">🔁 ${esc(repeatLabel(m.repeat))}</span>` : '');

/** Chip de recordatorio: ⏰ mañana 9:30 (apagado si ya pasó). */
export const remindChip = (m) => (m.remindAt
  ? `<span class="remind-chip ${m.remindAt <= Date.now() ? 'past' : ''}" title="Recordatorio">⏰ ${remindLabel(m.remindAt)}</span>` : '');

export const avatar = (c, size = '') => `<span class="avatar ${size}" style="--c:${c.color}">${esc(c.emoji || '💬')}</span>`;
export const catChip = (c) => `<span class="cat-chip" style="--c:${c.color}">${esc(c.name)}</span>`;
export const dueChip = (m) => `<span class="due-chip ${!m.done && isOverdue(m.due) ? 'late' : ''} ${m.due === todayKey() ? 'today' : ''}">📅 ${dueLabel(m.due)}</span>`;
export const empty = (t) => `<div class="empty">${esc(t)}</div>`;
/** Chip de categoría seleccionable (data-s / data-act según el contexto). */
export const catPick = (c, on, attrs) => `<button class="chip cdot ${on ? 'on' : ''}" style="--c:${c.color}" ${attrs}>${esc(c.name)}</button>`;
