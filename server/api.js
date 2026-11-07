/*
 * API de ChatNote, independiente del servidor.
 * La usan tanto el Worker de Cloudflare (worker/index.js) como Express (server/app.js).
 *
 * Sin sesión:  GET /health · POST /auth/login (usuario + contraseña) · POST /auth/register (con código de invitación)
 *              POST /auth/redeem (vincular dispositivo con un enlace)
 * Con sesión (APP_TOKEN = propietario, o token de sesión de cada persona):
 *   POST /sync                    subir cambios y recibir los del servidor (solo lo que puedes ver)
 *   GET|POST /me, GET /people     tu perfil y las personas de ChatNote
 *   POST /auth/invite             (propietario) código / enlace para que alguien cree su cuenta
 *   POST /auth/password           cambiar tu contraseña
 *   POST /users/create, /users/password   (propietario) crear cuentas y restablecer contraseñas
 *   POST /auth/link               enlace para usar tu cuenta en otro dispositivo
 *   GET /sessions, POST /sessions/revoke, POST /auth/logout
 *   GET /users, POST /users/disable          (propietario) personas y acceso
 *   POST /chats/members           añadir / sacar / cambiar rol / salir de un chat
 *   GET /export · POST /import · POST /reset (estas dos, solo el propietario)
 *   GET /push/key · POST /push/subscribe | unsubscribe | test | action
 *   GET|POST /settings · POST /summary/test · GET /feed · GET /storage
 *   GET|POST /backups, GET /backups/<nombre>   (propietario)
 */
import { isValidSubscription } from './webpush.js';
import { pushToAll, vapidReady } from './reminders.js';
import { advance } from '../public/js/recurrence.js';
import { feedKey } from '../public/js/calendar.js';
import { withDefaults, cleanPatch, validTz, USER_KEYS, GLOBAL_KEYS } from './settings.js';
import { sendSummary } from './daily.js';
import { handleBackups } from './backups.js';
import { OWNER, authenticate, identify, signToken, randomId, cleanProfile, suggestHandle, COLORS, checkPassword, hashPassword, verifyPassword } from './accounts.js';
import { storageState } from './storage.js';

/** Posponer desde la notificación. */
export const SNOOZE_MS = 10 * 60 * 1000;
const INVITE_DAYS = 7;
const LINK_MINUTES = 30;

const json = (status, body) => ({ status, body });
const fail = (err) => json(err.status || 400, { error: err.message });

/** Compara la clave en tiempo constante. Solo acepta APP_TOKEN (servidor MCP en modo propietario). */
export function tokenOk(token, header) {
  if (!token) return true;
  const expected = `Bearer ${token}`;
  const got = header || '';
  let diff = got.length ^ expected.length;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ (got.charCodeAt(i) || 0);
  return diff === 0;
}

export { identify };

/** Ajustes que ve un usuario: los suyos + (si es el propietario) los globales. */
async function settingsFor(repo, u, ctx) {
  const global = withDefaults(await repo.getServerSettings(), ctx.tz);
  const mine = await repo.getUserPrefs(u);
  const tz = validTz(mine.tz) || (u === OWNER ? global.tz : ctx.tz);
  const out = {
    summary: { ...global.summary, ...(u === OWNER ? {} : { enabled: false }), ...(mine.summary || {}) },
    tz,
    isOwner: u === OWNER,
    features: { push: vapidReady(ctx.vapid), backups: !!ctx.backups && u === OWNER, multiUser: !!ctx.token, ...ctx.features },
    storage: ctx.storageLimits ? storageState(await repo.getStorage(), ctx.storageLimits) : { available: false },
  };
  if (u === OWNER) Object.assign(out, { backups: global.backups, email: global.email });
  return out;
}

async function profile(repo, u) {
  const people = (await repo.activeUsers()).map(({ disabled, hasPassword, ...p }) => p);
  return { me: await repo.getUser(u), people };
}

/**
 * @param {{ getRepo: () => Promise<object>, token: string, vapid?: object, tz?: string, backups?: object, features?: object, storageLimits?: object }} ctx
 * @param {{ method: string, path: string, auth?: string, body?: any, userAgent?: string }} req  path sin el prefijo /api
 * @returns {Promise<{ status: number, body?: object, raw?: string, type?: string }>}
 */
