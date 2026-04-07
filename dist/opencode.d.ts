import { OpenCodeSession, OpenCodeMessageResponse, OpenCodeInputPart } from "./types";
export declare class OpenCodeClient {
    private http;
    private baseURL;
    /**
     * @param host - hostname de opencode serve
     * @param port - puerto de opencode serve
     * @param password - contraseña de HTTP Basic Auth del servidor (OPENCODE_SERVER_PASSWORD)
     */
    constructor(host: string, port: number, password?: string);
    /**
     * Verifica que el servidor de OpenCode está corriendo y saludable
     */
    healthCheck(): Promise<boolean>;
    /**
     * Crea una nueva sesión en OpenCode
     */
    createSession(title?: string): Promise<OpenCodeSession>;
    /**
     * Elimina una sesión (limpieza después de cada request)
     */
    deleteSession(sessionId: string): Promise<void>;
    /**
     * Envía un mensaje a una sesión y espera la respuesta completa.
     * @param model - Formato "providerID/modelID", ej: "openai/gpt-5.4"
     */
    sendMessage(sessionId: string, parts: OpenCodeInputPart[], model: string, systemPrompt?: string): Promise<OpenCodeMessageResponse>;
    /**
     * Obtiene el modelo default configurado en OpenCode (el primero de los conectados)
     */
    getDefaultModel(): Promise<string>;
    /**
     * Extrae el texto plano de la respuesta de OpenCode
     */
    extractTextFromResponse(response: OpenCodeMessageResponse): string;
    /**
     * Operación completa: crea sesión → envía mensaje → devuelve texto → limpia sesión
     */
    chat(parts: OpenCodeInputPart[], model: string, systemPrompt?: string): Promise<{
        text: string;
        model: string;
    }>;
}
//# sourceMappingURL=opencode.d.ts.map