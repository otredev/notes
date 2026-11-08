/* Clasificar: repasa uno a uno los mensajes sin clasificar de General. */
import { $, esc, shortWhen } from '../utils.js';
import { TYPES, KINDS } from '../constants.js';
import { S } from '../state.js';
import { fmt } from '../text.js';
import { chatById, inboxList, put, touch, trashMessages } from '../data/store.js';
import { sheet, closeSheet, toast } from '../ui/dom.js';
import { catPick } from '../ui/parts.js';
import { refreshAll } from '../render.js';

export function triageSheet() {
  const queue = inboxList();
  if (!queue.length) { toast('Nada por clasificar 🎉'); return; }
  let i = 0, st = {};

  const draw = (sh) => {
    const m = queue[i];
    const suggested = S.chats.find((c) => c.id !== 'general' && (c.tags || []).some((t) => (m.tags || []).includes(t)));
    st = { kind: suggested && suggested.type !== 'chat' ? TYPES[suggested.type].kind : 'note', chat: suggested?.id || 'general', cat: m.categoryId || '' };
    $('.sheet-body', sh).innerHTML = `<div class="triage-count">${i + 1} de ${queue.length}</div>
      <div class="triage-msg"><div class="msg out"><div class="bubble"><div class="b-text">${fmt(m.text)}</div><div class="b-meta"><span>${shortWhen(m.createdAt)}</span></div></div></div></div>
      <div class="field"><span>¿Qué es?</span><div class="seg" id="t-kind">${Object.entries(KINDS).map(([k, v]) => `<button data-s="kind" data-v="${k}" class="${st.kind === k ? 'on' : ''}">${v.icon} ${v.label}</button>`).join('')}</div></div>
      <div class="field"><span>¿A qué chat va?</span><div class="chips wrap">${S.chats.map((c) => `<button class="chip ${st.chat === c.id ? 'on' : ''}" data-s="chat" data-v="${c.id}">${esc(c.emoji)} ${esc(c.id === 'general' ? 'Se queda en General' : c.name)}</button>`).join('')}</div></div>
      <div class="field"><span>Categoría</span><div class="chips wrap"><button class="chip ${!st.cat ? 'on' : ''}" data-s="cat" data-v="">Ninguna</button>${S.categories.map((c) => catPick(c, st.cat === c.id, `data-s="cat" data-v="${c.id}"`)).join('')}</div></div>`;
  };

  sheet('Clasificar mensajes', '', {
    actions: '<button class="btn danger ghost" data-s="del">Eliminar</button><button class="btn ghost" data-s="skip">Saltar</button><span class="grow"></span><button class="btn primary" data-s="next">Clasificar</button>',
    onMount: (sh) => {
      draw(sh);
      sh.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-s]');
        if (!b) return;
        const s = b.dataset.s;
        if (s === 'kind' || s === 'chat' || s === 'cat') {
          st[s] = b.dataset.v;
          b.parentElement.querySelectorAll('[data-s]').forEach((x) => x.classList.toggle('on', x === b));
          // Al elegir un chat de notas o lista, el tipo se ajusta solo.
          const target = s === 'chat' ? chatById(b.dataset.v) : null;
          if (target && target.type !== 'chat') {
            st.kind = TYPES[target.type].kind;
            sh.querySelectorAll('#t-kind [data-s]').forEach((x) => x.classList.toggle('on', x.dataset.v === st.kind));
          }
          return;
        }
        const m = queue[i];
        if (s === 'next') {
          // Bloqueado: solo se marca como clasificado (y tu categoría, que es tuya).
          if (m.editLocked) { Object.assign(m, { categoryId: st.cat || null, triaged: true }); toast('🔒 Mensaje bloqueado: no se cambió su tipo ni su chat'); }
          else Object.assign(m, { kind: st.kind, chatId: st.chat || 'general', categoryId: st.cat || null, triaged: true });
          await put('messages', m);
          if (m.chatId !== 'general') await touch(m.chatId);
        } else if (s === 'del') {
          if (m.protected) toast('🛡️ Mensaje protegido: no se eliminó');
          else await trashMessages([m.id]);
        }
        i++;
        refreshAll();
        if (i >= queue.length) { closeSheet(); toast('¡Todo clasificado! 🎉'); return; }
        draw(sh);
      });
    },
  });
}
