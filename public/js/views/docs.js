/* Documentación: atajos, formato, listas, recordatorios, gestos y reglas del bloque de código HTML. */
import { ic } from '../icons.js';

const row = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`;
const table = (rows) => `<div class="set-group"><table class="help">${rows.map(([k, v]) => row(k, v)).join('')}</table></div>`;

export function docsPaneHtml() {
  return `<header class="pane-head"><button class="icon-btn" data-act="sub" data-v="" aria-label="Volver a Ajustes">${ic('back')}</button><h1>Documentación</h1></header>
  <div class="list docs">
    <p class="muted small pad">Todo lo que puedes escribir y hacer en RetroDark.</p>

    <div class="sec-title">Tipo de mensaje</div>
    ${table([
      ['<code>[]</code> o <code>/t</code>', 'Tarea (<code>[x]</code> = ya hecha)'],
      ['<code>/n</code>', 'Nota'],
      ['<code>/m</code>', 'Mensaje normal, sin clasificar'],
      ['Botón a la izquierda del cuadro', 'Elegir mensaje, nota o tarea antes de enviar'],
    ])}

    <div class="sec-title">Listas de casillas</div>
    ${table([
      ['<code>[] algo</code> + Enter', 'Añade otra casilla debajo: una lista en un solo mensaje'],
      ['Enter en una casilla vacía', 'Termina la lista y envía (o Ctrl + Enter)'],
      ['Tocar una casilla', 'La marca o desmarca dentro del mensaje'],
    ])}

    <div class="sec-title">Organizar al escribir</div>
    ${table([
      ['<code>#etiqueta</code>', 'Etiqueta. Si un chat tiene esa etiqueta vinculada, lo que escribas en General se mueve allí'],
      ['<code>@categoría</code>', 'Asigna una categoría existente'],
    ])}

    <div class="sec-title">Fechas, recordatorios y repetición</div>
    ${table([
      ['<code>!hoy</code> <code>!mañana</code> <code>!2026-12-24</code>', 'Fecha límite'],
      ['<code>!mañana 9:30</code>', 'Fecha + recordatorio con notificación a esa hora'],
      ['<code>!18:00</code>', 'Solo recordatorio (hoy, o mañana si ya pasó)'],
      ['<code>!cada día</code> <code>!cada semana</code><br><code>!cada mes</code> <code>!cada año</code>', 'Tarea que se repite'],
      ['<code>!cada lunes 9:00</code>', 'Cada lunes (o cualquier día), con aviso a esa hora'],
      ['<code>!laborables 8:00</code>', 'De lunes a viernes'],
      ['Completar una tarea recurrente', 'No queda hecha: salta a la próxima fecha (y su recordatorio también)'],
      ['Botones de la notificación', '<b>✅ Hecho</b> completa la tarea · <b>⏰ Posponer</b> avisa otra vez en 10 minutos'],
      ['Mensaje → Añadir al calendario', 'Google Calendar o archivo .ics (Apple, Outlook…)'],
    ])}

    <div class="sec-title">Formato</div>
    ${table([
      ['<code>*negrita*</code> · Ctrl + B', '<b>negrita</b>'],
      ['<code>_cursiva_</code> · Ctrl + I', '<i>cursiva</i>'],
      ['<code>__subrayado__</code> · Ctrl + U', '<u>subrayado</u>'],
      ['<code>~tachado~</code>', '<s>tachado</s>'],
      ['<code># Título</code>', 'Título grande (al principio de la línea, con espacio)'],
      ['<code>### Subtítulo</code>', 'Subtítulo'],
      ['<code>- elemento</code>', 'Lista con viñetas'],
      ['<code>`código`</code>', 'Código en línea'],
      ['<code>```</code> … <code>```</code>', 'Bloque de código (Enter dentro del bloque hace salto de línea)'],
      ['Botón ' + ic('format', 'tiny') + ' junto al cuadro', 'Barra de formato, encuestas y plantillas'],
    ])}

    <div class="sec-title">Bloque de código HTML</div>
    <div class="set-group small">
      <p>Escribe <code>\`\`\`html</code>, tu código y <code>\`\`\`</code> (o usa el botón <b>HTML</b> de la barra). Se ejecuta dentro del mensaje, en una caja aislada.</p>
      <p><b>Reglas</b></p>
      <ul class="md-ul">
        <li>Corre en un <code>iframe</code> con <code>sandbox="allow-scripts"</code> y <b>sin</b> <code>allow-same-origin</code>: puede usar HTML, CSS y JavaScript, pero no puede leer la app, tus notas, cookies ni el almacenamiento.</li>
        <li>Tampoco puede abrir ventanas, enviar formularios, navegar la app ni pedir permisos (cámara, ubicación…).</li>
        <li>Lo único que puede comunicar es su <b>tamaño</b>. La app solo lo acepta si viene de ese iframe y es un número (alto en px, entre 24 y 3000) o un porcentaje como <code>"56.25%"</code> (alto respecto al ancho, hasta 300 %). Cualquier otro mensaje se ignora.</li>
        <li>El alto se ajusta solo. Si quieres fijarlo tú: <code>parent.postMessage(400, "*")</code> o <code>parent.postMessage("56.25%", "*")</code>.</li>
        <li>Sin conexión, lo que cargue de internet (imágenes, scripts de un CDN) no aparecerá.</li>
        <li>En vistas previas, citas y búsquedas el bloque se muestra como <span class="he-chip">${ic('code', 'tiny')} Bloque HTML</span>. "Ver código" en la cabecera muestra el código.</li>
      </ul>
    </div>

    <div class="sec-title">Encuestas y plantillas</div>
    ${table([
      ['Barra ' + ic('format', 'tiny') + ' → ' + ic('poll', 'tiny'), 'Nueva encuesta: pregunta, opciones y si se puede elegir más de una'],
      ['Tocar una opción', 'Votar (otra vez para quitar el voto)'],
      ['Mensaje → Cerrar encuesta', 'Ya no admite votos (puedes reabrirla)'],
      ['Barra ' + ic('format', 'tiny') + ' → ' + ic('template', 'tiny'), 'Insertar una plantilla. Se crean y editan en Organizar'],
    ])}

    <div class="sec-title">Editar mensajes</div>
    ${table([
      ['Tocar un mensaje', 'Editar texto, tipo, categoría, etiquetas, fechas, repetición, chat…'],
      ['Cerrar la ventana', 'Guarda los cambios (X, tocar fuera, Atrás o Escape)'],
      ['Cancelar', 'Descarta los cambios'],
      ['Eliminar', 'Lo manda a la Papelera (30 días para recuperarlo)'],
    ])}

    <div class="sec-title">Gestos</div>
    ${table([
      ['Mantener pulsado / clic derecho', 'Seleccionar varios mensajes y clasificarlos de golpe'],
      ['Deslizar a la derecha / ↩', 'Responder. "Citar en…" cita el mensaje en otro chat'],
      ['Tocar una cita', 'Ir al mensaje original'],
      ['Pegar o arrastrar archivos', 'Adjuntarlos. Con el cuadro vacío, el botón de enviar graba una nota de voz'],
    ])}

    <div class="sec-title">Teclado</div>
    ${table([
      ['Enter', 'Enviar (si está activado en Ajustes)'],
      ['Mayús + Enter', 'Salto de línea'],
      ['Ctrl / ⌘ + Enter', 'Enviar siempre'],
      ['Ctrl / ⌘ + B · I · U', 'Negrita · cursiva · subrayado'],
      ['Escape', 'Cerrar ventana (guardando), quitar selección o respuesta'],
    ])}
  </div>`;
}
