/*
 * Ajustes que viven en el servidor (los comparten todos tus dispositivos):
 *   summary  → resumen diario por notificación { enabled, time: "HH:MM" }
 *   backups  → copia diaria automática en R2 { enabled }
 *   email    → correo a nota { allowed: [direcciones], chat: id }
 *   tz       → zona horaria para lo anterior
 */
export const DEFAULTS = {
  summary: { enabled: false, time: '08:00' },
  backups: { enabled: true },
  email: { allowed: [], chat: 'general' },
  tz: '',
};

export const validTz = (tz) => {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return null;
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return tz; } catch { return null; }
};

const EMAIL_RE = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}$/;

export function withDefaults(s = {}, fallbackTz = 'UTC') {
  return {
    summary: { ...DEFAULTS.summary, ...(s.summary || {}) },
    backups: { ...DEFAULTS.backups, ...(s.backups || {}) },
    email: { ...DEFAULTS.email, ...(s.email || {}) },
    tz: validTz(s.tz) || fallbackTz,
  };
}

/** Valida lo que manda la app. Lanza Error con un mensaje legible. */
export function cleanPatch(body = {}) {
  const out = {};
  if (body.summary) {
    const { enabled, time } = body.summary;
    if (time !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Hora no válida (HH:MM)');
    out.summary = { enabled: !!enabled, time: time || DEFAULTS.summary.time };
  }
  if (body.backups) out.backups = { enabled: !!body.backups.enabled };
  if (body.email) {
    const allowed = [...new Set((body.email.allowed || []).map((e) => String(e).trim().toLowerCase()).filter(Boolean))];
    const bad = allowed.find((e) => !EMAIL_RE.test(e));
    if (bad) throw new Error(`Correo no válido: ${bad}`);
    if (allowed.length > 20) throw new Error('Máximo 20 remitentes');
    out.email = { allowed, chat: typeof body.email.chat === 'string' && body.email.chat.length <= 100 ? body.email.chat : 'general' };
  }
  if (body.tz !== undefined) {
    if (!validTz(body.tz)) throw new Error('Zona horaria no válida');
    out.tz = body.tz;
  }
  return out;
}
