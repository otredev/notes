/* Hoja para editar un mensaje: texto, tipo, categoría, etiquetas, fecha, chat… */
import { $, esc, uniq, toLocalInput, fromLocalInput } from '../utils.js';
import { ic } from '../icons.js';
import { KINDS } from '../constants.js';
import { S } from '../state.js';
import { extractTags, splitTags } from '../text.js';
import { msgById, chatById, allTags, put, remove, touch } from '../data/store.js';
import { sheet, closeSheet, toast, copyText, pickSheet } from '../ui/dom.js';
import { catPick, avatar } from '../ui/parts.js';
import { refreshAll } from '../render.js';
import { gotoMsg, startReply, confirmReminder } from '../actions.js';
import { quoteHtml } from '../views/chat.js';
import { isAudio, fmtSize } from '../files.js';

export function messageSheet(id) {
  const m = msgById(id);
  if (!m) return;
  const st = { kind: m.kind, cat: m.categoryId || '', atts: [...(m.attachments || [])] };
  const attRows = () => st.atts.map((a) => `<div class="pend"><span class="pend-ic">${ic(isAudio(a) ? 'mic' : 'file')}</span>
      <span class="pend-name">${esc(a.name)}<small>${fmtSize(a.size)}</small></span>
      <button class="icon-btn" data-s="att-del" data-v="${a.id}" aria-label="Quitar">${ic('close')}</button></div>`).join('');
  const body = `
    <label class="field"><span>Texto</span><textarea id="f-text" rows="4">${esc(m.text)}</textarea></label>
    ${st.atts.length ? `<div class="field"><span>Adjuntos</span><div class="att-list" id="f-atts">${attRows()}</div></div>` : ''}
    <div class="field"><span>Tipo</span><div class="seg">${Object.entries(KINDS).map(([k, v]) => `<button data-s="kind" data-v="${k}" class="${m.kind === k ? 'on' : ''}">${v.icon} ${v.label}</button>`).join('')}</div></div>
    <div class="field task-only" ${m.kind === 'task' ? '' : 'hidden'}><label class="toggle"><input type="checkbox" id="f-done" ${m.done ? 'checked' : ''}> Completada</label></div>
    <div class="field"><span>Categoría</span><div class="chips wrap">
      <button class="chip ${!m.categoryId ? 'on' : ''}" data-s="cat" data-v="">Ninguna</button>
      ${S.categories.map((c) => catPick(c, m.categoryId === c.id, `data-s="cat" data-v="${c.id}"`)).join('')}</div></div>
    <label class="field"><span>Etiquetas</span><input id="f-tags" value="${esc((m.tags || []).join(', '))}" placeholder="trabajo, urgente" list="tag-list" autocomplete="off">
      <datalist id="tag-list">${allTags().map(([t]) => `<option value="${esc(t)}">`).join('')}</datalist></label>
    <label class="field"><span>Fecha límite</span><input type="date" id="f-due" value="${m.due || ''}"></label>
    <div class="field"><span>${ic('alarm', 'tiny')} Recordatorio</span>
      <input type="datetime-local" id="f-remind" value="${toLocalInput(m.remindAt)}">
      <div class="chips wrap">
        <button class="chip" data-s="remind" data-v="1h">En 1 hora</button>
        <button class="chip" data-s="remind" data-v="18">${new Date().getHours() < 18 ? 'Hoy' : 'Mañana'} 18:00</button>
        <button class="chip" data-s="remind" data-v="9">Mañana 9:00</button>
        <button class="chip ghost" data-s="remind" data-v="">Quitar</button>
      </div></div>
    <label class="field"><span>Chat</span><select id="f-chat">${S.chats.map((c) => `<option value="${c.id}" ${c.id === m.chatId ? 'selected' : ''}>${esc(c.emoji)} ${esc(c.name)}</option>`).join('')}</select></label>
    <div class="field row">
      <label class="toggle"><input type="checkbox" id="f-star" ${m.starred ? 'checked' : ''}> Destacado</label>
      <label class="toggle"><input type="checkbox" id="f-pin" ${m.pinned ? 'checked' : ''}> Fijado en el chat</label></div>
    <p class="muted small">Creado el ${new Date(m.createdAt).toLocaleString('es')}</p>
    ${m.replyTo ? `<div class="field"><span>En respuesta a</span>${quoteHtml(m.replyTo)}</div>` : ''}`;

  sheet('Mensaje', body, {
    actions: `<button class="btn ghost" data-s="reply">${ic('reply', 'tiny')} Responder</button>
      <button class="btn ghost" data-s="quote">${ic('quote', 'tiny')} Citar en…</button>
      <button class="btn ghost" data-s="copy">${ic('copy', 'tiny')} Copiar</button>
      <button class="btn danger ghost" data-s="del">${ic('trash', 'tiny')} Eliminar</button>
      <span class="grow"></span><button class="btn primary" data-s="save">Guardar</button>`,
    onMount: (sh) => sh.addEventListener('click', async (e) => {
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
        return;
      }
      if (s === 'copy') { copyText(m.text); return; }
      if (s === 'reply') { closeSheet(); startReply(m.id); return; }
      if (s === 'quote') {
        pickSheet('Citar en…', S.chats.map((c) => ({ id: c.id, html: `${avatar(c, 'sm')} ${esc(c.name)}${c.id === m.chatId ? ' <small class="muted">(este chat)</small>' : ''}` })),
          (chatId) => startReply(m.id, chatId));
        return;
      }
      if (s === 'del') {
        await remove('messages', m.id);
        closeSheet();
        refreshAll();
        toast('Mensaje eliminado', { action: 'Deshacer', fn: async () => { await put('messages', m); refreshAll(); } });
        return;
      }
      if (s === 'save') {
        const text = $('#f-text', sh).value.trim();
        if (!text && !st.atts.length) { toast('El mensaje no puede quedar vacío'); return; }
        const prevChat = m.chatId;
        const prevRemind = m.remindAt || null;
        const remindAt = fromLocalInput($('#f-remind', sh).value);
        Object.assign(m, {
          remindAt,
          attachments: st.atts,
          text, kind: st.kind, done: st.kind === 'task' && $('#f-done', sh).checked,
          due: $('#f-due', sh).value || null, categoryId: st.cat || null,
          tags: uniq([...extractTags(text), ...splitTags($('#f-tags', sh).value)]),
          chatId: $('#f-chat', sh).value, starred: $('#f-star', sh).checked, pinned: $('#f-pin', sh).checked,
        });
        if (m.done && !m.doneAt) m.doneAt = Date.now();
        if (m.kind !== 'message' || m.chatId !== 'general') m.triaged = true;
        await put('messages', m);
        if (m.chatId !== prevChat) await touch(m.chatId);
        closeSheet();
        refreshAll();
        if (m.chatId !== prevChat) {
          const c = chatById(m.chatId);
          toast(`Movido a ${c.emoji} ${c.name}`, { action: 'Ver', fn: () => gotoMsg(m.id) });
        } else if (remindAt && remindAt !== prevRemind) {
          confirmReminder(remindAt);
        }
      }
    }),
  });
}
