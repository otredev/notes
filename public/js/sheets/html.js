/*
 * Ventana para escribir un bloque HTML (como la de la encuesta): editor con números de línea,
 * resaltado, sangría automática y ajuste de línea, más vista previa. Al enviarlo queda como mensaje
 * con un bloque ```html ejecutable (aislado). También sirve para editar el HTML de un mensaje.
 */
import { $, uid } from '../utils.js';
import { ic } from '../icons.js';
import { S } from '../state.js';
import { chatById, msgById, put, touch } from '../data/store.js';
import { sheet, closeSheet, toast } from '../ui/dom.js';
import { refreshAll } from '../render.js';
import { canPost, myId } from '../people.js';
import { createCodeEditor } from '../codeeditor.js';
import { embedDoc } from '../text.js';
import { lockedNotice } from '../guard.js';

const SAMPLE = `<h3>Hola 👋</h3>
<button onclick="this.textContent = '¡Funciona!'">Púlsame</button>
`;
/** Lo que quedó sin enviar al cerrar la ventana (se recupera al volver a abrirla). */
let draft = '';

const HTML_BLOCK = /```html[^\n]*\n([\s\S]*?)\n```/i;
export const htmlOf = (m) => m?.text?.match(HTML_BLOCK)?.[1] ?? null;

/** Abre el editor. Sin `msgId`: nuevo mensaje en el chat abierto. Con `msgId`: edita su bloque HTML. */
export function htmlSheet(msgId = null) {
  const m = msgId ? msgById(msgId) : null;
  if (m && lockedNotice(m)) return;
  const chat = chatById(m ? m.chatId : S.active);
  if (!chat) return;
  if (!m && !canPost(chat)) { toast('Solo los administradores pueden enviar mensajes en este chat'); return; }
  const start = m ? htmlOf(m) ?? '' : draft || SAMPLE;
  let editor = null, sent = false;

  const body = `<div class="ce-tools">
      <button class="chip" data-s="wrap" aria-pressed="false">↩ Ajustar líneas</button>
      <button class="chip" data-s="preview" aria-pressed="false">${ic('play', 'tiny')} Vista previa</button>
      <span class="grow"></span><small class="muted">Tab: sangría · se aísla al enviarlo</small>
    </div>
    <div id="html-ed"></div>
    <div class="ce-preview" id="html-pv" hidden><iframe sandbox="allow-scripts" referrerpolicy="no-referrer" title="Vista previa"></iframe></div>`;

  sheet(m ? 'Editar HTML' : 'Bloque HTML', body, {
    cls: 'sheet-code',
    actions: `${!m && draft ? '<button class="btn ghost" data-s="clear">Vaciar</button>' : ''}<span class="grow"></span>
      <button class="btn ghost" data-act="sheet-close">Cancelar</button>
      <button class="btn primary" data-s="send">${m ? 'Guardar' : 'Enviar'}</button>`,
    onClose: () => { if (!m && !sent && editor) { draft = editor.value.trim() ? editor.value : ''; if (draft && draft !== SAMPLE) toast('Borrador guardado'); } },
    onMount: (sh) => {
      editor = createCodeEditor($('#html-ed', sh), { value: start, lang: 'html', placeholder: '<h1>Hola</h1>' });
      const wrapBtn = $('[data-s=wrap]', sh), pvBtn = $('[data-s=preview]', sh), pv = $('#html-pv', sh);
      const sync = () => {
        wrapBtn.classList.toggle('on', editor.wrap); wrapBtn.setAttribute('aria-pressed', editor.wrap);
        pvBtn.classList.toggle('on', !pv.hidden); pvBtn.setAttribute('aria-pressed', !pv.hidden);
      };
      const refreshPreview = () => { if (!pv.hidden) pv.querySelector('iframe').srcdoc = embedDoc(editor.value); };
      let t = null;
      editor.textarea.addEventListener('input', () => { clearTimeout(t); t = setTimeout(refreshPreview, 400); });
      sync();
      setTimeout(() => editor.focus(m || draft ? 'end' : 'all'), 80); // el ejemplo queda seleccionado: al escribir se reemplaza
      sh.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-s]');
        if (!b) return;
        if (b.dataset.s === 'wrap') { editor.setWrap(!editor.wrap); sync(); return; }
        if (b.dataset.s === 'preview') { pv.hidden = !pv.hidden; refreshPreview(); sync(); return; }
        if (b.dataset.s === 'clear') { editor.value = ''; draft = ''; editor.focus(); return; }
        if (b.dataset.s !== 'send') return;
        const code = editor.value.replace(/\s+$/, '');
        if (!code.trim()) { toast('Escribe algo de HTML'); editor.focus(); return; }
        if (code.includes('\n```')) { toast('El código no puede tener una línea que empiece por ```'); return; }
        const block = `\`\`\`html\n${code}\n\`\`\``;
        if (m) {
          m.text = HTML_BLOCK.test(m.text) ? m.text.replace(HTML_BLOCK, () => block) : block;
          await put('messages', m);
        } else {
          const now = Date.now();
          await put('messages', {
            id: uid(), chatId: chat.id, text: block, kind: 'message', done: false, doneAt: null, tags: [], categoryId: null, due: null,
            starred: false, pinned: false, from: 'me', triaged: true, createdAt: now, remindAt: null, authorId: myId(),
          });
          await touch(chat.id);
          draft = '';
        }
        sent = true;
        closeSheet();
        refreshAll(!m);
        if (m) toast('HTML guardado');
      });
    },
  });
}
