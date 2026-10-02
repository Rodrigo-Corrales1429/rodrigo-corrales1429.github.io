"use strict";

// Infraestructura exclusivamente del runner: no la importa el sitio/backend.
const http = require("node:http");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs/promises");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const express = require("express");

const ROOT = path.resolve(__dirname, "..");
// Origen YA autorizado por el CORS de desarrollo; no se modifica su allowlist.
const SITE_PORT = 5174;

const scripts = new Map([
  ["vacía mi carrito", [{ accion: "vaciar" }]],
  ["agrégame 2 Endo", [{ accion: "agregar", items: [{ producto: "endo", cantidad: 2 }] }]],
  ["quita los Endo", [{ accion: "quitar", items: [{ producto: "endo" }] }]],
  ["reemplaza mi carrito por un Nissin", [{ accion: "reemplazar", items: [{ producto: "nissin", cantidad: 1 }] }]],
  ["quita los Endo y agrégame un Nissin", [
    { accion: "quitar", items: [{ producto: "endo" }] },
    { accion: "agregar", items: [{ producto: "nissin", cantidad: 1 }] }
  ]]
]);

function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
  });
}

async function close(server) {
  if (!server?.listening) return;
  const closed = new Promise(resolve => server.close(resolve));
  server.closeAllConnections();
  await closed;
}

async function startHarness() {
  const providerCalls = [];
  const provider = http.createServer(async (req, res) => {
    try {
      if (req.method !== "POST" || !req.url.includes(":generateContent")) {
        throw new Error("Ruta inesperada al proveedor simulado");
      }
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      const lastUser = [...body.contents].reverse().find(c =>
        c.role === "user" && c.parts.some(p => p.text));
      const prompt = lastUser?.parts.filter(p => p.text).map(p => p.text).join("");
      const args = scripts.get(prompt);
      if (!args) throw new Error(`No hay guion E2E para: ${prompt}`);
      const functionResponses = body.contents.at(-1).parts
        .filter(p => p.functionResponse).map(p => p.functionResponse);
      providerCalls.push({ prompt, functionResponses });
      // Redacción vacía intencional: el fallback/verifier REAL compone desde
      // los resultados de la herramienta REAL, no desde un estado del mock.
      const parts = functionResponses.length ? [] : args.map(a => ({
        functionCall: { name: "calcular_cotizacion", args: a }
      }));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ candidates: [{
        content: { role: "model", parts }, finishReason: "STOP"
      }] }));
    } catch (error) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: error.message } }));
    }
  });

  const site = express();
  // No servir la raíz completa: .env, documentación y backend no son assets.
  site.get("/", (req, res) => res.sendFile(path.join(ROOT, "index.html")));
  site.use("/assets", express.static(path.join(ROOT, "assets")));
  site.use("/catalogo", express.static(path.join(ROOT, "catalogo")));
  site.use("/pack", express.static(path.join(ROOT, "pack")));
  const staticServer = http.createServer(site);
  let backend;
  let temporaryCwd;
  let logs = "";

  const stop = async () => {
    if (backend && backend.exitCode === null && backend.signalCode === null) {
      const exited = once(backend, "exit");
      backend.kill("SIGTERM");
      const force = setTimeout(() => backend.kill("SIGKILL"), 3_000);
      try { await exited; } finally { clearTimeout(force); }
    }
    await Promise.all([close(provider), close(staticServer)]);
    // Sólo el directorio temporal exacto creado por este fixture.
    if (temporaryCwd) await fs.rm(temporaryCwd, { recursive: true, force: true });
  };

  try {
    const providerUrl = await listen(provider);
    const siteUrl = await listen(staticServer, SITE_PORT);
    const reservation = http.createServer();
    const backendUrl = await listen(reservation);
    await close(reservation);
    temporaryCwd = await fs.mkdtemp(path.join(os.tmpdir(), "vq-cart-e2e-"));
    backend = spawn(process.execPath, [path.join(ROOT, "server.js")], {
      // dotenv no puede cargar el .env del repositorio desde este cwd vacío.
      cwd: temporaryCwd,
      // No heredar credenciales, DB, webhooks, almacenamiento ni proveedores.
      env: {
        NODE_ENV: "development",
        PORT: new URL(backendUrl).port,
        GEMINI_API_KEY: "e2e-placeholder-not-a-credential",
        GEMINI_BASE_URL: providerUrl,
        GEMINI_TIMEOUT_MS: "5000",
        AVISOS_SILENCIO: "1",
        ENVIOS_PROVEEDOR: "tabla"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    for (const stream of [backend.stdout, backend.stderr]) {
      stream.on("data", chunk => { logs += chunk.toString(); });
    }
    let ready = false;
    for (let attempt = 0; attempt < 100 && !ready; attempt++) {
      if (backend.exitCode !== null) throw new Error(`Backend E2E terminó: ${logs}`);
      try {
        const response = await fetch(`${backendUrl}/health`, { signal: AbortSignal.timeout(500) });
        ready = response.ok;
      } catch { /* Aún arranca el proceso. */ }
      if (!ready) await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (!ready) throw new Error(`Backend E2E no arrancó: ${logs}`);
    return { siteUrl, backendUrl, providerCalls, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

module.exports = { startHarness };
