# RetroDark

PWA de notas y tareas con forma de chat (inspirada en WhatsApp). Los datos se guardan en **MongoDB** a través de un pequeño servidor Node, y la app sigue funcionando sin conexión.

## Desplegar en Cloudflare Workers

Necesitas **Node 22+**, una cuenta de Cloudflare y un clúster de [MongoDB Atlas](https://www.mongodb.com/atlas) (el M0 es gratis).

1. **Atlas**: crea un usuario en *Database Access*, añade `0.0.0.0/0` en *Network Access* (los Workers no tienen IP fija) y copia la cadena `mongodb+srv://…` de *Connect → Drivers*.
2. Instala y entra en Cloudflare:
   ```bash
   npm install
   npx wrangler login
   ```
3. En `wrangler.jsonc`, pon en `DB_LOCATION` la región más cercana a tu clúster (`enam`, `wnam`, `weur`, `sam`…).
4. Crea el bucket de R2 para los archivos adjuntos (una sola vez; si te lo pide, activa R2 en el panel de Cloudflare):
   ```bash
   npx wrangler r2 bucket create retrodark-files
   ```
5. Guarda los secretos:
   ```bash
   npx wrangler secret put MONGODB_URI
   npx wrangler secret put APP_TOKEN
   ```
6. Despliega:
   ```bash
   npm run deploy
   ```
7. Abre `https://retrodark.<tu-subdominio>.workers.dev`, ve a **Ajustes → Sincronización** y escribe tu `APP_TOKEN`.

### Notificaciones push (recordatorios)

```bash
npm run vapid                              # genera las claves (guárdalas)
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
npm run deploy
```

Luego, en cada dispositivo: **Ajustes → Notificaciones → Activar notificaciones** (y "Enviar prueba"). En iPhone/iPad primero hay que instalar la app (Compartir → *Añadir a pantalla de inicio*) y abrirla desde ahí.

El Worker revisa los recordatorios cada minuto (`triggers.crons` en `wrangler.jsonc`) y envía el aviso a todos los dispositivos con las notificaciones activadas. Si cambias las claves VAPID, cada dispositivo tiene que volver a activarlas.

Dominio propio: panel de Cloudflare → *Workers & Pages → retrodark → Settings → Domains & Routes → Add → Custom domain*.

| Comando | Para qué |
|---|---|
| `npm run cf:dev` | Probar el Worker en local (`http://localhost:8787`), con los secretos en `.dev.vars` |
| `npm run deploy` | Publicar los cambios |
| `npm run cf:logs` | Ver los registros en vivo |
| `npm run vapid` | Generar las claves para las notificaciones push |

### Servidor MCP (asistentes de IA)

RetroDark incluye un servidor [MCP](https://modelcontextprotocol.io) en `/mcp` para que Claude u otro asistente lea y organice tus notas y tareas. Lo que escribe el asistente aparece en la app como mensaje recibido (🤖 Asistente). Usa la misma clave `APP_TOKEN`.

| Cliente | Cómo conectarlo |
|---|---|
| **Claude Code** | `claude mcp add --transport http retrodark https://retrodark.<tu-subdominio>.workers.dev/mcp --header "Authorization: Bearer TU_APP_TOKEN"` |
| **Claude.ai / Claude Desktop** | Configuración → Conectores → *Añadir conector personalizado* → URL `https://retrodark.<tu-subdominio>.workers.dev/mcp/TU_APP_TOKEN` |
| **Otros clientes** | Transporte *Streamable HTTP*, URL `…/mcp` y cabecera `Authorization: Bearer TU_APP_TOKEN` |

En la app, **Ajustes → Asistente de IA (MCP)** muestra la URL y el comando listos para copiar.

Herramientas: `list_chats`, `read_chat`, `search_messages`, `list_tasks`, `add_message` (con fecha límite, recordatorio, repetición, categoría, etiquetas o lista de casillas), `update_message`, `complete_task` (también casillas sueltas; una tarea recurrente pasa a su próxima fecha), `delete_message` (a la papelera) y `create_chat`. Las horas sin zona ("2026-11-01T09:30") se entienden en `TIMEZONE` (`wrangler.jsonc`).

### Alternativa: servidor Node en tu PC

```bash
npm install
copy .env.example .env    # rellena MONGODB_URI (local o Atlas) y APP_TOKEN
npm start                 # http://localhost:3000
```

## Cómo se guardan los datos

```
Navegador (PWA)                     Cloudflare Worker                         MongoDB Atlas
┌──────────────────────────┐  POST  ┌─────────────────────────────────┐       ┌──────────────┐
│ IndexedDB (copia local)  │ /api/* │ worker/index.js                 │       │ chats        │
│ outbox (cambios          │ ─────► │  └ Durable Object "Database"    │ ────► │ messages     │
│         pendientes)      │ ◄───── │     (conexión abierta a Mongo)  │       │ categories   │
└──────────────────────────┘        │     server/api.js + repo.js     │       │ groups, meta │
                                    └─────────────────────────────────┘       └──────────────┘
```

El resto de archivos (`public/`) los sirve Cloudflare directamente. En local, `server/app.js` (Express) hace lo mismo que el Worker usando la misma `server/api.js`.

- Cada cambio se guarda al instante en el navegador y se encola. La cola se sube a MongoDB a los pocos segundos, al volver la conexión, al volver a la app y cada 30 s.
- Si editas lo mismo en dos dispositivos, gana la edición más reciente.
- Lo borrado se guarda como "lápida" (`deleted: true`) para que los demás dispositivos también lo borren.
- **Borrar todo** e **Importar** reemplazan los datos en MongoDB y en todos tus dispositivos.
- Los **adjuntos** se guardan en **Cloudflare R2** (bucket `retrodark-files`), nunca en MongoDB. Los que ya no usa ningún mensaje se borran solos cada hora. La copia de seguridad (Exportar) no incluye los archivos. El servidor local (`npm start`) no guarda archivos: se quedan en el dispositivo hasta poder subirlos a Cloudflare.
- La primera vez que una instalación anterior (solo local) se conecta, sube a MongoDB todo lo que tenía guardado.

### API

| Método | Ruta | Para qué |
|---|---|---|
| `GET` | `/api/health` | Comprobar que el servidor responde |
| `POST` | `/api/sync` | Subir cambios `{ since, resetAt, changes }` y recibir los del servidor |
| `GET` | `/api/export` | Copia completa en JSON |
| `POST` | `/api/import` | Reemplazar todo con una copia |
| `POST` | `/api/reset` | Borrar todo |
| `GET` | `/api/push/key` | Clave pública VAPID |
| `POST` | `/api/push/subscribe` · `/unsubscribe` · `/test` | Activar, desactivar y probar las notificaciones de un dispositivo |
| `POST` | `/api/push/action` | Botones de la notificación `{ id, action: "done" \| "snooze", tz }` |
| `POST` | `/mcp` · `/mcp/<APP_TOKEN>` | Servidor MCP (JSON-RPC, Streamable HTTP) |
| `PUT` · `GET` | `/api/files/<id>` | Subir y descargar archivos adjuntos en R2 (máx. 50 MB) |

## Estructura

```
wrangler.jsonc    configuración del Worker (assets, Durable Object, variables)
worker/
  index.js        Worker + Durable Object que mantiene la conexión con MongoDB
server/
  api.js          rutas de la API y clave de acceso (compartido Worker / Express)
  webpush.js      envío de notificaciones push (cifrado + VAPID con WebCrypto)
  reminders.js    revisa los recordatorios vencidos y los envía
  mcp.js          servidor MCP para asistentes de IA (herramientas sobre chats, notas y tareas)
  files.js        archivos adjuntos en Cloudflare R2
  repo.js         lectura y escritura en MongoDB (sincronización)
  db.js           conexión e índices
  app.js          servidor Express para usar en local
  index.js        arranque del servidor local
  config.js       variables de entorno del servidor local
public/
  index.html, sw.js, manifest.webmanifest, icons/
  css/            base, layout, pane, chat, sheets, responsive
  js/
    main.js       arranque de la app
    state.js      estado y preferencias
    constants.js  tipos de chat y de mensaje, colores, emojis
    utils.js      utilidades (DOM, fechas)
    icons.js      iconos SVG
    text.js       atajos al escribir y formato (títulos, listas, código, bloques HTML aislados)
    editor.js     barra de formato y atajos Ctrl+B/I/U
    recurrence.js tareas recurrentes (lo usan también el servidor y el MCP)
    calendar.js   "Añadir al calendario" (Google Calendar y .ics)
    poll.js       encuestas
    render.js     redibujar todo
    actions.js    abrir chats, enviar, completar, importar, borrar…
    events.js     clics, teclado, pulsación larga
    push.js       activar / desactivar / probar notificaciones
    files.js      adjuntos: preparar, subir, descargar, grabar notas de voz
    player.js     reproductor de notas de voz
    backnav.js    botón Atrás y "¿Salir?"
    data/         idb.js (IndexedDB), store.js (datos), sync.js (MongoDB)
    ui/           dom.js (avisos y hojas), parts.js (piezas de HTML)
    views/        nav, pane, chatList, tasks, organize, settings, chat, docs, trash
    sheets/       message, chat, group, category, triage, template
```

## Qué tiene

- **Chat General** fijo como bandeja de entrada, y chats extra de tipo *Chat*, *Notas* o *Lista*.
- Cada mensaje es un **mensaje, nota o tarea** (con casilla, fecha límite y doble check azul al completarla).
- **Categorías** (con color), **#etiquetas** y **grupos** de chats.
- **Clasificar**: botón de bandeja en General para ordenar los mensajes sin clasificar uno a uno.
- **Etiquetas vinculadas**: si un chat tiene la etiqueta `compras`, lo que escribas en General con `#compras` se mueve allí solo.
- **Adjuntos y notas de voz**: botón 📎 (o pegar / arrastrar) para fotos, vídeos y documentos de hasta 50 MB (en Cloudflare R2); con el cuadro vacío el botón de enviar graba una nota de voz. Funciona sin conexión: se suben al volver. Las fotos grandes se reducen a 2048 px.
- **Recordatorios con notificación push**: pon fecha y hora a cualquier mensaje (en el mensaje → *Recordatorio*, o con `!mañana 9:30`) y te llega un aviso aunque la app esté cerrada. Al tocarlo se abre ese mensaje.
- **Responder y citar**: desliza un mensaje a la derecha (o ↩ al pasar el ratón) para responderlo; "Citar en…" lo cita en otro chat. La cita lleva al original y cada mensaje muestra cuántas respuestas tiene.
- Selección múltiple (mantener pulsado / clic derecho): convertir, categorizar, mover, destacar, copiar o borrar.
- **Formato**: botón Aa junto al cuadro de texto (negrita, cursiva, subrayado, tachado, H1, H3, lista, código) y Ctrl+B / I / U.
- **Bloques HTML ejecutables**: un bloque ` ```html ` se ejecuta dentro del mensaje en un `iframe` con `sandbox="allow-scripts"` y sin `allow-same-origin` (no puede leer la app ni tus datos). Solo puede comunicar su alto; la app lo acepta únicamente si viene de ese iframe y es un número o un porcentaje.
- **Editar un mensaje se guarda solo** al cerrar la ventana; *Cancelar* descarta los cambios.
- **Tareas recurrentes** (`!cada lunes 9:00`, `!laborables`, `!cada mes`…): al completarlas pasan a la próxima fecha.
- **Notificaciones con botones**: ✅ Hecho y ⏰ Posponer (10 min) sin abrir la app.
- **Añadir al calendario**: Google Calendar o archivo .ics (Apple, Outlook).
- **Encuestas** (una o varias respuestas, cerrar/reabrir), **plantillas** sincronizadas y **chats archivados**.
- **Papelera**: lo eliminado se puede recuperar durante 30 días.
- Vista de **Tareas**, **Organizar** y **Ajustes** (tema, sincronización, exportar/importar, documentación y papelera).

## Atajos al escribir

| Atajo | Efecto |
|---|---|
| `[]` o `/t` | Tarea (`[x]` = ya hecha) |
| `[] algo` + **Enter** | Añade otra casilla debajo: lista en un solo mensaje. Enter en una casilla vacía (o Ctrl + Enter) envía |
| `/n` | Nota |
| `/m` | Mensaje sin clasificar |
| `#etiqueta` | Etiqueta |
| `@categoría` | Asigna una categoría existente |
| `!hoy`, `!mañana`, `!2026-12-24` | Fecha límite |
| `!mañana 9:30`, `!2026-12-24 18:00` | Fecha límite + recordatorio a esa hora |
| `!18:00` | Solo recordatorio (hoy, o mañana si esa hora ya pasó) |
| `!cada día`, `!cada lunes 9:00`, `!laborables`, `!cada mes` | Tarea recurrente |
| `*negrita*`, `_cursiva_`, `__subrayado__`, `~tachado~` | Formato |
| `# Título`, `### Subtítulo`, `- lista` | Títulos y listas |
| ` ``` ` … ` ``` ` / ` ```html ` … ` ``` ` | Bloque de código / bloque HTML ejecutable |

La documentación completa está en la app: **Ajustes → Documentación**.
