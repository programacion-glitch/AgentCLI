# Soporte de imagenes base64 en el proxy OpenAI-compatible

**Fecha:** 2026-03-25
**Estado:** Aprobado

## Contexto

El proxy expone un endpoint `POST /v1/chat/completions` compatible con la API de OpenAI. Actualmente solo soporta mensajes de texto plano. Los clientes que usan el SDK oficial de OpenAI pueden enviar imagenes como parte del contenido de un mensaje (formato `image_url` con data URLs base64), pero el proxy las descarta.

OpenCode serve (`POST /session/{id}/message`) soporta imagenes via partes de tipo `"file"` con data URLs base64.

## Objetivo

Permitir que los clientes envien imagenes base64 en el formato estandar de OpenAI, y que el proxy las traduzca al formato que espera OpenCode.

## Restricciones

- Solo base64 data URLs (no URLs remotas)
- Solo clientes del SDK oficial de OpenAI (formato estandar garantizado)
- Limite de 10MB del body parser existente (sin cambio). Si el payload excede este limite, Express retorna 413 y el proxy debe responder con un error formato OpenAI.
- Formatos soportados: PNG, JPEG, GIF, WebP (lo que acepta OpenCode)
- El campo `detail` de `image_url` se ignora intencionalmente — OpenCode no tiene un parametro equivalente

## Enfoque

Modificar `sendMessage()` y `chat()` en el cliente OpenCode para aceptar un array de partes (texto + archivos) en vez de un string. La conversion de formato OpenAI a OpenCode se hace en `server.ts`.

## Archivos a modificar

### 1. `src/types.ts` — Nuevos tipos

**Nota de nomenclatura:** `OpenCodeMessagePart` (existente) es para respuestas/output. `OpenCodeInputPart` (nuevo) es para requests/input.

```typescript
// Formato estandar del SDK de OpenAI para content parts
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: string } };

// content pasa de string a string | ContentPart[]
export interface OpenAIMessage {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
}

// Tipo de input para partes que se envian a OpenCode (request)
// (OpenCodeMessagePart existente es para respuestas)
export type OpenCodeInputPart =
  | { type: "text"; text: string }
  | { type: "file"; mime: string; url: string };
```

### 2. `src/opencode.ts` — Firma de sendMessage y chat

`sendMessage()` cambia de `prompt: string` a `parts: OpenCodeInputPart[]`:

```typescript
async sendMessage(
  sessionId: string,
  parts: OpenCodeInputPart[],
  model: string,
  systemPrompt?: string
): Promise<OpenCodeMessageResponse> {
  const [providerID, modelID] = model.includes("/")
    ? model.split("/", 2)
    : ["openai", model];

  const body: Record<string, unknown> = {
    parts,
    model: { providerID, modelID },
    ...(systemPrompt && { system: systemPrompt }),
  };

  const res = await this.http.post<OpenCodeMessageResponse>(
    `/session/${sessionId}/message`,
    body
  );
  return res.data;
}
```

`chat()` cambia su firma completa:

```typescript
async chat(
  parts: OpenCodeInputPart[],
  model: string,
  systemPrompt?: string
): Promise<{ text: string; model: string }> {
  const session = await this.createSession();
  try {
    const response = await this.sendMessage(session.id, parts, model, systemPrompt);
    const text = this.extractTextFromResponse(response);
    return { text, model };
  } finally {
    await this.deleteSession(session.id);
  }
}
```

`extractTextFromResponse` no cambia.

### 3. `src/server.ts` — buildParts reemplaza buildPrompt

Nueva funcion `buildParts()` que convierte mensajes OpenAI a partes OpenCode:

```typescript
function buildParts(messages: OpenAIMessage[]): OpenCodeInputPart[] {
  const parts: OpenCodeInputPart[] = [];

  for (const msg of messages) {
    const label = msg.role === "assistant" ? "Assistant" : "User";

    if (typeof msg.content === "string") {
      const text = messages.length === 1 && msg.role === "user"
        ? msg.content
        : `${label}: ${msg.content}`;
      parts.push({ type: "text", text });
    } else {
      for (const part of msg.content) {
        if (part.type === "text") {
          const text = messages.length === 1 && msg.role === "user"
            ? part.text
            : `${label}: ${part.text}`;
          parts.push({ type: "text", text });
        } else if (part.type === "image_url") {
          // Validar que es un data URL base64
          if (!part.image_url.url.startsWith("data:image/")) {
            continue; // ignorar URLs remotas u otros formatos
          }
          // Regex soporta MIME subtypes con +, . y - (ej: image/svg+xml, image/vnd.ms-photo)
          const mime = part.image_url.url.match(/^data:(image\/[\w.+-]+);/)?.[1] ?? "image/png";
          parts.push({ type: "file", mime, url: part.image_url.url });
        }
      }
    }
  }

  return parts;
}
```

Cuando se omite una imagen por no ser data URL, se registra un warning:

```typescript
console.warn(`[buildParts] Skipping remote image URL (only base64 data URLs supported)`);
```

En el handler de `/v1/chat/completions`:
- `buildPrompt(conversationMessages)` se reemplaza por `buildParts(conversationMessages)`
- `opencode.chat(prompt, ...)` se reemplaza por `opencode.chat(parts, ...)`
- La validacion de contenido vacio pasa de `if (!prompt)` a `if (parts.length === 0)`

### 4. `src/server.ts` — Extraccion de system prompt

El system prompt se extrae como texto plano del campo `content`. Si `content` es un array, se concatenan solo las partes de texto:

```typescript
const systemMessage = body.messages.find(
  (m: OpenAIMessage) => m.role === "system"
);

// Extraer system prompt como string
let systemPrompt: string | undefined;
if (systemMessage) {
  systemPrompt = typeof systemMessage.content === "string"
    ? systemMessage.content
    : systemMessage.content
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join("\n");
}
```

### 5. `src/index.ts` — Actualizar llamada de monitoreo

La llamada de health check en linea 115 debe actualizarse para usar el nuevo formato de partes:

```typescript
// Antes:
await opencode.chat("ping (proactive check)", resolvedModel);

// Despues:
await opencode.chat([{ type: "text", text: "ping (proactive check)" }], resolvedModel);
```

### 6. `src/server.ts` — Error handler para payload 413

Agregar un error handler para que Express devuelva errores en formato OpenAI cuando el body excede 10MB:

```typescript
app.use((err: Error & { type?: string }, _req: Request, res: Response, _next: NextFunction) => {
  if (err.type === "entity.too.large") {
    res.status(413).json({
      error: {
        message: "Request body too large (max 10MB)",
        type: "invalid_request_error",
      },
    });
    return;
  }
  res.status(500).json({
    error: { message: "Internal server error", type: "server_error" },
  });
});
```

## Lo que NO cambia

- `extractTextFromResponse` — las respuestas siguen siendo texto
- El endpoint `/health` y `/v1/models`
- La autenticacion Bearer token
- El limite de 10MB del body (Express retorna 413 si se excede)
- La logica de mapeo de modelos
- El sistema de notificaciones por email
- El intervalo de monitoreo (solo cambia el formato de la llamada)
