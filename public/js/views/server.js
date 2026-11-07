/*
 * Ajustes que viven en el servidor y privacidad:
 *  - auto:    resumen diario, calendario suscribible y correo a nota
 *  - backups: copias de seguridad en la nube
 *  - privacy: bloqueo de chats (PIN, huella)
 */
import { $, esc, shortWhen } from '../utils.js';
import { ic } from '../icons.js';
import { S, settings } from '../state.js';
import { api } from '../data/sync.js';
import { hasPin, hasBiometric, isUnlocked, lockInfo } from '../lock.js';

const back = (title) => `<header class="pane-head"><button class="icon-btn" data-act="sub" data-v="" aria-label="Volver a Ajustes">${ic('back')}</button><h1>${title}</h1></header>`;
const loading = '<p class="muted small">Cargando…</p>';

/** Pide al servidor sus ajustes y funciones. */
export async function loadServer() {
  try { S.server = await api('settings'); } catch (err) { S.server = { error: err.message }; }
  return S.server;
}

const serverError = () => (S.server?.error ? `<div class="sync-state bad">${ic('cloudOff')}<span class="grow">No se pudo leer del servidor: ${esc(S.server.error)}</span></div>` : '');
const ready = () => S.server && !S.server.error;

/* ---------- Automatizaciones ---------- */
export function autoPaneHtml() {
  const s = S.server || {};
  const push = s.features?.push;
  const chats = S.chats.map((c) => `<option value="${c.id}" ${s.email?.chat === c.id ? 'selected' : ''}>${esc(c.emoji)} ${esc(c.name)}</option>`).join('');
  return `${back('Automatizaciones')}<div class="list">
    ${serverError()}
    <div class="sec-title">☀️ Resumen del día</div>
    <div class="set-group">${!ready() ? loading : `
      <label class="set-row toggle"><input type="checkbox" id="srv-summary-on" ${s.summary.enabled ? 'checked' : ''} ${push ? '' : 'disabled'}>
        <span class="grow">Notificación cada mañana<br><small class="muted">Tareas de hoy, vencidas y recordatorios del día${push ? '' : ' · necesita las claves VAPID en el servidor'}</small></span></label>
      <label class="field"><span>Hora (${esc(s.tz)})</span><input type="time" id="srv-summary-time" value="${esc(s.summary.time)}"></label>
      <div class="btn-row"><button class="btn outline" data-act="srv-summary-test" ${push ? '' : 'disabled'}>Enviar ahora</button></div>`}
    </div>

    <div class="sec-title">${ic('calendar', 'tiny')} Calendario suscrito</div>
    <div class="set-group">
      <p class="muted small" style="margin:0 0 8px">Tus tareas con fecha y tus recordatorios aparecen en Google Calendar, Apple Calendario u Outlook y se actualizan solos (cada pocas horas, según el calendario). Los chats bloqueados no se incluyen.</p>
      <label class="field" style="margin:6px 0"><span>URL del calendario</span><input readonly id="feed-url" value="…" onfocus="this.select()"></label>
      <div class="btn-row"><button class="btn outline" data-act="feed-copy">Copiar URL</button><a class="btn ghost" id="feed-webcal" href="#">Abrir en el calendario</a></div>
      <p class="muted small" style="margin:8px 0 0"><b>Google Calendar</b> (en el ordenador): Otros calendarios → + → Desde URL. <b>iPhone</b>: Ajustes → Calendario → Cuentas → Añadir calendario suscrito. Cualquiera con esta URL puede ver esas fechas: no la compartas.</p>
    </div>

    ${s.isOwner === false ? '' : `<div class="sec-title">✉️ Correo a nota</div>
    <div class="set-group">${!ready() ? loading : `
      <p class="muted small" style="margin:0 0 8px">Reenvía un correo a tu dirección de ChatNote y llegará como mensaje. El asunto va en negrita; empieza el asunto con <code>[]</code> o <code>tarea:</code> para crear una tarea, o <code>nota:</code> para una nota. Una <code>#etiqueta</code> lo manda a su chat vinculado.</p>
      <label class="field"><span>Remitentes permitidos (uno por línea)</span><textarea id="email-allowed" rows="3" placeholder="tu@correo.com">${esc((s.email.allowed || []).join('\n'))}</textarea></label>
      <label class="field"><span>Chat donde llegan</span><select id="email-chat">${chats}</select></label>
      <div class="btn-row"><button class="btn primary" data-act="email-save">Guardar</button></div>
      <details class="howto"><summary>Cómo activar la dirección (una vez)</summary>
        <ol class="small">
          <li>Necesitas un dominio propio en Cloudflare (por ejemplo <code>midominio.com</code>).</li>
          <li>Panel de Cloudflare → tu dominio → <b>Email → Email Routing</b> → actívalo.</li>
          <li><b>Routing rules → Create address</b>: por ejemplo <code>notas@midominio.com</code>, acción <b>Send to a Worker</b> → <code>retrodark</code>.</li>
          <li>Pon tu correo arriba en "Remitentes permitidos". Los demás se rechazan.</li>
        </ol></details>`}
    </div>`}
  </div>`;
}

