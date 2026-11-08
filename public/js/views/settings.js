/* Ajustes: tema, escritura, sincronización con MongoDB, datos y ayuda. */
import { $, esc, shortWhen } from '../utils.js';
import { ic } from '../icons.js';
import { S, settings } from '../state.js';
import { getStatus } from '../data/sync.js';
import { pushState } from '../push.js';
import { storageBarsHtml } from '../storage.js';
import { personDot, isOwnerUser, multiUser } from './account.js';

const PUSH_TEXT = {
  on: ['cloudOk', 'ok', 'Activadas en este dispositivo. Te avisaremos a la hora de cada recordatorio.'],
  off: ['bell', 'bad', 'Desactivadas en este dispositivo. Actívalas para recibir los recordatorios aunque la app esté cerrada.'],
  denied: ['bell', 'bad', 'Bloqueadas en el navegador. Permite las notificaciones para este sitio en la configuración del navegador.'],
  unsupported: ['bell', 'bad', 'Este navegador no admite notificaciones push.'],
  'ios-install': ['bell', 'bad', 'En iPhone y iPad primero instala la app: botón Compartir → "Añadir a pantalla de inicio", y ábrela desde ahí.'],
};

/** Rellena el bloque de notificaciones (el estado se consulta de forma asíncrona). */
export async function updatePushBox() {
  const box = $('#push-box');
  if (!box) return;
  const state = await pushState();
  const [icon, cls, text] = PUSH_TEXT[state];
  const buttons = state === 'on'
    ? '<button class="btn outline" data-act="push-test">Enviar prueba</button><button class="btn ghost" data-act="push-off">Desactivar</button>'
    : state === 'off' ? '<button class="btn primary" data-act="push-on">Activar notificaciones</button>' : '';
  box.innerHTML = `<div class="sync-state ${cls}">${ic(icon)}<span class="grow">${esc(text)}</span></div>
    ${buttons ? `<div class="btn-row">${buttons}</div>` : ''}
    <p class="muted small" style="margin:10px 0 0">Para poner un recordatorio mantén pulsado un mensaje → <b>✏️ Editar</b> → <b>Recordatorio</b>, o escribe <code>!mañana 9:30</code> o <code>!18:00</code> al enviarlo.</p>`;
}

const SYNC_LABELS = {
  idle: 'Conectando con el servidor…',
  syncing: 'Sincronizando…',
  ok: 'Todo guardado en MongoDB',
  offline: 'Sin conexión. Lo que escribas se guarda en este dispositivo y se subirá al volver.',
  auth: 'El servidor pide una clave de acceso.',
  error: 'No se pudo conectar con el servidor. Lo que escribas se guarda aquí mientras tanto.',
};

export function syncBoxHtml() {
  const st = getStatus();
  const good = st.state === 'ok' || st.state === 'syncing' || st.state === 'idle';
  const detail = [
    st.pending ? `${st.pending} cambio${st.pending > 1 ? 's' : ''} pendiente${st.pending > 1 ? 's' : ''} de subir` : '',
    st.lastSync ? `última vez: ${shortWhen(st.lastSync)}` : '',
  ].filter(Boolean).join(' · ');
  return `<div class="sync-state ${good ? 'ok' : 'bad'}">${ic(good ? 'cloudOk' : 'cloudOff')}
      <span class="grow">${esc(SYNC_LABELS[st.state] || '')}${detail ? `<br><small class="muted">${esc(detail)}</small>` : ''}</span></div>
    <div class="btn-row"><button class="btn outline" data-act="sync-now">${ic('sync', 'tiny')} Sincronizar ahora</button></div>
    ${settings.token.startsWith('rd1.')
      ? `<p class="muted small" style="margin:10px 0 0">Conectado con la cuenta de <b>${esc(S.me?.name || '')}</b>. Para cambiar de cuenta, cierra sesión en Ajustes → Cuenta.</p>`
      : `<label class="field token-field"><span>Clave de acceso (APP_TOKEN del servidor)</span>
      <input type="password" id="set-token" value="${esc(settings.token)}" placeholder="Vacío si el servidor no usa clave" autocomplete="off"></label>`}`;
}

/** Actualiza solo el bloque de sincronización (sin tocar lo que el usuario esté escribiendo). */
export function updateSyncBox() {
  const box = $('#sync-box');
  if (box && !box.contains(document.activeElement)) box.innerHTML = syncBoxHtml();
}

/** Dirección del servidor MCP para conectar Claude u otro asistente. */
export const mcpUrl = (withToken = false) => `${location.origin}/mcp${withToken && settings.token ? `/${encodeURIComponent(settings.token)}` : ''}`;

export function mcpBoxHtml() {
  const cmd = `claude mcp add --transport http chatnote ${mcpUrl()}${settings.token ? ' --header "Authorization: Bearer TU_APP_TOKEN"' : ''}`;
  return `<p class="muted small" style="margin:0 0 8px">Conecta Claude (u otro asistente compatible con MCP) para que lea y organice tus notas y tareas. Lo que escriba aparecerá aquí como mensaje recibido.</p>
    <label class="field" style="margin:6px 0"><span>URL para Claude.ai / Claude Desktop (Conectores → Añadir conector personalizado)</span>
      <input readonly id="mcp-url" value="${esc(mcpUrl(true))}" onfocus="this.select()"></label>
    <div class="btn-row"><button class="btn outline" data-act="copy-mcp" data-v="url">Copiar URL</button><button class="btn ghost" data-act="copy-mcp" data-v="cmd">Copiar comando de Claude Code</button></div>
    <p class="muted small" style="margin:8px 0 0">${settings.token ? 'La URL incluye tu clave de acceso: no la compartas.' : 'Tu servidor no usa clave: cualquiera con la URL podría usar el MCP. Configura APP_TOKEN.'}</p>
    <code class="mcp-cmd" hidden>${esc(cmd)}</code>`;
}

