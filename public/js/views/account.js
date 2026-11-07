/*
 * Cuenta (tu perfil, dispositivos) y Personas (solo el propietario: invitar, enlaces de acceso, desactivar).
 * También los enlaces ?join= (unirse) y ?login= (vincular dispositivo).
 */
import { $, esc, shortWhen } from '../utils.js';
import { ic } from '../icons.js';
import { S, settings, saveSettings } from '../state.js';
import { api, resetLocal, syncNow, storeToken, forgetAccount, setMe } from '../data/sync.js';
import { sheet, closeSheet, toast, confirmSheet, copyText } from '../ui/dom.js';
import { myId } from '../people.js';

const COLORS = ['#3e9d7c', '#53bdeb', '#ff7a59', '#a78bfa', '#f5b70a', '#ec4899', '#10b981', '#64748b'];
const back = (title) => `<header class="pane-head"><button class="icon-btn" data-act="sub" data-v="" aria-label="Volver a Ajustes">${ic('back')}</button><h1>${title}</h1></header>`;
export const personDot = (p, size = '') => `<span class="person-dot ${size}" style="--c:${p?.color || 'var(--muted)'}">${esc((p?.name || '?').trim()[0]?.toUpperCase() || '?')}</span>`;
export const isOwnerUser = () => (S.me?.role || 'owner') === 'owner';
export const multiUser = () => !!S.server?.features?.multiUser;
export const linkUrl = (kind, code) => `${location.origin}${location.pathname}?${kind}=${encodeURIComponent(code)}`;

let sessions = null, users = null, lastLink = null;

/* ---------- Cuenta ---------- */
export async function loadAccount() {
  try { sessions = isOwnerUser() ? [] : (await api('sessions')).sessions; } catch { sessions = []; }
  if (isOwnerUser() && multiUser()) { try { users = (await api('users')).users; } catch { users = []; } }
}

export function accountPaneHtml() {
  const me = S.me || { name: 'Yo', handle: 'yo', color: COLORS[0], role: 'owner' };
  const owner = isOwnerUser();
  return `${back('Cuenta')}<div class="list">
    <div class="set-group">
      <div class="acc-head">${personDot(me, 'lg')}<div><b>${esc(me.name)}</b><br><span class="muted">@${esc(me.handle || '')} · ${owner ? 'Propietario' : 'Miembro'}</span></div></div>
      <label class="field"><span>Nombre</span><input id="acc-name" maxlength="40" value="${esc(me.name)}" autocomplete="off"></label>
      <label class="field"><span>Usuario (para @menciones)</span><input id="acc-handle" maxlength="24" value="${esc(me.handle || '')}" autocomplete="off" autocapitalize="off"></label>
      <div class="field"><span>Color</span><div class="color-row">${COLORS.map((c) => `<button data-act="acc-color" data-v="${c}" style="--c:${c}" class="${me.color === c ? 'on' : ''}" aria-label="Color ${c}"></button>`).join('')}</div></div>
      <div class="btn-row"><button class="btn primary" data-act="acc-save">Guardar</button></div>
    </div>

    <div class="sec-title">Tus dispositivos</div>
    <div class="set-group">
      ${owner
        ? `<p class="muted small" style="margin:0">Como propietario, cada dispositivo entra con la clave del servidor (APP_TOKEN), en Ajustes → Sincronización.</p>`
        : `<p class="muted small" style="margin:0 0 8px">Para usar tu cuenta en otro móvil u ordenador, crea un enlace y ábrelo allí (sirve una vez y caduca en 30 minutos).</p>
          <div class="btn-row"><button class="btn outline" data-act="acc-link">Vincular otro dispositivo</button></div>
          ${lastLink ? `<label class="field"><span>Enlace (ábrelo en el otro dispositivo)</span><input readonly id="acc-link-url" value="${esc(lastLink)}" onfocus="this.select()"></label>
            <div class="btn-row"><button class="btn ghost" data-act="copy-input" data-v="acc-link-url">Copiar enlace</button></div>` : ''}
          ${(sessions || []).map((s) => `<div class="trash-row"><div class="grow"><b>${esc(deviceName(s.device))}</b>${s.current ? ' <span class="badge-mini">este</span>' : ''}<br><small class="muted">desde ${shortWhen(s.createdAt)} · visto ${shortWhen(s.lastSeen || s.createdAt)}</small></div>
            ${s.current ? '' : `<button class="btn ghost" data-act="sess-revoke" data-v="${esc(s.id)}">Cerrar</button>`}</div>`).join('')}
          <div class="btn-row"><button class="btn danger ghost" data-act="logout">Cerrar sesión en este dispositivo</button></div>`}
    </div>
  </div>`;
}

