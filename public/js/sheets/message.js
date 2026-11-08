/*
 * Hoja para editar un mensaje: texto, tipo, categoría, etiquetas, fecha, repetición, chat…
 * Los cambios se guardan solos al cerrarla (X, tocar fuera, Atrás, Escape). "Cancelar" es lo único que los descarta.
 */
import { $, esc, uniq, toLocalInput, fromLocalInput, todayKey, dayKey } from '../utils.js';
import { ic } from '../icons.js';
import { KINDS } from '../constants.js';
import { S } from '../state.js';
import { extractTags, splitTags } from '../text.js';
import { msgById, chatById, allTags, put, touch } from '../data/store.js';
import { sheet, closeSheet, toast, copyText, pickSheet } from '../ui/dom.js';
import { catPick, avatar } from '../ui/parts.js';
import { refreshAll } from '../render.js';
import { gotoMsg, startReply, confirmReminder, deleteMessages } from '../actions.js';
import { restoreMessages } from '../data/store.js';
import { quoteHtml } from '../views/chat.js';
import { isAudio, fmtSize } from '../files.js';
import { htmlOf } from './html.js';
import { REPEATS, DOW, firstDate, advance, repeatLabel } from '../recurrence.js';
import { googleCalendarUrl, downloadIcs } from '../calendar.js';
import { pollCounts, setPollClosed, pollVoters } from '../poll.js';
import { canEdit, canDelete, canGuard, isChatAdmin, nameOf } from '../people.js';

const repeatKey = (r) => (!r?.freq ? '' : r.freq === 'week' && Number.isInteger(r.dow) ? `week:${r.dow}` : r.freq);
const repeatFromKey = (k) => {
  if (!k) return null;
  const [freq, dow] = k.split(':');
  return dow !== undefined ? { freq, dow: Number(dow) } : { freq };
};

