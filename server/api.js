/*
 * API de RetroDark, independiente del servidor.
 * La usan tanto el Worker de Cloudflare (worker/index.js) como Express (server/app.js).
 *
 *   GET  /api/health   → comprobar que responde
 *   POST /api/sync     → subir cambios y recibir los del servidor
 *   GET  /api/export   → copia completa
 *   POST /api/import   → reemplazar todo con una copia
 *   POST /api/reset    → borrar todo
 *   GET  /api/push/key           → clave pública VAPID
 *   POST /api/push/subscribe     → guardar la suscripción push de este dispositivo
 *   POST /api/push/unsubscribe   → quitarla
 *   POST /api/push/test          → enviar una notificación de prueba
 *   POST /api/push/action        → botones de la notificación: { id, action: 'done' | 'snooze', tz }
 */

import { isValidSubscription } from './webpush.js';
import { pushToAll, vapidReady } from './reminders.js';
import { advance } from '../public/js/recurrence.js';

/** Posponer desde la notificación. */
export const SNOOZE_MS = 10 * 60 * 1000;

const validTz = (tz) => {
  if (typeof tz !== 'string' || tz.length > 64) return null;
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return tz; } catch { return null; }
};

const json = (status, body) => ({ status, body });

/** Compara la clave en tiempo constante (sin depender de node:crypto). */
export function tokenOk(token, header) {
  if (!token) return true;
  const expected = `Bearer ${token}`;
  const got = header || '';
  let diff = got.length ^ expected.length;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ (got.charCodeAt(i) || 0);
  return diff === 0;
}

/**
 * @param {{ getRepo: () => Promise<object>, token: string, vapid?: object }} ctx
 *   getRepo: devuelve el repositorio (conecta a MongoDB si hace falta) · token: APP_TOKEN ('' = sin clave)
 *   vapid: { publicKey, privateKey, subject } para las notificaciones push
 * @param {{ method: string, path: string, auth?: string, body?: any, userAgent?: string }} req  path sin el prefijo /api
 * @returns {Promise<{ status: number, body: object }>}
 */
export async function handleApi({ getRepo, token, vapid, tz: defaultTz = 'UTC' }, { method, path, auth, body, userAgent }) {
  if (method === 'GET' && path === '/health') return json(200, { ok: true, auth: !!token });
  if (!tokenOk(token, auth)) return json(401, { error: 'unauthorized' });

  const route = `${method} ${path}`;
  switch (route) {
    case 'POST /sync': {
      const { since = 0, resetAt = null, changes = [] } = body || {};
      if (!Array.isArray(changes)) return json(400, { error: 'changes debe ser una lista' });
      const repo = await getRepo();
      const current = await repo.getResetAt();
      // Los datos se borraron o importaron desde otro dispositivo: el cliente debe empezar de cero.
      if (resetAt && resetAt !== current) return json(200, { reset: true, resetAt: current });
      await repo.applyChanges(changes);
      return json(200, { resetAt: current, ...(await repo.changesSince(Number(since) || 0)) });
    }
    case 'GET /export': {
      const repo = await getRepo();
      return json(200, { app: 'retrodark', version: 1, exportedAt: new Date().toISOString(), ...(await repo.exportAll()) });
    }
    case 'POST /import': {
      if (!body || body.app !== 'retrodark' || !Array.isArray(body.messages)) {
        return json(400, { error: 'El archivo no es una copia de RetroDark' });
      }
      const repo = await getRepo();
      return json(200, { resetAt: await repo.replaceAll(body) });
    }
    case 'POST /reset': {
      const repo = await getRepo();
      return json(200, { resetAt: await repo.wipe() });
    }

    /* ---------- Notificaciones push ---------- */
    case 'GET /push/key': {
      if (!vapidReady(vapid)) return json(503, { error: 'Faltan las claves VAPID en el servidor (npm run vapid)' });
      return json(200, { publicKey: vapid.publicKey });
    }
    case 'POST /push/subscribe': {
      if (!isValidSubscription(body?.subscription)) return json(400, { error: 'Suscripción no válida' });
      const repo = await getRepo();
      await repo.saveSub(body.subscription, userAgent);
      return json(200, { ok: true });
    }
    case 'POST /push/unsubscribe': {
      if (typeof body?.endpoint !== 'string') return json(400, { error: 'Falta endpoint' });
      const repo = await getRepo();
      await repo.deleteSub(body.endpoint);
      return json(200, { ok: true });
    }
    case 'POST /push/test': {
      if (!vapidReady(vapid)) return json(503, { error: 'Faltan las claves VAPID en el servidor' });
      const repo = await getRepo();
      const sub = typeof body?.endpoint === 'string' ? await repo.getSub(body.endpoint) : null;
      if (!sub) return json(404, { error: 'Este dispositivo no tiene las notificaciones activadas' });
      const sent = await pushToAll(repo, vapid, { title: 'RetroDark', body: 'Las notificaciones funcionan 🎉', tag: 'test' }, [sub]);
      return sent ? json(200, { ok: true }) : json(502, { error: 'El servicio de notificaciones del navegador rechazó el aviso' });
    }
    case 'POST /push/action': {
      const { id, action } = body || {};
      if (typeof id !== 'string' || !['done', 'snooze'].includes(action)) return json(400, { error: 'Acción no válida' });
      const repo = await getRepo();
      const m = await repo.getMessage(id);
      if (!m || m.trashedAt) return json(404, { error: 'El mensaje ya no existe' });
      const now = Date.now();
      let patch;
      if (action === 'snooze') patch = { remindAt: now + SNOOZE_MS };
      else if (m.repeat?.freq) patch = advance(m, { tz: validTz(body.tz) || defaultTz, now });
      else patch = { kind: 'task', done: true, doneAt: now };
      const { id: _, ...doc } = { ...m, ...patch, triaged: true };
      const updatedAt = Math.max(now, (m.updatedAt || 0) + 1);
      await repo.applyChanges([{ store: 'messages', id, updatedAt, doc }]);
      return json(200, { ok: true, due: doc.due || null, remindAt: doc.remindAt || null, done: !!doc.done });
    }
    default:
      return json(404, { error: 'not found' });
  }
}
