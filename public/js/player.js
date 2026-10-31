/* Reproductor de notas de voz (uno a la vez, como en WhatsApp). */
import { $ } from './utils.js';
import { ic } from './icons.js';
import { fileUrl, fmtDur } from './files.js';

const audio = new Audio();
let current = null; // { id, duration }

const duration = () => (Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : current?.duration || 0);

/** Actualiza el reproductor visible (se llama también tras redibujar los mensajes). */
export function refreshPlayer() {
  document.querySelectorAll('.att-audio.playing').forEach((el) => {
    if (el.dataset.audio !== current?.id) {
      el.classList.remove('playing');
      $('.ap-play', el).innerHTML = ic('play');
    }
  });
  if (!current) return;
  const el = document.querySelector(`.att-audio[data-audio="${current.id}"]`);
  if (!el) return;
  const playing = !audio.paused && !audio.ended;
  el.classList.toggle('playing', playing);
  $('.ap-play', el).innerHTML = ic(playing ? 'pause' : 'play');
  const d = duration();
  const seek = $('.ap-seek', el);
  if (seek && document.activeElement !== seek) seek.value = d ? Math.round((audio.currentTime / d) * 1000) : 0;
  $('.ap-time', el).textContent = fmtDur(audio.currentTime > 0 && !audio.ended ? audio.currentTime : d);
}

['timeupdate', 'play', 'pause', 'ended', 'loadedmetadata'].forEach((ev) => audio.addEventListener(ev, refreshPlayer));
audio.addEventListener('ended', () => { audio.currentTime = 0; refreshPlayer(); });

export async function toggleAudio(att) {
  if (current?.id === att.id && !audio.paused) { audio.pause(); return; }
  if (current?.id !== att.id) {
    audio.pause();
    const el = document.querySelector(`.att-audio[data-audio="${att.id}"]`);
    el?.classList.add('loading');
    try { audio.src = await fileUrl(att); } finally { el?.classList.remove('loading'); }
    current = { id: att.id, duration: att.duration || 0 };
  }
  await audio.play();
}

export function seekAudio(attId, fraction) {
  if (current?.id !== attId) return;
  const d = duration();
  if (d) audio.currentTime = Math.max(0, Math.min(d, fraction * d));
}

export function stopAudio() { audio.pause(); }
