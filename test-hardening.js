"use strict";

const assert = require("assert");
const http = require("http");
const { spawn } = require("child_process");
const path = require("path");

const HOST = "127.0.0.1";
const PORT = 4723;
const MP_PORT = 4724;
const MARCADOR = "MARCADOR_PRIVADO_DE_PRUEBA";

function escuchar(servidor, puerto) {
  return new Promise((resolve, reject) =>
    servidor.once("error", reject).listen(puerto, HOST, resolve));
}

async function iniciarServidor({ modo, puerto, origenes }) {
  const entorno = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    PORT: String(puerto),
    AVISOS_SILENCIO: "1",
    GEMINI_API_KEY: "clave-sintetica-de-pruebas",
    MP_ACCESS_TOKEN: "APP_USR-sintetico-de-pruebas",
    MP_WEBHOOK_SECRET: "firma-sintetica-de-pruebas",
    MP_API_URL: `http://${HOST}:${MP_PORT}`,
    ALMACEN_RUTA: ""
  };
  if (modo) entorno.NODE_ENV = modo;
  if (origenes) entorno.CORS_ORIGENES = origenes;
  const hijo = spawn(process.execPath, [path.join(__dirname, "server.js")], {
    env: entorno, stdio: ["ignore", "pipe", "pipe"]
  });
  let logs = "";
  hijo.stdout.on("data", b => { logs += b.toString(); });
  hijo.stderr.on("data", b => { logs += b.toString(); });
  const base = `http://${HOST}:${puerto}`;
  for (let n = 0; n < 80; n++) {
    if (hijo.exitCode !== null) throw new Error("El servidor de prueba terminó antes de arrancar");
    try {
      const r = await fetch(`${base}/health`);
      if (r.ok) return { hijo, base, logs: () => logs };
    } catch { /* Esperando el puerto. */ }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  hijo.kill();
  throw new Error("El servidor de prueba no arrancó");
}

async function pedir(base, ruta, opciones = {}) {
  const respuesta = await fetch(base + ruta, opciones);
  const texto = await respuesta.text();
  return { status: respuesta.status, cuerpo: JSON.parse(texto), headers: respuesta.headers };
}

