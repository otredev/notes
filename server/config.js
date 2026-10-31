/* Configuración del servidor local, leída de variables de entorno (archivo .env). */
export const config = {
  port: Number(process.env.PORT) || 3000,
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017',
  dbName: process.env.MONGODB_DB || 'retrodark',
  token: process.env.APP_TOKEN || '',
  // Zona horaria del usuario (para el MCP: "mañana a las 9" = 9:00 aquí)
  timezone: process.env.TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone,
  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY || '',
    privateKey: process.env.VAPID_PRIVATE_KEY || '',
    subject: process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
  },
};