function repeatOptions(m) {
  const dow = (m.due ? new Date(`${m.due}T12:00`) : new Date()).getDay();
  const cur = repeatKey(m.repeat);
  const opts = [['', 'No se repite'], ['day', REPEATS.day], ['weekdays', REPEATS.weekdays], [`week:${dow}`, `Cada ${DOW[dow]}`], ['month', REPEATS.month], ['year', REPEATS.year]];
  if (cur && !opts.some(([k]) => k === cur)) opts.splice(4, 0, [cur, repeatLabel(m.repeat)]);
  return opts.map(([k, l]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${esc(l)}</option>`).join('');
}

function pollInfo(m) {
  const { counts, voters: n } = pollCounts(m.poll);
  const voters = pollVoters(m.poll);
  const canClose = canEdit(m) || isChatAdmin(chatById(m.chatId));
  return `<div class="field"><span>Encuesta · ${n} voto${n === 1 ? '' : 's'}${m.poll.multi ? ' · varias respuestas' : ''}</span>
    <div class="poll-sum">${m.poll.options.map((o) => `<div><span class="grow">${esc(o.text)}${voters[o.id].length ? `<br><small class="muted">${esc(voters[o.id].join(', '))}</small>` : ''}</span><b>${counts[o.id]}</b></div>`).join('')}</div>
    ${canClose ? `<div class="btn-row"><button class="btn outline" data-s="poll-close">${m.poll.closed ? '🔓 Reabrir encuesta' : '🔒 Cerrar encuesta'}</button></div>` : ''}</div>`;
}

export function messageSheet(id) {
  const m = msgById(id);
  if (!m) return;
  const st = { kind: m.kind, cat: m.categoryId || '', atts: [...(m.attachments || [])] };
  let mode = 'save'; // 'cancel' o 'deleted' → no se guarda al cerrar
  const attRows = () => st.atts.map((a) => `<div class="pend"><span class="pend-ic">${ic(isAudio(a) ? 'mic' : 'file')}</span>
      <span class="pend-name">${esc(a.name)}<small>${fmtSize(a.size)}</small></span>
      <button class="icon-btn" data-s="att-del" data-v="${a.id}" aria-label="Quitar">${ic('close')}</button></div>`).join('');
  const chat = chatById(m.chatId);
  const editable = canEdit(m);
  const guard = canGuard(m, chat);
  const guardField = `<div class="field"><span>Protección</span>
      <label class="toggle"><input type="checkbox" id="f-lock" ${m.editLocked ? 'checked' : ''} ${guard ? '' : 'disabled'}> 🔒 Bloquear edición <small class="muted">· nadie puede cambiarlo</small></label>
      <label class="toggle"><input type="checkbox" id="f-protect" ${m.protected ? 'checked' : ''} ${guard ? '' : 'disabled'}> 🛡️ Proteger de borrado <small class="muted">· no se puede eliminar</small></label>
      ${guard ? '' : '<small class="muted">Solo quien lo escribió o un administrador puede cambiar esto.</small>'}</div>`;
  const body = `
    <p class="readonly-note" id="f-locked-note" ${m.editLocked ? '' : 'hidden'}>🔒 Bloqueado: no se puede editar. Puedes destacarlo, ponerle tu categoría o fijarlo.</p>
    ${editable ? '' : `<p class="readonly-note">✍️ Escrito por <b>${esc(nameOf(m.authorId))}</b>. Puedes marcarlo como hecho, destacarlo o ponerle tu categoría; el resto solo lo cambia quien lo escribió.</p>`}
    <div class="field"><span>${m.poll ? 'Pregunta' : 'Texto'}</span>
      <textarea id="f-text" rows="4" data-fmt>${esc(m.text)}</textarea>
      ${htmlOf(m) !== null && editable ? `<button class="btn outline sm" data-act="html-edit" data-id="${m.id}" id="f-html">${ic('code', 'tiny')} Editar HTML</button>` : ''}</div>
    ${m.poll ? pollInfo(m) : ''}
    ${st.atts.length ? `<div class="field"><span>Adjuntos</span><div class="att-list" id="f-atts">${attRows()}</div></div>` : ''}
    <div class="field"><span>Tipo</span><div class="seg">${Object.entries(KINDS).map(([k, v]) => `<button data-s="kind" data-v="${k}" class="${m.kind === k ? 'on' : ''}">${v.icon} ${v.label}</button>`).join('')}</div></div>
    <div class="field task-only" ${m.kind === 'task' ? '' : 'hidden'}><label class="toggle"><input type="checkbox" id="f-done" ${m.done ? 'checked' : ''}> Completada</label></div>
    <div class="field"><span>Categoría</span><div class="chips wrap">
      <button class="chip ${!m.categoryId ? 'on' : ''}" data-s="cat" data-v="">Ninguna</button>
      ${S.categories.map((c) => catPick(c, m.categoryId === c.id, `data-s="cat" data-v="${c.id}"`)).join('')}</div></div>
    <label class="field"><span>Etiquetas</span><input id="f-tags" value="${esc((m.tags || []).join(', '))}" placeholder="trabajo, urgente" list="tag-list" autocomplete="off">
      <datalist id="tag-list">${allTags().map(([t]) => `<option value="${esc(t)}">`).join('')}</datalist></label>
    <div class="field-row">
      <label class="field"><span>Fecha límite</span><input type="date" id="f-due" value="${m.due || ''}"></label>
      <label class="field"><span>${ic('repeat', 'tiny')} Repetir</span><select id="f-repeat">${repeatOptions(m)}</select></label>
    </div>
    <div class="field"><span>${ic('alarm', 'tiny')} Recordatorio</span>
      <input type="datetime-local" id="f-remind" value="${toLocalInput(m.remindAt)}">
      <div class="chips wrap">
        <button class="chip" data-s="remind" data-v="1h">En 1 hora</button>
        <button class="chip" data-s="remind" data-v="18">${new Date().getHours() < 18 ? 'Hoy' : 'Mañana'} 18:00</button>
        <button class="chip" data-s="remind" data-v="9">Mañana 9:00</button>
        <button class="chip ghost" data-s="remind" data-v="">Quitar</button>
      </div></div>
    <div class="field" id="cal-field" ${m.due || m.remindAt ? '' : 'hidden'}><span>${ic('calendar', 'tiny')} Añadir al calendario</span>
      <div class="btn-row"><button class="btn outline" data-s="gcal">Google Calendar</button><button class="btn outline" data-s="ics">Apple / Outlook (.ics)</button></div></div>
    <label class="field"><span>Chat</span><select id="f-chat">${S.chats.map((c) => `<option value="${c.id}" ${c.id === m.chatId ? 'selected' : ''}>${esc(c.emoji)} ${esc(c.name)}</option>`).join('')}</select></label>
    <div class="field row">
      <label class="toggle"><input type="checkbox" id="f-star" ${m.starred ? 'checked' : ''}> Destacado</label>
      <label class="toggle"><input type="checkbox" id="f-pin" ${m.pinned ? 'checked' : ''}> Fijado en el chat</label></div>
    ${guardField}
    <p class="muted small">Creado el ${new Date(m.createdAt).toLocaleString('es')} · Los cambios se guardan al cerrar.</p>
    ${m.replyTo ? `<div class="field"><span>En respuesta a</span>${quoteHtml(m.replyTo)}</div>` : ''}`;

  let sh = null, initial = '';
  /** Valores del formulario (se leen también después de cerrar: los nodos siguen en memoria). */
  const collect = () => ({
    text: $('#f-text', sh).value.trim(),
    atts: st.atts.map((a) => a.id),
    kind: st.kind,
    done: st.kind === 'task' && $('#f-done', sh).checked,
    due: $('#f-due', sh).value || null,
    repeat: $('#f-repeat', sh).value,
    remindAt: fromLocalInput($('#f-remind', sh).value),
    cat: st.cat || null,
    tags: $('#f-tags', sh).value,
    chat: $('#f-chat', sh).value,
    star: $('#f-star', sh).checked,
    pin: $('#f-pin', sh).checked,
  });

  /** Fechas que hay ahora en el formulario (para "Añadir al calendario"). */
  const formDates = () => ({ ...m, text: $('#f-text', sh).value, due: $('#f-due', sh).value || null, remindAt: fromLocalInput($('#f-remind', sh).value) });
  const updateCal = () => { const d = formDates(); $('#cal-field', sh).hidden = !(d.due || d.remindAt); };

  async function commit() {
    const v = collect();
    if (JSON.stringify(v) === initial) return;
    if (!v.text && !st.atts.length) { toast('No se guardó: el mensaje no puede quedar vacío'); return; }
    if (m.editLocked) {
      // Bloqueado: solo lo tuyo (destacado, categoría) y fijarlo.
      Object.assign(m, { categoryId: v.cat, starred: v.star, pinned: v.pin });
      await put('messages', m);
      refreshAll();
      toast('Cambios guardados');
      return;
    }
    const prevChat = m.chatId, prevRemind = m.remindAt || null, wasDone = !!m.done;
    const repeat = repeatFromKey(v.repeat);
    Object.assign(m, {
      text: v.text, attachments: st.atts, kind: repeat ? 'task' : v.kind, done: (repeat || v.kind === 'task') && v.done,
      due: v.due, remindAt: v.remindAt, categoryId: v.cat,
      tags: uniq([...extractTags(v.text), ...splitTags(v.tags)]),
      chatId: v.chat, starred: v.star, pinned: v.pin,
    });
    if (m.poll) m.poll = { ...m.poll, question: v.text };
    if (repeat) {
      m.repeat = repeat;
      if (!m.due) m.due = m.remindAt ? dayKey(new Date(m.remindAt)) : firstDate(repeat, todayKey());
      // Marcar como hecha una tarea recurrente la pasa a su próxima fecha.
      if (m.done && !wasDone) Object.assign(m, advance(m));
    } else delete m.repeat;
    if (m.done && !m.doneAt) m.doneAt = Date.now();
    if (!m.done) m.doneAt = null;
    if (m.kind !== 'message' || m.chatId !== 'general') m.triaged = true;
    await put('messages', m);
    if (m.chatId !== prevChat) await touch(m.chatId);
    refreshAll();
    if (m.chatId !== prevChat) {
      const c = chatById(m.chatId);
      toast(`Guardado y movido a ${c.emoji} ${c.name}`, { action: 'Ver', fn: () => gotoMsg(m.id) });
    } else if (m.remindAt && m.remindAt !== prevRemind) {
      confirmReminder(m.remindAt);
    } else {
      toast('Cambios guardados');
    }
  }

  sheet('Mensaje', body, {
    actions: `<button class="btn ghost" data-s="reply">${ic('reply', 'tiny')} Responder</button>
      <button class="btn ghost" data-s="quote">${ic('quote', 'tiny')} Citar en…</button>
      <button class="btn ghost" data-s="copy">${ic('copy', 'tiny')} Copiar</button>
      ${canDelete(m, chat) ? `<button class="btn danger ghost" data-s="del">${ic('trash', 'tiny')} Eliminar</button>` : ''}
      <span class="grow"></span><button class="btn outline" data-s="cancel" title="Descartar los cambios">Cancelar</button>`,
    onClose: () => { if (mode === 'save' && sh) commit().catch((err) => toast(`No se pudo guardar: ${err.message}`)); },
    onMount: (el) => {
      sh = el;
      const CONTENT = '#f-text, #f-due, #f-repeat, #f-remind, #f-chat, #f-done, #f-tags, #f-html, [data-s=kind], [data-s=remind], [data-s=att-del]';
      const applyLock = () => {
        const locked = !!m.editLocked;
        sh.querySelectorAll(CONTENT).forEach((x) => { x.disabled = locked || (!editable && !x.matches('#f-done, #f-tags')); });
        if (!editable) sh.querySelectorAll('#f-pin').forEach((x) => { x.disabled = true; });
        $('#f-locked-note', sh).hidden = !locked;
        const del = sh.querySelector('[data-s=del]');
        if (del) { del.classList.toggle('dim', !!m.protected); del.title = m.protected ? 'Protegido: quítale la protección para eliminarlo' : ''; }
      };
      applyLock();
      initial = JSON.stringify(collect());
      sh.addEventListener('input', (e) => { if (e.target.matches('#f-due, #f-remind')) updateCal(); });
      sh.addEventListener('change', async (e) => {
        if (e.target.matches('#f-due, #f-remind')) updateCal();
        if (e.target.matches('#f-lock, #f-protect')) {
          const key = e.target.id === 'f-lock' ? 'editLocked' : 'protected';
          // Al bloquear, primero se guarda lo que ya habías cambiado.
          if (key === 'editLocked' && e.target.checked) { await commit(); initial = JSON.stringify(collect()); }
          m[key] = e.target.checked;
          await put('messages', m);
          refreshAll();
          applyLock();
          if (key === 'editLocked' && !e.target.checked) initial = JSON.stringify(collect());
          toast(key === 'editLocked' ? (m.editLocked ? '🔒 Mensaje bloqueado' : '🔓 Mensaje desbloqueado') : (m.protected ? '🛡️ Protegido: no se puede eliminar' : 'Protección quitada'));
        }
      });
      sh.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-s]');
        if (!b) return;
        const s = b.dataset.s;

        if (s === 'kind' || s === 'cat') {
          st[s] = b.dataset.v;
          sh.querySelectorAll(`[data-s=${s}]`).forEach((x) => x.classList.toggle('on', x === b));
          if (s === 'kind') sh.querySelectorAll('.task-only').forEach((x) => { x.hidden = st.kind !== 'task'; });
          return;
        }
        if (s === 'att-del') {
          st.atts = st.atts.filter((a) => a.id !== b.dataset.v);
          $('#f-atts', sh).innerHTML = attRows() || '<p class="muted small">Sin adjuntos</p>';
          return;
        }
        if (s === 'remind') {
          const d = new Date();
          const v = b.dataset.v;
          if (v === '1h') d.setTime(Date.now() + 3600e3);
          else if (v === '18') { if (d.getHours() >= 18) d.setDate(d.getDate() + 1); d.setHours(18, 0, 0, 0); }
          else if (v === '9') { d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); }
          $('#f-remind', sh).value = v ? toLocalInput(d.getTime()) : '';
          updateCal();
          return;
        }
        if (s === 'gcal') { window.open(googleCalendarUrl(formDates()), '_blank', 'noopener'); return; }
        if (s === 'ics') { downloadIcs(formDates()); return; }
        if (s === 'poll-close') {
          await setPollClosed(m, !m.poll.closed);
          b.textContent = m.poll.closed ? '🔓 Reabrir encuesta' : '🔒 Cerrar encuesta';
          toast(m.poll.closed ? 'Encuesta cerrada' : 'Encuesta abierta');
          return;
        }
        if (s === 'copy') { copyText($('#f-text', sh).value); return; }
        if (s === 'reply') { closeSheet(); startReply(m.id); return; }
        if (s === 'quote') {
          pickSheet('Citar en…', S.chats.map((c) => ({ id: c.id, html: `${avatar(c, 'sm')} ${esc(c.name)}${c.id === m.chatId ? ' <small class="muted">(este chat)</small>' : ''}` })),
            (chatId) => startReply(m.id, chatId));
          return;
        }
        if (s === 'cancel') {
          const changed = JSON.stringify(collect()) !== initial;
          mode = 'cancel';
          closeSheet();
          if (changed) toast('Cambios descartados');
          return;
        }
        if (s === 'del') {
          if (m.protected) { toast('🛡️ Mensaje protegido: quítale la protección para eliminarlo'); return; }
          mode = 'deleted';
          closeSheet();
          await deleteMessages([m.id]);
          refreshAll();
          toast('Mensaje en la papelera', { action: 'Deshacer', fn: async () => { await restoreMessages([m.id]); refreshAll(); } });
        }
      });
    },
  });
}
