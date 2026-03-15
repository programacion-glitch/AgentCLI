"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenCodeClient = void 0;
const axios_1 = __importDefault(require("axios"));
class OpenCodeClient {
    /**
     * @param host - hostname de opencode serve
     * @param port - puerto de opencode serve
     * @param password - contraseña de HTTP Basic Auth del servidor (OPENCODE_SERVER_PASSWORD)
     */
    constructor(host, port, password) {
        this.baseURL = `http://${host}:${port}`;
        this.http = axios_1.default.create({
            baseURL: this.baseURL,
            timeout: 120000, // 2 min - las respuestas de IA pueden tardar
            headers: {
                "Content-Type": "application/json",
            },
            // OpenCode siempre requiere HTTP Basic Auth en su servidor interno
            auth: password
                ? { username: "opencode", password }
                : undefined,
        });
    }
    /**
     * Verifica que el servidor de OpenCode está corriendo y saludable
     */
    async healthCheck() {
        try {
            const res = await this.http.get("/global/health", { timeout: 5000 });
            // Aceptamos cualquier respuesta 200 como señal de que el servidor está activo
            return res.status === 200;
        }
        catch {
            return false;
        }
    }
    /**
     * Crea una nueva sesión en OpenCode
     */
    async createSession(title) {
        const res = await this.http.post("/session", {
            title: title ?? `proxy-${Date.now()}`,
        });
        return res.data;
    }
    /**
     * Elimina una sesión (limpieza después de cada request)
     */
    async deleteSession(sessionId) {
        try {
            await this.http.delete(`/session/${sessionId}`);
        }
        catch {
            // Ignoramos errores de limpieza, no son críticos
        }
    }
    /**
     * Envía un mensaje a una sesión y espera la respuesta completa.
     * @param model - Formato "providerID/modelID", ej: "openai/gpt-5.4"
     */
    async sendMessage(sessionId, prompt, model, systemPrompt) {
        // Parseamos el modelo que viene en formato "providerID/modelID"
        const [providerID, modelID] = model.includes("/")
            ? model.split("/", 2)
            : ["openai", model];
        const body = {
            parts: [
                {
                    type: "text",
                    text: prompt,
                },
            ],
            // OpenCode espera el modelo como objeto con providerID y modelID
            model: {
                providerID,
                modelID,
            },
        };
        // Si hay un system prompt, lo pasamos directamente
        if (systemPrompt) {
            body.system = systemPrompt;
        }
        const res = await this.http.post(`/session/${sessionId}/message`, body);
        return res.data;
    }
    /**
     * Obtiene el modelo default configurado en OpenCode (el primero de los conectados)
     */
    async getDefaultModel() {
        try {
            const res = await this.http.get("/config/providers", { timeout: 5000 });
            const data = res.data;
            const defaults = data.default ?? {};
            // Buscamos el default de OpenAI primero, luego anthropic
            if (defaults["openai"])
                return `openai/${defaults["openai"]}`;
            if (defaults["anthropic"])
                return `anthropic/${defaults["anthropic"]}`;
            // Tomamos el primero disponible
            const first = Object.entries(defaults)[0];
            if (first)
                return `${first[0]}/${first[1]}`;
        }
        catch {
            // Si falla, usamos el fallback
        }
        return "openai/gpt-5.4";
    }
    /**
     * Extrae el texto plano de la respuesta de OpenCode
     */
    extractTextFromResponse(response) {
        if (!response?.parts || !Array.isArray(response.parts)) {
            return "";
        }
        return response.parts
            .filter((part) => part.type === "text" && part.text)
            .map((part) => part.text ?? "")
            .join("")
            .trim();
    }
    /**
     * Operación completa: crea sesión → envía mensaje → devuelve texto → limpia sesión
     */
    async chat(prompt, model, systemPrompt) {
        const session = await this.createSession();
        try {
            const response = await this.sendMessage(session.id, prompt, model, systemPrompt);
            const text = this.extractTextFromResponse(response);
            return { text, model };
        }
        finally {
            // Siempre limpiamos la sesión, aunque haya error
            await this.deleteSession(session.id);
        }
    }
}
exports.OpenCodeClient = OpenCodeClient;
//# sourceMappingURL=opencode.js.map