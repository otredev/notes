/*
 * Servidor MCP (Model Context Protocol) de RetroDark.
 *
 * Permite que un asistente de IA (Claude Code, Claude Desktop, claude.ai u otro cliente MCP)
 * lea y gestione tus chats, notas y tareas. Transporte "Streamable HTTP" sin estado:
 * cada POST /mcp lleva un mensaje JSON-RPC y se responde con JSON.
 *
 * Autenticación: cabecera `Authorization: Bearer <APP_TOKEN>` o la URL `/mcp/<APP_TOKEN>`
 * (para clientes que solo permiten pegar una URL).
 *
 * Lo que escribe el asistente se guarda con `from: 'mcp'` y se sincroniza con la app como
 * cualquier otro cambio (aparece como mensaje recibido).
 */
import { tokenOk } from './api.js';

const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const SERVER_INFO = { name: 'retrodark', title: 'RetroDark — notas y tareas', version: '1.0.0' };
const INSTRUCTIONS = `RetroDark es la app de notas y tareas del usuario, con forma de chat (inspirada en WhatsApp).
- Cada "chat" es una página: tipo "chat" (mensajes libres), "notes" (notas) o "list" (tareas). "General" es la bandeja de entrada.
- Cada mensaje es "message", "note" o "task". Una tarea tiene done, due (fecha límite AAAA-MM-DD) y remind_at (recordatorio con notificación push).
- Un mensaje puede ser una lista de casillas: líneas "[ ] algo" / "[x] algo".
- Usa list_chats para ver chats, categorías y grupos; read_chat o search_messages para leer; list_tasks para pendientes.
- Las fechas y horas sin zona se interpretan en la zona horaria del usuario.`;

/* ---------- Utilidades ---------- */
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const norm = (s = '') => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const ITEM_RE = /^(\s*(?:-\s*)?)\[([ xX]?)\]\s?(.*)$/;

class ToolError extends Error {}

function checklist(text = '') {
  const lines = String(text).split('\n');
  const items = lines.map((l, i) => ({ m: l.match(ITEM_RE), i })).filter((x) => x.m)
    .map(({ m, i }) => ({ line: i, done: m[2].toLowerCase() === 'x', text: m[3] }));
  if (!items.length || (items.length === 1 && lines.filter((l) => l.trim()).length === 1)) return null;
  return items;
}
const normalizeItems = (text) => text.split('\n')
  .map((l) => { const x = l.match(ITEM_RE); return x ? `${x[2].toLowerCase() === 'x' ? '[x]' : '[ ]'} ${x[3]}` : l; })
  .join('\n');

/** Diferencia (ms) entre la hora local de `tz` y UTC en el instante `ts`. */
function tzOffset(ts, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(ts);
  const g = (t) => Number(parts.find((p) => p.type === t).value);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - ts;
}

/** "2026-11-01T09:30" (sin zona) → milisegundos en la zona del usuario. Acepta también ISO con zona. */
function parseWhen(value, tz) {
  if (value == null || value === '') return null;
  const s = String(value).trim().replace(' ', 'T');
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) {
    const t = Date.parse(s);
    if (Number.isNaN(t)) throw new ToolError(`Fecha/hora no válida: ${value}`);
    return t;
  }
  const naive = Date.parse(/T\d{2}:\d{2}/.test(s) ? `${s}Z` : `${s}T09:00Z`);
  if (Number.isNaN(naive)) throw new ToolError(`Fecha/hora no válida: ${value} (usa AAAA-MM-DDTHH:MM)`);
  let ts = naive - tzOffset(naive, tz);
  ts = naive - tzOffset(ts, tz); // ajuste por cambio de horario
  return ts;
}

function parseDue(value) {
  if (value == null || value === '') return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) throw new ToolError('due debe tener el formato AAAA-MM-DD');
  return String(value);
}

const fmtLocal = (ts, tz) => (ts ? new Intl.DateTimeFormat('sv-SE', {
  timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
}).format(ts) : null);
const todayIn = (tz) => new Intl.DateTimeFormat('sv-SE', { timeZone: tz }).format(Date.now());

/* ---------- Acceso a datos ---------- */
async function loadAll(repo) {
  const d = await repo.exportAll();
  return { chats: d.chats || [], messages: d.messages || [], categories: d.categories || [], groups: d.groups || [] };
}

