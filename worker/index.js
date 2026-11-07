/*
 * RetroDark en Cloudflare Workers.
 *
 * - Los archivos de public/ los sirve Cloudflare directamente (binding ASSETS).
 * - Las peticiones a /api/* llegan aquí y se pasan a un único Durable Object ("main"),
 *   que mantiene abierta la conexión con MongoDB Atlas entre peticiones.
 * - Cada minuto (cron) el Durable Object revisa los recordatorios y envía las notificaciones push.
 * - /mcp es el servidor MCP para asistentes de IA (también pasa por el Durable Object).
 * - /api/files/<id> guarda y sirve los archivos adjuntos en Cloudflare R2 (binding FILES).
 */
import { DurableObject } from 'cloudflare:workers';
import { MongoClient } from 'mongodb';
import { ensureIndexes } from '../server/db.js';
import { createRepo } from '../server/repo.js';
import { handleApi } from '../server/api.js';
import { runReminders } from '../server/reminders.js';
import { handleMcp } from '../server/mcp.js';
import { handleFiles, r2Store, gcFiles } from '../server/files.js';

const jsonResponse = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

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
        return createRepo(db);
      })();
      // Si falla, se reintenta en la siguiente petición.
      this.repoPromise.catch(() => { this.repoPromise = null; });
    }
    return this.repoPromise;
  }

  async fetch(request) {
    const url = new URL(request.url);

    // Llamada interna del cron (no se puede alcanzar desde fuera: el Worker solo reenvía /api/* y /mcp).
    if (url.pathname === '/internal/reminders') {
      try {
        const repo = await this.getRepo();
        const n = await runReminders(repo, vapidFrom(this.env));
        // Una vez por hora: papelera de más de 30 días y adjuntos que ya no usa ningún mensaje.
        let files = 0, purged = 0;
        if (new Date().getUTCMinutes() === 17) {
          purged = await repo.purgeTrash(Date.now() - 30 * 864e5);
          if (this.env.FILES) files = await gcFiles(repo, r2Store(this.env.FILES));
        }
        return jsonResponse(200, { reminders: n, trashPurged: purged, filesRemoved: files });
      } catch (err) {
        console.error('Recordatorios:', err);
        return jsonResponse(500, { error: err.message });
      }
    }

    if (url.pathname === '/mcp' || url.pathname.startsWith('/mcp/')) return this.mcp(request, url);

    let body;
    if (request.method === 'POST') {
      try { body = await request.json(); } catch { return jsonResponse(400, { error: 'JSON no válido' }); }
    }
    try {
      const r = await handleApi(
        { getRepo: () => this.getRepo(), token: this.env.APP_TOKEN || '', vapid: vapidFrom(this.env), tz: this.env.TIMEZONE || 'UTC' },
        {
          method: request.method,
          path: url.pathname.replace(/^\/api/, '') || '/',
          auth: request.headers.get('Authorization'),
          userAgent: request.headers.get('User-Agent'),
          body,
        },
      );
      return jsonResponse(r.status, r.body);
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
async function files(request, env, url) {
  if (!env.FILES) return jsonResponse(503, { error: 'Falta el bucket de R2 (binding FILES en wrangler.jsonc)' });
  try {
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

const stubOf = (env) => env.DB.get(env.DB.idFromName('main'), env.DB_LOCATION ? { locationHint: env.DB_LOCATION } : undefined);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/files/')) return files(request, env, url);
    if (url.pathname.startsWith('/api/') || url.pathname === '/mcp' || url.pathname.startsWith('/mcp/')) return stubOf(env).fetch(request);
    return env.ASSETS.fetch(request);
  },

  /** Cron (cada minuto): recordatorios. */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(stubOf(env).fetch('https://retrodark.internal/internal/reminders', { method: 'POST' }));
  },
};
