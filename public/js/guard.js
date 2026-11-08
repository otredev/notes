/*
 * Mensajes bloqueados y protegidos (los marca quien lo escribió o un administrador; aplica a todos).
 *   m.editLocked → nadie puede cambiarlo: texto, tipo, tarea, casillas, lista de compras, fechas, chat…
 *                  (sí se puede destacar, ponerle tu categoría, fijarlo, responder y votar)
 *   m.protected  → no se puede eliminar hasta quitarle la protección
 * El servidor hace cumplir lo mismo; esto es para avisar al momento.
 */
import { toast } from './ui/dom.js';

export const isEditLocked = (m) => !!m?.editLocked;
export const isProtected = (m) => !!m?.protected;

/** true (y avisa) si el mensaje está bloqueado. */
export function lockedNotice(m) {
  if (!isEditLocked(m)) return false;
  toast('🔒 Mensaje bloqueado: desbloquéalo para cambiarlo');
  return true;
}

/** Quita los protegidos de una lista de mensajes a eliminar (y avisa). */
export function deletable(msgs) {
  const ok = msgs.filter((m) => !isProtected(m));
  const n = msgs.length - ok.length;
  if (n) toast(n === 1 && msgs.length === 1 ? '🛡️ Mensaje protegido: quítale la protección para eliminarlo' : `🛡️ ${n} mensaje${n > 1 ? 's' : ''} protegido${n > 1 ? 's' : ''} no se eliminaron`);
  return ok;
}

/** Iconos para la burbuja. */
export const guardBadges = (m) => `${isEditLocked(m) ? '<span class="b-guard" title="Bloqueado: no se puede editar">🔒</span>' : ''}${isProtected(m) ? '<span class="b-guard" title="Protegido: no se puede eliminar">🛡️</span>' : ''}`;