function findChat(data, ref, { fallbackGeneral = false } = {}) {
  if (!ref) {
    if (fallbackGeneral) return data.chats.find((c) => c.id === 'general');
    throw new ToolError('Falta el chat');
  }
  const exact = data.chats.find((c) => c.id === ref || norm(c.name) === norm(ref));
  if (exact) return exact;
  const partial = data.chats.filter((c) => norm(c.name).includes(norm(ref)));
  if (partial.length === 1) return partial[0];
  throw new ToolError(`No encuentro el chat "${ref}". Chats: ${data.chats.map((c) => c.name).join(', ')}`);
}

function findCategory(data, ref) {
  if (ref == null || ref === '') return null;
  const c = data.categories.find((k) => k.id === ref || norm(k.name) === norm(ref));
  if (!c) throw new ToolError(`No existe la categoría "${ref}". Categorías: ${data.categories.map((k) => k.name).join(', ') || 'ninguna'}`);
  return c;
}

function findMessage(data, id) {
  const m = data.messages.find((x) => x.id === id);
  if (!m) throw new ToolError(`No existe el mensaje ${id}`);
  return m;
}

async function save(repo, store, doc) {
  doc.updatedAt = Math.max(Date.now(), (doc.updatedAt || 0) + 1);
  const { id, ...rest } = doc;
  await repo.applyChanges([{ store, id, updatedAt: doc.updatedAt, doc: rest }]);
  return doc;
}

/** Mensaje en formato legible para el asistente. */
function view(m, data, tz) {
  const chat = data.chats.find((c) => c.id === m.chatId);
  const cat = data.categories.find((c) => c.id === m.categoryId);
  const items = checklist(m.text);
  return {
    id: m.id,
    chat: chat ? chat.name : m.chatId,
    kind: m.kind,
    text: m.text,
    ...(m.kind === 'task' ? { done: !!m.done } : {}),
    ...(items ? { checklist: items.map((x, i) => ({ item: i + 1, done: x.done, text: x.text })) } : {}),
    ...(m.due ? { due: m.due } : {}),
    ...(m.remindAt ? { remind_at: fmtLocal(m.remindAt, tz) } : {}),
    ...(cat ? { category: cat.name } : {}),
    ...(m.tags?.length ? { tags: m.tags } : {}),
    ...(m.starred ? { starred: true } : {}),
    ...(m.pinned ? { pinned: true } : {}),
    ...(m.replyTo ? { reply_to: m.replyTo } : {}),
    ...(m.attachments?.length ? { attachments: m.attachments.map((a) => ({ name: a.name, type: a.type, size: a.size, ...(a.duration ? { duration_s: Math.round(a.duration) } : {}) })) } : {}),
    created: fmtLocal(m.createdAt, tz),
    from: m.from === 'mcp' ? 'asistente' : m.from === 'app' ? 'app' : 'usuario',
  };
}

