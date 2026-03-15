import nodemailer from "nodemailer";

/**
 * Gestiona el envío de correos de alerta cuando las credenciales de
 * ChatGPT Pro / OpenCode expiran.
 *
 * Incluye un cooldown para evitar spam: solo envía un correo cada
 * COOLDOWN_MS milisegundos por el mismo tipo de error.
 */
export class EmailNotifier {
  private transporter: nodemailer.Transporter | null = null;
  private lastAlertTime = 0;
  private configured = false;

  // Cooldown de 1 hora entre alertas
  private readonly COOLDOWN_MS = 60 * 60 * 1000;

  private readonly smtpHost: string;
  private readonly smtpPort: number;
  private readonly smtpUser: string;
  private readonly smtpPass: string;
  private readonly alertTo: string;

  constructor() {
    this.smtpHost = process.env.SMTP_HOST ?? "";
    this.smtpPort = parseInt(process.env.SMTP_PORT ?? "587", 10);
    this.smtpUser = process.env.SMTP_USER ?? "";
    this.smtpPass = process.env.SMTP_PASS ?? "";
    this.alertTo = process.env.ALERT_EMAIL_TO ?? this.smtpUser;

    if (this.smtpHost && this.smtpUser && this.smtpPass) {
      this.transporter = nodemailer.createTransport({
        host: this.smtpHost,
        port: this.smtpPort,
        secure: this.smtpPort === 465,
        auth: {
          user: this.smtpUser,
          pass: this.smtpPass,
        },
      });
      this.configured = true;
      console.log(`✓ Notificaciones por correo configuradas → ${this.alertTo}`);
    } else {
      console.log(
        "⚠ Notificaciones por correo NO configuradas (faltan SMTP_HOST, SMTP_USER o SMTP_PASS en .env)"
      );
    }
  }

  /**
   * Detecta si un error de Axios/HTTP indica credenciales expiradas de ChatGPT/OpenCode.
   */
  isAuthError(error: Error & { response?: { status?: number; data?: unknown } }): boolean {
    const status = error.response?.status;
    const message = error.message?.toLowerCase() ?? "";
    const dataStr =
      typeof error.response?.data === "string"
        ? error.response.data.toLowerCase()
        : JSON.stringify(error.response?.data ?? "").toLowerCase();

    // HTTP 401 o 403 desde OpenCode
    if (status === 401 || status === 403) return true;

    // Palabras clave de error de autenticación
    const authKeywords = [
      "unauthorized",
      "auth expired",
      "session expired",
      "token expired",
      "authentication failed",
      "not authenticated",
      "invalid credentials",
      "login required",
      "re-authenticate",
      "oauth",
    ];

    return authKeywords.some((kw) => message.includes(kw) || dataStr.includes(kw));
  }

  /**
   * Envía una alerta por correo indicando que las credenciales expiraron.
   * Respeta un cooldown de 1 hora para no enviar correos repetidos.
   */
  async sendCredentialExpiredAlert(errorDetails: string): Promise<void> {
    if (!this.configured || !this.transporter) {
      console.error(
        "[ALERTA] Credenciales de ChatGPT expiradas, pero el correo no está configurado."
      );
      console.error("[ALERTA] Configura SMTP_HOST, SMTP_USER y SMTP_PASS en .env");
      return;
    }

    // Cooldown: evitar spam
    const now = Date.now();
    if (now - this.lastAlertTime < this.COOLDOWN_MS) {
      console.log(
        "[ALERTA] Credenciales expiradas (correo ya enviado recientemente, cooldown activo)"
      );
      return;
    }

    try {
      const timestamp = new Date().toLocaleString("es-CO", {
        timeZone: "America/Bogota",
      });

      await this.transporter.sendMail({
        from: `"OpenAI Local Proxy" <${this.smtpUser}>`,
        to: this.alertTo,
        subject: "⚠️ ALERTA: Credenciales de ChatGPT Pro expiradas",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: #dc3545; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
              <h2 style="margin: 0;">⚠️ Credenciales Expiradas</h2>
            </div>
            <div style="background: #f8f9fa; padding: 20px; border: 1px solid #dee2e6; border-radius: 0 0 8px 8px;">
              <p>Las credenciales de <strong>ChatGPT Pro / OpenCode</strong> han expirado. 
                 El proxy no puede procesar peticiones hasta que se renueven.</p>
              
              <h3 style="color: #dc3545;">Detalles del error:</h3>
              <pre style="background: #fff; padding: 12px; border-radius: 4px; border: 1px solid #dee2e6; overflow-x: auto; font-size: 13px;">${errorDetails}</pre>
              
              <h3 style="color: #28a745;">¿Cómo renovar?</h3>
              <ol>
                <li>Abre una terminal en el servidor</li>
                <li>Ejecuta: <code>opencode</code></li>
                <li>Dentro del TUI escribe: <code>/connect</code></li>
                <li>Selecciona <strong>OpenAI → ChatGPT Plus/Pro</strong></li>
                <li>Completa el login en el navegador</li>
                <li>Reinicia el servicio: <code>npm run service:install</code></li>
              </ol>
              
              <p style="color: #6c757d; font-size: 12px; margin-top: 20px;">
                Fecha de detección: ${timestamp}<br>
                Servidor: OpenAI Local Proxy (localhost:3000)
              </p>
            </div>
          </div>
        `,
      });

      this.lastAlertTime = now;
      console.log(`✓ Correo de alerta enviado a ${this.alertTo}`);
    } catch (emailErr) {
      console.error("[ERROR] No se pudo enviar el correo de alerta:", emailErr);
    }
  }
}
