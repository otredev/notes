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
import { allowLeave } from '../backnav.js';

const COLORS = ['#3e9d7c', '#53bdeb', '#ff7a59', '#a78bfa', '#f5b70a', '#ec4899', '#10b981', '#64748b'];
const back = (title) => `<header class="pane-head"><button class="icon-btn" data-act="sub" data-v="" aria-label="Volver a Ajustes">${ic('back')}</button><h1>${title}</h1></header>`;
export const personDot = (p, size = '') => `<span class="person-dot ${size}" style="--c:${p?.color || 'var(--muted)'}">${esc((p?.name || '?').trim()[0]?.toUpperCase() || '?')}</span>`;
export const isOwnerUser = () => (S.me?.role || 'owner') === 'owner';
export const multiUser = () => !!S.server?.features?.multiUser;
export const linkUrl = (kind, code) => `${location.origin}${location.pathname}?${kind}=${encodeURIComponent(code)}`;

let sessions = null, users = null, lastLink = null;

/**
 * Identificador de este navegador (no cambia al cerrar sesión). Con él, volver a entrar desde el mismo
 * dispositivo reemplaza su sesión anterior en vez de sumar otra a la lista.
 */
export function deviceId() {
  const KEY = 'retrodark-device';
  try {
    let id = localStorage.getItem(KEY);
    if (!/^[a-z0-9]{8,40}$/.test(id || '')) { id = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => (b % 36).toString(36)).join(''); localStorage.setItem(KEY, id); }
    return id;
  } catch { return ''; }
}

