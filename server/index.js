/* Punto de entrada del servidor local: conecta con MongoDB, arranca Express y revisa recordatorios. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { connect } from './db.js';
import { createRepo } from './repo.js';
import { createApp } from './app.js';
import { runReminders, vapidReady } from './reminders.js';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

let conn;
try {
  conn = await connect(config.mongoUri, config.dbName);
} catch (err) {
  console.error(`No se pudo conectar a MongoDB (${config.mongoUri.replace(/\/\/[^@/]*@/, '//***@')}).`);
  console.error(err.message);
  process.exit(1);
}

const repo = createRepo(conn.db);
const app = createApp({ repo, token: config.token, vapid: config.vapid, timezone: config.timezone, publicDir });
const server = app.listen(config.port, () => {
  console.log(`RetroDark en http://localhost:${config.port}  (base de datos: ${config.dbName})`);
  console.log(`MCP: http://localhost:${config.port}/mcp`);
  if (!config.token) console.log('Aviso: APP_TOKEN vacío, la API y el MCP no piden clave.');
  if (!vapidReady(config.vapid)) console.log('Aviso: sin claves VAPID, las notificaciones push están desactivadas (npm run vapid).');
});

// Recordatorios: se revisan cada minuto.
const timer = setInterval(() => {
  runReminders(repo, config.vapid).catch((err) => console.error('Recordatorios:', err.message));
}, 60_000);
// Papelera: lo que lleva más de 30 días se borra (una vez por hora).
const purgeTimer = setInterval(() => {
  repo.purgeTrash(Date.now() - 30 * 864e5).catch((err) => console.error('Papelera:', err.message));
}, 3600_000);

const shutdown = () => {
  clearInterval(timer);
  clearInterval(purgeTimer);
  server.close();
  conn.client.close().finally(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
