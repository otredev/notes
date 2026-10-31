/* Valores fijos de la app. */

export const COLORS = ['#00a884', '#53bdeb', '#ff7a59', '#a78bfa', '#f5b70a', '#ef4444', '#10b981', '#ec4899', '#64748b'];
export const EMOJIS = ['💬', '📝', '✅', '🛒', '💡', '💼', '🏠', '📚', '🎯', '✈️', '💪', '🎵', '🍳', '💰', '❤️', '⭐'];

/** Tipos de chat. `kind` es el tipo por defecto de lo que se escribe en él. */
export const TYPES = {
  chat: { label: 'Chat', kind: 'message', icon: '💬', hint: 'Mensajes libres que luego clasificas como notas o tareas.' },
  notes: { label: 'Notas', kind: 'note', icon: '📝', hint: 'Cada mensaje se guarda como una nota.' },
  list: { label: 'Lista', kind: 'task', icon: '✅', hint: 'Cada mensaje es una tarea con casilla para marcar.' },
};

/** Tipos de mensaje. */
export const KINDS = {
  message: { label: 'Mensaje', icon: '💬' },
  note: { label: 'Nota', icon: '📝' },
  task: { label: 'Tarea', icon: '☑️' },
};

export const FILTERS = [['all', 'Todo'], ['message', 'Mensajes'], ['note', 'Notas'], ['task', 'Tareas'], ['pending', 'Pendientes'], ['starred', 'Destacados']];
export const NAV = [['chats', 'Chats', 'chats'], ['tasks', 'Tareas', 'tasks'], ['org', 'Organizar', 'org'], ['settings', 'Ajustes', 'settings']];