/* ---------- Cuenta ---------- */
let viaAppToken = false;
export async function loadAccount() {
  try { const r = await api('sessions'); sessions = r.sessions; viaAppToken = !!r.viaAppToken; } catch { sessions = []; }
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

    <div class="sec-title">Contraseña</div>
    <div class="set-group">
      <p class="muted small" style="margin:0 0 8px">Entras con el usuario <b>@${esc(me.handle || '')}</b> y tu contraseña.${!me.hasPassword ? ' <b>Aún no tienes contraseña:</b> créala para poder entrar desde otros dispositivos.' : ''}</p>
      ${me.hasPassword && !viaAppToken ? '<label class="field"><span>Contraseña actual</span><input id="pw-cur" type="password" autocomplete="current-password"></label>' : ''}
      <label class="field"><span>${me.hasPassword ? 'Contraseña nueva' : 'Contraseña'} (mínimo 8)</span><input id="pw-new" type="password" autocomplete="new-password"></label>
      <label class="field"><span>Repítela</span><input id="pw-new2" type="password" autocomplete="new-password"></label>
      <div class="btn-row"><button class="btn primary" data-act="pw-save">${me.hasPassword ? 'Cambiar contraseña' : 'Crear contraseña'}</button></div>
    </div>

    <div class="sec-title">Tus dispositivos</div>
    <div class="set-group">
      ${viaAppToken
        ? `<p class="muted small" style="margin:0 0 8px">Este dispositivo entra con la clave del servidor (APP_TOKEN). En los demás puedes entrar con tu usuario y contraseña.${S.me?.hasPassword ? '' : ' <b>Crea tu contraseña antes de cerrar sesión</b>, o necesitarás la clave para volver a entrar.'}</p>`
        : `<p class="muted small" style="margin:0 0 8px">Puedes entrar con tu usuario y contraseña, o crear un enlace de un solo uso para otro móvil u ordenador (caduca en 30 minutos).</p>
          <div class="btn-row"><button class="btn outline" data-act="acc-link">Vincular otro dispositivo</button></div>
          ${lastLink ? `<label class="field"><span>Enlace (ábrelo en el otro dispositivo)</span><input readonly id="acc-link-url" value="${esc(lastLink)}" onfocus="this.select()"></label>
            <div class="btn-row"><button class="btn ghost" data-act="copy-input" data-v="acc-link-url">Copiar enlace</button></div>` : ''}
          ${(sessions || []).length > 1 ? '<div class="btn-row"><button class="btn ghost danger" data-act="sess-others">Cerrar sesión en los demás dispositivos</button></div>' : ''}
          ${(sessions || []).map((s) => `<div class="trash-row"><div class="grow"><b>${esc(deviceName(s.device))}</b>${s.current ? ' <span class="badge-mini">este</span>' : ''}<br><small class="muted">desde ${shortWhen(s.createdAt)} · visto ${shortWhen(s.lastSeen || s.createdAt)}</small></div>
            ${s.current ? '' : `<button class="btn ghost" data-act="sess-revoke" data-v="${esc(s.id)}">Cerrar</button>`}</div>`).join('')}
`}
      ${settings.token ? '<div class="btn-row"><button class="btn danger ghost" data-act="logout">Cerrar sesión en este dispositivo</button></div>' : ''}
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

export async function changePassword() {
  const a = $('#pw-new').value, b = $('#pw-new2').value;
  if (a.length < 8) { toast('La contraseña debe tener al menos 8 caracteres'); return false; }
  if (a !== b) { toast('Las contraseñas no coinciden'); return false; }
  try {
    await api('auth/password', { method: 'POST', body: { password: a, current: $('#pw-cur')?.value || '' } });
    if (S.me) S.me.hasPassword = true;
    toast('Contraseña guardada');
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

export async function revokeOtherSessions() {
  try { await api('sessions/revoke-others', { method: 'POST' }); sessions = sessions.filter((s) => s.current); toast('Sesiones cerradas en los demás dispositivos'); } catch (err) { toast(err.message); }
}

export async function revokeSession(id) {
  try { await api('sessions/revoke', { method: 'POST', body: { id } }); sessions = sessions.filter((s) => s.id !== id); toast('Sesión cerrada'); } catch (err) { toast(err.message); }
}

/** Cerrar sesión: este dispositivo olvida la cuenta y sus datos locales. */
export function logout() {
  confirmSheet('Este dispositivo dejará de tener acceso a tu cuenta y se borrarán sus datos locales (lo sincronizado sigue en el servidor).', 'Cerrar sesión', async () => {
    await switchAccount('');
  });
}

/**
 * Cambia la sesión de este dispositivo. Normalmente empieza de cero con los datos de esa cuenta;
 * con keepLocal (el propietario en un dispositivo que aún no sincronizaba) se conserva lo guardado y se sube.
 */
export async function switchAccount(token, { keepLocal = false } = {}) {
  // La sesión anterior de este dispositivo se cierra en el servidor (deja de salir en "Dispositivos").
  const prev = settings.token;
  if (prev && prev !== token) {
    try {
      await fetch('api/auth/logout', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${prev}` }, body: '{}' });
    } catch { /* sin conexión: se borra igual en este dispositivo */ }
  }
  settings.token = token;
  saveSettings();
  await storeToken();
  await forgetAccount();
  if (!keepLocal) await resetLocal(null);
  allowLeave();
  location.replace(location.pathname);
}

/* ---------- Personas (propietario) ---------- */
export function peoplePaneHtml() {
  const list = (users || []).filter((p) => p.id !== 'owner');
  return `${back('Personas')}<div class="list">
    <div class="set-group">
      <p class="muted small" style="margin:0 0 8px">Dos formas de dar acceso: un <b>código de invitación</b> (la persona crea su cuenta con su usuario y contraseña; sirve una vez y caduca en 7 días) o <b>crear tú la cuenta</b> y darle su usuario y contraseña.</p>
      <div class="btn-row"><button class="btn primary" data-act="ppl-invite">+ Código de invitación</button><button class="btn outline" data-act="ppl-new">Crear cuenta</button></div>
      ${lastInvite ? `<label class="field"><span>Código</span><input readonly id="ppl-code" class="code-input" value="${esc(lastInvite.code)}" onfocus="this.select()"></label>
        <label class="field"><span>O este enlace (abre "Crear cuenta" con el código puesto)</span><input readonly id="ppl-link" value="${esc(lastInvite.url)}" onfocus="this.select()"></label>
        <div class="btn-row"><button class="btn ghost" data-act="copy-input" data-v="ppl-code">Copiar código</button><button class="btn ghost" data-act="copy-input" data-v="ppl-link">Copiar enlace</button></div>` : ''}
    </div>
    <div class="sec-title">Personas <span>${list.length}</span></div>
    ${list.length ? list.map((p) => `<div class="trash-row person-row">${personDot(p)}<div class="grow"><b>${esc(p.name)}</b> <span class="muted">@${esc(p.handle)}</span><br>
        <small class="muted">${p.disabled ? 'Desactivada' : `${p.sessions || 0} dispositivo${p.sessions === 1 ? '' : 's'}${p.hasPassword ? '' : ' · sin contraseña'}`}</small></div>
      <div class="trash-acts">
        ${p.disabled ? '' : `<button class="btn ghost" data-act="ppl-pass" data-v="${p.id}" data-n="${esc(p.name)}" title="Poner una contraseña nueva">Contraseña</button>
          <button class="btn ghost" data-act="ppl-link" data-v="${p.id}" title="Enlace para entrar en un dispositivo nuevo">Enlace</button>`}
        <button class="btn ghost ${p.disabled ? '' : 'danger'}" data-act="ppl-disable" data-v="${p.id}" data-on="${p.disabled ? '0' : '1'}">${p.disabled ? 'Activar' : 'Desactivar'}</button>
      </div></div>`).join('') : '<p class="muted small pad">Aún no has invitado a nadie.</p>'}
    ${lastLink && lastLink.includes('login=') ? `<div class="set-group"><label class="field"><span>Enlace de acceso (30 minutos)</span><input readonly id="ppl-login" value="${esc(lastLink)}" onfocus="this.select()"></label>
      <div class="btn-row"><button class="btn ghost" data-act="copy-input" data-v="ppl-login">Copiar enlace</button></div></div>` : ''}
  </div>`;
}

let lastInvite = null;
export async function inviteLink(chatId = null) {
  try {
    const r = await api('auth/invite', { method: 'POST', body: chatId ? { chatId } : {} });
    lastInvite = { code: r.code, url: linkUrl('join', r.code) };
    copyText(chatId ? lastInvite.url : r.code);
    return lastInvite.url;
  } catch (err) { toast(err.message); return null; }
}

/** El propietario crea una cuenta con usuario y contraseña. */
export function newUserSheet(onDone) {
  sheet('Crear cuenta', `<p class="muted small">Dale a la persona su usuario y su contraseña. Podrá cambiar la contraseña en Ajustes → Cuenta.</p>
    <label class="field"><span>Nombre</span><input id="nu-name" maxlength="40" autocomplete="off"></label>
    <label class="field"><span>Usuario</span><input id="nu-handle" maxlength="24" autocapitalize="off" autocomplete="off"></label>
    <label class="field"><span>Contraseña (mínimo 8)</span><input id="nu-pass" type="text" autocomplete="off" value="${randomPass()}"></label>`, {
    actions: '<span class="grow"></span><button class="btn ghost" data-act="sheet-close">Cancelar</button><button class="btn primary" data-s="ok">Crear</button>',
    onMount: (sh) => {
      let touched = false;
      $('#nu-handle', sh).addEventListener('input', () => { touched = true; });
      $('#nu-name', sh).addEventListener('input', (e) => { if (!touched) $('#nu-handle', sh).value = e.target.value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 20); });
      setTimeout(() => $('#nu-name', sh).focus(), 60);
      sh.addEventListener('click', async (e) => {
        if (!e.target.closest('[data-s=ok]')) return;
        try {
          const r = await api('users/create', { method: 'POST', body: { name: $('#nu-name', sh).value, handle: $('#nu-handle', sh).value, password: $('#nu-pass', sh).value } });
          copyText(`Usuario: ${r.user.handle}\nContraseña: ${$('#nu-pass', sh).value}\nEntra en: ${location.origin}${location.pathname}`);
          closeSheet();
          toast(`Cuenta creada para ${r.user.name}. Datos de acceso copiados`);
          onDone?.();
        } catch (err) { toast(err.message); }
      });
    },
  });
}

/** El propietario pone una contraseña nueva a alguien (cierra sus sesiones). */
export function resetPasswordSheet(id, name, onDone) {
  sheet(`Contraseña de ${name}`, `<p class="muted small">Se cerrará la sesión en todos sus dispositivos y tendrá que entrar con la contraseña nueva.</p>
    <label class="field"><span>Contraseña nueva (mínimo 8)</span><input id="rp-pass" type="text" autocomplete="off" value="${randomPass()}"></label>`, {
    actions: '<span class="grow"></span><button class="btn ghost" data-act="sheet-close">Cancelar</button><button class="btn primary" data-s="ok">Guardar</button>',
    onMount: (sh) => sh.addEventListener('click', async (e) => {
      if (!e.target.closest('[data-s=ok]')) return;
      try {
        await api('users/password', { method: 'POST', body: { id, password: $('#rp-pass', sh).value } });
        copyText($('#rp-pass', sh).value);
        closeSheet();
        toast('Contraseña cambiada y copiada');
        onDone?.();
      } catch (err) { toast(err.message); }
    }),
  });
}

/** Contraseña aleatoria fácil de dictar (sin 0/O ni 1/l). */
function randomPass() {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  return [...crypto.getRandomValues(new Uint8Array(10))].map((b) => abc[b % abc.length]).join('');
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

export function loginSheet(code) {
  const go = async () => {
    try {
      const r = await fetchJson('auth/redeem', { code, deviceId: deviceId() });
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