/** Rellena la URL del feed (la clave se calcula con la de acceso). */
export async function fillFeedUrl() {
  const input = $('#feed-url');
  if (!input) return;
  let key;
  try { key = (await api('feed')).key; } catch { input.value = 'No disponible sin conexión'; return; }
  const url = `${location.origin}/cal/${key}.ics`;
  input.value = url;
  $('#feed-webcal').href = url.replace(/^https?:/, 'webcal:');
}

/* ---------- Copias de seguridad ---------- */
let backupList = null;
export async function loadBackups() {
  try { backupList = (await api('backups')).backups; } catch (err) { backupList = { error: err.message }; }
  return backupList;
}
const kb = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function backupsPaneHtml() {
  const s = S.server || {};
  const rows = Array.isArray(backupList) ? backupList.map((b) => `<div class="trash-row">
      <div class="grow"><b>${esc(b.name.replace(/\.json$/, ''))}</b><br><small class="muted">${kb(b.size)} · ${shortWhen(b.createdAt)}</small></div>
      <div class="trash-acts">
        <button class="icon-btn" data-act="backup-dl" data-v="${esc(b.name)}" title="Descargar" aria-label="Descargar">${ic('download')}</button>
        <button class="icon-btn" data-act="backup-restore" data-v="${esc(b.name)}" title="Restaurar" aria-label="Restaurar">${ic('restore')}</button>
      </div></div>`).join('') : '';
  return `${back('Copias de seguridad')}<div class="list">
    ${serverError()}
    <div class="set-group">${!ready() ? loading : `
      <label class="set-row toggle"><input type="checkbox" id="srv-backups-on" ${s.backups.enabled ? 'checked' : ''} ${s.features?.backups ? '' : 'disabled'}>
        <span class="grow">Copia automática cada día<br><small class="muted">${s.features?.backups ? 'En Cloudflare R2, a partir de las 3:00. Se guardan las 30 más recientes. No incluye los archivos adjuntos (ya están en R2).' : 'Solo funciona en Cloudflare (R2).'}</small></span></label>
      <div class="btn-row"><button class="btn outline" data-act="backup-now" ${s.features?.backups ? '' : 'disabled'}>Crear copia ahora</button><button class="btn ghost" data-act="export">Descargar copia a este dispositivo</button></div>`}
    </div>
    <div class="sec-title">Copias en la nube</div>
    ${backupList === null ? `<p class="muted small pad">${S.server?.features?.backups === false ? 'No disponibles en este servidor.' : 'Cargando…'}</p>`
      : backupList.error ? `<p class="muted small pad">${esc(backupList.error)}</p>`
      : rows || '<p class="muted small pad">Aún no hay copias.</p>'}
  </div>`;
}

/* ---------- Privacidad ---------- */
export function privacyPaneHtml() {
  const locked = S.chats.filter((c) => c.locked);
  return `${back('Privacidad')}<div class="list">
    <div class="sec-title">🔒 Chats bloqueados</div>
    <div class="set-group">
      <p class="muted small" style="margin:0 0 8px">Bloquea un chat desde su información (toca su nombre arriba). Sus mensajes no se ven en la lista, la búsqueda, Tareas, el calendario ni las notificaciones hasta que escribas tu PIN. Se vuelven a bloquear tras 1 minuto con la app en segundo plano.</p>
      <div class="sync-state ${hasPin() ? 'ok' : 'bad'}">🔑<span class="grow">${lockInfo()}</span></div>
      <div class="btn-row">
        <button class="btn outline" data-act="pin-set">${hasPin() ? 'Cambiar PIN' : 'Crear PIN'}</button>
        ${hasPin() ? `<button class="btn ghost" data-act="${hasBiometric() ? 'bio-off' : 'bio-on'}">${hasBiometric() ? 'Quitar huella / Face ID' : '👆 Usar huella / Face ID'}</button>` : ''}
        ${locked.length ? `<button class="btn ghost" data-act="${isUnlocked() ? 'lock-now' : 'unlock'}">${isUnlocked() ? '🔒 Bloquear ahora' : '🔓 Desbloquear'}</button>` : ''}
      </div>
      ${locked.length ? `<p class="small" style="margin:10px 0 0">${locked.map((c) => `${esc(c.emoji)} ${esc(c.name)}`).join(' · ')}</p>` : ''}
      <p class="muted small" style="margin:10px 0 0">Es un bloqueo de la app: los datos siguen en este navegador y en tu servidor como el resto.</p>
    </div>
  </div>`;
}
