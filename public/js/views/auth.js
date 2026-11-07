/*
 * Pantalla de entrada: iniciar sesión (usuario + contraseña) o crear una cuenta con un código de invitación.
 * Aparece si el servidor usa cuentas y este dispositivo no tiene sesión (o la sesión se cerró).
 */
import { $, esc } from '../utils.js';
import { ic } from '../icons.js';
import { S, settings } from '../state.js';
import { toast } from '../ui/dom.js';
import { switchAccount, deviceId } from './account.js';

let shown = false;

async function post(path, body) {
  const res = await fetch(`api/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

/** ¿El servidor usa cuentas? (null si no responde: se sigue sin conexión) */
export async function accountsEnabled() {
  try {
    const res = await fetch('api/auth/status', { cache: 'no-store', signal: AbortSignal.timeout?.(4000) });
    if (!res.ok) return null;
    return !!(await res.json()).accounts;
  } catch { return null; }
}

const suggest = (name) => name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 20);

/**
 * @param {{ mode?: 'login'|'register', code?: string, reason?: string }} opt
 */
export function showAuth({ mode = 'login', code = '', reason = '' } = {}) {
  if (shown) { if (code) { $('#au-code').value = code; switchTab('register'); } return; }
  shown = true;
  const el = document.createElement('div');
  el.id = 'auth';
  el.innerHTML = `<div class="au-card" role="dialog" aria-modal="true" aria-labelledby="au-title">
    <div class="au-logo">${ic('chats')}</div>
    <h1 id="au-title">Chat<em>Note</em></h1>
    ${reason ? `<p class="au-reason">${esc(reason)}</p>` : ''}
    <div class="seg au-tabs"><button data-au="login">Iniciar sesión</button><button data-au="register">Crear cuenta</button></div>

    <form id="au-login" autocomplete="on">
      <label class="field"><span>Usuario</span><input id="au-user" name="username" autocomplete="username" autocapitalize="off" spellcheck="false" placeholder="tu_usuario" required></label>
      <label class="field"><span>Contraseña</span><input id="au-pass" name="password" type="password" autocomplete="current-password" required></label>
      <button class="btn primary wide" type="submit">Entrar</button>
    </form>

    <form id="au-register" autocomplete="on" hidden>
      <label class="field"><span>Código de invitación</span><input id="au-code" autocapitalize="off" spellcheck="false" value="${esc(code)}" placeholder="Te lo da quien administra ChatNote" required></label>
      <label class="field"><span>Tu nombre</span><input id="au-name" autocomplete="name" maxlength="40" required></label>
      <label class="field"><span>Usuario (para entrar y para @menciones)</span><input id="au-handle" name="username" autocomplete="username" autocapitalize="off" spellcheck="false" maxlength="24" required></label>
      <label class="field"><span>Contraseña (mínimo 8 caracteres)</span><input id="au-p1" type="password" autocomplete="new-password" minlength="8" required></label>
      <label class="field"><span>Repite la contraseña</span><input id="au-p2" type="password" autocomplete="new-password" minlength="8" required></label>
      <button class="btn primary wide" type="submit">Crear cuenta</button>
    </form>

    <details class="au-master"><summary>Entrar con la clave del servidor (APP_TOKEN)</summary>
      <form id="au-token"><label class="field"><span>Clave</span><input id="au-tok" type="password" autocomplete="off"></label>
      <button class="btn outline wide" type="submit">Entrar como propietario</button></form>
    </details>
  </div>`;
  document.body.append(el);
  document.body.classList.add('auth-open');

  const busy = (form, on) => form.querySelectorAll('button, input').forEach((x) => { x.disabled = on; });
  const done = async (r, keepLocal = false) => {
    toast(`Hola, ${r.me?.name || ''} 👋`);
    await switchAccount(r.token, { keepLocal });
  };

  el.addEventListener('click', (e) => { const b = e.target.closest('[data-au]'); if (b) switchTab(b.dataset.au); });
  let touched = false;
  $('#au-handle', el).addEventListener('input', () => { touched = true; });
  $('#au-name', el).addEventListener('input', (e) => { if (!touched) $('#au-handle', el).value = suggest(e.target.value); });

  $('#au-login', el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    busy(f, true);
    try {
      const r = await post('auth/login', { handle: $('#au-user', el).value.trim(), password: $('#au-pass', el).value, deviceId: deviceId() });
      // El propietario que usaba este dispositivo sin cuenta conserva lo que tenía guardado aquí.
      await done(r, r.me?.id === 'owner' && !settings.token && !!S.hadLocalData);
    } catch (err) { toast(err.message); busy(f, false); $('#au-pass', el).select(); }
  });
  $('#au-register', el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    if ($('#au-p1', el).value !== $('#au-p2', el).value) { toast('Las contraseñas no coinciden'); return; }
    busy(f, true);
    try {
      const r = await post('auth/register', { code: $('#au-code', el).value.trim(), name: $('#au-name', el).value, handle: $('#au-handle', el).value.trim(), password: $('#au-p1', el).value, deviceId: deviceId() });
      await done(r);
    } catch (err) { toast(err.message); busy(f, false); }
  });
  $('#au-token', el).addEventListener('submit', async (e) => {
    e.preventDefault();
    const tok = $('#au-tok', el).value.trim();
    if (!tok) return;
    const res = await fetch('api/me', { headers: { Authorization: `Bearer ${tok}` } }).catch(() => null);
    if (!res?.ok) { toast('Esa clave no es correcta'); return; }
    await switchAccount(tok, { keepLocal: !settings.token && !!S.hadLocalData });
  });

  switchTab(code ? 'register' : mode);
}

function switchTab(mode) {
  const el = $('#auth');
  if (!el) return;
  el.querySelectorAll('[data-au]').forEach((b) => b.classList.toggle('on', b.dataset.au === mode));
  $('#au-login', el).hidden = mode !== 'login';
  $('#au-register', el).hidden = mode !== 'register';
  // La clave del servidor (solo para el propietario) no tiene sentido al crear una cuenta.
  $('.au-master', el).hidden = mode !== 'login';
  setTimeout(() => (mode === 'login' ? $('#au-user', el) : $('#au-code', el).value ? $('#au-name', el) : $('#au-code', el)).focus(), 50);
}
