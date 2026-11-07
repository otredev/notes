/*
 * Tiempo real: un WebSocket con el servidor (Durable Object). Cuando alguien cambia algo que te afecta
 * (un mensaje en un chat compartido, tus otros dispositivos…) llega un aviso y la app sincroniza al momento.
 * Si no hay conexión en vivo (servidor local, red caída) la app sigue sincronizando cada 30 s.
 */
import { S, settings } from './state.js';
import { syncNow } from './data/sync.js';

let ws = null, retry = 0, timer = null, pinger = null, stopped = false;

function schedule() {
  clearTimeout(timer);
  if (stopped) return;
  const wait = Math.min(300000, 2000 * 2 ** retry++); // 2 s, 4 s… hasta 5 min
  timer = setTimeout(connect, wait);
}

function connect() {
  clearTimeout(timer);
  if (stopped || !S.server?.features?.live || document.visibilityState === 'hidden') return;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  const url = new URL('api/live', location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  if (settings.token) url.searchParams.set('token', settings.token);
  try { ws = new WebSocket(url); } catch { schedule(); return; }
  ws.onopen = () => {
    retry = 0;
    clearInterval(pinger);
    pinger = setInterval(() => { if (ws?.readyState === WebSocket.OPEN) ws.send('ping'); }, 30000);
    syncNow(); // por si algo cambió mientras no estaba conectado
  };
  ws.onmessage = (e) => { if (String(e.data).includes('sync')) syncNow(); };
  ws.onclose = () => { clearInterval(pinger); ws = null; schedule(); };
  ws.onerror = () => { try { ws?.close(); } catch { /* */ } };
}

export const liveConnected = () => ws?.readyState === WebSocket.OPEN;

export function startLive() {
  stopped = false;
  connect();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { retry = 0; connect(); } });
  addEventListener('online', () => { retry = 0; connect(); });
}

/** Al cambiar de cuenta o de clave. */
export function restartLive() {
  try { ws?.close(); } catch { /* */ }
  ws = null;
  retry = 0;
  connect();
}
