/*
 * Lista de compras dentro de un mensaje (se crea desde la barra, junto a la encuesta).
 * Arriba se añade ("2 leche" → 2 en casa · "leche" → por comprar); en casa se consume (−) o se suma (+);
 * lo que llega a 0 pasa a "Por comprar" y al marcarlo vuelve a casa con su cantidad de antes.
 * Cualquier miembro del chat puede usarla; cada producto se sincroniza por separado (ver shopcore.js).
 */
import { $, uid, esc } from './utils.js';
import { S } from './state.js';
import { chatById, msgById, put, touch } from './data/store.js';
import { schedule } from './data/sync.js';
import { toast, confirmSheet } from './ui/dom.js';
import { refreshAll } from './render.js';
import { canPost, myId } from './people.js';
import { shopItems, parseShopInput, SHOP_MAX_ITEMS } from './shopcore.js';
import { lockedNotice, isEditLocked } from './guard.js';

const byName = (a, b) => a.n.localeCompare(b.n, 'es', { sensitivity: 'base' });

export function shopHtml(m) {
  const items = shopItems(m.shop);
  const buy = items.filter((x) => x.q <= 0);
  const have = items.filter((x) => x.q > 0).sort(byName);
  const id = m.id;
  const buyRows = buy.map((x) => `<div class="shop-row buy">
      <button class="shop-chk" data-act="shop-got" data-id="${id}" data-i="${x.id}" aria-label="Comprado: ${esc(x.n)}"></button>
      <span class="shop-n">${esc(x.n)}</span>
      <button class="shop-del" data-act="shop-del" data-id="${id}" data-i="${x.id}" aria-label="Quitar ${esc(x.n)}">×</button></div>`).join('');
  const haveRows = have.map((x) => `<div class="shop-row">
      <span class="shop-n">${esc(x.n)}</span>
      <button class="shop-step" data-act="shop-use" data-id="${id}" data-i="${x.id}" aria-label="Consumir ${esc(x.n)}">−</button>
      <span class="shop-q">${x.q}</span>
      <button class="shop-step" data-act="shop-more" data-id="${id}" data-i="${x.id}" aria-label="Sumar ${esc(x.n)}">+</button></div>`).join('');
  return `<div class="shop ${isEditLocked(m) ? 'locked' : ''}">
    <div class="shop-title">🛒 ${esc(m.text || 'Lista de compras')}${isEditLocked(m) ? ' <small class="muted">🔒</small>' : ''}</div>
    <div class="shop-add"><input class="shop-in" data-id="${id}" maxlength="80" placeholder="Añadir… (ej. 2 leche)" autocomplete="off" enterkeyhint="done" aria-label="Añadir producto">
      <button class="shop-plus" data-act="shop-add" data-id="${id}" aria-label="Añadir">+</button></div>
    <div class="shop-h">Por comprar${buy.length ? ` · ${buy.length}` : ''}</div>
    ${buyRows || '<div class="shop-empty">Nada pendiente ✓</div>'}
    <div class="shop-h">En casa</div>
    ${haveRows || '<div class="shop-empty">Vacío</div>'}
  </div>`;
}

/** Guarda el cambio y lo sube enseguida (para que los demás lo vean casi al momento). */
async function save(m, items) {
  m.shop = { items };
  await put('messages', m);
  schedule(150);
  refreshAll();
}

/** Cambia un producto. */
async function change(msgId, itemId, fn) {
  const m = msgById(msgId);
  if (!m?.shop || lockedNotice(m)) return;
  const now = Date.now();
  const items = m.shop.items.map((x) => {
    if (x.id !== itemId || x.del) return x;
    const y = { ...x };
    fn(y);
    y.t = Math.max(now, (x.t || 0) + 1);
    return y;
  });
  navigator.vibrate?.(8);
  await save(m, items);
}

export const SHOP_ACTIONS = {
  'shop-use': (el) => change(el.dataset.id, el.dataset.i, (x) => { if (x.q > 0) x.last = Math.max(x.last || 1, x.q); x.q = Math.max(0, x.q - 1); }),
  'shop-more': (el) => change(el.dataset.id, el.dataset.i, (x) => { x.q += 1; x.last = x.q; }),
  'shop-got': (el) => change(el.dataset.id, el.dataset.i, (x) => { x.q = Math.max(1, x.last || 1); }),
  // Quitar un producto: primero se pregunta.
  'shop-del': (el) => {
    const { id, i } = el.dataset;
    const m = msgById(id);
    const x = m?.shop?.items.find((y) => y.id === i && !y.del);
    if (!x || lockedNotice(m)) return;
    confirmSheet(`¿Quitar "${x.n}" de la lista?`, 'Quitar', () => change(id, i, (y) => { for (const k of ['n', 'q', 'last']) delete y[k]; y.del = true; }));
  },
  'shop-add': (el) => addFrom(el.closest('.shop')?.querySelector('.shop-in')),
};

/** Añade lo escrito en el cuadro de la lista. Si ya existe (mismo nombre), suma o lo pasa a "Por comprar". */
export async function addFrom(input) {
  if (!input) return;
  const m = msgById(input.dataset.id);
  const p = parseShopInput(input.value);
  if (!m?.shop || !p || lockedNotice(m)) return;
  const now = Date.now();
  const items = [...m.shop.items];
  const i = items.findIndex((x) => !x.del && x.n.toLowerCase() === p.n.toLowerCase());
  if (i >= 0) {
    const x = { ...items[i], t: Math.max(now, (items[i].t || 0) + 1) };
    if (p.q) { x.q += p.q; x.last = x.q; } else { if (x.q > 0) x.last = x.q; x.q = 0; }
    items[i] = x;
  } else {
    if (shopItems(m.shop).length >= SHOP_MAX_ITEMS) { toast(`Máximo ${SHOP_MAX_ITEMS} productos por lista`); return; }
    items.push({ id: uid(), n: p.n, q: p.q, last: p.q || 1, t: now });
  }
  input.value = '';
  await save(m, items);
}

/** Nueva lista de compras en el chat abierto. El texto escrito (primera línea) es su título. */
export async function newShop() {
  const chat = chatById(S.active);
  if (!chat) return;
  if (!canPost(chat)) { toast('Solo los administradores pueden enviar mensajes en este chat'); return; }
  const ta = $('#composer-input');
  const title = (ta?.value.trim().split('\n')[0] || '').slice(0, 80) || 'Lista de compras';
  const now = Date.now();
  const msg = {
    id: uid(), chatId: chat.id, text: title, kind: 'message', done: false, doneAt: null, tags: [], categoryId: null, due: null,
    starred: false, pinned: false, from: 'me', triaged: true, createdAt: now, remindAt: null, authorId: myId(),
    shop: { items: [] },
  };
  await put('messages', msg);
  await touch(chat.id);
  if (ta?.value.trim()) { ta.value = ''; ta.dispatchEvent(new Event('input', { bubbles: true })); }
  refreshAll(true);
  // El cursor va directo al cuadro de la lista nueva.
  requestAnimationFrame(() => document.querySelector(`.shop-in[data-id="${msg.id}"]`)?.focus());
}
