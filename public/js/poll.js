/*
 * Encuestas, como las de WhatsApp.
 *
 * m.poll = { question, options: [{ id, text }], multi, closed, votes: { [votante]: [idOpción…] } }
 * Por ahora el único votante es 'me'; el formato ya admite un voto por persona para los chats compartidos.
 */
import { $, uid, esc } from './utils.js';
import { S } from './state.js';
import { fmt } from './text.js';
import { chatById, msgById, put, touch } from './data/store.js';
import { sheet, closeSheet, toast } from './ui/dom.js';
import { refreshAll } from './render.js';

export const VOTER = 'me';
const MAX_OPTIONS = 12;

export function pollCounts(p) {
  const counts = Object.fromEntries(p.options.map((o) => [o.id, 0]));
  let voters = 0;
  for (const ids of Object.values(p.votes || {})) {
    const valid = (ids || []).filter((id) => id in counts);
    if (valid.length) voters++;
    valid.forEach((id) => { counts[id]++; });
  }
  return { counts, voters };
}

export function pollHtml(m) {
  const p = m.poll;
  const { counts, voters } = pollCounts(p);
  const mine = new Set(p.votes?.[VOTER] || []);
  const max = Math.max(0, ...Object.values(counts));
  const opts = p.options.map((o) => {
    const n = counts[o.id], pct = voters ? Math.round((n / voters) * 100) : 0;
    return `<button class="poll-opt ${mine.has(o.id) ? 'on' : ''} ${n && n === max ? 'top' : ''}" data-act="poll-vote" data-id="${m.id}" data-o="${o.id}" ${p.closed ? 'disabled' : ''}
        aria-pressed="${mine.has(o.id)}" aria-label="${esc(o.text)}: ${n} voto${n === 1 ? '' : 's'}">
      <span class="po-check ${p.multi ? 'sq' : ''}"></span><span class="po-text">${esc(o.text)}</span><span class="po-n">${n}</span>
      <span class="po-bar"><i style="width:${pct}%"></i></span></button>`;
  }).join('');
  const sub = p.closed ? '🔒 Encuesta cerrada' : p.multi ? 'Elige una o varias opciones' : 'Elige una opción';
  return `<div class="poll"><div class="poll-q">${fmt(p.question)}</div><div class="poll-sub">${sub}</div>${opts}
    <div class="poll-foot">${voters} voto${voters === 1 ? '' : 's'}</div></div>`;
}

export async function vote(msgId, optId) {
  const m = msgById(msgId);
  if (!m?.poll || m.poll.closed || !m.poll.options.some((o) => o.id === optId)) return;
  const votes = { ...(m.poll.votes || {}) };
  const cur = new Set(votes[VOTER] || []);
  if (m.poll.multi) { if (cur.has(optId)) cur.delete(optId); else cur.add(optId); }
  else if (cur.has(optId)) cur.clear();
  else { cur.clear(); cur.add(optId); }
  if (cur.size) votes[VOTER] = [...cur]; else delete votes[VOTER];
  m.poll = { ...m.poll, votes };
  await put('messages', m);
  navigator.vibrate?.(8);
  refreshAll();
}

export async function setPollClosed(m, closed) {
  m.poll = { ...m.poll, closed };
  await put('messages', m);
  refreshAll();
}

/** Hoja para crear una encuesta en el chat abierto. */
export function pollSheet(question = '') {
  const chat = chatById(S.active);
  if (!chat) return;
  const optRow = (v = '') => `<div class="poll-row"><input class="poll-in" maxlength="100" placeholder="Opción" value="${esc(v)}" autocomplete="off">
    <button class="icon-btn" data-s="opt-del" aria-label="Quitar opción" type="button">✕</button></div>`;
  const body = `<label class="field"><span>Pregunta</span><input id="poll-q" maxlength="200" value="${esc(question)}" placeholder="¿Qué cenamos?" autocomplete="off"></label>
    <div class="field"><span>Opciones</span><div id="poll-opts">${optRow()}${optRow()}</div>
      <button class="link-btn" data-s="opt-add" type="button">+ Añadir opción</button></div>
    <label class="toggle"><input type="checkbox" id="poll-multi"> Permitir varias respuestas</label>`;
  sheet('Nueva encuesta', body, {
    actions: '<span class="grow"></span><button class="btn ghost" data-act="sheet-close">Cancelar</button><button class="btn primary" data-s="create">Enviar encuesta</button>',
    onMount: (sh) => {
      const box = $('#poll-opts', sh);
      const addRow = () => {
        if (box.children.length >= MAX_OPTIONS) { toast(`Máximo ${MAX_OPTIONS} opciones`); return; }
        box.insertAdjacentHTML('beforeend', optRow());
        box.lastElementChild.querySelector('input').focus();
      };
      // Enter en la última opción añade otra.
      sh.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || !e.target.classList.contains('poll-in')) return;
        e.preventDefault();
        if (e.target.closest('.poll-row') === box.lastElementChild && e.target.value.trim()) addRow();
        else e.target.closest('.poll-row').nextElementSibling?.querySelector('input').focus();
      });
      sh.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-s]');
        if (!b) return;
        if (b.dataset.s === 'opt-add') addRow();
        if (b.dataset.s === 'opt-del') { if (box.children.length > 2) b.closest('.poll-row').remove(); else b.closest('.poll-row').querySelector('input').value = ''; }
        if (b.dataset.s === 'create') {
          const q = $('#poll-q', sh).value.trim();
          const seen = new Set();
          const options = [...sh.querySelectorAll('.poll-in')].map((i) => i.value.trim())
            .filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()))
            .map((text) => ({ id: uid(), text }));
          if (!q) { $('#poll-q', sh).focus(); toast('Escribe la pregunta'); return; }
          if (options.length < 2) { toast('Pon al menos dos opciones distintas'); return; }
          const now = Date.now();
          const msg = {
            id: uid(), chatId: chat.id, text: q, kind: 'message', done: false, doneAt: null, tags: [], categoryId: null, due: null,
            starred: false, pinned: false, from: 'me', triaged: true, createdAt: now, remindAt: null,
            poll: { question: q, options, multi: $('#poll-multi', sh).checked, closed: false, votes: {} },
          };
          await put('messages', msg);
          await touch(chat.id);
          closeSheet();
          refreshAll(true);
        }
      });
      setTimeout(() => $('#poll-q', sh).focus(), 60);
    },
  });
}
