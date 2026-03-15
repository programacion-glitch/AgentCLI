const path = require("path");
const { Service } = require("node-windows");

const svc = new Service({
  name: "OpenAI Local Proxy",
  script: path.join(__dirname, "dist", "index.js"),
});

svc.on("uninstall", () => {
  console.log("");
  console.log("✓ Servicio 'OpenAI Local Proxy' desinstalado correctamente.");
  console.log("  El proxy ya no se ejecutará en segundo plano.");
});

svc.on("error", (err) => {
  console.error("✗ Error:", err);
});

console.log("→ Desinstalando servicio de Windows...");
svc.uninstall();
