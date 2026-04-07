import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";
import { OpenCodeClient } from "./opencode";
import { EmailNotifier } from "./notifier";
import {
  ChatCompletionRequest,
  ChatCompletionResponse,
  OpenAIMessage,
  OpenCodeInputPart,
  ContentPart,
} from "./types";

export function createServer(
  opencode: OpenCodeClient,
  defaultModel: string,
  notifier: EmailNotifier,
  apiSecret?: string
) {
  const app = express();

  app.use(express.json({ limit: "50mb" }));
  app.use(cors());

  // Log del tamaño de cada request entrante (diagnóstico de payloads grandes)
  app.use((req: Request, _res: Response, next: NextFunction): void => {
    const len = req.headers["content-length"];
    if (len) {
      const mb = (parseInt(len, 10) / 1024 / 1024).toFixed(2);
      console.log(
        `[${new Date().toISOString()}] ${req.method} ${req.path} → ${mb} MB`
      );
    }
    next();
  });

  // ──────────────────────────────────────────────
  // Middleware: validación de token opcional
  // ──────────────────────────────────────────────
  app.use((req: Request, res: Response, next: NextFunction): void => {
    if (!apiSecret) return next(); // sin protección configurada

    const authHeader = req.headers.authorization ?? "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;

    if (token !== apiSecret) {
      res.status(401).json({ error: "Unauthorized: invalid token" });
      return;
    }
    next();
  });

  // ──────────────────────────────────────────────
  // GET /health — health check rápido
  // ──────────────────────────────────────────────
  app.get("/health", async (_req: Request, res: Response): Promise<void> => {
    const opencodeOk = await opencode.healthCheck();
    res.json({
      status: "ok",
      proxy: "running",
      opencode: opencodeOk ? "connected" : "unreachable",
      default_model: defaultModel,
    });
  });

  // ──────────────────────────────────────────────
  // GET /v1/models — lista de modelos disponibles
  // Retorna formato OpenAI compatible
  // ──────────────────────────────────────────────
  app.get("/v1/models", (_req: Request, res: Response): void => {
    res.json({
      object: "list",
      data: [
        {
          id: "gpt-4o",
          object: "model",
          created: 1677610602,
          owned_by: "openai",
        },
        {
          id: "gpt-4o-mini",
          object: "model",
          created: 1677610602,
          owned_by: "openai",
        },
      ],
    });
  });

  // ──────────────────────────────────────────────
  // POST /v1/chat/completions — endpoint principal
  // ──────────────────────────────────────────────
  app.post(
    "/v1/chat/completions",
    async (req: Request, res: Response): Promise<void> => {
      const body = req.body as ChatCompletionRequest;

      // Validación básica
      if (!body.messages || !Array.isArray(body.messages)) {
        res.status(400).json({
          error: {
            message: "El campo 'messages' es requerido y debe ser un array",
            type: "invalid_request_error",
          },
        });
        return;
      }

      if (body.messages.length === 0) {
        res.status(400).json({
          error: {
            message: "El array 'messages' no puede estar vacío",
            type: "invalid_request_error",
          },
        });
        return;
      }

      // No soportamos streaming por ahora
      if (body.stream === true) {
        res.status(400).json({
          error: {
            message:
              "Streaming no soportado en esta versión. Usa stream: false o no lo especifiques.",
            type: "invalid_request_error",
          },
        });
        return;
      }

      // Determinar el modelo a usar
      // Mapeamos los modelos de OpenAI al formato de OpenCode: openai/<model>
      const requestedModel = body.model ?? "gpt-4o";
      const opencodeModel = mapToOpencodeModel(requestedModel, defaultModel);

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

        // Si OpenCode devuelve texto vacío, asumimos sesión expirada
        // (no siempre lanza 401 cuando las credenciales caducan).
        if (!text.trim()) {
          const msg =
            "OpenCode devolvió respuesta vacía (probable sesión de ChatGPT Pro expirada)";
          console.error(`[ALERTA] ${msg}`);
          notifier.sendCredentialExpiredAlert(msg).catch(() => {});
          res.status(503).json({
            error: {
              message:
                "Las credenciales de ChatGPT Pro parecen haber expirado (respuesta vacía). Se ha enviado una alerta por correo. Ejecuta 'opencode' → '/connect' para renovarlas.",
              type: "auth_expired",
            },
          });
          return;
        }

        // Construir respuesta compatible con OpenAI
        const response: ChatCompletionResponse = buildOpenAIResponse(
          text,
          model,
          requestedModel
        );

        console.log(
          `[${new Date().toISOString()}] Chat response → ${text.length} chars`
        );

        res.json(response);
      } catch (err: unknown) {
        const error = err as Error & { response?: { status?: number; data?: unknown } };
        console.error(
          "[ERROR] Chat completion failed:",
          error.message,
          error.response?.data
        );

        // Detectar credenciales expiradas y enviar alerta por correo
        if (notifier.isAuthError(error)) {
          console.error(
            "[ALERTA] Credenciales de ChatGPT Pro expiradas o inválidas"
          );
          const errorDetails = `${error.message}\n${JSON.stringify(error.response?.data ?? "", null, 2)}`;
          notifier.sendCredentialExpiredAlert(errorDetails).catch(() => {});

          res.status(503).json({
            error: {
              message:
                "Las credenciales de ChatGPT Pro han expirado. Se ha enviado una alerta por correo. Ejecuta 'opencode' → '/connect' para renovarlas.",
              type: "auth_expired",
            },
          });
          return;
        }

        // Si OpenCode no está disponible, damos un mensaje claro
        if (
          error.message?.includes("ECONNREFUSED") ||
          error.message?.includes("connect")
        ) {
          res.status(503).json({
            error: {
              message:
                "OpenCode server no está disponible. Asegúrate de que 'opencode serve' está corriendo.",
              type: "server_error",
            },
          });
          return;
        }

        res.status(500).json({
          error: {
            message: error.message ?? "Error interno del servidor",
            type: "server_error",
          },
        });
      }
    }
  );

  // Error handler para payload demasiado grande (formato OpenAI)
  app.use((err: Error & { type?: string }, _req: Request, res: Response, _next: NextFunction) => {
    if (err.type === "entity.too.large") {
      res.status(413).json({
        error: {
          message: "Request body too large (max 50MB)",
          type: "invalid_request_error",
        },
      });
      return;
    }
    res.status(500).json({
      error: { message: "Internal server error", type: "server_error" },
    });
  });

  return app;
}

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

