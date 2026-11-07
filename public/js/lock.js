/*
 * Bloqueo de chats con PIN (y huella / Face ID si el dispositivo lo permite).
 *
 * - "Bloqueado" es una marca del chat (chat.locked) que se sincroniza: el chat queda bloqueado en todos tus dispositivos.
 * - El PIN es de cada dispositivo (se guarda solo su hash, PBKDF2) y la huella usa WebAuthn del propio dispositivo.
 * - Al desbloquear se abren todos los chats bloqueados hasta que la app pase 1 minuto en segundo plano o pulses "Bloquear".
 *
 * Es un bloqueo de la interfaz: oculta el contenido en la app, la búsqueda, Tareas, el calendario y las notificaciones,
 * pero los datos siguen guardados en este navegador como el resto.
 */
import { $, esc } from './utils.js';
import { S, settings } from './state.js';
import { sheet, closeSheet, toast } from './ui/dom.js';

const KEY = 'retrodark-lock';
const ITER = 150000;
const RELOCK_MS = 60 * 1000;
let unlocked = false;
let hiddenAt = 0;
const listeners = new Set();

const readCfg = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const writeCfg = (c) => { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* sin almacenamiento */ } };
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export const hasPin = () => !!readCfg().hash;
export const hasBiometric = () => !!readCfg().credId;
export const anyLocked = () => S.chats.some((c) => c.locked);
export const isUnlocked = () => unlocked;
/** ¿Este chat está bloqueado ahora mismo? */
export const isLocked = (chatOrId) => {
  if (unlocked) return false;
  const c = typeof chatOrId === 'string' ? S.chats.find((x) => x.id === chatOrId) : chatOrId;
  return !!c?.locked;
};
/** Ids de los chats que ahora se ocultan. */
export const hiddenChatIds = () => (unlocked ? new Set() : new Set(S.chats.filter((c) => c.locked).map((c) => c.id)));
export const onLockChange = (fn) => listeners.add(fn);
const changed = () => listeners.forEach((fn) => fn());

async function hashPin(pin, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITER }, key, 256));
}

export async function setPin(pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  writeCfg({ ...readCfg(), salt: b64(salt), hash: await hashPin(pin, salt) });
}

async function checkPin(pin) {
  const c = readCfg();
  if (!c.hash) return false;
  return (await hashPin(pin, unb64(c.salt))) === c.hash;
}

export function lockNow() {
  if (!unlocked) return;
  unlocked = false;
  changed();
}

function setUnlocked() {
  unlocked = true;
  changed();
}

/* ---------- Huella / Face ID (WebAuthn, solo en este dispositivo) ---------- */
export const biometricSupported = async () => !!(window.PublicKeyCredential
  && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable?.().catch(() => false));

export async function enableBiometric() {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'RetroDark' },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'retrodark', displayName: 'RetroDark' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'discouraged' },
      timeout: 60000,
    },
  });
  writeCfg({ ...readCfg(), credId: b64(cred.rawId) });
}

export const disableBiometric = () => { const c = readCfg(); delete c.credId; writeCfg(c); };

async function biometricCheck() {
  const c = readCfg();
  if (!c.credId) return false;
  try {
    await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ type: 'public-key', id: unb64(c.credId) }],
        userVerification: 'required',
        timeout: 60000,
      },
    });
    return true;
  } catch {
    return false;
  }
}

/* ---------- Hojas ---------- */
const pinInput = (id, label) => `<label class="field"><span>${label}</span><input id="${id}" class="pin-input" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" autocomplete="off"></label>`;
const validPin = (p) => /^\d{4,8}$/.test(p);

/** Crear o cambiar el PIN de este dispositivo. Si ya hay chats bloqueados y no hay PIN aquí, pide la clave del servidor. */
export function pinSetupSheet() {
  return new Promise((resolve) => {
    let done = false;
    const needsToken = !hasPin() && anyLocked() && !!settings.token;
    const changing = hasPin();
    sheet(changing ? 'Cambiar PIN' : 'Crear PIN', `
      <p class="muted small">El PIN es solo de este dispositivo (4 a 8 números). Con él se abren los chats bloqueados.</p>
      ${changing ? pinInput('pin-old', 'PIN actual') : ''}
      ${needsToken ? `<label class="field"><span>Clave de acceso del servidor (APP_TOKEN)</span><input id="pin-token" type="password" autocomplete="off"></label>
        <p class="muted small">Ya tienes chats bloqueados: para crear un PIN nuevo aquí, confirma que eres tú.</p>` : ''}
      ${pinInput('pin-new', 'PIN nuevo')}${pinInput('pin-new2', 'Repite el PIN')}`, {
      actions: '<span class="grow"></span><button class="btn ghost" data-act="sheet-close">Cancelar</button><button class="btn primary" data-s="ok">Guardar PIN</button>',
      onClose: () => { if (!done) resolve(false); },
      onMount: (sh) => {
        setTimeout(() => sh.querySelector('input')?.focus(), 60);
        const submit = async () => {
          if (changing && !(await checkPin($('#pin-old', sh).value))) { toast('El PIN actual no es correcto'); return; }
          if (needsToken && $('#pin-token', sh).value.trim() !== settings.token) { toast('La clave no coincide'); return; }
          const a = $('#pin-new', sh).value, b = $('#pin-new2', sh).value;
          if (!validPin(a)) { toast('El PIN debe tener de 4 a 8 números'); return; }
          if (a !== b) { toast('Los PIN no coinciden'); return; }
          await setPin(a);
          done = true;
          closeSheet();
          setUnlocked();
          toast('PIN guardado');
          resolve(true);
        };
        sh.addEventListener('click', (e) => { if (e.target.closest('[data-s=ok]')) submit(); });
        sh.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('input')) { e.preventDefault(); submit(); } });
      },
    });
  });
}

