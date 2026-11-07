/*
 * Espacio en la nube (Cloudflare R2). El servidor lleva la cuenta y rechaza subidas al acercarse al límite
 * gratis; aquí se avisa con una ventana y se muestran las barras en Ajustes.
 */
import { S } from './state.js';
import { sheet, closeSheet, toast } from './ui/dom.js';
import { setStorageFullHandler } from './files.js';

const GB = 1e9;
const fmtBytes = (n) => (n >= GB ? `${(n / GB).toFixed(2)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`);
const fmtNum = (n) => new Intl.NumberFormat('es').format(Math.round(n));

export const storageInfo = () => S.server?.storage || null;
export const storageFull = () => storageInfo()?.state === 'full';

function bar(label, value, limit, pct, fmt, st) {
  const p = Math.min(100, pct);
  const cls = p >= st.limits.stopPct ? 'full' : p >= st.limits.warnPct ? 'warn' : '';
  return `<div class="st-row"><div class="st-top"><span>${label}</span><span>${fmt(value)} de ${fmt(limit)} · ${p < 1 && p > 0 ? '<1' : Math.round(p)} %</span></div>
    <div class="st-bar ${cls}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(p)}" aria-label="${label}"><i style="width:${Math.max(p, p > 0 ? 1.5 : 0)}%"></i></div></div>`;
}

/** Barras de progreso (espacio y operaciones del mes). */
export function storageBarsHtml(st = storageInfo()) {
  if (!st) return '<p class="muted small">Cargando…</p>';
  if (!st.available) return '<p class="muted small">Este servidor no guarda archivos en la nube (solo en Cloudflare R2).</p>';
  const head = st.state === 'full'
    ? `<div class="sync-state bad">⛔<span class="grow"><b>Casi lleno.</b> No se suben archivos nuevos para no generar cobros.</span></div>`
    : st.state === 'warn' ? `<div class="sync-state bad">⚠️<span class="grow">Te acercas al límite gratis.</span></div>` : '';
  return `${head}
    ${bar('Espacio usado', st.bytes, st.limits.bytes, st.pct.bytes, fmtBytes, st)}
    ${bar('Subidas este mes (clase A)', st.opsA, st.limits.opsA, st.pct.opsA, fmtNum, st)}
    ${bar('Descargas este mes (clase B)', st.opsB, st.limits.opsB, st.pct.opsB, fmtNum, st)}
    <p class="muted small" style="margin:8px 0 0">Límite gratis de Cloudflare R2. Al llegar al ${st.limits.stopPct} % la app deja de subir archivos y copias (no se te cobra nada); lo que intentes adjuntar se queda en este dispositivo. Las operaciones vuelven a 0 cada mes.${st.scannedAt ? ` Recalculado ${new Date(st.scannedAt).toLocaleString('es', { dateStyle: 'short', timeStyle: 'short' })}.` : ''}</p>`;
}

let shownAt = 0;
/** Ventana de aviso: espacio lleno. */
export function storageModal({ force = false } = {}) {
  if (!force && Date.now() - shownAt < 10 * 60e3) return;
  shownAt = Date.now();
  const st = storageInfo();
  sheet('⛔ Espacio en la nube casi lleno', `
    <p>Para que Cloudflare no te cobre, RetroDark <b>no sube archivos nuevos</b> (fotos, audios, documentos) ni crea copias de seguridad hasta que haya espacio.</p>
    <div class="set-group">${storageBarsHtml(st)}</div>
    <p class="small"><b>Qué puedes hacer</b></p>
    <ul class="md-ul small">
      <li>Vaciar la <b>Papelera</b> (Ajustes → Papelera): sus adjuntos se borran de la nube en menos de una hora.</li>
      <li>Borrar mensajes con archivos grandes que ya no necesites.</li>
      <li>Si se agotaron las operaciones del mes, espera al día 1: el contador vuelve a 0.</li>
    </ul>
    <p class="muted small">Los mensajes de texto siguen funcionando con normalidad.</p>`, {
    actions: `<span class="grow"></span><button class="btn ghost" data-s="see">Ver en Ajustes</button><button class="btn primary" data-act="sheet-close">Entendido</button>`,
    onMount: (sh) => sh.addEventListener('click', (e) => {
      if (!e.target.closest('[data-s=see]')) return;
      closeSheet();
      document.dispatchEvent(new CustomEvent('retrodark:goto', { detail: { nav: 'settings', anchor: 'storage-box' } }));
    }),
  });
}

/** Antes de adjuntar: si está lleno, avisa y devuelve false. */
export function canUpload() {
  if (!storageFull()) return true;
  storageModal({ force: true });
  return false;
}

/** Al abrir la app: lleno → ventana; cerca del límite → aviso una vez al día. */
export function checkStorageOnStart() {
  const st = storageInfo();
  if (!st?.available) return;
  if (st.state === 'full') storageModal();
  else if (st.state === 'warn') {
    const key = 'retrodark-storage-warn', today = new Date().toDateString();
    let seen = null;
    try { seen = localStorage.getItem(key); } catch { /* */ }
    if (seen !== today) {
      toast(`⚠️ La nube está al ${Math.round(Math.max(st.pct.bytes, st.pct.opsA, st.pct.opsB))} % del límite gratis. Revisa Ajustes → Almacenamiento`);
      try { localStorage.setItem(key, today); } catch { /* */ }
    }
  }
}

/** El servidor rechazó una subida (507). */
setStorageFullHandler((st) => {
  if (S.server) S.server.storage = st ? { ...st, available: true, state: 'full' } : { ...(S.server.storage || {}), state: 'full' };
  storageModal();
  const box = document.getElementById('storage-box');
  if (box) box.innerHTML = storageBarsHtml();
});

export const storageLabel = () => {
  const st = storageInfo();
  return st?.available ? `${fmtBytes(st.bytes)} de ${fmtBytes(st.limits.bytes)}` : '';
};
