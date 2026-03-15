const path = require("path");
const { Service } = require("node-windows");

// Ruta al entry point compilado
const scriptPath = path.join(__dirname, "dist", "index.js");

const svc = new Service({
  name: "OpenAI Local Proxy",
  description:
    "Proxy HTTP local compatible con la API de OpenAI, usando OpenCode CLI y ChatGPT Pro.",
  script: scriptPath,

  // Reiniciar automáticamente si el proceso falla
  // Esperar 1 segundo entre cada reinicio, máximo 3 intentos seguidos
  wait: 1,
  grow: 0.5,
  maxRestarts: 3,

  // Variables de entorno del servicio
  // IMPORTANTE: El servicio corre como SYSTEM, que no tiene el PATH ni
  // el perfil de usuario. Pasamos las variables críticas del usuario actual
  // para que opencode sea encontrado y pueda leer auth.json.
  env: [
    { name: "NODE_ENV", value: "production" },
    {
      name: "DOTENV_CONFIG_PATH",
      value: path.join(__dirname, ".env"),
    },
    {
      name: "PATH",
      value: process.env.PATH,
    },
    {
      name: "USERPROFILE",
      value: process.env.USERPROFILE,
    },
    {
      name: "HOME",
      value: process.env.USERPROFILE,
    },
    {
      name: "APPDATA",
      value: process.env.APPDATA,
    },
    {
      name: "LOCALAPPDATA",
      value: process.env.LOCALAPPDATA,
    },
  ],
});

svc.on("install", () => {
  console.log("");
  console.log("✓ Servicio 'OpenAI Local Proxy' instalado correctamente.");
  console.log("  → Iniciando el servicio...");
  svc.start();
});

svc.on("start", () => {
  console.log("✓ Servicio iniciado.");
  console.log("");
  console.log("  El proxy ahora corre en segundo plano y arranca con Windows.");
  console.log("  Endpoint: http://localhost:3000/v1/chat/completions");
  console.log("");
  console.log("  Para ver el servicio: services.msc → 'OpenAI Local Proxy'");
  console.log("  Para detenerlo:       npm run service:stop");
  console.log("  Para desinstalarlo:   npm run service:uninstall");
});

svc.on("alreadyinstalled", () => {
  console.log("⚠ El servicio ya está instalado.");
  console.log("  Si necesitas reinstalarlo, primero ejecuta: npm run service:uninstall");
});

svc.on("error", (err) => {
  console.error("✗ Error:", err);
});

console.log("→ Instalando servicio de Windows...");
console.log(`  Script: ${scriptPath}`);
console.log("");
svc.install();