export async function handleApi(ctx, { method, path, auth, body, userAgent }) {
  const { getRepo, token, vapid } = ctx;
  const defaultTz = ctx.tz || 'UTC';
  if (method === 'GET' && path === '/health') return json(200, { ok: true, auth: !!token });

  /* ---------- Sin sesión: entrar, crear cuenta y vincular dispositivos ---------- */
  if (method === 'GET' && path === '/auth/status') {
    return json(200, { accounts: !!token });
  }
  if (method === 'POST' && ['/auth/login', '/auth/register', '/auth/join', '/auth/redeem'].includes(path)) {
    if (!token) return json(400, { error: 'El servidor no tiene APP_TOKEN: las cuentas están desactivadas' });
    const repo = await getRepo();
    const code = String(body?.code || '').trim();
    const newSession = async (uid) => {
      const sid = randomId(16);
      await repo.createSession(uid, sid, userAgent);
      return { token: await signToken(token, uid, sid), me: await repo.getUser(uid) };
    };

    if (path === '/auth/login') {
      const generic = json(401, { error: 'Usuario o contraseña incorrectos' });
      await repo.ensureOwner();
      const x = await repo.findByHandle(body?.handle);
      if (!x) return generic;
      if (x.disabled) return json(403, { error: 'Esta cuenta está desactivada. Habla con el propietario.' });
      if ((x.lockUntil || 0) > Date.now()) return json(429, { error: `Demasiados intentos. Espera ${Math.ceil((x.lockUntil - Date.now()) / 60e3)} min.` });
      if (!x.password) return json(401, { error: x._id === OWNER ? 'Aún no tienes contraseña: entra con la clave del servidor (APP_TOKEN) y créala en Ajustes → Cuenta' : 'Esta cuenta no tiene contraseña: pide al propietario que te la ponga' });
      if (!(await verifyPassword(String(body?.password || ''), x.password))) { await repo.loginFailed(x._id); return generic; }
      await repo.loginOk(x._id);
      return json(200, await newSession(x._id));
    }

    if (path === '/auth/register' || path === '/auth/join') {
      let p;
      try {
        p = cleanProfile({ name: body?.name, handle: body?.handle || suggestHandle(body?.name || '') });
        // /auth/join (enlaces antiguos) no pedía contraseña; ahora sí.
        checkPassword(body?.password);
      } catch (err) { return fail(err); }
      if (await repo.handleTaken(p.handle)) return json(409, { error: `El usuario @${p.handle} ya existe; elige otro` });
      const inv = await repo.takeInvite(code, 'join');
      if (!inv) return json(410, { error: 'El código de invitación no es válido, caducó o ya se usó' });
      const uid = randomId(10);
      const color = COLORS[(await repo.listUsers()).length % COLORS.length];
      await repo.createUser(uid, { ...p, color, invitedBy: inv.createdBy });
      await repo.setPassword(uid, await hashPassword(body.password));
      if (inv.chatId) await repo.updateMembers(inv.createdBy, { chatId: inv.chatId, add: [uid] }).catch(() => {});
      return json(200, await newSession(uid));
    }
    const inv = await repo.takeInvite(code, 'login');
    if (!inv) return json(410, { error: 'El enlace no es válido, caducó o ya se usó' });
    const me = await repo.getUser(inv.userId);
    if (!me || me.disabled) return json(403, { error: 'Esa cuenta está desactivada' });
    return json(200, await newSession(inv.userId));
  }

  /* ---------- A partir de aquí, hace falta sesión ---------- */
  const repo0 = token ? await getRepo() : null;
  const who = await authenticate(token, auth, repo0);
  if (!who) return json(401, { error: 'unauthorized' });
  const u = who.id;
  const isOwner = u === OWNER;
  const ownerOnly = () => json(403, { error: 'Solo el propietario puede hacer esto' });

  if (path === '/backups' || path.startsWith('/backups/')) {
    if (!isOwner) return ownerOnly();
    return handleBackups({ getRepo, store: ctx.backups, storage: ctx.storageLimits }, { method, path });
  }

  const route = `${method} ${path}`;
  const repo = await getRepo();
  switch (route) {
    case 'POST /sync': {
      const { since = 0, resetAt = null, changes = [] } = body || {};
      if (!Array.isArray(changes)) return json(400, { error: 'changes debe ser una lista' });
      const current = await repo.getResetAt();
      // Los datos se borraron o importaron desde otro dispositivo: el cliente debe empezar de cero.
      if (resetAt && resetAt !== current) return json(200, { reset: true, resetAt: current });
      const res = await repo.applyChanges(changes, u);
      const out = await repo.changesSince(Number(since) || 0, u);
      for (const f of res.forced) out.changes[f.store].push(f.doc);
      return json(200, { resetAt: current, ...out, rejected: res.rejected, ...(await profile(repo, u)) });
    }

    /* ---------- Perfil y personas ---------- */
    case 'GET /me':
      return json(200, { ...(await profile(repo, u)), isOwner, multiUser: !!token });
    case 'POST /me': {
      let p;
      try { p = cleanProfile(body || {}); } catch (err) { return fail(err); }
      if (p.handle && await repo.handleTaken(p.handle, u)) return json(409, { error: `El usuario @${p.handle} ya existe` });
      await repo.updateUser(u, p);
      return json(200, { ...(await profile(repo, u)), isOwner, multiUser: !!token });
    }
    case 'GET /people':
      return json(200, await profile(repo, u));

    /* ---------- Invitaciones, dispositivos y sesiones ---------- */
    case 'POST /auth/invite': {
      if (!token) return json(400, { error: 'Configura APP_TOKEN en el servidor para usar cuentas' });
      if (!isOwner) return ownerOnly();
      const code = randomId(20);
      await repo.createInvite({ code, type: 'join', createdBy: u, chatId: typeof body?.chatId === 'string' ? body.chatId : null, expiresAt: Date.now() + INVITE_DAYS * 864e5 });
      return json(200, { code, expiresAt: Date.now() + INVITE_DAYS * 864e5 });
    }
    case 'POST /auth/link': {
      if (!token) return json(400, { error: 'Configura APP_TOKEN en el servidor para usar cuentas' });
      const target = isOwner && typeof body?.userId === 'string' ? body.userId : u;
      if (!(await repo.getUser(target))) return json(404, { error: 'No existe esa persona' });
      const code = randomId(20);
      await repo.createInvite({ code, type: 'login', userId: target, createdBy: u, expiresAt: Date.now() + LINK_MINUTES * 60e3 });
      return json(200, { code, expiresAt: Date.now() + LINK_MINUTES * 60e3 });
    }
    case 'POST /auth/password': {
      try { checkPassword(body?.password); } catch (err) { return fail(err); }
      // Con la clave maestra (APP_TOKEN) el propietario no necesita la contraseña actual.
      if (who.sid && await repo.hasPassword(u)) {
        const x = isOwner ? await repo.ensureOwner() : await repo.findByHandle((await repo.getUser(u)).handle);
        if (!(await verifyPassword(String(body?.current || ''), x.password))) return json(403, { error: 'La contraseña actual no es correcta' });
      }
      await repo.setPassword(u, await hashPassword(body.password));
      return json(200, { ok: true });
    }
    case 'POST /users/create': {
      if (!token) return json(400, { error: 'Configura APP_TOKEN en el servidor para usar cuentas' });
      if (!isOwner) return ownerOnly();
      let p;
      try { p = cleanProfile({ name: body?.name, handle: body?.handle || suggestHandle(body?.name || '') }); checkPassword(body?.password); } catch (err) { return fail(err); }
      if (await repo.handleTaken(p.handle)) return json(409, { error: `El usuario @${p.handle} ya existe` });
      const uid = randomId(10);
      const color = COLORS[(await repo.listUsers()).length % COLORS.length];
      await repo.createUser(uid, { ...p, color, invitedBy: u });
      await repo.setPassword(uid, await hashPassword(body.password));
      return json(200, { user: await repo.getUser(uid) });
    }
    case 'POST /users/password': {
      if (!isOwner) return ownerOnly();
      const id = String(body?.id || '');
      if (id === OWNER) return json(400, { error: 'Tu contraseña se cambia en Ajustes → Cuenta' });
      if (!(await repo.getUser(id))) return json(404, { error: 'No existe esa persona' });
      try { checkPassword(body?.password); } catch (err) { return fail(err); }
      await repo.setPassword(id, await hashPassword(body.password));
      // Por seguridad, sus dispositivos tienen que volver a entrar.
      await repo.revokeAllSessions(id);
      return json(200, { ok: true });
    }
    case 'GET /sessions':
      return json(200, { sessions: (await repo.listSessions(u)).map((s) => ({ ...s, current: s.id === who.sid })), viaAppToken: !who.sid });
    case 'POST /sessions/revoke': {
      const ok = await repo.revokeSession(u, String(body?.id || ''));
      return ok ? json(200, { ok: true }) : json(404, { error: 'No existe esa sesión' });
    }
    case 'POST /auth/logout':
      if (who.sid) await repo.revokeSession(u, who.sid);
      return json(200, { ok: true });
    case 'GET /users': {
      if (!isOwner) return ownerOnly();
      const list = await repo.listUsers();
      for (const p of list) p.sessions = p.id === OWNER ? null : (await repo.listSessions(p.id)).length;
      return json(200, { users: list });
    }
    case 'POST /users/disable': {
      if (!isOwner) return ownerOnly();
      try { await repo.setDisabled(String(body?.id || ''), !!body?.disabled); } catch (err) { return fail(err); }
      return json(200, { ok: true });
    }

    /* ---------- Miembros de un chat ---------- */
    case 'POST /chats/members': {
      try { return json(200, await repo.updateMembers(u, body || {}).then((r) => ({ chat: r.chat }))); } catch (err) { return fail(err); }
    }

    /* ---------- Datos ---------- */
    case 'GET /export':
      return json(200, { app: 'retrodark', version: 1, exportedAt: new Date().toISOString(), ...(await repo.userData(u)) });
    case 'POST /import': {
      if (!isOwner) return ownerOnly();
      if (!body || body.app !== 'retrodark' || !Array.isArray(body.messages)) return json(400, { error: 'El archivo no es una copia de ChatNote' });
      return json(200, { resetAt: await repo.replaceAll(body) });
    }
    case 'POST /reset':
      if (!isOwner) return ownerOnly();
      return json(200, { resetAt: await repo.wipe() });

    /* ---------- Notificaciones push ---------- */
    case 'GET /push/key':
      if (!vapidReady(vapid)) return json(503, { error: 'Faltan las claves VAPID en el servidor (npm run vapid)' });
      return json(200, { publicKey: vapid.publicKey });
    case 'POST /push/subscribe':
      if (!isValidSubscription(body?.subscription)) return json(400, { error: 'Suscripción no válida' });
      await repo.saveSub(body.subscription, userAgent, u);
      return json(200, { ok: true });
    case 'POST /push/unsubscribe':
      if (typeof body?.endpoint !== 'string') return json(400, { error: 'Falta endpoint' });
      await repo.deleteSub(body.endpoint);
      return json(200, { ok: true });
    case 'POST /push/test': {
      if (!vapidReady(vapid)) return json(503, { error: 'Faltan las claves VAPID en el servidor' });
      const sub = typeof body?.endpoint === 'string' ? await repo.getSub(body.endpoint) : null;
      if (!sub) return json(404, { error: 'Este dispositivo no tiene las notificaciones activadas' });
      const sent = await pushToAll(repo, vapid, { title: 'ChatNote', body: 'Las notificaciones funcionan 🎉', tag: 'test' }, [sub]);
      return sent ? json(200, { ok: true }) : json(502, { error: 'El servicio de notificaciones del navegador rechazó el aviso' });
    }
    case 'POST /push/action': {
      const { id, action } = body || {};
      if (typeof id !== 'string' || !['done', 'snooze'].includes(action)) return json(400, { error: 'Acción no válida' });
      const m = await repo.getMessageFor(id, u);
      if (!m || m.trashedAt) return json(404, { error: 'El mensaje ya no existe' });
      const now = Date.now();
      let patch;
      if (action === 'snooze') patch = { remindAt: now + SNOOZE_MS };
      else if (m.repeat?.freq) patch = advance(m, { tz: validTz(body.tz) || defaultTz, now });
      else patch = { kind: 'task', done: true, doneAt: now };
      const { id: _, ...doc } = { ...m, ...patch, triaged: true };
      const res = await repo.applyChanges([{ store: 'messages', id, updatedAt: Math.max(now, (m.updatedAt || 0) + 1), doc }], u);
      if (res.rejected.length) return json(403, { error: res.rejected[0].reason });
      return json(200, { ok: true, due: doc.due || null, remindAt: doc.remindAt || null, done: !!doc.done });
    }

    /* ---------- Ajustes, resumen, calendario y espacio ---------- */
    case 'GET /settings':
      return json(200, await settingsFor(repo, u, ctx));
    case 'POST /settings': {
      let patch;
      try { patch = cleanPatch(body || {}); } catch (err) { return fail(err); }
      const global = Object.fromEntries(Object.entries(patch).filter(([k]) => GLOBAL_KEYS.includes(k)));
      const mine = Object.fromEntries(Object.entries(patch).filter(([k]) => USER_KEYS.includes(k)));
      if (Object.keys(global).length) {
        if (!isOwner) return ownerOnly();
        await repo.saveServerSettings(global);
      }
      if (Object.keys(mine).length) {
        await repo.saveUserPrefs(u, { ...(await repo.getUserPrefs(u)), ...mine });
        // Compatibilidad: el resumen del propietario también queda en los ajustes globales.
        if (isOwner) await repo.saveServerSettings(mine);
      }
      return json(200, await settingsFor(repo, u, ctx));
    }
    case 'POST /summary/test': {
      if (!vapidReady(vapid)) return json(503, { error: 'Faltan las claves VAPID en el servidor' });
      const s = await settingsFor(repo, u, ctx);
      return json(200, { ok: true, ...(await sendSummary(repo, vapid, s.tz, Date.now(), u)) });
    }
    case 'GET /feed':
      return json(200, { key: await feedKey(token, u) });
    case 'GET /storage':
      return json(200, ctx.storageLimits ? storageState(await repo.getStorage(), ctx.storageLimits) : { available: false });
    default:
      return json(404, { error: 'not found' });
  }
}
