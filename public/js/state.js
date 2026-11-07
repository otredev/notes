/* Estado en memoria de la app y preferencias del dispositivo. */
import { $ } from './utils.js';

export const S = {
  // Datos (se cargan de IndexedDB y se sincronizan con MongoDB)
  chats: [], messages: [], categories: [], groups: [], templates: [],
  trash: [], // mensajes en la papelera (no se muestran en los chats)
  // Interfaz
  nav: 'chats', active: null, groupFilter: 'all', search: '',
  chatFilter: 'all', chatCat: null, chatSearch: '', selection: new Set(), kind: null,
  sub: null,     // vista secundaria del panel: 'docs' (documentación) o 'trash' (papelera)
  replyTo: null, // id del mensaje al que se está respondiendo
  pending: [],   // adjuntos preparados para el próximo mensaje: { att, blob, url }
  taskCat: 'all', showDone: false, installEvt: null,
  agendaMonth: null, agendaDay: null, // Tareas → Agenda
  server: null, // ajustes y funciones del servidor (GET /api/settings)
};

function readLS(k) { try { return JSON.parse(localStorage.getItem(k)) || {}; } catch { return {}; } }

/** Preferencias de este dispositivo (no se sincronizan). */
export const settings = Object.assign({ theme: 'dark', enterSend: true, confirmExit: true, token: '', fmtBar: false, taskView: 'list' }, readLS('retrodark-settings'));

export function saveSettings() {
  try { localStorage.setItem('retrodark-settings', JSON.stringify(settings)); } catch { /* sin almacenamiento */ }
  applyTheme();
}

export function applyTheme() {
  const root = document.documentElement;
  if (settings.theme === 'system') root.removeAttribute('data-theme'); else root.dataset.theme = settings.theme;
  const dark = settings.theme === 'dark' || (settings.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  root.dataset.mode = dark ? 'dark' : 'light'; // css/theme.css aplica el tema oscuro con data-mode
  $('meta[name=theme-color]')?.setAttribute('content', dark ? '#0b0c0e' : '#f0f2f5');
}