/**
 * Mapea el modelo solicitado por el cliente al formato que espera OpenCode.
 * OpenCode usa el formato: "providerID/modelID", ej: "openai/gpt-5.4"
 *
 * Si el cliente solicita modelos como "gpt-4o" (API Key de OpenAI estándar),
 * pero tenemos ChatGPT Pro conectado (que tiene modelos GPT-5), redirigimos
 * al modelo default configurado.
 */
function mapToOpencodeModel(requested: string, defaultModel: string): string {
  // Si ya viene con el prefijo de proveedor (ej: "openai/gpt-5.4"), lo usamos tal cual
  if (requested.includes("/")) return requested;

  // Mapeamos nombres de modelos estándar al modelo default (el más reciente disponible)
  // Esto permite que apps que usan "gpt-4o" funcionen sin cambios
  const legacyModels = [
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-4",
    "gpt-4-turbo",
    "gpt-3.5-turbo",
    "gpt-3.5",
  ];

  if (legacyModels.includes(requested)) {
    // Redirigimos al modelo default de la cuenta (puede ser GPT-5 si tiene Pro)
    return defaultModel;
  }

  // Si el modelo no se reconoce, asumimos que es un modelID de OpenAI
  return `openai/${requested}`;
}

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

/**
 * Construye una respuesta en formato compatible con la API de OpenAI
 */
function buildOpenAIResponse(
  content: string,
  opencodeModel: string,
  requestedModel: string
): ChatCompletionResponse {
  // Extraemos solo el nombre del modelo para el campo "model" de la respuesta
  const modelName = opencodeModel.includes("/")
    ? opencodeModel.split("/")[1]
    : requestedModel;

  // Estimación básica de tokens (1 token ≈ 4 caracteres)
  const promptTokens = Math.ceil(content.length / 4);
  const completionTokens = Math.ceil(content.length / 4);

  return {
    id: `chatcmpl-${uuidv4()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: modelName,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: content,
        },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  };
}