async function main() {
  const mp = http.createServer((req, res) => {
    req.resume();
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: MARCADOR, payload: { direccion: MARCADOR } }));
  });
  await escuchar(mp, MP_PORT);
  let activo;
  let pruebas = 0;
  try {
    activo = await iniciarServidor({ modo: "production", puerto: PORT });
    const { base } = activo;
    const salud = await pedir(base, "/health");
    assert.strictEqual(salud.status, 200);
    assert.deepStrictEqual(salud.cuerpo, { ok: true });
    assert.strictEqual(salud.headers.get("x-powered-by"), null);
    assert.strictEqual(salud.headers.get("cache-control"), "no-store");
    assert.deepStrictEqual((await pedir(base, "/")).cuerpo, { ok: true });
    pruebas++;

    for (const origen of ["https://valquiriainc.com", "https://www.valquiriainc.com",
      "https://rodrigo-corrales1429.github.io"]) {
      const r = await pedir(base, "/health", { headers: { Origin: origen } });
      assert.strictEqual(r.headers.get("access-control-allow-origin"), origen);
      assert.strictEqual(r.headers.get("vary"), "Origin");
    }
    const sinOrigen = await pedir(base, "/health");
    assert.strictEqual(sinOrigen.status, 200);
    assert.strictEqual(sinOrigen.headers.get("access-control-allow-origin"), null);
    pruebas++;

    const preflight = await fetch(base + "/api/pago", {
      method: "OPTIONS",
      headers: { Origin: "https://valquiriainc.com",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type" }
    });
    assert.strictEqual(preflight.status, 204);
    assert.strictEqual(preflight.headers.get("access-control-allow-origin"), "https://valquiriainc.com");
    assert.strictEqual(preflight.headers.get("x-content-type-options"), "nosniff");
    pruebas++;

    for (const origen of ["https://fuera.example", "http://localhost:5500", "*"]) {
      const r = await pedir(base, "/health", { headers: { Origin: origen } });
      assert.strictEqual(r.status, 403);
      assert.strictEqual(r.headers.get("access-control-allow-origin"), null);
      assert.strictEqual(r.headers.get("x-powered-by"), null);
      assert.strictEqual(r.headers.get("x-content-type-options"), "nosniff");
      assert.deepStrictEqual(r.cuerpo, { error: "Origen no permitido." });
    }
    pruebas++;

    const invalido = await pedir(base, "/api/pago", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{"
    });
    assert.strictEqual(invalido.status, 400);
    assert.strictEqual(invalido.headers.get("x-powered-by"), null);
    assert.strictEqual(invalido.headers.get("x-frame-options"), "DENY");
    pruebas++;

    const pago = await pedir(base, "/api/pago", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ sku: "ValEnd", cantidad: 1 }],
        comprador: {
          nombre: "Nombre Privado", whatsapp: "7717959131", email: "privado@ejemplo.mx",
          cp: "03330", direccion: "Calle Privada 120, Centro, Ciudad de México"
        }
      })
    });
    assert.strictEqual(pago.status, 502);
    const firma = await pedir(base, "/api/pago/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-request-id": MARCADOR + "@correo.mx" },
      body: JSON.stringify({ type: "payment", data: { id: MARCADOR + "@correo.mx" } })
    });
    assert.strictEqual(firma.status, 401);
    const logs = activo.logs();
    for (const privado of [MARCADOR, "Calle Privada", "privado@ejemplo.mx", "7717959131"]) {
      assert.ok(!logs.includes(privado), "El log incluyó datos privados sintéticos");
    }
    assert.ok(/\[\/api\/pago\] req_id=[a-f0-9-]+ folio=VQ-[A-Z0-9-]+ fallo mp_http=400/.test(logs));
    assert.ok(logs.includes("[webhook] firma="));
    pruebas++;

    activo.hijo.kill();
    activo = await iniciarServidor({
      modo: "production", puerto: PORT + 2, origenes: "https://staging.example"
    });
    const staging = await pedir(activo.base, "/health", { headers: { Origin: "https://staging.example" } });
    assert.strictEqual(staging.headers.get("access-control-allow-origin"), "https://staging.example");
    assert.strictEqual((await pedir(activo.base, "/health", {
      headers: { Origin: "https://valquiriainc.com" }
    })).headers.get("access-control-allow-origin"), "https://valquiriainc.com");
    pruebas++;

    activo.hijo.kill();
    activo = await iniciarServidor({ modo: "development", puerto: PORT + 3 });
    const local = await pedir(activo.base, "/health", { headers: { Origin: "http://localhost:5500" } });
    assert.strictEqual(local.headers.get("access-control-allow-origin"), "http://localhost:5500");
    pruebas++;

    activo.hijo.kill();
    activo = await iniciarServidor({ puerto: PORT + 4 });
    const localSinModo = await pedir(activo.base, "/health", { headers: { Origin: "http://localhost:5500" } });
    assert.strictEqual(localSinModo.status, 403);
    pruebas++;

    activo.hijo.kill();
    activo = null;
    for (const origenes of ["*", "https://localhost:5500"]) {
      await assert.rejects(
        iniciarServidor({ modo: "production", puerto: PORT + 5, origenes }),
        /servidor de prueba/i
      );
    }
    pruebas++;

    /* Las tools y avisos conservan el dato para la operación, pero no en stdout. */
    process.env.NODE_ENV = "test";
    process.env.AVISOS_SILENCIO = "1";
    delete process.env.LEADS_WEBHOOK_URL;
    const registro = [];
    const logOriginal = console.log;
    const warnOriginal = console.warn;
    try {
      console.log = (...args) => registro.push(args.join(" "));
      console.warn = (...args) => registro.push(args.join(" "));
      const { ejecutarHerramienta } = require("./gemini-tools.js");
      const lead = await ejecutarHerramienta({ name: "registrar_interes", args: {
        division: "ia", resumen: `Proyecto con ${MARCADOR} y domicilio privado`,
        nombre: "Nombre Privado", contacto: "privado@ejemplo.mx"
      } });
      assert.strictEqual(lead.ok, true);
      const avisos = require("./notificaciones.js");
      avisos.avisar({ tipo: "config", detalle: MARCADOR });
    } finally {
      console.log = logOriginal;
      console.warn = warnOriginal;
    }
    assert.ok(registro.some(linea => linea.includes("[LEAD] id=")));
    assert.ok(registro.some(linea => linea.includes("[AVISO-SILENCIADO]")));
    assert.ok(!registro.join("\n").includes(MARCADOR));
    assert.ok(!registro.join("\n").includes("privado@ejemplo.mx"));
    pruebas++;

    /* Una respuesta de proveedor puede repetir el token incluido en su URL.
       Simular el fallo sin conectar con el servicio real. */
    process.env.NODE_ENV = "production";
    process.env.AVISOS_SILENCIO = "0";
    process.env.TELEGRAM_BOT_TOKEN = "token-sintetico";
    process.env.TELEGRAM_CHAT_ID = "chat-sintetico";
    const fetchOriginal = global.fetch;
    const errorOriginal = console.error;
    const salidaOriginal = console.log;
    const errores = [];
    try {
      global.fetch = async () => ({ ok: false, status: 400,
        text: async () => MARCADOR });
      console.error = (...args) => errores.push(args.join(" "));
      console.log = (...args) => errores.push(args.join(" "));
      delete require.cache[require.resolve("./notificaciones.js")];
      const avisosProd = require("./notificaciones.js");
      avisosProd.avisar({ tipo: "config", pago_id: MARCADOR + "@correo.mx", detalle: MARCADOR });
      await new Promise(resolve => setTimeout(resolve, 20));
    } finally {
      global.fetch = fetchOriginal;
      console.error = errorOriginal;
      console.log = salidaOriginal;
    }
    assert.ok(errores.some(linea => linea.includes("Telegram respondió HTTP 400")));
    assert.ok(!errores.join("\n").includes(MARCADOR));
    assert.ok(!errores.join("\n").includes("token-sintetico"));
    pruebas++;

    console.log(`✓ ${pruebas}/${pruebas} pruebas de hardening pasaron.`);
  } finally {
    if (activo) activo.hijo.kill();
    await new Promise(resolve => mp.close(resolve));
  }
}

main().catch(error => {
  console.error("Pruebas de hardening fallaron:", error.message);
  process.exitCode = 1;
});