export function settingsPaneHtml() {
  const themes = [['system', 'Sistema'], ['light', 'Claro'], ['dark', 'Oscuro']];
  const me = S.me || { name: 'Yo', handle: 'yo', role: 'owner' };
  return `<header class="pane-head"><h1>Ajustes</h1></header>
  <div class="list">
    <div class="set-group links">
      <button class="set-link" data-act="sub" data-v="account">${personDot(me)}<span class="grow"><b>${esc(me.name)}</b><br><small class="muted">@${esc(me.handle || '')} · ${isOwnerUser() ? 'Propietario' : 'Miembro'}</small></span><span class="muted">›</span></button>
      ${isOwnerUser() && multiUser() ? `<button class="set-link" data-act="sub" data-v="people">👥<span class="grow">Personas<br><small class="muted">Invitar, dispositivos y acceso</small></span><span class="muted">›</span></button>` : ''}
    </div>
    <div class="sec-title">Apariencia</div>
    <div class="set-group"><div class="seg">${themes.map(([v, l]) => `<button class="${settings.theme === v ? 'on' : ''}" data-act="theme" data-v="${v}">${l}</button>`).join('')}</div></div>
    <div class="sec-title">Escritura</div>
    <div class="set-group"><label class="set-row toggle"><input type="checkbox" id="set-enter" ${settings.enterSend ? 'checked' : ''}><span class="grow">Enviar con Enter<br><small class="muted">Mayús + Enter hace un salto de línea</small></span></label></div>
    <div class="sec-title">Navegación</div>
    <div class="set-group"><label class="set-row toggle"><input type="checkbox" id="set-exit" ${settings.confirmExit ? 'checked' : ''}><span class="grow">Preguntar antes de salir<br><small class="muted">Al pulsar Atrás en la pantalla principal, cerrar o recargar la pestaña</small></span></label></div>
    ${S.installEvt ? '<div class="sec-title">App</div><div class="set-group"><button class="btn primary" data-act="install">Instalar ChatNote</button></div>' : ''}
    <div class="sec-title">Notificaciones</div>
    <div class="set-group" id="push-box"><p class="muted small">Comprobando…</p></div>
    <div class="sec-title">Sincronización</div>
    <div class="set-group" id="sync-box">${syncBoxHtml()}</div>
    ${isOwnerUser() ? `<div class="sec-title">Asistente de IA (MCP)</div>
    <div class="set-group" id="mcp-box">${mcpBoxHtml()}</div>` : ''}
    ${isOwnerUser() ? `<div class="sec-title" id="storage-title">Almacenamiento en la nube</div>
    <div class="set-group" id="storage-box">${storageBarsHtml()}</div>` : ''}
    <div class="sec-title">Tus datos</div>
    <div class="set-group">
      <p class="muted small" style="margin:0">${S.messages.length} mensajes en ${S.chats.length} chats${S.trash.length ? ` · ${S.trash.length} en la papelera` : ''}.</p>
      <div class="btn-row">
        <button class="btn outline" data-act="export">Exportar copia</button>
        ${isOwnerUser() ? `<label class="btn outline">Importar<input type="file" id="import-file" accept="application/json,.json" hidden></label>
        <button class="btn danger ghost" data-act="wipe">Borrar todo</button>` : ''}
      </div>
    </div>
    <div class="sec-title">Más</div>
    <div class="set-group links">
      <button class="set-link" data-act="sub" data-v="docs">${ic('book')}<span class="grow">Documentación<br><small class="muted">Atajos, formato, recordatorios, gestos y reglas del bloque HTML</small></span><span class="muted">›</span></button>
      <button class="set-link" data-act="sub" data-v="auto">⚙️<span class="grow">Automatizaciones<br><small class="muted">Resumen diario, calendario suscrito y correo a nota</small></span><span class="muted">›</span></button>
      ${isOwnerUser() ? `<button class="set-link" data-act="sub" data-v="backups">${ic('archive')}<span class="grow">Copias de seguridad<br><small class="muted">Automáticas cada día en la nube, descargar y restaurar</small></span><span class="muted">›</span></button>` : ''}
      <button class="set-link" data-act="sub" data-v="privacy">🔒<span class="grow">Privacidad<br><small class="muted">PIN y huella para los chats bloqueados</small></span><span class="muted">›</span></button>
      <button class="set-link" data-act="sub" data-v="trash">${ic('trash')}<span class="grow">Papelera<br><small class="muted">${S.trash.length ? `${S.trash.length} mensaje${S.trash.length > 1 ? 's' : ''} · ` : ''}se vacía sola a los 30 días</small></span><span class="muted">›</span></button>
    </div>
  </div>`;
}
