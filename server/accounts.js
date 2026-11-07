/*
 * Cuentas y sesiones.
 *
 * - Quien usa APP_TOKEN es el propietario ("owner"): así siguen funcionando los dispositivos de siempre.
 * - El propietario invita a otras personas con un enlace de un solo uso (?join=CÓDIGO). Al abrirlo,
 *   la persona elige su nombre y ese dispositivo queda con su sesión. Sin contraseñas.
 * - Para usar la cuenta en otro dispositivo se genera un enlace de vinculación (?login=CÓDIGO).
 * - Las sesiones son tokens firmados: rd1.<usuario>.<sesión>.<firma> (HMAC con APP_TOKEN).
 *   La firma se comprueba sin base de datos (archivos, IA) y la API además comprueba que la sesión siga activa.
 */
export const OWNER = 'owner';
const TOKEN_RE = /^rd1\.([a-z0-9]{4,40})\.([a-z0-9]{8,40})\.([A-Za-z0-9_-]{20,64})$/;
export const HANDLE_RE = /^[a-z0-9_]{2,24}$/;
export const COLORS = ['#3e9d7c', '#53bdeb', '#ff7a59', '#a78bfa', '#f5b70a', '#ec4899', '#10b981', '#64748b'];

const enc = new TextEncoder();
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const randomId = (n = 16) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => (b % 36).toString(36)).join('');

async function hmac(secret, text) {
  const key = await crypto.subtle.importKey('raw', enc.encode(`${secret}|sessions`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(text))).slice(0, 32);
}

function sameText(a, b) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export async function signToken(secret, uid, sid) {
  return `rd1.${uid}.${sid}.${await hmac(secret, `${uid}.${sid}`)}`;
}

/** Solo la firma (sin base de datos). Devuelve { uid, sid } o null. */
export async function verifySignature(secret, token) {
  const m = TOKEN_RE.exec(token || '');
  if (!m || !secret) return null;
  return sameText(m[3], await hmac(secret, `${m[1]}.${m[2]}`)) ? { uid: m[1], sid: m[2] } : null;
}

const bearer = (auth) => (/^Bearer\s+(.+)$/i.exec(auth || '') || [])[1]?.trim() || '';

/**
 * ¿Quién hace la petición? Sin base de datos: APP_TOKEN → propietario; token de sesión → firma válida.
 * Devuelve { id, sid } o null.
 */
export async function identify(appToken, auth) {
  if (!appToken) return { id: OWNER, sid: null };
  const t = bearer(auth);
  if (!t) return null;
  if (sameText(t, appToken)) return { id: OWNER, sid: null };
  const s = await verifySignature(appToken, t);
  return s ? { id: s.uid, sid: s.sid } : null;
}

/** Igual que identify, y además comprueba en la base de datos que la sesión y el usuario sigan activos. */
export async function authenticate(appToken, auth, repo) {
  const who = await identify(appToken, auth);
  if (!who || who.id === OWNER) return who;
  const ok = await repo.sessionActive(who.id, who.sid);
  return ok ? who : null;
}

export function cleanProfile(body = {}) {
  const out = {};
  if (body.name !== undefined) {
    const name = String(body.name).replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!name) throw new Error('Escribe un nombre');
    out.name = name;
  }
  if (body.handle !== undefined) {
    const handle = String(body.handle).trim().toLowerCase().replace(/^@/, '');
    if (!HANDLE_RE.test(handle)) throw new Error('El usuario debe tener de 2 a 24 letras, números o _ (sin espacios ni acentos)');
    out.handle = handle;
  }
  if (body.color !== undefined) {
    if (!COLORS.includes(body.color)) throw new Error('Color no válido');
    out.color = body.color;
  }
  return out;
}

/** Usuario sugerido a partir del nombre ("Ana María" → "ana_maria"). */
export const suggestHandle = (name) => String(name).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 20) || 'usuario';
