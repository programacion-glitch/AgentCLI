/**
 * Gestiona el envío de correos de alerta cuando las credenciales de
 * ChatGPT Pro / OpenCode expiran.
 *
 * Incluye un cooldown para evitar spam: solo envía un correo cada
 * COOLDOWN_MS milisegundos por el mismo tipo de error.
 */
export declare class EmailNotifier {
    private transporter;
    private lastAlertTime;
    private configured;
    private readonly COOLDOWN_MS;
    private readonly smtpHost;
    private readonly smtpPort;
    private readonly smtpUser;
    private readonly smtpPass;
    private readonly alertTo;
    constructor();
    /**
     * Detecta si un error de Axios/HTTP indica credenciales expiradas de ChatGPT/OpenCode.
     */
    isAuthError(error: Error & {
        response?: {
            status?: number;
            data?: unknown;
        };
    }): boolean;
    /**
     * Envía una alerta por correo indicando que las credenciales expiraron.
     * Respeta un cooldown de 1 hora para no enviar correos repetidos.
     */
    sendCredentialExpiredAlert(errorDetails: string): Promise<void>;
}
//# sourceMappingURL=notifier.d.ts.map