let pending = null;
/** Pide el PIN (o la huella) si hay algo bloqueado. Resuelve true si se desbloqueó. */
export function requireUnlock(reason = 'Chat bloqueado') {
  if (unlocked || !anyLocked()) return Promise.resolve(true);
  if (!hasPin()) return pinSetupSheet();
  if (pending) return pending;
  pending = new Promise((resolve) => {
    let done = false;
    const finish = (ok) => { if (done) return; done = true; pending = null; if (ok) { closeSheet(); setUnlocked(); } resolve(ok); };
    sheet(`🔒 ${reason}`, `<p class="muted small">Escribe tu PIN para ver los chats bloqueados.</p>${pinInput('pin-in', 'PIN')}
      ${hasBiometric() ? '<button class="btn outline wide" data-s="bio">👆 Usar huella / Face ID</button>' : ''}
      <button class="link-btn" data-s="forgot" style="margin-top:12px">¿Olvidaste el PIN?</button>`, {
      actions: '<span class="grow"></span><button class="btn ghost" data-act="sheet-close">Cancelar</button><button class="btn primary" data-s="ok">Desbloquear</button>',
      onClose: () => { if (!done) { done = true; pending = null; resolve(false); } },
      onMount: (sh) => {
        const input = $('#pin-in', sh);
        setTimeout(() => input.focus(), 60);
        let tries = 0;
        const submit = async () => {
          if (await checkPin(input.value)) { finish(true); return; }
          tries++;
          input.value = '';
          toast(tries >= 5 ? 'PIN incorrecto. Espera unos segundos.' : 'PIN incorrecto');
          if (tries >= 5) { input.disabled = true; setTimeout(() => { input.disabled = false; input.focus(); }, 30000); }
        };
        sh.addEventListener('click', async (e) => {
          const b = e.target.closest('[data-s]');
          if (!b) return;
          if (b.dataset.s === 'ok') submit();
          if (b.dataset.s === 'bio' && await biometricCheck()) finish(true);
          if (b.dataset.s === 'forgot') {
            done = true; pending = null; resolve(false);
            forgotPin();
          }
        });
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
        if (hasBiometric()) biometricCheck().then((ok) => ok && finish(true));
      },
    });
  });
  return pending;
}

/** Olvidé el PIN: con la clave del servidor se borra el PIN de este dispositivo y se crea otro. */
function forgotPin() {
  if (!settings.token) {
    toast('Sin clave del servidor no se puede verificar. Configúrala en Ajustes → Sincronización.');
    return;
  }
  sheet('Restablecer PIN', `<p class="muted small">Escribe la clave de acceso del servidor (APP_TOKEN) para crear un PIN nuevo en este dispositivo.</p>
    <label class="field"><span>Clave de acceso</span><input id="fp-token" type="password" autocomplete="off"></label>`, {
    actions: '<span class="grow"></span><button class="btn ghost" data-act="sheet-close">Cancelar</button><button class="btn primary" data-s="ok">Continuar</button>',
    onMount: (sh) => sh.addEventListener('click', (e) => {
      if (!e.target.closest('[data-s=ok]')) return;
      if ($('#fp-token', sh).value.trim() !== settings.token) { toast('La clave no coincide'); return; }
      writeCfg({});
      closeSheet();
      pinSetupSheet();
    }),
  });
}

/** Se vuelve a bloquear tras 1 minuto en segundo plano. */
export function initLock() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') hiddenAt = Date.now();
    else if (unlocked && hiddenAt && Date.now() - hiddenAt > RELOCK_MS) lockNow();
  });
}

export const lockInfo = () => esc(hasPin() ? `PIN configurado${hasBiometric() ? ' · huella activada' : ''}` : 'Sin PIN en este dispositivo');
