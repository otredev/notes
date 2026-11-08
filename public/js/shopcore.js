/*
 * Lista de compras (mensaje especial, como las encuestas). Parte sin dependencias: la usan la app y el servidor.
 *
 * m.shop = { items: [{ id, n, q, last, t, del? }] }
 *   n    nombre
 *   q    cantidad en casa (0 = por comprar)
 *   last última cantidad que había (al marcar "comprado" vuelve a ella)
 *   t    hora del último cambio de ESE producto
 *   del  borrado (se guarda la marca para que el borrado llegue a todos)
 *
 * Cada producto se fusiona por separado (gana el cambio más reciente de cada uno). Así, si dos personas
 * tocan productos distintos a la vez, no se pisan; solo "compiten" si tocan el mismo producto.
 */
export const SHOP_MAX_ITEMS = 300;
const MAX_NAME = 80, MAX_Q = 99999, TOMBSTONE_DAYS = 30;

const int = (v, max) => Math.max(0, Math.min(max, Math.floor(Number(v) || 0)));

/** Deja solo lo válido (datos que vienen de un dispositivo). */
export function cleanShop(shop) {
  const items = [];
  const seen = new Set();
  for (const x of Array.isArray(shop?.items) ? shop.items : []) {
    if (!x || typeof x.id !== 'string' || !x.id || x.id.length > 40 || seen.has(x.id)) continue;
    seen.add(x.id);
    const t = int(x.t, 8.64e15);
    if (x.del) { items.push({ id: x.id, del: true, t }); continue; }
    const n = String(x.n ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
    if (!n) continue;
    const q = int(x.q, MAX_Q);
    items.push({ id: x.id, n, q, last: Math.max(1, int(x.last, MAX_Q) || q || 1), t });
  }
  return { items: prune(items) };
}

/** Quita marcas de borrado viejas y, si hay demasiados productos, las primeras en irse son esas marcas. */
function prune(items, now = Date.now()) {
  let out = items.filter((x) => !x.del || now - x.t < TOMBSTONE_DAYS * 864e5);
  if (out.length > SHOP_MAX_ITEMS) {
    const dels = out.filter((x) => x.del).sort((a, b) => a.t - b.t);
    const drop = new Set(dels.slice(0, out.length - SHOP_MAX_ITEMS).map((x) => x.id));
    out = out.filter((x) => !drop.has(x.id)).slice(0, SHOP_MAX_ITEMS);
  }
  return out;
}

/** Fusiona dos versiones: por cada producto gana la más reciente. Conserva el orden de `a`. */
export function mergeShop(a, b) {
  const A = a?.items || [], B = b?.items || [];
  const byId = new Map(A.map((x) => [x.id, x]));
  for (const x of B) {
    const cur = byId.get(x.id);
    if (!cur || (x.t || 0) > (cur.t || 0)) byId.set(x.id, x);
  }
  const order = [...A.map((x) => x.id), ...B.filter((x) => !A.some((y) => y.id === x.id)).map((x) => x.id)];
  return { items: prune(order.map((id) => byId.get(id))) };
}

export const sameShop = (a, b) => JSON.stringify(a?.items || []) === JSON.stringify(b?.items || []);

/** Productos visibles (sin los borrados). */
export const shopItems = (shop) => (shop?.items || []).filter((x) => !x.del);

/** "2 leche" → { q: 2, n: 'Leche' } · "leche" → { q: 0, n: 'Leche' } */
export function parseShopInput(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  const m = t.match(/^(\d+)\s*[x×]?\s+(.+)$/i);
  const n = (m ? m[2] : t).trim();
  return { q: m ? int(m[1], MAX_Q) : 0, n: n.charAt(0).toUpperCase() + n.slice(1) };
}
