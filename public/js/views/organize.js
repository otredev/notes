/* Organizar: categorías, grupos de chats y etiquetas. */
import { esc, byOrder } from '../utils.js';
import { ic } from '../icons.js';
import { S } from '../state.js';
import { allTags } from '../data/store.js';
import { empty } from '../ui/parts.js';

export function orgPaneHtml() {
  const catCount = (id) => S.messages.filter((m) => m.categoryId === id).length;
  const tags = allTags();
  const cats = [...S.categories].sort(byOrder);
  const groups = [...S.groups].sort(byOrder);

  const catRows = cats.map((c) => `<div class="org-row" data-act="edit-cat" data-id="${c.id}" role="button" tabindex="0">
      <span class="dot" style="--c:${c.color}"></span><span class="grow">${esc(c.name)}</span><span class="muted small">${catCount(c.id)}</span></div>`).join('');

  const groupRows = groups.map((g) => {
    const chats = S.chats.filter((c) => c.groupId === g.id);
    const names = chats.length ? chats.map((c) => esc(`${c.emoji} ${c.name}`)).join(', ') : 'Sin chats';
    return `<div class="org-row" data-act="edit-group" data-id="${g.id}" role="button" tabindex="0">${ic('folder')}
      <span class="grow">${esc(g.name)}<br><small class="muted">${names}</small></span><span class="muted small">${chats.length}</span></div>`;
  }).join('');

  const tagChips = tags.length
    ? tags.map(([t, n]) => `<button class="chip" data-act="tag" data-tag="${esc(t)}">#${esc(t)} <span>${n}</span></button>`).join('')
    : '<p class="muted small">Escribe #algo en un mensaje para crear una etiqueta.</p>';

  return `<header class="pane-head"><h1>Organizar</h1></header>
  <div class="list">
    <div class="sec-title">Categorías <button class="link-btn" data-act="new-cat">${ic('plus', 'tiny')} Nueva</button></div>
    ${catRows || empty('Sin categorías todavía')}
    <div class="sec-title">Grupos de chats <button class="link-btn" data-act="new-group">${ic('plus', 'tiny')} Nuevo</button></div>
    ${groupRows || empty('Sin grupos todavía')}
    <div class="sec-title">Etiquetas</div>
    <div class="chips wrap pad">${tagChips}</div>
  </div>`;
}
