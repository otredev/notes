/* Servidor Express para usar la app en local (npm start). En producción se usa el Worker. */
import express from 'express';
import { handleApi } from './api.js';
import { handleMcp } from './mcp.js';
import { handleFeed } from './feed.js';

const send = (res, r) => (r.raw !== undefined ? res.status(r.status).type(r.type || 'text/plain').send(r.raw) : res.status(r.status).json(r.body));

export function createApp({ repo, token = '', vapid = null, timezone = 'UTC', publicDir }) {
  const app = express();
  app.disable('x-powered-by');

  // Archivos adjuntos: solo en Cloudflare (R2). El servidor local no los guarda.
  app.use('/api/files', (req, res) => {
    res.status(503).json({ error: 'Los archivos adjuntos solo se guardan en Cloudflare (R2); el servidor local no los admite' });
  });
  app.use('/api/ai', (req, res) => res.status(503).json({ error: 'La IA (transcribir, leer texto de fotos) solo funciona en Cloudflare' }));

  // Feed de calendario
  app.get('/cal/:file', async (req, res, next) => {
    try { send(res, await handleFeed({ getRepo: async () => repo, token, tz: timezone }, { file: req.params.file, origin: `${req.protocol}://${req.get('host')}` })); } catch (err) { next(err); }
  });
  // "Compartir con RetroDark" sin service worker
  app.post('/share', (req, res) => res.redirect(303, './?share=0'));

  app.use('/api', express.json({ limit: '25mb' }), async (req, res, next) => {
    try {
      const r = await handleApi({ getRepo: async () => repo, token, vapid, tz: timezone }, {
        method: req.method, path: req.path, auth: req.get('authorization'), body: req.body, userAgent: req.get('user-agent'),
      });
      send(res, r);
    } catch (err) {
      next(err);
    }
  });

  // Servidor MCP para asistentes de IA: POST /mcp (o /mcp/<APP_TOKEN>)
  app.use('/mcp', express.json({ limit: '2mb' }), async (req, res, next) => {
    try {
      const r = await handleMcp({ getRepo: async () => repo, token, tz: timezone }, {
        method: req.method, path: req.path === '/' ? '' : req.path, auth: req.get('authorization'), body: req.body,
      });
      if (r.headers) res.set(r.headers);
      if (r.body === undefined) res.status(r.status).end(); else res.status(r.status).json(r.body);
    } catch (err) {
      next(err);
    }
  });

  if (publicDir) {
    app.use(express.static(publicDir, {
      setHeaders(res, file) {
        if (file.endsWith('sw.js') || file.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
      },
    }));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(err.status || 500).json({ error: err.expose ? err.message : 'Error del servidor' });
  });

  return app;
}
