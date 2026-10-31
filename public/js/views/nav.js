/* Barra de navegación (lateral en escritorio, inferior en móvil). */
import { $ } from '../utils.js';
import { ic } from '../icons.js';
import { NAV } from '../constants.js';
import { S } from '../state.js';
import { dueNowCount } from '../data/store.js';

export function renderNav() {
  const due = dueNowCount();
  const html = NAV.map(([key, label, icon]) => {
    const badge = key === 'tasks' && due ? `<b class="badge">${due}</b>` : '';
    return `<button class="nav-btn ${S.nav === key ? 'on' : ''}" data-act="nav" data-nav="${key}" title="${label}" aria-label="${label}">${ic(icon)}<span>${label}</span>${badge}</button>`;
  }).join('');
  $('#rail').innerHTML = html;
  $('#bottomnav').innerHTML = html;
}
