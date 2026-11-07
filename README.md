# ChatNote

> Los nombres internos siguen siendo `retrodark` (Worker y URL `retrodark.<tu-subdominio>.workers.dev`, base de datos, bucket `retrodark-files`, datos guardados en el navegador) para no perder datos ni configuración.

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

### Personas y chats compartidos

Cada persona entra con **usuario y contraseña** (pantalla de inicio de sesión). El **propietario** es la cuenta `propietario`. La primera vez (o si olvidas la contraseña) se la pones con `APP_TOKEN` desde una terminal:

```bash
curl -X POST https://retrodark.<tu-subdominio>.workers.dev/api/auth/password \
  -H "Authorization: Bearer TU_APP_TOKEN" -H "Content-Type: application/json" \
  -d '{"password":"tu-contraseña-nueva"}'
```

Después entras con usuario `propietario` y esa contraseña (puedes cambiar el usuario en **Ajustes → Cuenta**). `APP_TOKEN` no se usa en la pantalla de entrada: sirve para el asistente MCP, para firmar las sesiones y como llave de emergencia.

1. **Ajustes → Personas → Código de invitación** (7 días, un solo uso): con él, la persona pulsa **Crear cuenta** y elige nombre, usuario y contraseña. También puedes enviarle el enlace `…/?join=CÓDIGO`, que abre el formulario con el código puesto. O bien **Crear cuenta** tú mismo y darle usuario y contraseña. Cada persona tiene sus propias notas, categorías y plantillas.
2. En la **información de un chat → Añadir persona** lo compartes. Los administradores cambian nombre e icono, añaden o sacan gente y pueden activar **"Solo los administradores pueden enviar"** (lo hace cumplir el servidor).
3. Los mensajes de otros solo los edita quien los escribió; los demás pueden marcar casillas, completar tareas y votar en las encuestas (cada uno su voto). `@usuario` menciona y avisa.
4. Cada uno cambia su contraseña en **Ajustes → Cuenta**, donde también puede cerrar sesión en otros dispositivos o crear un enlace de 30 minutos para entrar sin escribirla. En **Personas**, el propietario restablece contraseñas (cierra las sesiones de esa persona), crea enlaces de acceso o desactiva cuentas. Tras 5 intentos fallidos de contraseña hay que esperar unos minutos.

Los cambios llegan **en tiempo real** por WebSocket (Durable Object). Las cuentas necesitan `APP_TOKEN`; con el servidor local (`npm start`) no hay tiempo real (sincroniza cada 30 s).

### Espacio en la nube (sin cobros sorpresa)

Cloudflare no deja poner un tope de gasto a R2, así que la app lleva la cuenta: bytes guardados (se recalcula cada hora) y operaciones del mes (clase A: subidas y listados; clase B: descargas). Al **75 %** del límite gratis avisa; al **90 %** rechaza archivos y copias nuevos (HTTP 507) y muestra una ventana. Las barras están en **Ajustes → Almacenamiento**. Los límites se cambian en `wrangler.jsonc` (`STORAGE_LIMIT_GB`, `R2_CLASS_A_LIMIT`, `R2_CLASS_B_LIMIT`, `STORAGE_WARN_PCT`, `STORAGE_STOP_PCT`).

### Inteligencia artificial (Workers AI)

No hay que configurar nada: `wrangler.jsonc` ya trae el binding `AI`. Se usa al pulsar **📝 Transcribir** (notas de voz, modelo Whisper) o **📝 Extraer texto** (fotos, modelo de visión Llama 3.2). La primera vez que se lee una foto, el Worker acepta la licencia de Meta en tu cuenta; si fallara, acéptala tú una vez:

```bash
curl https://api.cloudflare.com/client/v4/accounts/TU_ACCOUNT_ID/ai/run/@cf/meta/llama-3.2-11b-vision-instruct \
  -H "Authorization: Bearer TU_API_TOKEN" -d '{ "prompt": "agree" }'
```

