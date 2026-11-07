/*
 * Acceso a datos.
 *
 * Cada documento se guarda con:
 *   _id        → el id que genera la app
 *   updatedAt  → hora de la última edición en el dispositivo (gana la más reciente)
 *   _rev       → marca del servidor para saber qué ha cambiado desde la última sincronización
 *   deleted    → true si se borró (se guarda la "lápida" para avisar a otros dispositivos)
 */
import { randomUUID } from 'node:crypto';
import { COLLECTIONS } from './db.js';

/* Margen para no perder escrituras que terminan en desorden entre peticiones simultáneas. */
const PULL_OVERLAP_MS = 5000;

let lastRev = 0;
const nextRev = () => (lastRev = Math.max(Date.now(), lastRev + 1));

/** Quita campos reservados de MongoDB y del protocolo. */
function sanitize(doc) {
  const out = {};
  for (const [k, v] of Object.entries(doc || {})) {
    if (k === 'id' || k === '_id' || k === '_rev' || k.startsWith('$')) continue;
    out[k] = v;
  }
  return out;
}

const isValidChange = (c) =>
  c && COLLECTIONS.includes(c.store) && typeof c.id === 'string' && c.id.length > 0 && c.id.length <= 100 &&
  Number.isFinite(c.updatedAt) && (c.deleted === true || (c.doc && typeof c.doc === 'object'));

