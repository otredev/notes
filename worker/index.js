/*
 * RetroDark en Cloudflare Workers.
 *
 * - Los archivos de public/ los sirve Cloudflare directamente (binding ASSETS).
 * - Las peticiones a /api/* llegan aquí y se pasan a un único Durable Object ("main"),
 *   que mantiene abierta la conexión con MongoDB Atlas entre peticiones.
 * - Cada minuto (cron) el Durable Object revisa los recordatorios y envía las notificaciones push.
 * - /mcp es el servidor MCP para asistentes de IA (también pasa por el Durable Object).
 * - /api/files/<id> guarda y sirve los archivos adjuntos en Cloudflare R2 (binding FILES).
 * - /api/ai/* transcribe notas de voz y saca el texto de fotos con Workers AI (binding AI).
 * - /cal/<clave>.ics es el feed de calendario; /.well-known/assetlinks.json, la app Android (TWA).
 * - email(): correo a nota con Cloudflare Email Routing.
 */
import { DurableObject } from 'cloudflare:workers';
import { MongoClient } from 'mongodb';
import { ensureIndexes } from '../server/db.js';
import { createRepo } from '../server/repo.js';
import { handleApi } from '../server/api.js';
import { runReminders } from '../server/reminders.js';
import { handleMcp } from '../server/mcp.js';
import { handleFiles, r2Store, gcFiles, MAX_FILE_BYTES } from '../server/files.js';
import { handleAi } from '../server/ai.js';
import { handleFeed } from '../server/feed.js';
import { runDaily } from '../server/daily.js';
import { r2Backups } from '../server/backups.js';
import { senderAllowed, emailToMessage, htmlToText, MAX_EMAIL_ATTACHMENTS } from '../server/email.js';
import { authenticate, identify } from '../server/accounts.js';
import { notifyNewMessages } from '../server/notify.js';
import { limitsFrom, reserveUpload, countOps, rescan, storageState } from '../server/storage.js';
import PostalMime from 'postal-mime';

const jsonResponse = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

/** Respuesta de handleApi / handleFeed: JSON o texto tal cual (raw). */
const toResponse = (r) => (r.raw !== undefined
  ? new Response(r.raw, { status: r.status, headers: { 'Content-Type': r.type || 'text/plain', 'Cache-Control': 'no-store' } })
  : jsonResponse(r.status, r.body));

const vapidFrom = (env) => ({
  publicKey: env.VAPID_PUBLIC_KEY || '',
  privateKey: env.VAPID_PRIVATE_KEY || '',
  subject: env.VAPID_SUBJECT || '',
});

