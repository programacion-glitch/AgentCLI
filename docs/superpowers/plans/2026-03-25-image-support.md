# Image Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow base64 images in OpenAI-format requests to flow through the proxy to OpenCode serve.

**Architecture:** Widen `content` from `string` to `string | ContentPart[]` in types, update `OpenCodeClient` to accept `OpenCodeInputPart[]` instead of a plain string, and replace `buildPrompt()` with `buildParts()` in the server handler to translate between formats.

**Tech Stack:** TypeScript, Express, Axios

**Nota:** Los numeros de linea en cada task son relativos al archivo original. Despues de aplicar cambios, las lineas se desplazan — usar los comentarios y landmarks del codigo como referencia. El proyecto solo compila limpiamente despues de Task 4. Considerar squash-merge al integrar.

**Spec:** `docs/superpowers/specs/2026-03-25-image-support-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/types.ts` | Modify | Add `ContentPart`, `OpenCodeInputPart`; widen `OpenAIMessage.content` |
| `src/opencode.ts` | Modify | Change `sendMessage`/`chat` to accept `OpenCodeInputPart[]` |
| `src/server.ts` | Modify | Replace `buildPrompt` with `buildParts`; update handler; add 413 error handler |
| `src/index.ts` | Modify | Update monitoring ping call to new `chat()` signature |

---

### Task 1: Update types

**Files:**
- Modify: `src/types.ts:1-72`

- [ ] **Step 1: Add `ContentPart` type and widen `OpenAIMessage.content`**

Replace the existing `OpenAIMessage` interface and add `ContentPart` above it:

```typescript
// In src/types.ts, replace lines 5-8 with:

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: string } };

export interface OpenAIMessage {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
}
```

- [ ] **Step 2: Add `OpenCodeInputPart` type**

Add after the `OpenCodeMessageResponse` interface (after line 72):

```typescript
// Input parts for OpenCode requests (OpenCodeMessagePart above is for responses)
export type OpenCodeInputPart =
  | { type: "text"; text: string }
  | { type: "file"; mime: string; url: string };
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

Expected: Compilation errors in `opencode.ts`, `server.ts`, and `index.ts` because `content` is now `string | ContentPart[]` and is used as `string` in those files. This is expected — we fix them in subsequent tasks.

- [ ] **Step 4: Commit**

```bash
git add src/types.ts
git commit -m "feat: add ContentPart and OpenCodeInputPart types for image support"
```

---

### Task 2: Update OpenCode client

**Files:**
- Modify: `src/opencode.ts:1-169`

- [ ] **Step 1: Update import to include `OpenCodeInputPart`**

In `src/opencode.ts` line 2-6, add `OpenCodeInputPart` to the import:

```typescript
import {
  OpenCodeSession,
  OpenCodeMessageResponse,
  OpenCodeMessagePart,
  OpenCodeInputPart,
} from "./types";
```

- [ ] **Step 2: Update `sendMessage` to accept parts array**

Replace the `sendMessage` method (lines 70-106) with:

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
      model: {
        providerID,
        modelID,
      },
      ...(systemPrompt && { system: systemPrompt }),
    };

    const res = await this.http.post<OpenCodeMessageResponse>(
      `/session/${sessionId}/message`,
      body
    );

    return res.data;
  }
```

- [ ] **Step 3: Update `chat` to accept parts array**

Replace the `chat` method (lines 146-168) with:

```typescript
  async chat(
    parts: OpenCodeInputPart[],
    model: string,
    systemPrompt?: string
  ): Promise<{ text: string; model: string }> {
    const session = await this.createSession();

    try {
      const response = await this.sendMessage(
        session.id,
        parts,
        model,
        systemPrompt
      );

      const text = this.extractTextFromResponse(response);

      return { text, model };
    } finally {
      await this.deleteSession(session.id);
    }
  }
```

- [ ] **Step 4: Commit**

```bash
git add src/opencode.ts
git commit -m "feat: update OpenCodeClient to accept OpenCodeInputPart[] instead of string"
```

---

### Task 3: Update server handler

**Files:**
- Modify: `src/server.ts:1-318`

- [ ] **Step 1: Update imports**

In `src/server.ts` lines 6-10, add `OpenCodeInputPart` and `ContentPart` to the import:

```typescript
import {
  ChatCompletionRequest,
  ChatCompletionResponse,
  OpenAIMessage,
  OpenCodeInputPart,
  ContentPart,
} from "./types";
```

- [ ] **Step 2: Replace `buildPrompt` with `buildParts`**

Replace the `buildPrompt` function (lines 263-277) with:

```typescript
/**
 * Convierte mensajes OpenAI a partes de input para OpenCode.
 * Soporta content como string (texto plano) o como array (texto + imagenes).
 */
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
          if (!part.image_url.url.startsWith("data:image/")) {
            console.warn("[buildParts] Skipping remote image URL (only base64 data URLs supported)");
            continue;
          }
          const mime = part.image_url.url.match(/^data:(image\/[\w.+-]+);/)?.[1] ?? "image/png";
          parts.push({ type: "file", mime, url: part.image_url.url });
        }
      }
    }
  }

  return parts;
}
```

- [ ] **Step 3: Update system prompt extraction in handler**

In the handler (around lines 124-130), replace the system prompt extraction:

```typescript
      // Separar system prompt de los mensajes de usuario
      const systemMessage = body.messages.find(
        (m: OpenAIMessage) => m.role === "system"
      );
      const conversationMessages = body.messages.filter(
        (m: OpenAIMessage) => m.role !== "system"
      );

      // Extraer system prompt como string (soporta content string o array)
      let systemPrompt: string | undefined;
      if (systemMessage) {
        systemPrompt = typeof systemMessage.content === "string"
          ? systemMessage.content
          : systemMessage.content
              .filter((p): p is ContentPart & { type: "text" } => p.type === "text")
              .map((p) => p.text)
              .join("\n");
      }
```

- [ ] **Step 4: Update handler to use `buildParts` and new `chat` signature**

Replace lines 132-153 (the prompt building and chat call) with:

```typescript
      // Construir partes de input (texto + imagenes)
      const parts = buildParts(conversationMessages);

      if (parts.length === 0) {
        res.status(400).json({
          error: {
            message: "No se encontró contenido en los mensajes",
            type: "invalid_request_error",
          },
        });
        return;
      }

      try {
        console.log(
          `[${new Date().toISOString()}] Chat request → model: ${opencodeModel}`
        );

        const { text, model } = await opencode.chat(
          parts,
          opencodeModel,
          systemPrompt
        );
```

Note: everything from the `buildOpenAIResponse` call onwards stays the same.

- [ ] **Step 5: Add 413 error handler**

Before the `return app;` line (line 219), add:

```typescript
  // Error handler para payload demasiado grande (formato OpenAI)
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

- [ ] **Step 6: Commit**

```bash
git add src/server.ts
git commit -m "feat: replace buildPrompt with buildParts for image support"
```

---

### Task 4: Update monitoring ping

**Files:**
- Modify: `src/index.ts:115`

- [ ] **Step 1: Update the health check call**

In `src/index.ts` line 115, change:

```typescript
// Before:
await opencode.chat("ping (proactive check)", resolvedModel);

// After:
await opencode.chat([{ type: "text", text: "ping (proactive check)" }], resolvedModel);
```

- [ ] **Step 2: Verify full project compiles**

Run: `npx tsc --noEmit`

Expected: No errors. All files should compile cleanly.

- [ ] **Step 3: Build the project**

Run: `npm run build`

Expected: Clean build with output in `dist/`.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: update monitoring ping to new chat() signature"
```