Workers AI tiene una cuota gratuita diaria; lo que pase de ahí se cobra en tu cuenta de Cloudflare.

### Correo a nota (opcional, necesita un dominio propio en Cloudflare)

1. Panel de Cloudflare → tu dominio → **Email → Email Routing** → actívalo.
2. **Routing rules → Create address** (p. ej. `notas@tudominio.com`) → acción **Send to a Worker** → `retrodark`.
3. En la app: **Ajustes → Automatizaciones → Correo a nota**, escribe los remitentes permitidos (los demás se rechazan).

### Resumen diario y copias de seguridad

En **Ajustes → Automatizaciones** activas el resumen de cada mañana (necesita las claves VAPID). Las copias diarias van a R2 (`backups/` dentro del bucket de adjuntos) y se gestionan en **Ajustes → Copias de seguridad**. Las dos usan tu zona horaria.

### App Android (Trusted Web Activity)

Para publicarla en Google Play o instalarla como app nativa:

```bash
npx @bubblewrap/cli init --manifest https://retrodark.<tu-subdominio>.workers.dev/manifest.webmanifest
npx @bubblewrap/cli build
```

Bubblewrap te muestra la huella SHA-256 de tu clave de firma (o cópiala de Play Console → *Integridad de la app*). Ponla en `wrangler.jsonc` junto al nombre del paquete y despliega, para que la app abra sin barra del navegador:

```jsonc
"ANDROID_PACKAGE": "dev.workers.retrodark.twa",
"ANDROID_SHA256": "AA:BB:CC:…"
```

Se sirve en `/.well-known/assetlinks.json`. Con la app instalada, "Ok Google, abre ChatNote" la abre y al mantener pulsado el icono salen los accesos directos.

Dominio propio: panel de Cloudflare → *Workers & Pages → retrodark → Settings → Domains & Routes → Add → Custom domain*.

| Comando | Para qué |
|---|---|
| `npm run cf:dev` | Probar el Worker en local (`http://localhost:8787`), con los secretos en `.dev.vars` |
| `npm run deploy` | Publicar los cambios |
| `npm run cf:logs` | Ver los registros en vivo |
| `npm run vapid` | Generar las claves para las notificaciones push |

### Servidor MCP (asistentes de IA)

