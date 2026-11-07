/*
 * Acceso a datos (MongoDB), con varios usuarios y chats compartidos.
 *
 * Cada documento se guarda con:
 *   _id        → el id que genera la app (los datos personales de otros usuarios llevan prefijo "<usuario>~")
 *   updatedAt  → hora de la última edición (gana la más reciente)
 *   _rev       → marca del servidor para saber qué ha cambiado desde la última sincronización
 *   deleted    → true si se borró (se guarda la "lápida" para avisar a otros dispositivos)
 *
 * Chats:    ownerId, members [{ id, role: 'admin'|'member', rev }], formerMembers [{ id, rev }], onlyAdmins,
 *           prefs { <usuario>: { pinned, groupId, archived, locked, tags, muted } }   ← cada uno los suyos
 * Mensajes: authorId, prefs { <usuario>: { starred, categoryId } }, poll.votes { <usuario>: [...] }
 * Categorías, grupos y plantillas: ownerId (son de cada usuario).
 *
 * La app recibe cada documento ya "visto" por su usuario (view) y escribe igual; aquí se separa
 * lo compartido de lo personal y se comprueban los permisos (solo admins envían, solo el autor edita…).
 */
import { randomUUID } from 'node:crypto';
import { COLLECTIONS } from './db.js';
import { OWNER, COLORS } from './accounts.js';

/* Margen para no perder escrituras que terminan en desorden entre peticiones simultáneas. */
const PULL_OVERLAP_MS = 5000;
const PERSONAL = {
  chats: ['pinned', 'groupId', 'archived', 'locked', 'tags', 'muted'],
  messages: ['starred', 'categoryId'],
};
const OWN_STORES = ['categories', 'groups', 'templates'];
const CHAT_SHARED = ['name', 'emoji', 'color', 'type', 'desc', 'onlyAdmins', 'createdAt'];
/* Lo que puede cambiar quien no escribió el mensaje (en chats compartidos). */
const NON_AUTHOR = ['done', 'doneAt', 'status'];
const SERVER_FIELDS = ['_id', '_rev', 'id', 'prefs', 'prefsAt', 'sharedAt', 'members', 'formerMembers', 'ownerId', 'authorId', 'deleted', 'myRole', 'shared'];
const ITEM_RE = /^(\s*(?:-\s*)?)\[([ xX]?)\]\s?(.*)$/;

let lastRev = 0;
const nextRev = () => (lastRev = Math.max(Date.now(), lastRev + 1));

/* ---------- Ids por usuario ---------- */
const ownToDb = (id, u) => (u === OWNER ? id : `${u}~${id}`);
const ownFromDb = (id, u) => (u !== OWNER && id.startsWith(`${u}~`) ? id.slice(u.length + 1) : id);
export const chatToDb = (id, u) => (id === 'general' && u !== OWNER ? `general~${u}` : id);
export const chatFromDb = (id, u) => (id === `general~${u}` ? 'general' : id);

/* ---------- Miembros ---------- */
/** Chats antiguos (antes de las cuentas) son del propietario. */
export const ownerOf = (c) => c.ownerId || OWNER;
export const membersOf = (c) => (Array.isArray(c.members) && c.members.length ? c.members : [{ id: ownerOf(c), role: 'admin', rev: 0 }]);
export const memberOf = (c, u) => membersOf(c).find((m) => m.id === u) || null;
export const isAdmin = (c, u) => memberOf(c, u)?.role === 'admin';

/** Quita campos reservados y los de servidor. */
function sanitize(doc) {
  const out = {};
  for (const [k, v] of Object.entries(doc || {})) {
    if (SERVER_FIELDS.includes(k) || k.startsWith('$')) continue;
    out[k] = v;
  }
  return out;
}
const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj && k in obj).map((k) => [k, obj[k]]));
const omit = (obj, keys) => Object.fromEntries(Object.entries(obj || {}).filter(([k]) => !keys.includes(k)));

/** Solo cambia qué casillas están marcadas (lo único que otro miembro puede tocar del texto). */
function onlyChecksChanged(a = '', b = '') {
  const la = String(a).split('\n'), lb = String(b).split('\n');
  if (la.length !== lb.length) return false;
  return la.every((l, i) => {
    if (l === lb[i]) return true;
    const x = l.match(ITEM_RE), y = lb[i].match(ITEM_RE);
    return x && y && x[1] === y[1] && x[3] === y[3];
  });
}

