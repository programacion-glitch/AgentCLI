# OpenAI Local Proxy — Documentación Técnica

Servidor HTTP local que expone un endpoint compatible con la API de OpenAI, usando las credenciales de tu cuenta de **ChatGPT Pro** autenticadas a través de **OpenCode CLI**. No requiere una API Key de pago por uso: funciona con tu suscripción Pro existente.

---

## Tabla de contenidos

1. [¿Qué hace este proyecto?](#qué-hace-este-proyecto)
2. [Arquitectura](#arquitectura)
3. [Requisitos previos](#requisitos-previos)
4. [Instalación desde cero](#instalación-desde-cero)
5. [Estructura del proyecto](#estructura-del-proyecto)
6. [Descripción del código](#descripción-del-código)
7. [Variables de entorno (.env)](#variables-de-entorno-env)
8. [Cómo arrancar el servidor](#cómo-arrancar-el-servidor)
9. [Solución de problemas](#solución-de-problemas)

---

## ¿Qué hace este proyecto?

Expone un servidor HTTP en `localhost:3000` con un endpoint `POST /v1/chat/completions` que sigue exactamente el mismo formato de la API oficial de OpenAI. Esto significa que cualquier aplicación que ya use la SDK de OpenAI puede apuntar a este servidor local sin cambiar nada en su código, excepto la base URL.

La diferencia clave es que **las peticiones no se facturan por token**: se procesan a través de tu suscripción **ChatGPT Pro** (o Plus/Team) usando OpenCode CLI como capa de autenticación.

### Modelo disponible con ChatGPT Pro

Con una cuenta Pro, tienes acceso a la serie **GPT-5** (modelos más recientes que GPT-4o):

| Modelo | Descripción |
|---|---|
| `openai/gpt-5.4` | Modelo más reciente y estable (default auto-detectado) |
| `openai/gpt-5.2` | Versión anterior estable |
| `openai/gpt-5.1-codex` | Optimizado para código |
| `openai/codex-mini-latest` | Versión ligera de Codex |

---

## Arquitectura

```
Tu aplicación
     │
     │  POST http://localhost:3000/v1/chat/completions
     │  (formato estándar OpenAI)
     ▼
┌─────────────────────────────┐
│   OpenAI Local Proxy        │  ← Node.js / TypeScript (puerto 3000)
│   src/index.ts              │     Express HTTP server
│   src/server.ts             │     Traduce formato OpenAI → OpenCode
│   src/opencode.ts           │
└──────────────┬──────────────┘
               │
               │  HTTP Basic Auth
               │  POST http://127.0.0.1:4096/session/:id/message
               │  (API interna de OpenCode)
               ▼
┌─────────────────────────────┐
│   opencode serve            │  ← OpenCode CLI (puerto 4096, interno)
│   Proceso hijo gestionado   │     Iniciado automáticamente por el proxy
│   por el proxy              │     Solo accesible desde localhost
└──────────────┬──────────────┘
               │
               │  OAuth (ChatGPT Pro)
               │  Token almacenado en ~/.local/share/opencode/auth.json
               ▼
     API de OpenAI / ChatGPT
     (modelos GPT-5 con tu cuenta Pro)
```

### Flujo de una petición

1. Tu app envía `POST /v1/chat/completions` con el cuerpo estándar de OpenAI
2. El proxy valida el request y extrae los mensajes
3. Crea una **sesión nueva** en OpenCode (`POST /session`)
4. Envía el prompt a esa sesión (`POST /session/:id/message`)
5. OpenCode usa el token OAuth de ChatGPT Pro para llamar a la API de OpenAI
6. El proxy recibe la respuesta, la formatea como respuesta OpenAI estándar
7. Elimina la sesión de OpenCode (limpieza)
8. Retorna la respuesta a tu app

---

## Requisitos previos

| Requisito | Versión mínima | Verificar con |
|---|---|---|
| Node.js | 18+ | `node --version` |
| npm | 8+ | `npm --version` |
| Cuenta ChatGPT | Plus, Pro o Team | — |
| Sistema operativo | Windows 10+ | — |

> **Nota sobre WSL:** OpenCode recomienda WSL en Windows para mejor rendimiento. Sin embargo, este proyecto funciona directamente en Windows con PowerShell o Git Bash, ya que la sesión de autenticación se almacena en el perfil de usuario de Windows.

---

## Instalación desde cero

### Paso 1 — Instalar OpenCode CLI

Abre una terminal (PowerShell o Git Bash) y ejecuta:

```bash
npm install -g opencode-ai
```

Verifica la instalación:

```bash
opencode --version
# Debería mostrar algo como: 1.2.20
```

### Paso 2 — Autenticar OpenCode con tu cuenta de ChatGPT Pro

Ejecuta OpenCode en modo interactivo:

```bash
opencode
```

Una vez dentro del TUI (interfaz de terminal), escribe el comando:

```
/connect
```

Se abrirá un menú de selección. Navega hasta **OpenAI** y selecciónalo. Luego elige:

```
ChatGPT Plus/Pro
```

OpenCode abrirá tu navegador automáticamente para que inicies sesión con tu cuenta de ChatGPT. Una vez autenticado, vuelve a la terminal.

> Las credenciales se guardan en `C:\Users\<tu_usuario>\.local\share\opencode\auth.json`. No necesitas repetir este paso en futuros arranques.

Cierra OpenCode con `Ctrl+C` o `Ctrl+Q`.

### Paso 3 — Instalar las dependencias del proxy

Navega al directorio del proyecto e instala:

```bash
cd C:\Users\Desarrollo\Documents\AgentAI
npm install
```

### Paso 4 — Compilar el TypeScript

```bash
npm run build
```

Esto genera la carpeta `dist/` con el JavaScript compilado.

### Paso 5 — Configurar el archivo .env

Copia el archivo de ejemplo y revisa la configuración:

```bash
copy .env.example .env
```

En la mayoría de casos no necesitas cambiar nada. El archivo `.env` tiene valores sensatos por defecto. Ver la sección [Variables de entorno](#variables-de-entorno-env) para detalles.

### Paso 6 — Arrancar el servidor

```bash
npm start
```

Verás una salida como esta:

```
╔══════════════════════════════════════════╗
║     OpenAI Local Proxy (via OpenCode)    ║
╚══════════════════════════════════════════╝

→ OpenCode server no detectado. Iniciando opencode serve...
[opencode] opencode server listening on http://127.0.0.1:4096
✓ OpenCode server listo (intento #4)
→ Auto-detectando modelo default...
✓ Modelo detectado: openai/gpt-5.4

✓ Proxy corriendo en http://localhost:3000
  Modelo por defecto: openai/gpt-5.4

── Endpoints disponibles ───────────────────
  GET  http://localhost:3000/health
  GET  http://localhost:3000/v1/models
  POST http://localhost:3000/v1/chat/completions
────────────────────────────────────────────
```

El proxy está listo para recibir peticiones.

---

## Estructura del proyecto

```
AgentAI/
│
├── src/                        # Código fuente TypeScript
│   ├── index.ts                # Entry point: arranca opencode serve y el proxy
│   ├── server.ts               # Express: define los endpoints HTTP
│   ├── opencode.ts             # Cliente HTTP para la API interna de OpenCode
│   └── types.ts                # Definiciones de tipos TypeScript
│
├── dist/                       # Código compilado (generado por tsc)
│   ├── index.js
│   ├── server.js
│   ├── opencode.js
│   └── types.js
│
├── .env                        # Variables de entorno (no subir a git)
├── .env.example                # Plantilla de variables de entorno
├── package.json                # Dependencias y scripts npm
├── tsconfig.json               # Configuración del compilador TypeScript
├── README.md                   # Este archivo
└── API_MANUAL.md               # Manual de uso del API
```

---

## Descripción del código

### `src/types.ts` — Definiciones de tipos

Define las interfaces TypeScript para los dos "mundos" del sistema:

**Tipos OpenAI (lo que recibe el proxy del cliente):**

```typescript
// Un mensaje de la conversación
interface OpenAIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// El body completo de una petición a /v1/chat/completions
interface ChatCompletionRequest {
  model?: string;          // ej: "gpt-4o", "openai/gpt-5.4"
  messages: OpenAIMessage[];
  stream?: boolean;        // No soportado (siempre false)
  // ...otros campos opcionales
}

// La respuesta que devuelve el proxy al cliente
interface ChatCompletionResponse {
  id: string;              // "chatcmpl-<uuid>"
  object: "chat.completion";
  model: string;           // El modelo que procesó la respuesta
  choices: [ { message: { role: "assistant", content: string } } ];
  usage: { prompt_tokens, completion_tokens, total_tokens };
}
```

**Tipos OpenCode (lo que usa internamente el proxy):**

```typescript
// Una sesión de OpenCode (conversación)
interface OpenCodeSession {
  id: string;    // ej: "ses_33b1d033bffee8..."
  title?: string;
}

// Una parte de la respuesta de OpenCode
// OpenCode devuelve las respuestas en "parts" (puede haber texto, llamadas a tools, etc.)
interface OpenCodeMessagePart {
  type: "text" | "tool-call" | "tool-result" | "step-start" | "step-finish";
  text?: string;
}
```

---

### `src/opencode.ts` — Cliente de la API interna de OpenCode

La clase `OpenCodeClient` encapsula toda la comunicación con el servidor interno de OpenCode (`opencode serve`). Usa `axios` para hacer las peticiones HTTP con autenticación Basic.

**Constructor:**

```typescript
constructor(host: string, port: number, password?: string)
```

Crea una instancia de axios preconfigurada con:
- `baseURL`: `http://127.0.0.1:4096`
- `timeout`: 120 segundos (las respuestas de IA pueden tardar)
- `auth`: HTTP Basic Auth con usuario `opencode` y la contraseña generada

> **Por qué Basic Auth:** El servidor de OpenCode siempre requiere autenticación HTTP Basic, incluso en localhost. El proxy genera una contraseña aleatoria (UUID) en cada arranque y se la pasa tanto al proceso `opencode serve` como al cliente axios. Esto asegura que nadie más en el sistema pueda hablar con el servidor interno.

**Método `healthCheck()`:**

Hace `GET /global/health`. Retorna `true` si el servidor responde con HTTP 200. Se usa tanto para detectar si hay un `opencode serve` ya corriendo, como para esperar a que arranque.

**Método `createSession()`:**

Hace `POST /session`. OpenCode organiza las conversaciones en "sesiones". El proxy crea una sesión nueva por cada petición que recibe, y la elimina al terminar. Esto asegura que cada llamada a la API sea stateless (independiente).

**Método `sendMessage(model, prompt, systemPrompt?)`:**

Hace `POST /session/:id/message`. El formato del body es específico de OpenCode:

```json
{
  "model": { "providerID": "openai", "modelID": "gpt-5.4" },
  "parts": [{ "type": "text", "text": "el prompt del usuario" }],
  "system": "instrucciones del sistema (opcional)"
}
```

> **Detalle importante:** El campo `model` debe ser un objeto `{ providerID, modelID }`, no un string. Esta fue una de las cosas que se descubrió durante el desarrollo al explorar la API.

**Método `getDefaultModel()`:**

Consulta `GET /config/providers` para obtener el modelo default configurado en la cuenta. Con ChatGPT Pro retorna `openai/gpt-5.4`. Si falla, devuelve ese mismo valor como fallback.

**Método `chat(prompt, model, systemPrompt?)`:**

Orquesta la operación completa usando `try/finally` para garantizar que la sesión siempre se elimine, incluso si hay un error:

```
createSession() → sendMessage() → extractText() → [finally] deleteSession()
```

---

### `src/server.ts` — Servidor Express

Crea y configura el servidor Express con tres endpoints.

**Middleware de autenticación opcional:**

Si `API_SECRET` está configurado en `.env`, todas las peticiones deben incluir el header:
```
Authorization: Bearer <tu_token>
```
Si no está configurado, el proxy acepta peticiones sin autenticación.

**`GET /health`:**

Verifica el estado del sistema completo. Llama a `opencode.healthCheck()` y retorna:
```json
{
  "status": "ok",
  "proxy": "running",
  "opencode": "connected",
  "default_model": "openai/gpt-5.4"
}
```

**`GET /v1/models`:**

Retorna una lista de modelos en formato OpenAI. Actualmente retorna una lista estática de referencia (gpt-4o, gpt-4o-mini). Los modelos reales con ChatGPT Pro son GPT-5 y se usan automáticamente.

**`POST /v1/chat/completions`:**

El endpoint principal. El procesamiento sigue estos pasos:

1. Valida que `messages` existe y no está vacío
2. Rechaza peticiones con `stream: true` (no soportado)
3. Llama a `mapToOpencodeModel()` para traducir el modelo
4. Separa el `system` message de los mensajes de conversación
5. Llama a `buildPrompt()` para construir el texto del prompt
6. Llama a `opencode.chat()` y espera la respuesta
7. Llama a `buildOpenAIResponse()` para formatear la respuesta

**Función `mapToOpencodeModel()`:**

Traduce el nombre del modelo que pide el cliente al formato que usa OpenCode:

| Cliente pide | El proxy envía |
|---|---|
| `gpt-4o` | `openai/gpt-5.4` (default de la cuenta) |
| `gpt-4o-mini` | `openai/gpt-5.4` (redirige al default) |
| `gpt-3.5-turbo` | `openai/gpt-5.4` (redirige al default) |
| `openai/gpt-5.4` | `openai/gpt-5.4` (pasa directo) |
| `openai/gpt-5.2` | `openai/gpt-5.2` (pasa directo) |

Esto permite que aplicaciones que ya usan `gpt-4o` funcionen sin cambios.

**Función `buildPrompt()`:**

- Si hay un solo mensaje `user`: devuelve el contenido directamente
- Si hay múltiples mensajes (conversación multi-turno): los concatena con etiquetas `User:` / `Assistant:`

**Función `buildOpenAIResponse()`:**

Construye la respuesta en el formato que espera la SDK de OpenAI:
- Genera un ID único con `chatcmpl-<uuid>`
- Estima los tokens (aproximación: 1 token ≈ 4 caracteres, suficiente para logging)

---

### `src/index.ts` — Entry point

Es el punto de entrada del programa. Gestiona el ciclo de vida completo:

**Variables de entorno:**

Lee la configuración desde el archivo `.env` usando `dotenv/config`.

**Contraseña interna de OpenCode:**

```typescript
const OPENCODE_SERVER_PASSWORD = process.env.OPENCODE_SERVER_PASSWORD ?? uuidv4();
```

Genera una contraseña aleatoria usando UUID v4 en cada arranque. Se usa para la comunicación interna entre el proxy y `opencode serve`. No necesitas configurarla manualmente.

**Secuencia de arranque:**

```
1. Intenta healthCheck() en 127.0.0.1:4096
   ├── Si responde → usa ese servidor (ya estaba corriendo)
   └── Si no responde → inicia `opencode serve` como proceso hijo
         └── Espera hasta 30 segundos con healthCheck() en bucle
               └── Si no levanta en 30s → muestra error y sale

2. Auto-detecta el modelo default (si DEFAULT_MODEL está vacío en .env)
   └── Consulta /config/providers al servidor OpenCode

3. Crea el servidor Express con createServer()
4. Escucha en 0.0.0.0:3000 (accesible desde cualquier interfaz de red)
```

**Inicio de `opencode serve`:**

```typescript
const cmd = `opencode serve --port ${port} --hostname ${hostname}`;
const child = spawn(cmd, [], {
  shell: true,
  env: { ...process.env, OPENCODE_SERVER_PASSWORD: password }
});
```

Usa `shell: true` porque en Windows el ejecutable de Node/npm necesita el PATH del shell para ser encontrado. La contraseña se pasa como variable de entorno, no como argumento de línea de comandos, para evitar que aparezca en listados de procesos.

**Manejo de señales:**

```typescript
process.on("SIGINT", () => { opencodeProcess.kill(); process.exit(0); });
process.on("SIGTERM", () => { opencodeProcess.kill(); process.exit(0); });
```

Cuando presionas `Ctrl+C`, el proxy también detiene el proceso hijo de `opencode serve` antes de salir.

---

## Variables de entorno (.env)

| Variable | Default | Descripción |
|---|---|---|
| `PROXY_PORT` | `3000` | Puerto donde tu app hace las peticiones |
| `OPENCODE_PORT` | `4096` | Puerto interno de `opencode serve`. No cambiar salvo conflicto |
| `OPENCODE_HOST` | `127.0.0.1` | Host del servidor interno. No cambiar |
| `DEFAULT_MODEL` | _(vacío)_ | Modelo a usar. Vacío = auto-detectar desde la cuenta |
| `API_SECRET` | _(vacío)_ | Token opcional para proteger el endpoint con Bearer Auth |
| `OPENCODE_SERVER_PASSWORD` | _(auto-generado)_ | Contraseña interna. No configurar manualmente |

### Ejemplo de `.env` con token de protección

```env
PROXY_PORT=3000
OPENCODE_PORT=4096
OPENCODE_HOST=127.0.0.1
DEFAULT_MODEL=
API_SECRET=mi_token_super_secreto_2026
```

Con esto configurado, todas las peticiones deben incluir:
```
Authorization: Bearer mi_token_super_secreto_2026
```

---

## Cómo arrancar el servidor

### Modo producción (código compilado)

```bash
npm run build   # Compila TypeScript → dist/
npm start       # Ejecuta dist/index.js
```

### Modo desarrollo (sin compilar)

```bash
npm run dev     # Ejecuta src/index.ts directamente con ts-node
```

### Modo desarrollo con auto-recarga

```bash
npm run dev:watch   # Reinicia automáticamente al guardar cambios
```

---

## Dependencias

### Producción

| Paquete | Versión | Para qué se usa |
|---|---|---|
| `express` | ^4.18 | Servidor HTTP |
| `axios` | ^1.6 | Cliente HTTP para llamar a OpenCode |
| `dotenv` | ^16.3 | Leer variables de entorno desde `.env` |
| `cors` | ^2.8 | Permitir peticiones desde el navegador (CORS) |
| `uuid` | ^9.0 | Generar IDs únicos para respuestas y contraseñas |

### Desarrollo

| Paquete | Para qué se usa |
|---|---|
| `typescript` | Compilador TypeScript |
| `ts-node` | Ejecutar TypeScript directamente sin compilar |
| `ts-node-dev` | ts-node con auto-recarga |
| `@types/*` | Tipos TypeScript para las dependencias |

---

## Solución de problemas

### "OpenCode CLI no está autenticado"

El proxy inicia pero cierra después de 30 segundos de espera.

**Solución:** Ejecuta `opencode` en la terminal, luego `/connect` → OpenAI → ChatGPT Plus/Pro y completa el login en el navegador.

### "Puerto 4096 ya está en uso"

Hay otro proceso usando ese puerto (posiblemente un `opencode serve` huérfano).

**Solución en Windows:**
```bash
netstat -ano | grep ":4096 "
# Anota el PID de la última columna
taskkill /PID <numero> /F
```

### "Puerto 3000 ya está en uso"

**Solución:** Cambia `PROXY_PORT=3001` en el archivo `.env` y vuelve a ejecutar `npm start`.

### La respuesta del modelo está vacía

El modelo especificado no existe en tu cuenta.

**Solución:** Deja `DEFAULT_MODEL=` en blanco en `.env` para que el proxy auto-detecte el modelo disponible. O consulta los modelos disponibles en tu cuenta con:
```bash
curl http://localhost:3000/health
```

### Error "ECONNREFUSED" en las peticiones de chat

El servidor de OpenCode se cayó después de arrancar.

**Solución:** Reinicia el proxy con `npm start`. Verifica que tienes conexión a internet y que tu sesión de ChatGPT Pro sigue activa.