const deviceName = (ua = '') => (/iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Dispositivo')
  + (/Edg\//.test(ua) ? ' · Edge' : /Chrome\//.test(ua) ? ' · Chrome' : /Firefox\//.test(ua) ? ' · Firefox' : /Safari\//.test(ua) ? ' · Safari' : '');

export async function saveProfile() {
  const color = document.querySelector('[data-act=acc-color].on')?.dataset.v;
  try {
    const r = await api('me', { method: 'POST', body: { name: $('#acc-name').value, handle: $('#acc-handle').value, ...(color ? { color } : {}) } });
    await setMe(r.me, r.people);
    toast('Perfil guardado');
    return true;
  } catch (err) { toast(err.message); return false; }
}

export async function createDeviceLink() {
  try {
    const r = await api('auth/link', { method: 'POST', body: {} });
    lastLink = linkUrl('login', r.code);
    copyText(lastLink);
    return true;
  } catch (err) { toast(err.message); return false; }
}

export async function revokeSession(id) {
  try { await api('sessions/revoke', { method: 'POST', body: { id } }); sessions = sessions.filter((s) => s.id !== id); toast('Sesión cerrada'); } catch (err) { toast(err.message); }
}

/** Cerrar sesión: este dispositivo olvida la cuenta y sus datos locales. */
export function logout() {
  confirmSheet('Este dispositivo dejará de tener acceso a tu cuenta y se borrarán sus datos locales (lo sincronizado sigue en el servidor).', 'Cerrar sesión', async () => {
    try { await api('auth/logout', { method: 'POST' }); } catch { /* sin conexión: se borra igual */ }
    await switchAccount('');
  });
}

/** Cambia la clave/sesión de este dispositivo y empieza de cero con los datos de esa cuenta. */
export async function switchAccount(token) {
  settings.token = token;
  saveSettings();
  await storeToken();
  await forgetAccount();
  await resetLocal(null);
  location.replace(location.pathname);
}

/* ---------- Personas (propietario) ---------- */
export function peoplePaneHtml() {
  const list = (users || []).filter((p) => p.id !== 'owner');
  return `${back('Personas')}<div class="list">
    <div class="set-group">
      <p class="muted small" style="margin:0 0 8px">Invita a alguien con un enlace (sirve una vez y caduca en 7 días). Al abrirlo elige su nombre y ya puede usar ChatNote con sus propias notas. Después puedes compartir chats con esa persona desde la información del chat.</p>
      <div class="btn-row"><button class="btn primary" data-act="ppl-invite">+ Invitar a alguien</button></div>
      ${lastLink && lastLink.includes('join=') ? `<label class="field"><span>Enlace de invitación</span><input readonly id="ppl-link" value="${esc(lastLink)}" onfocus="this.select()"></label>
        <div class="btn-row"><button class="btn ghost" data-act="copy-input" data-v="ppl-link">Copiar enlace</button></div>` : ''}
    </div>
    <div class="sec-title">Personas <span>${list.length}</span></div>
    ${list.length ? list.map((p) => `<div class="trash-row">${personDot(p)}<div class="grow"><b>${esc(p.name)}</b> <span class="muted">@${esc(p.handle)}</span><br>
        <small class="muted">${p.disabled ? 'Desactivada' : `${p.sessions || 0} dispositivo${p.sessions === 1 ? '' : 's'}`}</small></div>
      <div class="trash-acts">
        ${p.disabled ? '' : `<button class="btn ghost" data-act="ppl-link" data-v="${p.id}" title="Enlace para entrar en un dispositivo nuevo">Enlace</button>`}
        <button class="btn ghost ${p.disabled ? '' : 'danger'}" data-act="ppl-disable" data-v="${p.id}" data-on="${p.disabled ? '0' : '1'}">${p.disabled ? 'Activar' : 'Desactivar'}</button>
      </div></div>`).join('') : '<p class="muted small pad">Aún no has invitado a nadie.</p>'}
    ${lastLink && lastLink.includes('login=') ? `<div class="set-group"><label class="field"><span>Enlace de acceso (30 minutos)</span><input readonly id="ppl-login" value="${esc(lastLink)}" onfocus="this.select()"></label>
      <div class="btn-row"><button class="btn ghost" data-act="copy-input" data-v="ppl-login">Copiar enlace</button></div></div>` : ''}
  </div>`;
}

export async function inviteLink(chatId = null) {
  try {
    const r = await api('auth/invite', { method: 'POST', body: chatId ? { chatId } : {} });
    lastLink = linkUrl('join', r.code);
    copyText(lastLink);
    return lastLink;
  } catch (err) { toast(err.message); return null; }
}

export async function loginLinkFor(userId) {
  try {
    const r = await api('auth/link', { method: 'POST', body: { userId } });
    lastLink = linkUrl('login', r.code);
    copyText(lastLink);
  } catch (err) { toast(err.message); }
}

export async function setDisabled(id, disabled) {
  try { await api('users/disable', { method: 'POST', body: { id, disabled } }); await loadAccount(); toast(disabled ? 'Persona desactivada: sus dispositivos ya no entran' : 'Persona activada'); } catch (err) { toast(err.message); }
}

/* ---------- Enlaces ?join= y ?login= ---------- */
const hasLocalAccount = () => !!settings.token;

export function joinSheet(code) {
  sheet('Unirte a ChatNote', `<p class="muted small">Te invitaron a ChatNote. Elige cómo te verán los demás.</p>
    <label class="field"><span>Tu nombre</span><input id="join-name" maxlength="40" autocomplete="name" placeholder="Ana"></label>
    <label class="field"><span>Usuario (para @menciones)</span><input id="join-handle" maxlength="24" autocapitalize="off" placeholder="ana"></label>
    ${hasLocalAccount() ? '<p class="small" style="color:var(--danger)">Este dispositivo ya tiene otra cuenta. Al unirte, se cambiará a la nueva y se borrarán sus datos locales (lo sincronizado sigue en el servidor).</p>' : ''}`, {
    actions: '<span class="grow"></span><button class="btn ghost" data-act="sheet-close">Ahora no</button><button class="btn primary" data-s="ok">Unirme</button>',
    onMount: (sh) => {
      const name = $('#join-name', sh), handle = $('#join-handle', sh);
      let touched = false;
      handle.addEventListener('input', () => { touched = true; });
      name.addEventListener('input', () => {
        if (!touched) handle.value = name.value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 20);
      });
      setTimeout(() => name.focus(), 60);
      sh.addEventListener('click', async (e) => {
        if (!e.target.closest('[data-s=ok]')) return;
        try {
          const r = await fetchJson('auth/join', { code, name: name.value, handle: handle.value });
          closeSheet();
          toast(`¡Bienvenido, ${r.me.name}!`);
          await switchAccount(r.token);
        } catch (err) { toast(err.message); }
      });
    },
  });
}

export function loginSheet(code) {
  const go = async () => {
    try {
      const r = await fetchJson('auth/redeem', { code });
      toast(`Dispositivo vinculado: ${r.me.name}`);
      await switchAccount(r.token);
    } catch (err) { toast(err.message); }
  };
  if (!hasLocalAccount()) { go(); return; }
  confirmSheet('Este dispositivo ya tiene una cuenta. ¿Cambiar a la del enlace? Se borrarán sus datos locales (lo sincronizado sigue en el servidor).', 'Cambiar de cuenta', go);
}

/** Sin la sesión de este dispositivo (son rutas públicas). */
async function fetchJson(path, body) {
  const res = await fetch(`api/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

export { myId };
