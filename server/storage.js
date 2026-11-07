/*
 * Control del espacio de Cloudflare R2 (adjuntos, copias de seguridad).
 *
 * R2 no permite poner un tope de gasto, así que la app lleva la cuenta y se frena sola:
 *   - bytes guardados (se recalcula cada hora listando el bucket y se suma en cada subida)
 *   - operaciones del mes: clase A (subir, listar) y clase B (descargar)
 * Al llegar al STORAGE_STOP_PCT (90 %) de cualquiera de los límites gratis, se rechazan las subidas
 * nuevas (507) y las copias automáticas. Desde STORAGE_WARN_PCT (75 %) la app avisa.
 */
export function limitsFrom(env = {}) {
  const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
  return {
    bytes: num(env.STORAGE_LIMIT_GB, 10) * 1e9,
    opsA: num(env.R2_CLASS_A_LIMIT, 1_000_000),
    opsB: num(env.R2_CLASS_B_LIMIT, 10_000_000),
    stopPct: num(env.STORAGE_STOP_PCT, 90),
    warnPct: num(env.STORAGE_WARN_PCT, 75),
  };
}

const monthKey = (now = Date.now()) => new Date(now).toISOString().slice(0, 7);

/** Estado actual. Las operaciones vuelven a 0 cada mes (como factura R2). */
export function storageState(s = {}, limits, now = Date.now()) {
  const sameMonth = s.month === monthKey(now);
  const bytes = Math.max(0, s.bytes || 0), opsA = sameMonth ? s.opsA || 0 : 0, opsB = sameMonth ? s.opsB || 0 : 0;
  const pct = {
    bytes: (bytes / limits.bytes) * 100,
    opsA: (opsA / limits.opsA) * 100,
    opsB: (opsB / limits.opsB) * 100,
  };
  const top = Math.max(pct.bytes, pct.opsA, pct.opsB);
  return {
    available: true, bytes, objects: s.objects || 0, opsA, opsB, month: monthKey(now), scannedAt: s.scannedAt || null,
    pct, limits, state: top >= limits.stopPct ? 'full' : top >= limits.warnPct ? 'warn' : 'ok',
  };
}

async function bump(repo, patch, now = Date.now()) {
  const s = await repo.getStorage();
  const month = monthKey(now);
  const reset = s.month !== month;
  const next = {
    month,
    bytes: Math.max(0, (s.bytes || 0) + (patch.bytes || 0)),
    opsA: (reset ? 0 : s.opsA || 0) + (patch.opsA || 0),
    opsB: (reset ? 0 : s.opsB || 0) + (patch.opsB || 0),
  };
  await repo.saveStorage(next);
  return { ...s, ...next };
}

/** Antes de subir: ¿cabe? Si cabe, se cuenta ya (bytes + 1 operación de clase A). */
export async function reserveUpload(repo, size, limits) {
  const st = storageState(await repo.getStorage(), limits);
  const after = storageState({ ...st, month: st.month, bytes: st.bytes + size, opsA: st.opsA + 1 }, limits);
  if (st.state === 'full' || after.pct.bytes >= limits.stopPct || after.pct.opsA >= limits.stopPct) return { ok: false, ...st, state: 'full' };
  return { ok: true, ...storageState(await bump(repo, { bytes: size, opsA: 1 }), limits) };
}

export const countOps = (repo, { a = 0, b = 0, bytes = 0 } = {}) => bump(repo, { opsA: a, opsB: b, bytes });

/** Recalcula los bytes reales listando el bucket (cada página del listado es 1 operación de clase A). */
export async function rescan(repo, bucket) {
  let bytes = 0, objects = 0, pages = 0, cursor;
  do {
    const r = await bucket.list({ cursor, limit: 1000 });
    pages++;
    for (const o of r.objects) { bytes += o.size; objects++; }
    cursor = r.truncated ? r.cursor : undefined;
  } while (cursor);
  const s = await bump(repo, { opsA: pages });
  await repo.saveStorage({ bytes, objects, scannedAt: Date.now() });
  return { ...s, bytes, objects };
}
