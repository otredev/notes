/* Clave de acceso opcional (APP_TOKEN). Sin clave configurada, la API queda abierta. */
import { timingSafeEqual } from 'node:crypto';

export function auth(token) {
  const expected = Buffer.from(`Bearer ${token}`);
  return (req, res, next) => {
    if (!token) return next();
    const got = Buffer.from(req.get('authorization') || '');
    if (got.length === expected.length && timingSafeEqual(got, expected)) return next();
    res.status(401).json({ error: 'unauthorized' });
  };
}