const isValidChange = (c) =>
  c && COLLECTIONS.includes(c.store) && typeof c.id === 'string' && c.id.length > 0 && c.id.length <= 100 && !c.id.includes('~') &&
  Number.isFinite(c.updatedAt) && (c.deleted === true || (c.doc && typeof c.doc === 'object'));

export function createRepo(db) {
  const col = (name) => db.collection(name);
  const meta = () => db.collection('meta');

  // Quien quiera enterarse de cada escritura (tiempo real, avisos de mensajes nuevos).
  const listeners = new Set();
  const onWrite = (fn) => listeners.add(fn);
  const emit = (out) => { for (const fn of listeners) { try { fn(out); } catch (err) { console.error('onWrite', err); } } };

  // Las escrituras se hacen de una en una (leer → mezclar → guardar) para no pisarse.
  let lock = Promise.resolve();
  const serial = (fn) => { const run = lock.then(fn, fn); lock = run.catch(() => {}); return run; };

  /* ======================================================================
   * Vista de un documento para un usuario
   * ====================================================================== */
  function personalOf(store, d, u) {
    const keys = PERSONAL[store] || [];
    const mine = d.prefs?.[u];
    // Documentos antiguos: lo personal estaba arriba y era del propietario.
    const legacy = u === OWNER || (store === 'messages' ? false : ownerOf(d) === u);
    const out = {};
    for (const k of keys) out[k] = mine && k in mine ? mine[k] : legacy && k in d ? d[k] : k === 'tags' ? [] : k === 'categoryId' || k === 'groupId' ? null : false;
    return out;
  }

  function view(store, d, u) {
    const base = omit(d, ['_id', '_rev', 'prefs', 'prefsAt', 'sharedAt', 'formerMembers']);
    if (store === 'chats') {
      const members = membersOf(d);
      return {
        ...omit(base, ['members']), ...personalOf('chats', d, u),
        id: chatFromDb(d._id, u), ownerId: ownerOf(d),
        members: members.map((m) => ({ id: m.id, role: m.role })),
        shared: members.length > 1, myRole: memberOf(d, u)?.role || null, onlyAdmins: !!d.onlyAdmins,
      };
    }
    if (store === 'messages') {
      // Encuestas de antes de las cuentas: el voto "me" era del propietario.
      if (base.poll?.votes?.me) {
        const { me, ...rest } = base.poll.votes;
        base.poll = { ...base.poll, votes: rest[OWNER] ? rest : { ...rest, [OWNER]: me } };
      }
      return { ...base, ...personalOf('messages', d, u), id: d._id, chatId: chatFromDb(d.chatId, u), authorId: d.authorId || OWNER };
    }
    return { ...omit(base, ['ownerId']), id: ownFromDb(d._id, u) };
  }

  /* ======================================================================
   * Cambios desde la última sincronización (solo lo que este usuario puede ver)
   * ====================================================================== */
  async function changesSince(since, u = OWNER) {
    const from = since > 0 ? since - PULL_OVERLAP_MS : -1;
    let cursor = since;
    const bump = (r) => { if (r > cursor) cursor = r; };
    const changes = { chats: [], messages: [], categories: [], groups: [], templates: [] };

    const allChats = await col('chats').find({}).toArray();
    const visible = new Set(), joinedNow = new Set();
    for (const c of allChats) {
      bump(c._rev);
      const me = memberOf(c, u);
      if (me && !c.deleted) {
        visible.add(c._id);
        if ((me.rev || 0) > from) joinedNow.add(c._id);
        bump(me.rev || 0);
        if (c._rev > from || (me.rev || 0) > from) changes.chats.push(view('chats', c, u));
      } else if (c.deleted && me && c._rev > from) {
        changes.chats.push({ id: chatFromDb(c._id, u), deleted: true, updatedAt: c.updatedAt });
      } else {
        // Me sacaron del chat: se le avisa como si se hubiera borrado.
        const gone = (c.formerMembers || []).find((m) => m.id === u);
        if (gone && gone.rev > from) changes.chats.push({ id: chatFromDb(c._id, u), deleted: true, updatedAt: Math.max(c.updatedAt || 0, gone.rev) });
        if (gone) bump(gone.rev);
      }
    }

    const msgs = await col('messages').find({ _rev: { $gt: from } }).toArray();
    const seen = new Set();
    for (const m of msgs) {
      bump(m._rev);
      if (!visible.has(m.chatId) && !(m.deleted && m.chatId === undefined)) continue;
      seen.add(m._id);
      changes.messages.push(m.deleted ? { id: m._id, deleted: true, updatedAt: m.updatedAt } : view('messages', m, u));
    }
    // Al entrar en un chat se recibe todo su historial.
    for (const chatId of joinedNow) {
      for (const m of await col('messages').find({ chatId }).toArray()) {
        if (!seen.has(m._id) && !m.deleted) changes.messages.push(view('messages', m, u));
      }
    }

    for (const name of OWN_STORES) {
      for (const d of await col(name).find({ _rev: { $gt: from } }).toArray()) {
        bump(d._rev);
        if ((d.ownerId || OWNER) !== u) continue;
        changes[name].push(d.deleted ? { id: ownFromDb(d._id, u), deleted: true, updatedAt: d.updatedAt } : view(name, d, u));
      }
    }
    return { changes, cursor };
  }

  /* ======================================================================
   * Guardar cambios de un usuario (con permisos y mezcla de lo compartido / personal)
   * ====================================================================== */
  /**
   * @returns {{ rejected: {store,id,reason}[], forced: {store,doc}[], created: object[], users: Set<string> }}
   *   forced: versión del servidor que el dispositivo debe tomar (porque su cambio no se aceptó del todo)
   *   created: mensajes nuevos (para avisar a los demás) · users: a quién avisar en tiempo real
   */
  function applyChanges(changes, u = OWNER) {
    return serial(async () => {
      const out = { rejected: [], forced: [], created: [], users: new Set([u]) };
      const writes = {};
      const chatCache = new Map();
      const getChatRawCached = async (dbId) => {
        if (!chatCache.has(dbId)) chatCache.set(dbId, await col('chats').findOne({ _id: dbId }));
        return chatCache.get(dbId);
      };
      const put = (name, doc) => { (writes[name] ||= new Map()).set(doc._id, doc); if (name === 'chats') chatCache.set(doc._id, doc); };
      const reject = (c, reason, current) => {
        out.rejected.push({ store: c.store, id: c.id, reason });
        // El dispositivo vuelve a la versión del servidor (o la borra si no existe).
        const updatedAt = Math.max(current?.updatedAt || 0, c.updatedAt) + 1;
        out.forced.push({ store: c.store, doc: current && !current.deleted ? { ...view(c.store, current, u), updatedAt } : { id: c.id, deleted: true, updatedAt } });
      };
      const notifyChat = (chat) => membersOf(chat).forEach((m) => out.users.add(m.id));

      for (const c of changes) {
        if (!isValidChange(c)) continue;
        const rev = nextRev();

        /* ----- Datos personales: categorías, grupos, plantillas ----- */
        if (OWN_STORES.includes(c.store)) {
          const _id = ownToDb(c.id, u);
          const cur = writes[c.store]?.get(_id) || await col(c.store).findOne({ _id });
          if (cur && (cur.ownerId || OWNER) !== u) continue;
          if (cur && (cur.updatedAt || 0) >= c.updatedAt) continue;
          put(c.store, c.deleted ? { _id, deleted: true, ownerId: u, updatedAt: c.updatedAt, _rev: rev } : { ...sanitize(c.doc), _id, ownerId: u, updatedAt: c.updatedAt, _rev: rev });
          continue;
        }

        /* ----- Chats ----- */
        if (c.store === 'chats') {
          const _id = chatToDb(c.id, u);
          const cur = await getChatRawCached(_id);
          const live = cur && !cur.deleted ? cur : null;
          if (live && !memberOf(live, u)) { reject(c, 'No eres miembro de este chat', null); continue; }
          if (c.deleted) {
            if (!live) continue;
            if (ownerOf(live) === u) {
              put('chats', { ...live, deleted: true, updatedAt: Math.max(c.updatedAt, (live.updatedAt || 0) + 1), _rev: rev });
            } else {
              // Si no es suyo, "eliminar" es salir del chat.
              put('chats', leave(live, u, rev));
            }
            notifyChat(live);
            continue;
          }
          const doc = sanitize(c.doc);
          if (!live) {
            if (cur && cur.deleted && ownerOf(cur) !== u) { reject(c, 'Ese chat ya no existe', null); continue; }
            put('chats', {
              ...pick(doc, CHAT_SHARED), _id, ownerId: u, members: [{ id: u, role: 'admin', rev }],
              prefs: { [u]: pick(doc, PERSONAL.chats) }, prefsAt: { [u]: c.updatedAt }, sharedAt: c.updatedAt,
              updatedAt: c.updatedAt, _rev: rev,
            });
            continue;
          }
          const next = { ...live, _rev: rev, updatedAt: Math.max(c.updatedAt, (live.updatedAt || 0) + 1) };
          let changed = false;
          if (isAdmin(live, u) && c.updatedAt > (live.sharedAt ?? live.updatedAt ?? 0)) {
            Object.assign(next, pick(doc, CHAT_SHARED), { sharedAt: c.updatedAt });
            changed = true;
          }
          if (c.updatedAt > (live.prefsAt?.[u] ?? 0)) {
            next.prefs = { ...(live.prefs || {}), [u]: pick(doc, PERSONAL.chats) };
            next.prefsAt = { ...(live.prefsAt || {}), [u]: c.updatedAt };
            // Lo personal antiguo (de antes de las cuentas) pasa a prefs del propietario.
            if (u === OWNER) for (const k of PERSONAL.chats) delete next[k];
            changed = true;
          }
          if (changed) { put('chats', next); notifyChat(live); }
          continue;
        }

        /* ----- Mensajes ----- */
        const cur = writes.messages?.get(c.id) || await col('messages').findOne({ _id: c.id });
        const live = cur && !cur.deleted ? cur : null;
        const chatOfCur = live ? await getChatRawCached(live.chatId) : null;
        if (live && (!chatOfCur || chatOfCur.deleted || !memberOf(chatOfCur, u))) { reject(c, 'No tienes acceso a este mensaje', null); continue; }
        const author = live ? (live.authorId || OWNER) : u;
        const isAuthor = author === u;

        if (c.deleted) {
          if (!live) continue;
          if (!isAuthor && !isAdmin(chatOfCur, u)) { reject(c, 'Solo quien lo escribió o un administrador puede borrarlo', live); continue; }
          put('messages', { _id: c.id, deleted: true, chatId: live.chatId, updatedAt: Math.max(c.updatedAt, (live.updatedAt || 0) + 1), _rev: rev });
          notifyChat(chatOfCur);
          continue;
        }

        const doc = sanitize(c.doc);
        const targetId = chatToDb(doc.chatId, u);
        const target = await getChatRawCached(targetId);
        if (!target || target.deleted || !memberOf(target, u)) { reject(c, 'No eres miembro de ese chat', live); continue; }
        const canPost = !target.onlyAdmins || isAdmin(target, u);

        if (!live) {
          if (cur && cur.deleted) continue; // ya se borró
          if (!canPost) { reject(c, 'Solo los administradores pueden enviar mensajes en este chat', null); continue; }
          const poll = doc.poll ? { ...doc.poll, votes: doc.poll.votes?.[u] ? { [u]: doc.poll.votes[u] } : {} } : undefined;
          const created = {
            ...omit(doc, PERSONAL.messages), ...(poll ? { poll } : {}), _id: c.id, chatId: targetId, authorId: u,
            prefs: { [u]: pick(doc, PERSONAL.messages) }, prefsAt: { [u]: c.updatedAt }, sharedAt: c.updatedAt,
            updatedAt: c.updatedAt, _rev: rev,
          };
          put('messages', created);
          out.created.push({ ...created, chat: target });
          notifyChat(target);
          continue;
        }

        const next = { ...live, _rev: rev, updatedAt: Math.max(c.updatedAt, (live.updatedAt || 0) + 1) };
        let changed = false;
        const newer = c.updatedAt > (live.sharedAt ?? live.updatedAt ?? 0);
        if (isAuthor && newer) {
          if (targetId !== live.chatId && !canPost) { reject(c, 'Solo los administradores pueden enviar mensajes en ese chat', live); continue; }
          const keepVotes = live.poll?.votes || {};
          Object.assign(next, omit(doc, [...PERSONAL.messages, 'poll']), { chatId: targetId, sharedAt: c.updatedAt });
          if (doc.poll) next.poll = { ...doc.poll, votes: keepVotes };
          changed = true;
        } else if (!isAuthor && newer) {
          // Otro miembro: solo el estado de la tarea y marcar casillas.
          Object.assign(next, pick(doc, NON_AUTHOR));
          if (doc.text !== undefined && doc.text !== live.text && onlyChecksChanged(live.text, doc.text)) next.text = doc.text;
          if (doc.poll && live.poll && doc.poll.closed !== live.poll.closed && isAdmin(chatOfCur, u)) next.poll = { ...live.poll, closed: !!doc.poll.closed };
          next.sharedAt = c.updatedAt;
          changed = true;
        }
        // Mi voto en una encuesta: siempre el mío, sin tocar los de los demás.
        const poll = next.poll || live.poll;
        if (poll && doc.poll && !poll.closed && c.updatedAt > (live.prefsAt?.[u] ?? 0)) {
          const mine = doc.poll.votes?.[u];
          const votes = { ...(poll.votes || {}) };
          if (u === OWNER) delete votes.me;
          if (Array.isArray(mine) && mine.length) votes[u] = mine.filter((id) => poll.options.some((o) => o.id === id)); else delete votes[u];
          next.poll = { ...poll, votes };
          changed = true;
        }
        if (c.updatedAt > (live.prefsAt?.[u] ?? 0)) {
          next.prefs = { ...(live.prefs || {}), [u]: pick(doc, PERSONAL.messages) };
          next.prefsAt = { ...(live.prefsAt || {}), [u]: c.updatedAt };
          if (u === OWNER) for (const k of PERSONAL.messages) delete next[k];
          changed = true;
        }
        if (changed) {
          put('messages', next);
          notifyChat(chatOfCur);
          if (targetId !== live.chatId) notifyChat(target);
          // Lo que no se aceptó: el dispositivo recibe la versión buena.
          const lost = !isAuthor && ((doc.text !== undefined && next.text !== doc.text) || ['kind', 'due', 'remindAt', 'chatId'].some((k) => k in doc && doc[k] !== (k === 'chatId' ? chatFromDb(next.chatId, u) : next[k])));
          if (lost) out.forced.push({ store: 'messages', doc: { ...view('messages', next, u), updatedAt: next.updatedAt + 1 } });
        }
      }

      for (const [name, map] of Object.entries(writes)) {
        if (!map.size) continue;
        await col(name).bulkWrite([...map.values()].map((d) => ({ replaceOne: { filter: { _id: d._id }, replacement: omit(d, ['_id']), upsert: true } })), { ordered: false });
      }
      if (Object.values(writes).some((m) => m.size)) emit({ ...out, by: u });
      return out;
    });
  }

  function leave(chat, u, rev) {
    return {
      ...chat, _rev: rev, updatedAt: Math.max(Date.now(), (chat.updatedAt || 0) + 1),
      members: membersOf(chat).filter((m) => m.id !== u),
      formerMembers: [...(chat.formerMembers || []).filter((m) => m.id !== u), { id: u, rev }],
      prefs: omit(chat.prefs, [u]),
    };
  }

  /* ======================================================================
   * Miembros de un chat
   * ====================================================================== */
  /** @param {{ chatId, add?: string[], remove?: string, role?: { id, role }, leave?: boolean }} op */
  function updateMembers(u, op) {
    return serial(async () => {
      const _id = chatToDb(String(op.chatId || ''), u);
      if (_id.startsWith('general')) throw Object.assign(new Error('General no se puede compartir'), { status: 400 });
      const chat = await col('chats').findOne({ _id });
      if (!chat || chat.deleted || !memberOf(chat, u)) throw Object.assign(new Error('No existe el chat'), { status: 404 });
      const rev = nextRev();
      let next;
      if (op.leave) {
        if (ownerOf(chat) === u) throw Object.assign(new Error('Creaste este chat: si no lo quieres, elimínalo'), { status: 400 });
        next = leave(chat, u, rev);
      } else {
        if (!isAdmin(chat, u)) throw Object.assign(new Error('Solo los administradores pueden cambiar los miembros'), { status: 403 });
        let members = membersOf(chat).map((m) => ({ ...m }));
        let former = [...(chat.formerMembers || [])];
        if (Array.isArray(op.add)) {
          const all = await activeUsers();
          for (const id of op.add) {
            if (!all.some((x) => x.id === id) || members.some((m) => m.id === id)) continue;
            members.push({ id, role: 'member', rev });
            former = former.filter((m) => m.id !== id);
          }
        }
        if (op.remove) {
          if (op.remove === ownerOf(chat)) throw Object.assign(new Error('No se puede sacar a quien creó el chat'), { status: 400 });
          if (members.some((m) => m.id === op.remove)) {
            members = members.filter((m) => m.id !== op.remove);
            former = [...former.filter((m) => m.id !== op.remove), { id: op.remove, rev }];
          }
        }
        if (op.role) {
          const m = members.find((x) => x.id === op.role.id);
          if (m && ['admin', 'member'].includes(op.role.role)) {
            if (op.role.id === ownerOf(chat) && op.role.role !== 'admin') throw Object.assign(new Error('Quien creó el chat siempre es administrador'), { status: 400 });
            m.role = op.role.role;
          }
        }
        next = { ...chat, members, formerMembers: former, _rev: rev, updatedAt: Math.max(Date.now(), (chat.updatedAt || 0) + 1) };
      }
      await col('chats').bulkWrite([{ replaceOne: { filter: { _id }, replacement: omit(next, ['_id']), upsert: true } }]);
      const users = new Set([...membersOf(chat), ...membersOf(next)].map((m) => m.id));
      emit({ users, created: [], by: u });
      return { chat: view('chats', next, u), users };
    });
  }

  /* ======================================================================
   * Datos de un usuario (asistente MCP, calendario, resumen, correo)
   * ====================================================================== */
  async function userData(u = OWNER) {
    const chatsRaw = (await col('chats').find({ deleted: { $ne: true } }).toArray()).filter((c) => memberOf(c, u));
    const ids = new Set(chatsRaw.map((c) => c._id));
    const messages = (await col('messages').find({ deleted: { $ne: true } }).toArray()).filter((m) => ids.has(m.chatId)).map((m) => view('messages', m, u));
    const out = { chats: chatsRaw.map((c) => view('chats', c, u)), messages };
    for (const name of OWN_STORES) {
      out[name] = (await col(name).find({ deleted: { $ne: true } }).toArray()).filter((d) => (d.ownerId || OWNER) === u).map((d) => view(name, d, u));
    }
    return out;
  }
  /** Sin la papelera. */
  async function liveData(u = OWNER) {
    const d = await userData(u);
    return { ...d, messages: d.messages.filter((m) => !m.trashedAt) };
  }
  async function getMessageFor(id, u) {
    const d = await col('messages').findOne({ _id: id });
    if (!d || d.deleted) return null;
    const chat = await col('chats').findOne({ _id: d.chatId });
    return chat && !chat.deleted && memberOf(chat, u) ? view('messages', d, u) : null;
  }
  async function getChatRaw(id) {
    const c = await col('chats').findOne({ _id: id });
    return c && !c.deleted ? c : null;
  }
  /** Chat tal como lo ve un usuario (id de la base de datos). */
  async function getChat(dbId, u = OWNER) {
    const c = await getChatRaw(dbId);
    return c && memberOf(c, u) ? view('chats', c, u) : null;
  }

  /* ======================================================================
   * Versión de los datos, copias, borrar todo
   * ====================================================================== */
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

  /** Todo, tal cual está guardado (copias de seguridad). */
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

  async function replaceAll(data) {
    await Promise.all([...COLLECTIONS, 'reminders_sent'].map((name) => col(name).deleteMany({})));
    const now = Date.now();
    for (const name of COLLECTIONS) {
      const docs = (Array.isArray(data[name]) ? data[name] : [])
        .filter((d) => d && typeof d.id === 'string' && !d.deleted)
        .map(({ id, _id, _rev, myRole, shared, ...rest }) => ({ _id: id, ...rest, updatedAt: Number.isFinite(rest.updatedAt) ? rest.updatedAt : now, _rev: nextRev() }))
        // Una copia hecha desde la app trae los miembros sin "rev".
        .map((d) => (name === 'chats' && Array.isArray(d.members) ? { ...d, members: d.members.map((m) => ({ rev: 0, ...m })) } : d));
      if (docs.length) await col(name).insertMany(docs, { ordered: false });
    }
    return newResetAt();
  }

  /* ======================================================================
   * Usuarios, sesiones e invitaciones
   * ====================================================================== */
  const users = () => db.collection('users');
  const sessions = () => db.collection('sessions');
  const invites = () => db.collection('invites');
  const pub = (x) => x && ({ id: x._id, name: x.name, handle: x.handle, color: x.color, role: x._id === OWNER ? 'owner' : 'member', disabled: !!x.disabled, hasPassword: !!x.password });

  async function ensureOwner() {
    const o = await users().findOne({ _id: OWNER });
    if (o) return o;
    const doc = { name: 'Propietario', handle: 'propietario', color: COLORS[0], createdAt: Date.now() };
    await users().updateOne({ _id: OWNER }, { $setOnInsert: doc }, { upsert: true });
    return { _id: OWNER, ...doc };
  }
  async function getUser(id) { if (id === OWNER) return pub(await ensureOwner()); return pub(await users().findOne({ _id: id })); }
  async function listUsers() { await ensureOwner(); return (await users().find({}).toArray()).map(pub); }
  async function activeUsers() { return (await listUsers()).filter((x) => !x.disabled); }
  async function handleTaken(handle, except) { return (await users().find({}).toArray()).some((x) => x.handle === handle && x._id !== except); }
  async function createUser(id, profile) {
    await users().updateOne({ _id: id }, { $set: { ...profile, createdAt: Date.now() } }, { upsert: true });
    return getUser(id);
  }
  async function updateUser(id, patch) {
    if (id === OWNER) await ensureOwner();
    await users().updateOne({ _id: id }, { $set: patch });
    return getUser(id);
  }
  async function getUserPrefs(id) { const x = id === OWNER ? await ensureOwner() : await users().findOne({ _id: id }); return x?.prefs || {}; }
  async function saveUserPrefs(id, prefs) { if (id === OWNER) await ensureOwner(); await users().updateOne({ _id: id }, { $set: { prefs } }); }

  async function createSession(userId, sid, device = '') {
    await sessions().updateOne({ _id: sid }, { $set: { userId, device: String(device).slice(0, 120), createdAt: Date.now(), lastSeen: Date.now() } }, { upsert: true });
  }
  const sessionCache = new Map();
  async function sessionActive(userId, sid) {
    const hit = sessionCache.get(sid);
    if (hit && hit.until > Date.now()) return hit.ok;
    const s = await sessions().findOne({ _id: sid });
    const usr = s && await users().findOne({ _id: userId });
    const ok = !!(s && !s.revoked && s.userId === userId && usr && !usr.disabled);
    sessionCache.set(sid, { ok, until: Date.now() + 30000 });
    if (ok && Date.now() - (s.lastSeen || 0) > 3600e3) await sessions().updateOne({ _id: sid }, { $set: { lastSeen: Date.now() } });
    return ok;
  }
  async function listSessions(userId) {
    return (await sessions().find({ userId }).toArray()).filter((s) => !s.revoked)
      .map((s) => ({ id: s._id, device: s.device, createdAt: s.createdAt, lastSeen: s.lastSeen }));
  }
  async function revokeSession(userId, sid) {
    const s = await sessions().findOne({ _id: sid });
    if (!s || (userId !== OWNER && s.userId !== userId)) return false;
    await sessions().updateOne({ _id: sid }, { $set: { revoked: true } });
    sessionCache.delete(sid);
    return true;
  }
  async function revokeAllSessions(userId) {
    for (const s of await sessions().find({ userId }).toArray()) { await sessions().updateOne({ _id: s._id }, { $set: { revoked: true } }); sessionCache.delete(s._id); }
  }
  /* ---------- Contraseñas e intentos de entrada ---------- */
  const findByHandle = async (handle) => (await users().find({}).toArray()).find((x) => x.handle === String(handle || '').toLowerCase().replace(/^@/, '')) || null;
  async function setPassword(id, password) {
    if (id === OWNER) await ensureOwner();
    await users().updateOne({ _id: id }, { $set: { password, failCount: 0, lockUntil: 0 } });
  }
  const hasPassword = async (id) => !!(id === OWNER ? await ensureOwner() : await users().findOne({ _id: id }))?.password;
  async function loginFailed(id) {
    const x = await users().findOne({ _id: id });
    const n = (x?.failCount || 0) + 1;
    // A los 5 intentos fallidos, 5 minutos de espera (y se dobla cada 5 más).
    const lockUntil = n % 5 === 0 ? Date.now() + 5 * 60e3 * 2 ** (n / 5 - 1) : x?.lockUntil || 0;
    await users().updateOne({ _id: id }, { $set: { failCount: n, lockUntil } });
  }
  const loginOk = (id) => users().updateOne({ _id: id }, { $set: { failCount: 0, lockUntil: 0, lastLogin: Date.now() } });

  async function setDisabled(id, disabled) {
    if (id === OWNER) throw Object.assign(new Error('No puedes desactivar al propietario'), { status: 400 });
    await users().updateOne({ _id: id }, { $set: { disabled: !!disabled } });
    if (disabled) await revokeAllSessions(id);
    sessionCache.clear();
  }

  async function createInvite(inv) { await invites().updateOne({ _id: inv.code }, { $set: { ...omit(inv, ['code']), createdAt: Date.now() } }, { upsert: true }); }
  /** Usa un código de un solo uso. Devuelve la invitación o null si no vale. */
  async function takeInvite(code, type) {
    const inv = await invites().findOne({ _id: code });
    if (!inv || inv.type !== type || inv.usedAt || inv.expiresAt < Date.now()) return null;
    await invites().updateOne({ _id: code }, { $set: { usedAt: Date.now() } });
    return inv;
  }

  /* ======================================================================
   * Notificaciones push (cada suscripción es de un usuario)
   * ====================================================================== */
  const subs = () => db.collection('push_subs');
  const sentCol = () => db.collection('reminders_sent');
  async function saveSub(sub, userAgent = '', userId = OWNER) {
    await subs().updateOne(
      { _id: sub.endpoint },
      { $set: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, userAgent: String(userAgent).slice(0, 200), userId, updatedAt: Date.now() } },
      { upsert: true },
    );
  }
  const deleteSub = (endpoint) => subs().deleteOne({ _id: endpoint });
  /** Sin usuario: todas. Con usuario: solo las suyas (las antiguas, sin usuario, son del propietario). */
  async function listSubs(userId = null) {
    const all = await subs().find({}).toArray();
    return userId ? all.filter((s) => (s.userId || OWNER) === userId) : all;
  }
  const getSub = (endpoint) => subs().findOne({ _id: endpoint });

  /** Mensajes con recordatorio vencido (últimas 24 h) que aún no se avisaron. */
  async function dueReminders(now) {
    const docs = await col('messages').find({ remindAt: { $lte: now, $gt: now - 24 * 3600 * 1000 }, deleted: { $ne: true } }).toArray();
    const out = [];
    for (const d of docs) {
      if ((d.kind === 'task' && d.done) || d.trashedAt) continue;
      const sent = await sentCol().findOne({ _id: d._id });
      if (sent && sent.remindAt === d.remindAt) continue;
      out.push({ id: d._id, ...d, authorId: d.authorId || OWNER });
    }
    return out;
  }
  const markReminded = (id, remindAt) => sentCol().updateOne({ _id: id }, { $set: { remindAt, sentAt: Date.now() } }, { upsert: true });

  /* ======================================================================
   * Ajustes del servidor y tareas diarias
   * ====================================================================== */
  async function getServerSettings() {
    const d = await meta().findOne({ _id: 'settings' });
    if (!d) return {};
    const { _id, ...rest } = d;
    return rest;
  }
  const saveServerSettings = (patch) => meta().updateOne({ _id: 'settings' }, { $set: patch }, { upsert: true });
  async function claimDaily(key, day) {
    const d = await meta().findOne({ _id: `daily:${key}` });
    if (d?.day === day) return false;
    await meta().updateOne({ _id: `daily:${key}` }, { $set: { day, at: Date.now() } }, { upsert: true });
    return true;
  }

  /* ---------- Espacio de R2 (contadores) ---------- */
  async function getStorage() { const d = await meta().findOne({ _id: 'storage' }); return d ? omit(d, ['_id']) : {}; }
  const saveStorage = (patch) => meta().updateOne({ _id: 'storage' }, { $set: patch }, { upsert: true });

  /* ---------- Papelera y archivos ---------- */
  async function purgeTrash(cutoff) {
    const old = await col('messages').find({ trashedAt: { $gt: 0, $lt: cutoff }, deleted: { $ne: true } }).toArray();
    for (const d of old) {
      await col('messages').bulkWrite([{ replaceOne: { filter: { _id: d._id }, replacement: { deleted: true, chatId: d.chatId, updatedAt: Math.max(Date.now(), (d.updatedAt || 0) + 1), _rev: nextRev() }, upsert: true } }]);
    }
    return old.length;
  }
  async function usedFileIds() {
    const used = new Set();
    for (const m of await col('messages').find({ deleted: { $ne: true } }).toArray()) for (const a of m.attachments || []) used.add(a.id);
    return used;
  }

  return {
    onWrite, view, changesSince, applyChanges, updateMembers, userData, liveData, getMessageFor, getChat, getChatRaw,
    getResetAt, exportAll, wipe, replaceAll,
    ensureOwner, getUser, listUsers, activeUsers, handleTaken, createUser, updateUser, getUserPrefs, saveUserPrefs,
    findByHandle, setPassword, hasPassword, loginFailed, loginOk,
    createSession, sessionActive, listSessions, revokeSession, revokeAllSessions, setDisabled, createInvite, takeInvite,
    saveSub, deleteSub, listSubs, getSub, dueReminders, markReminded,
    getServerSettings, saveServerSettings, claimDaily, getStorage, saveStorage, purgeTrash, usedFileIds,
  };
}