export function createRepo(db) {
  const col = (name) => db.collection(name);
  const meta = () => db.collection('meta');

  /** Identificador de la "versión" de los datos. Cambia al borrar todo o importar. */
  async function getResetAt() {
    const found = await meta().findOne({ _id: 'sync' });
    if (found) return found.resetAt;
    await meta().updateOne({ _id: 'sync' }, { $setOnInsert: { resetAt: randomUUID() } }, { upsert: true });
    return (await meta().findOne({ _id: 'sync' })).resetAt;
  }

  async function newResetAt() {
    const resetAt = randomUUID();
    await meta().updateOne({ _id: 'sync' }, { $set: { resetAt } }, { upsert: true });
    return resetAt;
  }

  /** Guarda los cambios de un dispositivo. Solo se aplican si son más recientes que lo guardado. */
  async function applyChanges(changes) {
    const byCol = {};
    for (const c of changes) {
      if (!isValidChange(c)) continue;
      const doc = c.deleted ? { deleted: true } : sanitize(c.doc);
      doc.updatedAt = c.updatedAt;
      doc._rev = nextRev();
      (byCol[c.store] ||= []).push({
        replaceOne: { filter: { _id: c.id, updatedAt: { $lt: c.updatedAt } }, replacement: doc, upsert: true },
      });
    }
    for (const [name, ops] of Object.entries(byCol)) {
      try {
        await col(name).bulkWrite(ops, { ordered: false });
      } catch (err) {
        // E11000: ya existe una versión igual o más reciente → se ignora ese cambio.
        const errors = [].concat(err.writeErrors || []);
        if (!errors.length || errors.some((e) => e.code !== 11000)) throw err;
      }
    }
  }

  /** Todo lo que cambió desde `since` (marca _rev del servidor). */
  async function changesSince(since) {
    const from = since > 0 ? since - PULL_OVERLAP_MS : -1;
    const changes = {};
    let cursor = since;
    for (const name of COLLECTIONS) {
      const docs = await col(name).find({ _rev: { $gt: from } }).toArray();
      changes[name] = docs.map(({ _id, _rev, ...rest }) => {
        if (_rev > cursor) cursor = _rev;
        return { id: _id, ...rest };
      });
    }
    return { changes, cursor };
  }

  async function exportAll() {
    const data = {};
    for (const name of COLLECTIONS) {
      const docs = await col(name).find({ deleted: { $ne: true } }).toArray();
      data[name] = docs.map(({ _id, _rev, ...rest }) => ({ id: _id, ...rest }));
    }
    return data;
  }

  async function wipe() {
    await Promise.all([...COLLECTIONS, 'reminders_sent'].map((name) => col(name).deleteMany({})));
    return newResetAt();
  }

  /* ---------- Notificaciones push ---------- */
  const subs = () => db.collection('push_subs');
  const sentCol = () => db.collection('reminders_sent');

  async function saveSub(sub, userAgent = '') {
    await subs().updateOne(
      { _id: sub.endpoint },
      { $set: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, userAgent: String(userAgent).slice(0, 200), updatedAt: Date.now() } },
      { upsert: true },
    );
  }
  const deleteSub = (endpoint) => subs().deleteOne({ _id: endpoint });
  const listSubs = () => subs().find({}).toArray();
  const getSub = (endpoint) => subs().findOne({ _id: endpoint });

  /** Mensajes con recordatorio vencido (últimas 24 h) que aún no se avisaron. */
  async function dueReminders(now) {
    const docs = await col('messages')
      .find({ remindAt: { $lte: now, $gt: now - 24 * 3600 * 1000 }, deleted: { $ne: true } })
      .toArray();
    const out = [];
    for (const d of docs) {
      if ((d.kind === 'task' && d.done) || d.trashedAt) continue;
      const sent = await sentCol().findOne({ _id: d._id });
      if (sent && sent.remindAt === d.remindAt) continue;
      out.push({ id: d._id, ...d });
    }
    return out;
  }
  const markReminded = (id, remindAt) => sentCol().updateOne({ _id: id }, { $set: { remindAt, sentAt: Date.now() } }, { upsert: true });
  async function getMessage(id) {
    const d = await col('messages').findOne({ _id: id });
    if (!d || d.deleted) return null;
    const { _id, _rev, ...rest } = d;
    return { id: _id, ...rest };
  }

  /** Borra para siempre lo que lleva en la papelera desde antes de `cutoff`. */
  async function purgeTrash(cutoff) {
    const old = await col('messages').find({ trashedAt: { $gt: 0, $lt: cutoff }, deleted: { $ne: true } }).toArray();
    if (old.length) await applyChanges(old.map((d) => ({ store: 'messages', id: d._id, updatedAt: Math.max(Date.now(), (d.updatedAt || 0) + 1), deleted: true })));
    return old.length;
  }

  /* ---------- Ajustes del servidor (resumen diario, copias, correo) ---------- */
  async function getServerSettings() {
    const d = await meta().findOne({ _id: 'settings' });
    if (!d) return {};
    const { _id, ...rest } = d;
    return rest;
  }
  const saveServerSettings = (patch) => meta().updateOne({ _id: 'settings' }, { $set: patch }, { upsert: true });

  /** Marca una tarea diaria (resumen, copia) como hecha hoy. Devuelve false si ya se hizo. */
  async function claimDaily(key, day) {
    const d = await meta().findOne({ _id: `daily:${key}` });
    if (d?.day === day) return false;
    await meta().updateOne({ _id: `daily:${key}` }, { $set: { day, at: Date.now() } }, { upsert: true });
    return true;
  }

  /** Todos los mensajes y chats (sin borrados) para el feed, el resumen y el correo. */
  async function liveData() {
    const strip = ({ _id, _rev, ...rest }) => ({ id: _id, ...rest });
    const [messages, chats] = await Promise.all([
      col('messages').find({ deleted: { $ne: true } }).toArray(),
      col('chats').find({ deleted: { $ne: true } }).toArray(),
    ]);
    return { messages: messages.map(strip).filter((m) => !m.trashedAt), chats: chats.map(strip) };
  }

  async function getChat(id) {
    const c = await col('chats').findOne({ _id: id });
    return c && !c.deleted ? c : null;
  }

  /* ---------- Archivos adjuntos (se guardan en R2; aquí solo se consultan los mensajes) ---------- */
  /** Ids de los archivos que usa algún mensaje (para limpiar los que sobran). */
  async function usedFileIds() {
    const used = new Set();
    for (const m of await col('messages').find({ deleted: { $ne: true } }).toArray()) {
      for (const a of m.attachments || []) used.add(a.id);
    }
    return used;
  }

  async function replaceAll(data) {
    await Promise.all([...COLLECTIONS, 'reminders_sent'].map((name) => col(name).deleteMany({})));
    const now = Date.now();
    for (const name of COLLECTIONS) {
      const docs = (Array.isArray(data[name]) ? data[name] : [])
        .filter((d) => d && typeof d.id === 'string' && !d.deleted)
        .map((d) => ({ _id: d.id, ...sanitize(d), updatedAt: Number.isFinite(d.updatedAt) ? d.updatedAt : now, _rev: nextRev() }));
      if (docs.length) await col(name).insertMany(docs, { ordered: false });
    }
    return newResetAt();
  }

  return {
    getResetAt, applyChanges, changesSince, exportAll, wipe, replaceAll,
    saveSub, deleteSub, listSubs, getSub, dueReminders, markReminded, getChat, getMessage, purgeTrash,
    getServerSettings, saveServerSettings, claimDaily, liveData,
    usedFileIds,
  };
}