ChatNote incluye un servidor [MCP](https://modelcontextprotocol.io) en `/mcp` para que Claude u otro asistente lea y organice tus notas y tareas. Lo que escribe el asistente aparece en la app como mensaje recibido (🤖 Asistente). Usa la misma clave `APP_TOKEN`.

| Cliente | Cómo conectarlo |
|---|---|
| **Claude Code** | `claude mcp add --transport http chatnote https://retrodark.<tu-subdominio>.workers.dev/mcp --header "Authorization: Bearer TU_APP_TOKEN"` |
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
| `POST` | `/api/auth/login` · `/api/auth/register` · `/api/auth/redeem` | Entrar con usuario y contraseña · crear cuenta con código · vincular con enlace (sin sesión) |
| `POST` | `/api/auth/password` · `/api/users/create` · `/api/users/password` | Cambiar tu contraseña · crear cuenta · restablecer contraseña (propietario) |
| `POST` | `/api/auth/invite` · `/api/auth/link` · `/api/auth/logout` | Crear invitación (propietario) · enlace de dispositivo · cerrar sesión |
| `GET` · `POST` | `/api/me` · `GET /api/people` | Tu perfil · personas de ChatNote |
| `GET` · `POST` | `/api/sessions` · `/api/sessions/revoke` | Tus dispositivos |
| `GET` · `POST` | `/api/users` · `/api/users/disable` | Personas y acceso (propietario) |
| `POST` | `/api/chats/members` | `{ chatId, add \| remove \| role \| leave }` |
| `GET` | `/api/live` | Tiempo real (WebSocket, `?token=`) |
| `GET` | `/api/storage` | Espacio usado en R2 |
| `POST` | `/api/sync` | Subir cambios `{ since, resetAt, changes }` y recibir los del servidor |
| `GET` | `/api/export` | Copia completa en JSON |
| `POST` | `/api/import` | Reemplazar todo con una copia |
| `POST` | `/api/reset` | Borrar todo |
| `GET` | `/api/push/key` | Clave pública VAPID |
| `POST` | `/api/push/subscribe` · `/unsubscribe` · `/test` | Activar, desactivar y probar las notificaciones de un dispositivo |
| `POST` | `/api/push/action` | Botones de la notificación `{ id, action: "done" \| "snooze", tz }` |
| `POST` | `/mcp` · `/mcp/<APP_TOKEN>` | Servidor MCP (JSON-RPC, Streamable HTTP) |
| `PUT` · `GET` | `/api/files/<id>` | Subir y descargar archivos adjuntos en R2 (máx. 50 MB) |
| `POST` | `/api/ai/transcribe` · `/api/ai/ocr` | `{ fileId }` → `{ text }` con Workers AI |
| `GET` · `POST` | `/api/settings` | Ajustes del servidor: resumen diario, copias, correo, zona horaria |
| `POST` | `/api/summary/test` | Enviar el resumen del día ahora |
| `GET` · `POST` | `/api/backups` · `GET /api/backups/<nombre>` | Copias de seguridad en R2 |
| `GET` | `/cal/<clave>.ics` | Calendario suscrito (la clave se deriva de `APP_TOKEN`; solo lectura) |
| `GET` | `/.well-known/assetlinks.json` | Verificación de la app Android (TWA) |

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
  ai.js           Workers AI: transcribir audio y leer texto de fotos
  feed.js         calendario suscrito (.ics)
  daily.js        resumen diario y copia de seguridad diaria
  backups.js      copias de seguridad en R2
  email.js        correo a nota (Email Routing)
  settings.js     ajustes del servidor (validación y valores por defecto)
  accounts.js     cuentas, sesiones firmadas e invitaciones
  notify.js       avisos de mensajes nuevos y menciones en chats compartidos
  storage.js      control del espacio de R2 (límite gratis)
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
    ai.js         transcribir / extraer texto (Workers AI)
    lock.js       bloqueo de chats con PIN y huella
    people.js     personas, permisos y menciones
    live.js       tiempo real (WebSocket)
    storage.js    aviso y barras del espacio en la nube
    render.js     redibujar todo
    actions.js    abrir chats, enviar, completar, importar, borrar…
    events.js     clics, teclado, pulsación larga
    push.js       activar / desactivar / probar notificaciones
    files.js      adjuntos: preparar, subir, descargar, grabar notas de voz
    player.js     reproductor de notas de voz
    backnav.js    botón Atrás y "¿Salir?"
    data/         idb.js (IndexedDB), store.js (datos), sync.js (MongoDB)
    ui/           dom.js (avisos y hojas), parts.js (piezas de HTML)
    views/        nav, pane, chatList, tasks (lista, agenda, tablero), organize, settings, server, account, chat, docs, trash
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
- **Tareas en tres vistas**: lista, **agenda** del mes (con repeticiones) y **tablero** Por hacer / En curso / Hecho.
- **IA de Cloudflare**: transcribir notas de voz y extraer el texto de fotos (se puede buscar).
- **Resumen del día** por notificación, **calendario suscrito** (.ics para Google/Apple/Outlook) y **correo a nota**.
- **Copias de seguridad** diarias en R2 con descarga y restauración.
- **Chats bloqueados** con PIN o huella / Face ID.
- **Varias personas**: invitaciones por enlace, chats compartidos con administradores, "solo los administradores pueden enviar", votos por persona, @menciones y cambios en tiempo real.
- **Control del espacio en la nube**: barras en Ajustes y freno automático al 90 % del límite gratis de R2.
- **Compartir con ChatNote** desde otras apps y **accesos directos** del icono (nueva tarea, nueva nota, agenda).
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