const extractTags = (text) => [...new Set([...String(text).matchAll(/(?:^|\s)#([\p{L}\p{N}_-]+)/gu)].map((x) => x[1].toLowerCase()))];

/* ---------- Herramientas ---------- */
const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
const KIND = { type: 'string', enum: ['message', 'note', 'task'] };

const TOOLS = [
  {
    name: 'list_chats',
    title: 'Ver chats',
    description: 'Lista los chats (páginas de notas y listas) con su tipo, grupo y número de notas y tareas pendientes. También devuelve las categorías y grupos disponibles.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    async run(_, { repo, tz }) {
      const data = await loadAll(repo);
      return {
        today: todayIn(tz),
        chats: data.chats.map((c) => {
          const ms = data.messages.filter((m) => m.chatId === c.id);
          return {
            id: c.id, name: c.name, emoji: c.emoji, type: c.type,
            group: data.groups.find((g) => g.id === c.groupId)?.name || null,
            linked_tags: c.tags || [], description: c.desc || '',
            messages: ms.length, notes: ms.filter((m) => m.kind === 'note').length,
            pending_tasks: ms.filter((m) => m.kind === 'task' && !m.done).length,
          };
        }),
        categories: data.categories.map((c) => c.name),
        groups: data.groups.map((g) => g.name),
      };
    },
  },
  {
    name: 'read_chat',
    title: 'Leer un chat',
    description: 'Devuelve los mensajes de un chat (los más recientes, en orden cronológico).',
    inputSchema: {
      type: 'object',
      properties: {
        chat: str('Nombre o id del chat. Por defecto "General".'),
        limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
      },
    },
    annotations: { readOnlyHint: true },
    async run({ chat, limit = 50 }, { repo, tz }) {
      const data = await loadAll(repo);
      const c = findChat(data, chat, { fallbackGeneral: true });
      const ms = data.messages.filter((m) => m.chatId === c.id).sort((a, b) => a.createdAt - b.createdAt).slice(-Math.min(limit, 200));
      return { chat: { id: c.id, name: c.name, type: c.type }, messages: ms.map((m) => view(m, data, tz)) };
    },
  },
  {
    name: 'search_messages',
    title: 'Buscar',
    description: 'Busca en todos los chats por texto o #etiqueta. Opcionalmente filtra por tipo o categoría.',
    inputSchema: {
      type: 'object',
      properties: {
        query: str('Texto a buscar, o "#etiqueta".'),
        kind: KIND,
        category: str('Nombre de la categoría.'),
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 30 },
      },
      required: ['query'],
    },
    annotations: { readOnlyHint: true },
    async run({ query, kind, category, limit = 30 }, { repo, tz }) {
      const data = await loadAll(repo);
      const isTag = String(query).startsWith('#');
      const q = norm(isTag ? query.slice(1) : query);
      const cat = category ? findCategory(data, category) : null;
      const found = data.messages
        .filter((m) => (isTag ? (m.tags || []).some((t) => norm(t) === q) : norm(m.text).includes(q) || (m.tags || []).some((t) => norm(t).includes(q))))
        .filter((m) => !kind || m.kind === kind)
        .filter((m) => !cat || m.categoryId === cat.id)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, Math.min(limit, 100));
      return { results: found.map((m) => view(m, data, tz)) };
    },
  },
  {
    name: 'list_tasks',
    title: 'Ver tareas',
    description: 'Lista tareas (y listas de casillas) de todos los chats, filtrando por estado y fecha límite.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['pending', 'done', 'all'], default: 'pending' },
        due: { type: 'string', enum: ['any', 'overdue', 'today', 'upcoming', 'none'], default: 'any', description: 'Filtro por fecha límite.' },
        chat: str('Limitar a un chat (nombre o id).'),
      },
    },
    annotations: { readOnlyHint: true },
    async run({ status = 'pending', due = 'any', chat }, { repo, tz }) {
      const data = await loadAll(repo);
      const c = chat ? findChat(data, chat) : null;
      const today = todayIn(tz);
      const isDone = (m) => (m.kind === 'task' ? !!m.done : checklist(m.text).every((x) => x.done));
      const list = data.messages
        .filter((m) => m.kind === 'task' || checklist(m.text))
        .filter((m) => !c || m.chatId === c.id)
        .filter((m) => status === 'all' || (status === 'done' ? isDone(m) : !isDone(m)))
        .filter((m) => due === 'any'
          || (due === 'none' ? !m.due : due === 'overdue' ? m.due && m.due < today : due === 'today' ? m.due === today : m.due && m.due > today))
        .sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999') || a.createdAt - b.createdAt);
      return { today, tasks: list.map((m) => view(m, data, tz)) };
    },
  },
  {
    name: 'add_message',
    title: 'Añadir nota o tarea',
    description: 'Crea un mensaje, nota o tarea en un chat. Para una lista de casillas en un solo mensaje, escribe varias líneas "[ ] elemento".',
    inputSchema: {
      type: 'object',
      properties: {
        chat: str('Nombre o id del chat. Por defecto "General".'),
        text: str('Texto. Admite *negrita*, _cursiva_, #etiquetas y líneas "[ ] casilla".'),
        kind: { ...KIND, description: 'Por defecto: el tipo propio del chat (task en listas, note en notas, message en chats).' },
        due: str('Fecha límite AAAA-MM-DD.'),
        remind_at: str('Recordatorio con notificación push: AAAA-MM-DDTHH:MM (hora del usuario) o ISO 8601 con zona.'),
        category: str('Nombre de una categoría existente.'),
        tags: { type: 'array', items: { type: 'string' }, description: 'Etiquetas sin #.' },
        reply_to: str('Id de un mensaje al que responder o citar.'),
      },
      required: ['text'],
    },
    async run(args, { repo, tz }) {
      const data = await loadAll(repo);
      const c = findChat(data, args.chat, { fallbackGeneral: true });
      let text = String(args.text || '').trim();
      if (!text) throw new ToolError('El texto está vacío');
      const isList = !!checklist(text);
      if (isList) text = normalizeItems(text);
      const defaultKind = { list: 'task', notes: 'note', chat: 'message' }[c.type] || 'message';
      const kind = isList ? 'note' : args.kind || defaultKind;
      if (args.reply_to) findMessage(data, args.reply_to);
      const now = Date.now();
      const msg = await save(repo, 'messages', {
        id: uid(), chatId: c.id, text, kind, done: false, doneAt: null,
        tags: [...new Set([...extractTags(text), ...(args.tags || []).map((t) => norm(t).replace(/^#/, ''))])],
        categoryId: findCategory(data, args.category)?.id || null,
        due: parseDue(args.due), remindAt: parseWhen(args.remind_at, tz),
        starred: false, pinned: false, from: 'mcp', triaged: true, replyTo: args.reply_to || null, createdAt: now,
      });
      return { created: view(msg, data, tz) };
    },
  },
  {
    name: 'update_message',
    title: 'Editar mensaje',
    description: 'Cambia un mensaje existente: texto, tipo, estado, fecha límite, recordatorio, categoría, chat, destacado o fijado. Para quitar un campo usa null.',
    inputSchema: {
      type: 'object',
      properties: {
        id: str('Id del mensaje.'),
        text: { type: 'string' },
        kind: KIND,
        done: { type: 'boolean', description: 'Solo para tareas.' },
        due: { type: ['string', 'null'], description: 'AAAA-MM-DD o null.' },
        remind_at: { type: ['string', 'null'], description: 'AAAA-MM-DDTHH:MM o null.' },
        category: { type: ['string', 'null'] },
        chat: str('Mover a otro chat (nombre o id).'),
        starred: { type: 'boolean' },
        pinned: { type: 'boolean' },
      },
      required: ['id'],
    },
    async run(args, { repo, tz }) {
      const data = await loadAll(repo);
      const m = { ...findMessage(data, args.id) };
      if (args.text !== undefined) {
        m.text = String(args.text).trim();
        if (!m.text) throw new ToolError('El texto está vacío');
        if (checklist(m.text)) m.text = normalizeItems(m.text);
        m.tags = [...new Set([...(m.tags || []), ...extractTags(m.text)])];
      }
      if (args.kind) m.kind = args.kind;
      if (args.done !== undefined) { m.kind = 'task'; m.done = args.done; m.doneAt = args.done ? Date.now() : null; }
      if (args.due !== undefined) m.due = parseDue(args.due);
      if (args.remind_at !== undefined) m.remindAt = parseWhen(args.remind_at, tz);
      if (args.category !== undefined) m.categoryId = findCategory(data, args.category)?.id || null;
      if (args.chat) m.chatId = findChat(data, args.chat).id;
      if (args.starred !== undefined) m.starred = args.starred;
      if (args.pinned !== undefined) m.pinned = args.pinned;
      m.triaged = true;
      await save(repo, 'messages', m);
      return { updated: view(m, data, tz) };
    },
  },
  {
    name: 'complete_task',
    title: 'Completar tarea',
    description: 'Marca una tarea como hecha (o pendiente con done=false). Para una lista de casillas indica item: su número (1, 2…) o parte de su texto.',
    inputSchema: {
      type: 'object',
      properties: {
        id: str('Id del mensaje.'),
        done: { type: 'boolean', default: true },
        item: { type: ['integer', 'string'], description: 'Casilla de una lista: número o texto.' },
      },
      required: ['id'],
    },
    async run({ id, done = true, item }, { repo, tz }) {
      const data = await loadAll(repo);
      const m = { ...findMessage(data, id) };
      const items = checklist(m.text);
      if (items) {
        if (item === undefined) throw new ToolError(`Es una lista; indica item (1-${items.length}) o parte del texto`);
        const target = typeof item === 'number' || /^\d+$/.test(item)
          ? items[Number(item) - 1]
          : items.find((x) => norm(x.text).includes(norm(item)));
        if (!target) throw new ToolError(`No encuentro la casilla "${item}"`);
        const lines = m.text.split('\n');
        lines[target.line] = `${done ? '[x]' : '[ ]'} ${target.text}`;
        m.text = lines.join('\n');
      } else {
        m.kind = 'task';
        m.done = done;
        m.doneAt = done ? Date.now() : null;
      }
      await save(repo, 'messages', m);
      return { updated: view(m, data, tz) };
    },
  },
  {
    name: 'delete_message',
    title: 'Eliminar mensaje',
    description: 'Elimina un mensaje de forma permanente (en todos los dispositivos).',
    inputSchema: { type: 'object', properties: { id: str('Id del mensaje.') }, required: ['id'] },
    annotations: { destructiveHint: true },
    async run({ id }, { repo }) {
      const data = await loadAll(repo);
      const m = findMessage(data, id);
      await repo.applyChanges([{ store: 'messages', id, updatedAt: Math.max(Date.now(), (m.updatedAt || 0) + 1), deleted: true }]);
      return { deleted: id };
    },
  },
  {
    name: 'create_chat',
    title: 'Crear chat',
    description: 'Crea un chat nuevo (una página de notas, una lista de tareas o un chat libre).',
    inputSchema: {
      type: 'object',
      properties: {
        name: str('Nombre del chat.'),
        type: { type: 'string', enum: ['chat', 'notes', 'list'], default: 'notes' },
        emoji: str('Un emoji para el icono.'),
        group: str('Nombre de un grupo existente.'),
        linked_tags: { type: 'array', items: { type: 'string' }, description: 'Lo escrito en General con estas #etiquetas llegará a este chat.' },
        description: { type: 'string' },
      },
      required: ['name'],
    },
    async run(args, { repo }) {
      const data = await loadAll(repo);
      const name = String(args.name || '').trim();
      if (!name) throw new ToolError('Falta el nombre');
      if (data.chats.some((c) => norm(c.name) === norm(name))) throw new ToolError(`Ya existe un chat llamado "${name}"`);
      let groupId = null;
      if (args.group) {
        const g = data.groups.find((x) => norm(x.name) === norm(args.group));
        if (!g) throw new ToolError(`No existe el grupo "${args.group}". Grupos: ${data.groups.map((x) => x.name).join(', ') || 'ninguno'}`);
        groupId = g.id;
      }
      const type = args.type || 'notes';
      const colors = ['#53bdeb', '#ff7a59', '#a78bfa', '#f5b70a', '#10b981', '#ec4899'];
      const chat = await save(repo, 'chats', {
        id: uid(), name, type, emoji: args.emoji || { chat: '💬', notes: '📝', list: '✅' }[type],
        color: colors[data.chats.length % colors.length], groupId,
        tags: (args.linked_tags || []).map((t) => norm(t).replace(/^#/, '')).filter(Boolean),
        desc: args.description || '', pinned: false, createdAt: Date.now(),
      });
      return { created: { id: chat.id, name: chat.name, type: chat.type, emoji: chat.emoji } };
    },
  },
];

/* ---------- JSON-RPC ---------- */
const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

async function dispatch(msg, ctx) {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return rpcError(msg?.id ?? null, -32600, 'Invalid Request');
  const isNotification = msg.id === undefined || msg.id === null;
  const { method, params = {} } = msg;

  if (isNotification) return null; // notifications/initialized, cancelled… no requieren respuesta

  switch (method) {
    case 'initialize': {
      const asked = params.protocolVersion;
      return rpcResult(msg.id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }
    case 'ping':
      return rpcResult(msg.id, {});
    case 'tools/list':
      return rpcResult(msg.id, { tools: TOOLS.map(({ run, ...t }) => t) });
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === params.name);
      if (!tool) return rpcError(msg.id, -32602, `Herramienta desconocida: ${params.name}`);
      try {
        const out = await tool.run(params.arguments || {}, { repo: await ctx.getRepo(), tz: ctx.tz });
        return rpcResult(msg.id, { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }], structuredContent: out, isError: false });
      } catch (err) {
        if (!(err instanceof ToolError)) console.error('MCP', params.name, err);
        return rpcResult(msg.id, { content: [{ type: 'text', text: err instanceof ToolError ? err.message : 'Error del servidor' }], isError: true });
      }
    }
    default:
      return rpcError(msg.id, -32601, `Método no soportado: ${method}`);
  }
}

/**
 * @param {{ getRepo: () => Promise<object>, token: string, tz: string }} ctx
 * @param {{ method: string, path: string, auth?: string, body?: any }} req  path sin el prefijo /mcp ('' o '/<token>')
 * @returns {Promise<{ status: number, body?: any, headers?: object }>}
 */
export async function handleMcp(ctx, { method, path, auth, body }) {
  const pathToken = decodeURIComponent((path || '').replace(/^\/+|\/+$/g, ''));
  const authorized = !ctx.token || tokenOk(ctx.token, auth) || (pathToken && tokenOk(ctx.token, `Bearer ${pathToken}`));
  if (!authorized) return { status: 401, body: { error: 'unauthorized' }, headers: { 'WWW-Authenticate': 'Bearer' } };
  if (method === 'GET' || method === 'DELETE') return { status: 405, body: { error: 'Solo POST' }, headers: { Allow: 'POST' } };
  if (method !== 'POST') return { status: 405, body: { error: 'Solo POST' }, headers: { Allow: 'POST' } };
  if (body === undefined) return { status: 400, body: rpcError(null, -32700, 'Parse error') };

  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => dispatch(m, ctx)))).filter(Boolean);
    return out.length ? { status: 200, body: out } : { status: 202 };
  }
  const out = await dispatch(body, ctx);
  return out ? { status: 200, body: out } : { status: 202 };
}
