/*
 * Botón Atrás y salir de la app.
 *
 * El historial se mantiene en dos entradas: [inicio, guarda]. Cada vez que el usuario pulsa
 * Atrás se consume la guarda y la app decide qué hacer:
 *   ventana abierta → se cierra · selección → se quita · chat abierto (móvil) → vuelve a la lista
 *   búsqueda → se borra · otra pestaña → vuelve a Chats · si no queda nada → "¿Salir de ChatNote?"
 * Mientras se pregunta no hay guarda, así que pulsar Atrás otra vez sale de verdad.
 *
 * Al cerrar o recargar la pestaña (escritorio) el navegador muestra su propio aviso.
 */
import { $, isMobile } from './utils.js';
import { S, settings } from './state.js';
import { getStatus } from './data/sync.js';
import { sheet, closeSheet, isSheetOpen, toast } from './ui/dom.js';
import { renderNav } from './views/nav.js';
import { renderPane } from './views/pane.js';
import { closeChat, clearSel } from './actions.js';
import { exitEmbedFull } from './events.js';

let guarded = false;   // hay una entrada "guarda" en el historial
let asking = false;    // se está mostrando "¿Salir?"
let leaving = false;   // el usuario eligió salir

function pushGuard() {
  if (guarded || asking || leaving) return;
  history.pushState({ retrodark: 'guard' }, '');
  guarded = true;
}

/** Lo que hace Atrás dentro de la app. Devuelve false si ya no queda nada que cerrar. */
function backInsideApp() {
  if (isSheetOpen()) { closeSheet(); return true; }
  if (S.selection.size) { clearSel(); return true; }
  if (isMobile() && $('#app').classList.contains('chat-open')) { closeChat(); return true; }
  if (document.querySelector('.html-embed.he-max')) { exitEmbedFull(); return true; }
  if (S.sub) { S.sub = null; renderPane(true); return true; }
  if (S.search) { S.search = ''; renderPane(true); return true; }
  if (S.nav !== 'chats') { S.nav = 'chats'; renderNav(); renderPane(true); return true; }
  return false;
}

function askExit() {
  asking = true;
  const pending = getStatus().pending;
  const note = pending
    ? `Hay ${pending} cambio${pending > 1 ? 's' : ''} sin subir. Se guardan en este dispositivo y se subirán la próxima vez que abras la app.`
    : 'Tus notas están guardadas.';
  sheet('¿Salir de ChatNote?', `<p class="muted">${note}</p>`, {
    actions: '<span class="grow"></span><button class="btn ghost" data-act="sheet-close">Quedarme</button><button class="btn primary" data-s="exit">Salir</button>',
    onMount: (sh) => sh.addEventListener('click', (e) => { if (e.target.closest('[data-s=exit]')) leave(); }),
    onClose: () => { asking = false; pushGuard(); },
  });
}

function leave() {
  leaving = true;
  closeSheet();
  history.back(); // en el navegador vuelve a la página anterior
  // En la app instalada no hay página anterior: se intenta cerrar la ventana…
  setTimeout(() => {
    window.close();
    // …y si el sistema no lo permite, el siguiente Atrás sale (no hay guarda).
    setTimeout(() => {
      if (document.visibilityState === 'visible') {
        leaving = false;
        toast('Pulsa Atrás otra vez para salir');
      }
    }, 300);
  }, 150);
}

export function initBackNav() {
  // Chrome ignora entradas del historial añadidas sin interacción, así que la guarda
  // se pone (o se repone) al tocar o teclear.
  ['pointerdown', 'keydown'].forEach((t) => addEventListener(t, pushGuard, { capture: true }));

  addEventListener('popstate', () => {
    guarded = false;
    if (leaving) return;
    if (backInsideApp()) { pushGuard(); return; }
    if (settings.confirmExit) askExit();
    else history.back();
  });

  addEventListener('beforeunload', (e) => {
    if (!settings.confirmExit || leaving) return;
    e.preventDefault();
    e.returnValue = ''; // el navegador muestra su aviso estándar
  });
}
