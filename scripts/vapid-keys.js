/* Genera las claves VAPID para las notificaciones push:  npm run vapid */
import { generateVapidKeys } from '../server/webpush.js';

const { publicKey, privateKey } = await generateVapidKeys();

console.log(`
Claves VAPID generadas. Guárdalas (si las cambias, cada dispositivo tendrá que volver a activar las notificaciones).

── Cloudflare Workers ─────────────────────────────────────────────
  npx wrangler secret put VAPID_PUBLIC_KEY
      ${publicKey}
  npx wrangler secret put VAPID_PRIVATE_KEY
      ${privateKey}

── Servidor local (.env y .dev.vars) ──────────────────────────────
VAPID_PUBLIC_KEY=${publicKey}
VAPID_PRIVATE_KEY=${privateKey}
`);
