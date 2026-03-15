"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createServer = createServer;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const uuid_1 = require("uuid");
function createServer(opencode, defaultModel, notifier, apiSecret) {
    const app = (0, express_1.default)();
    app.use(express_1.default.json({ limit: "10mb" }));
    app.use((0, cors_1.default)());
    // ──────────────────────────────────────────────
    // Middleware: validación de token opcional
    // ──────────────────────────────────────────────
    app.use((req, res, next) => {
        if (!apiSecret)
            return next(); // sin protección configurada
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
    app.get("/health", async (_req, res) => {
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
    app.get("/v1/models", (_req, res) => {
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
    app.post("/v1/chat/completions", async (req, res) => {
        const body = req.body;
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
                    message: "Streaming no soportado en esta versión. Usa stream: false o no lo especifiques.",
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
        const systemMessage = body.messages.find((m) => m.role === "system");
        const conversationMessages = body.messages.filter((m) => m.role !== "system");
        // Construir el prompt combinando todos los mensajes de conversación
        const prompt = buildPrompt(conversationMessages);
        if (!prompt) {
            res.status(400).json({
                error: {
                    message: "No se encontró contenido en los mensajes",
                    type: "invalid_request_error",
                },
            });
            return;
        }
        try {
            console.log(`[${new Date().toISOString()}] Chat request → model: ${opencodeModel}`);
            const { text, model } = await opencode.chat(prompt, opencodeModel, systemMessage?.content);
            // Construir respuesta compatible con OpenAI
            const response = buildOpenAIResponse(text, model, requestedModel);
            console.log(`[${new Date().toISOString()}] Chat response → ${text.length} chars`);
            res.json(response);
        }
        catch (err) {
            const error = err;
            console.error("[ERROR] Chat completion failed:", error.message, error.response?.data);
            // Detectar credenciales expiradas y enviar alerta por correo
            if (notifier.isAuthError(error)) {
                console.error("[ALERTA] Credenciales de ChatGPT Pro expiradas o inválidas");
                const errorDetails = `${error.message}\n${JSON.stringify(error.response?.data ?? "", null, 2)}`;
                notifier.sendCredentialExpiredAlert(errorDetails).catch(() => { });
                res.status(503).json({
                    error: {
                        message: "Las credenciales de ChatGPT Pro han expirado. Se ha enviado una alerta por correo. Ejecuta 'opencode' → '/connect' para renovarlas.",
                        type: "auth_expired",
                    },
                });
                return;
            }
            // Si OpenCode no está disponible, damos un mensaje claro
            if (error.message?.includes("ECONNREFUSED") ||
                error.message?.includes("connect")) {
                res.status(503).json({
                    error: {
                        message: "OpenCode server no está disponible. Asegúrate de que 'opencode serve' está corriendo.",
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
function mapToOpencodeModel(requested, defaultModel) {
    // Si ya viene con el prefijo de proveedor (ej: "openai/gpt-5.4"), lo usamos tal cual
    if (requested.includes("/"))
        return requested;
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
 * Construye un prompt unificado a partir de los mensajes de la conversación.
 * Si hay una sola mensaje de usuario, lo devuelve tal cual.
 * Si hay múltiples (conversación), los formatea con roles.
 */
function buildPrompt(messages) {
    if (messages.length === 0)
        return "";
    if (messages.length === 1 && messages[0].role === "user") {
        return messages[0].content;
    }
    // Conversación con múltiples turnos
    return messages
        .map((m) => {
        const label = m.role === "assistant" ? "Assistant" : "User";
        return `${label}: ${m.content}`;
    })
        .join("\n\n");
}
/**
 * Construye una respuesta en formato compatible con la API de OpenAI
 */
function buildOpenAIResponse(content, opencodeModel, requestedModel) {
    // Extraemos solo el nombre del modelo para el campo "model" de la respuesta
    const modelName = opencodeModel.includes("/")
        ? opencodeModel.split("/")[1]
        : requestedModel;
    // Estimación básica de tokens (1 token ≈ 4 caracteres)
    const promptTokens = Math.ceil(content.length / 4);
    const completionTokens = Math.ceil(content.length / 4);
    return {
        id: `chatcmpl-${(0, uuid_1.v4)()}`,
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
//# sourceMappingURL=server.js.map