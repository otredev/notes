/* Notificaciones push en este dispositivo: activar, desactivar, probar. */
import { api } from './data/sync.js';

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** iPhone/iPad: solo funcionan con la app instalada en la pantalla de inicio. */
export const needsInstallOnIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent)
  && !matchMedia('(display-mode: standalone)').matches && !navigator.standalone;

function keyToBytes(b64url) {
  const s = b64url.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(s + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
}

async function currentSubscription() {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

/** 'unsupported' | 'ios-install' | 'denied' | 'on' | 'off' */
export async function pushState() {
  if (needsInstallOnIOS()) return 'ios-install';
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return Notification.permission === 'granted' && await currentSubscription() ? 'on' : 'off';
}

export async function enablePush() {
  if (!pushSupported()) throw new Error('Este navegador no admite notificaciones push');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('No diste permiso para las notificaciones');
  const reg = await navigator.serviceWorker.ready;
  const { publicKey } = await api('push/key');
  let sub = await reg.pushManager.getSubscription();
  // Si el servidor cambió de claves, la suscripción vieja no sirve.
  if (sub && sub.options?.applicationServerKey) {
    const old = new Uint8Array(sub.options.applicationServerKey);
    const neu = keyToBytes(publicKey);
    if (old.length !== neu.length || old.some((b, i) => b !== neu[i])) { await sub.unsubscribe(); sub = null; }
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(publicKey) });
  await api('push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  await api('push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } }).catch(() => {});
  await sub.unsubscribe();
}

export async function testPush() {
  const sub = await currentSubscription();
  if (!sub) throw new Error('Activa primero las notificaciones');
  await api('push/test', { method: 'POST', body: { endpoint: sub.endpoint } });
}

/** Al abrir la app, vuelve a registrar la suscripción en el servidor (por si cambió o se borró). */
export async function refreshPushSubscription() {
  try {
    if (!pushSupported() || Notification.permission !== 'granted') return;
    const sub = await currentSubscription();
    if (sub) await api('push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
  } catch { /* sin conexión: ya se hará */ }
}