export class Database extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.repoPromise = null;
  }

  /** Conecta a MongoDB la primera vez y reutiliza la conexión mientras el objeto siga vivo. */
  getRepo() {
    if (!this.repoPromise) {
      this.repoPromise = (async () => {
        if (!this.env.MONGODB_URI) throw new Error('Falta el secreto MONGODB_URI');
        const client = new MongoClient(this.env.MONGODB_URI, {
          maxPoolSize: 1,
          minPoolSize: 0,
          serverSelectionTimeoutMS: 5000,
          maxIdleTimeMS: 20000,
        });
        await client.connect();
        const db = client.db(this.env.MONGODB_DB || 'retrodark');
        await ensureIndexes(db);
        const repo = createRepo(db);
        // Cada escritura: aviso en tiempo real a quien le afecte y push de mensajes nuevos en chats compartidos.
        repo.onWrite((out) => {
          this.broadcast(out.users);
          if (out.created?.length) notifyNewMessages(repo, vapidFrom(this.env), out).catch((err) => console.error('Avisos', err));
        });
        return repo;
      })();
      // Si falla, se reintenta en la siguiente petición.
      this.repoPromise.catch(() => { this.repoPromise = null; });
    }
    return this.repoPromise;
  }

  /** Tiempo real: avisa a los dispositivos conectados de estas personas de que hay cambios. */
  broadcast(users) {
    for (const uid of users || []) {
      for (const ws of this.ctx.getWebSockets(uid)) { try { ws.send('{"t":"sync"}'); } catch { /* cerrado */ } }
    }
  }

  async webSocketMessage(ws, msg) { if (msg === 'ping') ws.send('pong'); }
  async webSocketClose(ws, code) { try { ws.close(code, 'adiós'); } catch { /* ya cerrado */ } }

  get limits() { return this.env.FILES ? limitsFrom(this.env) : null; }

  async fetch(request) {
    const url = new URL(request.url);

    // Tiempo real (WebSocket). El navegador no puede mandar cabeceras: la clave va en ?token=
    if (url.pathname === '/api/live') {
      if (request.headers.get('Upgrade') !== 'websocket') return jsonResponse(426, { error: 'Usa WebSocket' });
      const repo = await this.getRepo();
      const who = await authenticate(this.env.APP_TOKEN || '', `Bearer ${url.searchParams.get('token') || ''}`, repo);
      if (!who) return jsonResponse(401, { error: 'unauthorized' });
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1], [who.id]);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    // Espacio de R2: reservar una subida o contar operaciones (llamadas internas del Worker).
    if (url.pathname === '/internal/storage') {
      const repo = await this.getRepo();
      const op = await request.json();
      if (!this.limits) return jsonResponse(200, { ok: true });
      if (op.op === 'reserve') {
        const r = await reserveUpload(repo, Number(op.size) || 0, this.limits);
        if (!r.ok) this.broadcast([...(await repo.activeUsers()).map((p) => p.id)]);
        return jsonResponse(200, r);
      }
      await countOps(repo, { a: Number(op.a) || 0, b: Number(op.b) || 0, bytes: Number(op.bytes) || 0 });
      return jsonResponse(200, { ok: true });
    }

    // Llamada interna del cron (no se puede alcanzar desde fuera: el Worker solo reenvía /api/* y /mcp).
    if (url.pathname === '/internal/reminders') {
      try {
        const repo = await this.getRepo();
        const n = await runReminders(repo, vapidFrom(this.env));
        // Resumen del día y copia de seguridad diaria (a su hora).
        const daily = await runDaily(repo, {
          vapid: vapidFrom(this.env), backups: this.env.FILES ? r2Backups(this.env.FILES) : null, tz: this.env.TIMEZONE || 'UTC',
          // Sin copia automática si el espacio está casi lleno.
          storageOk: async () => !this.limits || storageState(await repo.getStorage(), this.limits).state !== 'full',
        });
        // Una vez por hora: papelera de más de 30 días y adjuntos que ya no usa ningún mensaje.
        let files = 0, purged = 0;
        if (new Date().getUTCMinutes() === 17) {
          purged = await repo.purgeTrash(Date.now() - 30 * 864e5);
          if (this.env.FILES) {
            files = await gcFiles(repo, r2Store(this.env.FILES));
            await countOps(repo, { a: 1 }); // el listado de la limpieza
            // Recalcula el espacio real ocupado.
            await rescan(repo, this.env.FILES);
          }
        }
        return jsonResponse(200, { reminders: n, ...daily, trashPurged: purged, filesRemoved: files });
      } catch (err) {
        console.error('Recordatorios:', err);
        return jsonResponse(500, { error: err.message });
      }
    }

    // Correo a nota (llamadas internas desde email()).
    if (url.pathname === '/internal/email-check') {
      const { from } = await request.json();
      const repo = await this.getRepo();
      return jsonResponse(200, { allowed: senderAllowed(await repo.getServerSettings(), from) });
    }
    if (url.pathname === '/internal/email') {
      const repo = await this.getRepo();
      return jsonResponse(200, await emailToMessage(repo, await request.json(), { tz: this.env.TIMEZONE || 'UTC' }));
    }

    if (url.pathname === '/mcp' || url.pathname.startsWith('/mcp/')) return this.mcp(request, url);

    if (url.pathname.startsWith('/cal/')) {
      try {
        const r = await handleFeed(
          { getRepo: () => this.getRepo(), token: this.env.APP_TOKEN || '', tz: this.env.TIMEZONE || 'UTC' },
          { file: decodeURIComponent(url.pathname.slice(5)), origin: url.origin },
        );
        return toResponse(r);
      } catch (err) {
        console.error('Feed', err);
        return jsonResponse(500, { error: 'Error del servidor' });
      }
    }

    let body;
    if (request.method === 'POST') {
      try { body = await request.json(); } catch { return jsonResponse(400, { error: 'JSON no válido' }); }
    }
    try {
      const r = await handleApi(
        {
          getRepo: () => this.getRepo(), token: this.env.APP_TOKEN || '', vapid: vapidFrom(this.env), tz: this.env.TIMEZONE || 'UTC',
          backups: this.env.FILES ? r2Backups(this.env.FILES) : null,
          features: { ai: !!this.env.AI, files: !!this.env.FILES, email: true, live: true },
          storageLimits: this.limits,
        },
        {
          method: request.method,
          path: url.pathname.replace(/^\/api/, '') || '/',
          auth: request.headers.get('Authorization'),
          userAgent: request.headers.get('User-Agent'),
          body,
        },
      );
      return toResponse(r);
    } catch (err) {
      console.error(err);
      return jsonResponse(500, { error: 'Error del servidor' });
    }
  }

  /** Servidor MCP (POST /mcp o /mcp/<APP_TOKEN>). */
  async mcp(request, url) {
    let body;
    if (request.method === 'POST') {
      try { body = await request.json(); } catch { return jsonResponse(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); }
    }
    try {
      const r = await handleMcp(
        { getRepo: () => this.getRepo(), token: this.env.APP_TOKEN || '', tz: this.env.TIMEZONE || 'UTC' },
        { method: request.method, path: url.pathname.slice(4), auth: request.headers.get('Authorization'), body },
      );
      const res = r.body === undefined ? new Response(null, { status: r.status }) : jsonResponse(r.status, r.body);
      for (const [k, v] of Object.entries(r.headers || {})) res.headers.set(k, v);
      return res;
    } catch (err) {
      console.error('MCP', err);
      return jsonResponse(500, { jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Error del servidor' } });
    }
  }
}

/** Archivos adjuntos: PUT y GET /api/files/<id>, directos a R2 (no pasan por MongoDB). */
async function files(request, env, url, ctx) {
  if (!env.FILES) return jsonResponse(503, { error: 'Falta el bucket de R2 (binding FILES en wrangler.jsonc)' });
  const stub = stubOf(env);
  const storage = (op) => stub.fetch('https://retrodark.internal/internal/storage', { method: 'POST', body: JSON.stringify(op) });
  try {
    // Antes de subir: ¿queda espacio gratis? (si no, se rechaza y la app avisa)
    if (request.method === 'PUT' && (await identify(env.APP_TOKEN || '', request.headers.get('Authorization')))) {
      const size = Number(request.headers.get('Content-Length')) || 0;
      if (size > 0 && size <= MAX_FILE_BYTES) {
        const r = await (await storage({ op: 'reserve', size })).json();
        if (!r.ok) return jsonResponse(507, { error: 'El espacio en la nube está casi lleno: no se admiten más archivos', storage: r });
      }
    }
    const r = await handleFiles(
      { store: r2Store(env.FILES), token: env.APP_TOKEN || '' },
      {
        method: request.method,
        id: decodeURIComponent(url.pathname.slice('/api/files/'.length)),
        auth: request.headers.get('Authorization'),
        type: request.headers.get('Content-Type'),
        name: request.headers.get('X-File-Name'),
        size: Number(request.headers.get('Content-Length')) || 0,
        body: request.method === 'PUT' ? request.body : undefined,
      },
    );
    if (request.method === 'GET' && r.status === 200) ctx.waitUntil(storage({ op: 'count', b: 1 }).catch(() => {}));
    if (r.json) {
      const res = jsonResponse(r.status, r.json);
      for (const [k, v] of Object.entries(r.headers || {})) res.headers.set(k, v);
      return res;
    }
    return new Response(r.body, { status: r.status, headers: r.headers });
  } catch (err) {
    console.error('Archivos', err);
    return jsonResponse(500, { error: 'Error del servidor' });
  }
}

/** IA: directo a R2 y Workers AI (no necesita MongoDB). */
async function ai(request, env, url, ctx) {
  let body;
  try { body = await request.json(); } catch { return jsonResponse(400, { error: 'JSON no válido' }); }
  const r = await handleAi(
    { ai: env.AI, store: env.FILES ? r2Store(env.FILES) : null, token: env.APP_TOKEN || '' },
    { method: request.method, path: url.pathname.slice('/api/ai'.length), auth: request.headers.get('Authorization'), body },
  );
  if (r.status === 200) ctx.waitUntil(stubOf(env).fetch('https://retrodark.internal/internal/storage', { method: 'POST', body: '{"op":"count","b":1}' }).catch(() => {}));
  return jsonResponse(r.status, r.body);
}

/** Digital Asset Links para la app Android (TWA). Variables ANDROID_PACKAGE y ANDROID_SHA256. */
function assetLinks(env) {
  const pkg = env.ANDROID_PACKAGE, prints = String(env.ANDROID_SHA256 || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!pkg || !prints.length) return jsonResponse(404, { error: 'Configura ANDROID_PACKAGE y ANDROID_SHA256' });
  return new Response(JSON.stringify([{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: { namespace: 'android_app', package_name: pkg, sha256_cert_fingerprints: prints },
  }]), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' } });
}

const stubOf = (env) => env.DB.get(env.DB.idFromName('main'), env.DB_LOCATION ? { locationHint: env.DB_LOCATION } : undefined);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/files/')) return files(request, env, url, ctx);
    if (url.pathname.startsWith('/api/ai/')) return ai(request, env, url, ctx);
    if (url.pathname === '/.well-known/assetlinks.json') return assetLinks(env);
    // "Compartir con RetroDark" sin service worker activo: se abre la app (el contenido no se pierde con él activo).
    if (url.pathname === '/share' && request.method === 'POST') return Response.redirect(`${url.origin}/?share=0`, 303);
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/cal/') || url.pathname === '/mcp' || url.pathname.startsWith('/mcp/')) {
      return stubOf(env).fetch(request);
    }
    return env.ASSETS.fetch(request);
  },

  /** Correo a nota (Cloudflare Email Routing → este Worker). */
  async email(message, env) {
    const stub = stubOf(env);
    const from = String(message.from || '').toLowerCase();
    const check = await stub.fetch('https://retrodark.internal/internal/email-check', { method: 'POST', body: JSON.stringify({ from }) });
    if (!(await check.json()).allowed) { message.setReject('Remitente no autorizado en RetroDark'); return; }
    const mail = await PostalMime.parse(message.raw);
    const attachments = [];
    for (const a of (mail.attachments || []).slice(0, MAX_EMAIL_ATTACHMENTS)) {
      const bytes = typeof a.content === 'string' ? new TextEncoder().encode(a.content) : new Uint8Array(a.content);
      if (!env.FILES || !bytes.byteLength || bytes.byteLength > MAX_FILE_BYTES) continue;
      const room = await (await stub.fetch('https://retrodark.internal/internal/storage', { method: 'POST', body: JSON.stringify({ op: 'reserve', size: bytes.byteLength }) })).json();
      if (!room.ok) continue; // sin espacio: el correo llega sin ese adjunto
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      const att = { id, name: (a.filename || 'adjunto').slice(0, 200), type: a.mimeType || 'application/octet-stream', size: bytes.byteLength };
      await r2Store(env.FILES).put(id, bytes, att);
      attachments.push(att);
    }
    await stub.fetch('https://retrodark.internal/internal/email', {
      method: 'POST',
      body: JSON.stringify({ from, subject: mail.subject || '', text: mail.text || htmlToText(mail.html || ''), attachments }),
    });
  },

  /** Cron (cada minuto): recordatorios. */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(stubOf(env).fetch('https://retrodark.internal/internal/reminders', { method: 'POST' }));
  },
};
