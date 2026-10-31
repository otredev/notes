/* Ajustes: tema, escritura, sincronización con MongoDB, datos y ayuda. */
import { $, esc, shortWhen } from '../utils.js';
import { ic } from '../icons.js';
import { S, settings } from '../state.js';
import { getStatus } from '../data/sync.js';
import { pushState } from '../push.js';

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
    <p class="muted small" style="margin:10px 0 0">Para poner un recordatorio toca un mensaje → <b>Recordatorio</b>, o escribe <code>!mañana 9:30</code> o <code>!18:00</code> al enviarlo.</p>`;
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
    <label class="field token-field"><span>Clave de acceso (APP_TOKEN del servidor)</span>
      <input type="password" id="set-token" value="${esc(settings.token)}" placeholder="Vacío si el servidor no usa clave" autocomplete="off"></label>`;
}

/** Actualiza solo el bloque de sincronización (sin tocar lo que el usuario esté escribiendo). */
export function updateSyncBox() {
  const box = $('#sync-box');
  if (box && !box.contains(document.activeElement)) box.innerHTML = syncBoxHtml();
}

/** Dirección del servidor MCP para conectar Claude u otro asistente. */
export const mcpUrl = (withToken = false) => `${location.origin}/mcp${withToken && settings.token ? `/${encodeURIComponent(settings.token)}` : ''}`;

export function mcpBoxHtml() {
  const cmd = `claude mcp add --transport http retrodark ${mcpUrl()}${settings.token ? ' --header "Authorization: Bearer TU_APP_TOKEN"' : ''}`;
  return `<p class="muted small" style="margin:0 0 8px">Conecta Claude (u otro asistente compatible con MCP) para que lea y organice tus notas y tareas. Lo que escriba aparecerá aquí como mensaje recibido.</p>
    <label class="field" style="margin:6px 0"><span>URL para Claude.ai / Claude Desktop (Conectores → Añadir conector personalizado)</span>
      <input readonly id="mcp-url" value="${esc(mcpUrl(true))}" onfocus="this.select()"></label>
    <div class="btn-row"><button class="btn outline" data-act="copy-mcp" data-v="url">Copiar URL</button><button class="btn ghost" data-act="copy-mcp" data-v="cmd">Copiar comando de Claude Code</button></div>
    <p class="muted small" style="margin:8px 0 0">${settings.token ? 'La URL incluye tu clave de acceso: no la compartas.' : 'Tu servidor no usa clave: cualquiera con la URL podría usar el MCP. Configura APP_TOKEN.'}</p>
    <code class="mcp-cmd" hidden>${esc(cmd)}</code>`;
}

export function settingsPaneHtml() {
  const themes = [['system', 'Sistema'], ['light', 'Claro'], ['dark', 'Oscuro']];
  return `<header class="pane-head"><h1>Ajustes</h1></header>
  <div class="list">
    <div class="sec-title">Apariencia</div>
    <div class="set-group"><div class="seg">${themes.map(([v, l]) => `<button class="${settings.theme === v ? 'on' : ''}" data-act="theme" data-v="${v}">${l}</button>`).join('')}</div></div>
    <div class="sec-title">Escritura</div>
    <div class="set-group"><label class="set-row toggle"><input type="checkbox" id="set-enter" ${settings.enterSend ? 'checked' : ''}><span class="grow">Enviar con Enter<br><small class="muted">Mayús + Enter hace un salto de línea</small></span></label></div>
    <div class="sec-title">Navegación</div>
    <div class="set-group"><label class="set-row toggle"><input type="checkbox" id="set-exit" ${settings.confirmExit ? 'checked' : ''}><span class="grow">Preguntar antes de salir<br><small class="muted">Al pulsar Atrás en la pantalla principal, cerrar o recargar la pestaña</small></span></label></div>
    ${S.installEvt ? '<div class="sec-title">App</div><div class="set-group"><button class="btn primary" data-act="install">Instalar RetroDark</button></div>' : ''}
    <div class="sec-title">Notificaciones</div>
    <div class="set-group" id="push-box"><p class="muted small">Comprobando…</p></div>
    <div class="sec-title">Sincronización</div>
    <div class="set-group" id="sync-box">${syncBoxHtml()}</div>
    <div class="sec-title">Asistente de IA (MCP)</div>
    <div class="set-group" id="mcp-box">${mcpBoxHtml()}</div>
    <div class="sec-title">Tus datos</div>
    <div class="set-group">
      <p class="muted small" style="margin:0">${S.messages.length} mensajes en ${S.chats.length} chats.</p>
      <div class="btn-row">
        <button class="btn outline" data-act="export">Exportar copia</button>
        <label class="btn outline">Importar<input type="file" id="import-file" accept="application/json,.json" hidden></label>
        <button class="btn danger ghost" data-act="wipe">Borrar todo</button>
      </div>
    </div>
    <div class="sec-title">Atajos al escribir</div>
    <div class="set-group"><table class="help">
      <tr><td><code>[]</code> o <code>/t</code></td><td>Crea una tarea (<code>[x]</code> ya hecha)</td></tr>
      <tr><td><code>[] algo</code> + Enter</td><td>Añade otra casilla debajo: una lista en un solo mensaje. Enter en una casilla vacía envía (o Ctrl + Enter).</td></tr>
      <tr><td><code>/n</code></td><td>Crea una nota</td></tr>
      <tr><td><code>/m</code></td><td>Mensaje normal, sin clasificar</td></tr>
      <tr><td><code>#etiqueta</code></td><td>Añade etiquetas. Si un chat tiene esa etiqueta vinculada, lo escrito en General se mueve allí.</td></tr>
      <tr><td><code>@categoría</code></td><td>Asigna una categoría existente</td></tr>
      <tr><td><code>!hoy</code> <code>!mañana</code><br><code>!2026-12-24</code></td><td>Fecha límite</td></tr>
      <tr><td><code>*negrita*</code> <code>_cursiva_</code><br><code>~tachado~</code></td><td>Formato, como en WhatsApp</td></tr>
    </table></div>
    <div class="sec-title">Gestos</div>
    <div class="set-group small">
      <p>Toca un mensaje para editarlo, cambiar su tipo, categoría, etiquetas, fecha o chat.</p>
      <p>Mantén pulsado (o clic derecho) para seleccionar varios y clasificarlos de golpe.</p>
      <p>Desliza un mensaje a la derecha (o pasa el ratón y pulsa ↩) para responderlo. Desde el mensaje, "Citar en…" lo cita en otro chat. Toca una cita para ir al original.</p>
      <p>Toca el icono a la izquierda del cuadro de texto para elegir si envías un mensaje, una nota o una tarea.</p>
    </div>
  </div>`;
}
