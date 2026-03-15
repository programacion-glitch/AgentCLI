import dotenv from "dotenv";
import path from "path";

// Cargar .env explícitamente por ruta, necesario cuando corre como servicio de Windows
// (el CWD del servicio no es el directorio del proyecto)
dotenv.config({
  path: process.env.DOTENV_CONFIG_PATH ?? path.join(__dirname, "..", ".env"),
});
import { spawn, ChildProcess } from "child_process";
import { v4 as uuidv4 } from "uuid";
import { createServer } from "./server";
import { OpenCodeClient } from "./opencode";
import { EmailNotifier } from "./notifier";

// ──────────────────────────────────────────────
// Configuración desde variables de entorno
// ──────────────────────────────────────────────
const PROXY_PORT = parseInt(process.env.PROXY_PORT ?? "3000", 10);
const OPENCODE_PORT = parseInt(process.env.OPENCODE_PORT ?? "4096", 10);
const OPENCODE_HOST = process.env.OPENCODE_HOST ?? "127.0.0.1";
// Si DEFAULT_MODEL está vacío, se auto-detecta del servidor OpenCode al arrancar
const DEFAULT_MODEL_ENV = process.env.DEFAULT_MODEL?.trim() ?? "";
const API_SECRET = process.env.API_SECRET ?? undefined;

// Contraseña interna para la comunicación con opencode serve.
// Se genera aleatoriamente en cada arranque para mayor seguridad.
const OPENCODE_SERVER_PASSWORD = process.env.OPENCODE_SERVER_PASSWORD ?? uuidv4();

let opencodeProcess: ChildProcess | null = null;

// ──────────────────────────────────────────────
// Función principal
// ──────────────────────────────────────────────
async function main() {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║     OpenAI Local Proxy (via OpenCode)    ║");
  console.log("╚══════════════════════════════════════════╝");
  console.log("");

  const opencode = new OpenCodeClient(OPENCODE_HOST, OPENCODE_PORT, OPENCODE_SERVER_PASSWORD);

  // 1. Intentar conectar con un opencode serve ya existente
  const isAlreadyRunning = await opencode.healthCheck();

  if (isAlreadyRunning) {
    console.log(
      `✓ OpenCode server detectado en ${OPENCODE_HOST}:${OPENCODE_PORT}`
    );
  } else {
    // 2. Si no está corriendo, lo iniciamos nosotros
    console.log(
      `→ OpenCode server no detectado. Iniciando opencode serve...`
    );
    opencodeProcess = startOpencodeServe(OPENCODE_PORT, OPENCODE_HOST, OPENCODE_SERVER_PASSWORD);

    // Esperar a que el servidor esté listo
    const ready = await waitForOpencode(opencode, 30);
    if (!ready) {
      console.error("✗ No se pudo iniciar opencode serve después de 30 segundos.");
      console.error("");
      console.error("  Posibles causas:");
      console.error("  1. OpenCode CLI no está autenticado. Ejecuta: opencode");
      console.error("     Luego: /connect → OpenAI → ChatGPT Plus/Pro");
      console.error("  2. El puerto 4096 está ocupado. Cambia OPENCODE_PORT en .env");
      process.exit(1);
    }
  }

  // 3. Auto-detectar el modelo default si no está configurado
  let resolvedModel = DEFAULT_MODEL_ENV;
  if (!resolvedModel) {
    console.log("→ Auto-detectando modelo default...");
    resolvedModel = await opencode.getDefaultModel();
    console.log(`✓ Modelo detectado: ${resolvedModel}`);
  }

  // 4. Iniciar nuestro servidor proxy
  const notifier = new EmailNotifier();
  const app = createServer(opencode, resolvedModel, notifier, API_SECRET);

  const server = app.listen(PROXY_PORT, "0.0.0.0", () => {
    console.log("");
    console.log(`✓ Proxy corriendo en http://localhost:${PROXY_PORT}`);
    console.log(`  Modelo por defecto: ${resolvedModel}`);
    if (API_SECRET) {
      console.log("  Protección con token: activada");
    }
    console.log("");
    console.log("── Endpoints disponibles ───────────────────");
    console.log(`  GET  http://localhost:${PROXY_PORT}/health`);
    console.log(`  GET  http://localhost:${PROXY_PORT}/v1/models`);
    console.log(`  POST http://localhost:${PROXY_PORT}/v1/chat/completions`);
    console.log("");
    console.log("── Ejemplo de request ──────────────────────");
    console.log(`  curl -X POST http://localhost:${PROXY_PORT}/v1/chat/completions \\`);
    console.log(`    -H "Content-Type: application/json" \\`);
    console.log(`    -d '{"messages":[{"role":"user","content":"Hola!"}]}'`);
    console.log("────────────────────────────────────────────");
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`✗ Puerto ${PROXY_PORT} ya está en uso.`);
      console.error(`  Cambia PROXY_PORT en el archivo .env`);
    } else {
      console.error("✗ Error del servidor:", err.message);
    }
    process.exit(1);
  });
}

// ──────────────────────────────────────────────
// Inicia opencode serve como proceso hijo
// ──────────────────────────────────────────────
function startOpencodeServe(port: number, hostname: string, password: string): ChildProcess {
  // En Windows necesitamos shell:true para encontrar el ejecutable de npm/node
  // Usamos un solo string de comando para evitar el warning de seguridad
  const cmd = `opencode serve --port ${port} --hostname ${hostname}`;
  const child = spawn(cmd, [], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
    shell: true,
    env: {
      ...process.env,
      // Contraseña para HTTP Basic Auth del servidor interno de OpenCode
      OPENCODE_SERVER_PASSWORD: password,
    },
  });

  child.stdout?.on("data", (data: Buffer) => {
    const line = data.toString().trim();
    if (line) console.log(`[opencode] ${line}`);
  });

  child.stderr?.on("data", (data: Buffer) => {
    const line = data.toString().trim();
    if (line) console.error(`[opencode] ${line}`);
  });

  child.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.error(`[opencode] Proceso terminó con código ${code}`);
    }
  });

  return child;
}

// ──────────────────────────────────────────────
// Espera hasta que OpenCode responda a health check
// ──────────────────────────────────────────────
async function waitForOpencode(
  client: OpenCodeClient,
  maxSeconds: number
): Promise<boolean> {
  const start = Date.now();
  let attempt = 0;

  while ((Date.now() - start) / 1000 < maxSeconds) {
    attempt++;
    const ok = await client.healthCheck();
    if (ok) {
      console.log(
        `✓ OpenCode server listo (intento #${attempt})`
      );
      return true;
    }

    if (attempt % 5 === 0) {
      console.log(`  Esperando a opencode serve... (${attempt}s)`);
    }

    await sleep(1000);
  }

  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ──────────────────────────────────────────────
// Limpieza al cerrar el proceso
// ──────────────────────────────────────────────
process.on("SIGINT", () => {
  console.log("\n→ Cerrando servidor...");
  if (opencodeProcess) {
    opencodeProcess.kill();
  }
  process.exit(0);
});

process.on("SIGTERM", () => {
  if (opencodeProcess) {
    opencodeProcess.kill();
  }
  process.exit(0);
});

main().catch((err) => {
  console.error("Error fatal:", err);
  process.exit(1);
});
