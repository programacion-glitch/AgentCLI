const path = require("path");
const { Service } = require("node-windows");

const svc = new Service({
  name: "OpenAI Local Proxy",
  script: path.join(__dirname, "dist", "index.js"),
});

svc.on("stop", () => {
  console.log("✓ Servicio detenido.");
});

console.log("→ Deteniendo servicio...");
svc.stop();
