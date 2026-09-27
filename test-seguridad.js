/**
 * ============================================================================
 *  PRUEBAS DE SEGURIDAD — LA LISTA DE 20 PUNTOS, ATACADA DE VERDAD
 * ============================================================================
 *  Cada bloque corresponde a un punto de la lista «valida estas cosas antes de
 *  lanzar tu web». No se comprueba que el código PAREZCA seguro: se levanta el
 *  servidor real —con un Mercado Pago falso y un Gemini falso, para no cobrar
 *  ni gastar créditos— y se le hace lo que haría alguien intentando romperlo.
 *
 *  Los puntos que no dependen del código (doble factor en tus cuentas, por
 *  ejemplo) NO se fingen aquí: se dicen en AUDITORIA.md como tareas tuyas.
 *
 *  Correr con:  node --no-warnings test-seguridad.js
 * ============================================================================
 */

"use strict";

const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn, execSync } = require("child_process");

const RAIZ = __dirname;
const leer = f => fs.readFileSync(path.join(RAIZ, f), "utf8");

const PUERTO_FALSO = 4731;         // Mercado Pago + Gemini falsos
const PUERTO_APP = 4732;
const SECRETO_WEBHOOK = "secreto-webhook-de-pruebas";
const TOKEN = "token-de-panel-de-pruebas-con-longitud-de-sobra-0123456789";

let pasadas = 0;
const fallos = [];
async function prueba(nombre, fn) {
  try { await fn(); console.log(`  ✓ ${nombre}`); pasadas++; }
  catch (e) { console.log(`  ✗ ${nombre}\n      ${e.message}`); fallos.push(nombre); }
}
function afirmar(c, m) { if (!c) throw new Error(m); }
const seccion = t => console.log(`\n[${t}]`);

// ---------------------------------------------------------------------------
//  Mercado Pago y Gemini falsos
// ---------------------------------------------------------------------------
const falso = { pagos: new Map(), rutasMP: [], llamadasGemini: 0 };

const servidorFalso = http.createServer((req, res) => {
  let cuerpo = "";
  req.on("data", c => (cuerpo += c));
  req.on("end", () => {
    const json = (st, d) => { res.writeHead(st, { "Content-Type": "application/json" }); res.end(JSON.stringify(d)); };
    if (req.url.includes(":generateContent")) {
      falso.llamadasGemini++;
      return json(200, { candidates: [{ content: { role: "model",
        parts: [{ text: "Hola, soy el Asesor. ¿Qué necesitas?" }] }, finishReason: "STOP" }] });
    }
    if (req.method === "POST" && req.url.startsWith("/checkout/preferences")) {
      return json(200, { id: "pref-" + Date.now(),
        init_point: "https://www.mercadopago.com.mx/checkout/v1/redirect?pref_id=x" });
    }
    if (req.url.startsWith("/v1/payments/")) {
      falso.rutasMP.push(req.url);
      const id = decodeURIComponent(req.url.slice("/v1/payments/".length).split("?")[0]);
      const pago = falso.pagos.get(id);
      return pago ? json(200, pago) : json(404, { message: "no existe" });
    }
    json(404, {});
  });
});

// ---------------------------------------------------------------------------
//  Levantar el servidor real
// ---------------------------------------------------------------------------
function arrancar(extra = {}, puerto = PUERTO_APP) {
  const logs = [];
  const hijo = spawn(process.execPath, [path.join(RAIZ, "server.js")], {
    env: {
      ...process.env,
      PORT: String(puerto),
      NODE_ENV: "test",
      AVISOS_SILENCIO: "1",
      GEMINI_API_KEY: "clave-falsa-de-pruebas",
      GEMINI_BASE_URL: `http://127.0.0.1:${PUERTO_FALSO}`,
      MP_ACCESS_TOKEN: "APP_USR-de-mentira",
      MP_WEBHOOK_SECRET: SECRETO_WEBHOOK,
      MP_API_URL: `http://127.0.0.1:${PUERTO_FALSO}`,
      LEADS_TOKEN: TOKEN,
      SITIO_URL: "https://valquiriainc.com",
      BACKEND_URL: `http://127.0.0.1:${puerto}`,
      ALMACEN_RUTA: "",
      RATE_LIMIT_PULSO_POR_MINUTO: "500",
      GEMINI_TOPE_DIARIO: "4",
      ...extra
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  hijo.stdout.on("data", d => logs.push(...String(d).split("\n")));
  hijo.stderr.on("data", d => logs.push(...String(d).split("\n")));
  const base = `http://127.0.0.1:${puerto}`;
  const listo = (async () => {
    for (let i = 0; i < 80; i++) {
      await new Promise(r => setTimeout(r, 100));
      try { if ((await fetch(base + "/health")).ok) return true; } catch { /* aún no */ }
    }
    return false;
  })();
  const parar = senal => new Promise(r => { hijo.once("exit", r); hijo.kill(senal || "SIGKILL"); });
  return { hijo, logs, base, listo, parar };
}

/* Cada «visitante» es una IP real distinta, tal como la entrega Cloudflare. */
const visitante = n => ({ "CF-Connecting-IP": `198.51.100.${n}` });

async function pedir(base, ruta, { metodo = "GET", cabeceras = {}, cuerpo } = {}) {
  const r = await fetch(base + ruta, {
    method: metodo,
    headers: { ...(cuerpo !== undefined ? { "Content-Type": "application/json" } : {}), ...cabeceras },
    body: cuerpo === undefined ? undefined : (typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo))
  });
  const texto = await r.text();
  let json = null; try { json = JSON.parse(texto); } catch { /* no JSON */ }
  return { status: r.status, json, texto, headers: r.headers };
}

function firmar(dataId, requestId, ts = Math.floor(Date.now() / 1000), secreto = SECRETO_WEBHOOK) {
  const manifiesto = `id:${String(dataId).toLowerCase()};request-id:${requestId};ts:${ts};`;
  return `ts=${ts},v1=${crypto.createHmac("sha256", secreto).update(manifiesto).digest("hex")}`;
}

async function webhook(base, pagoId, { firma = true, ts, secreto } = {}) {
  const rid = "req-" + crypto.randomBytes(4).toString("hex");
  const cab = { "x-request-id": rid };
  if (firma) cab["x-signature"] = firmar(pagoId, rid, ts, secreto);
  return pedir(base, `/api/pago/webhook?type=payment&data.id=${encodeURIComponent(pagoId)}`,
    { metodo: "POST", cabeceras: cab, cuerpo: { type: "payment", data: { id: String(pagoId) } } });
}

const COMPRADOR = {
  nombre: "Ana Ruiz Soto", whatsapp: "7717959131", email: "ana@ejemplo.mx",
  cp: "03330", direccion: "Av. Juárez 120, Centro, Ciudad de México"
};

async function crearPedido(base, n, items, comprador = COMPRADOR) {
  return pedir(base, "/api/pago", { metodo: "POST", cabeceras: visitante(n),
    cuerpo: { items, comprador } });
}

async function resumenAdmin(base, n = 250) {
  return pedir(base, "/api/admin/resumen", { cabeceras: { ...visitante(n), "X-Leads-Token": TOKEN } });
}

/* Una sesión firmada con la llave que se quiera: sirve para fabricar sesiones
   caducadas o firmadas con un token que ya no es el vigente. */
function fabricarSesion({ exp, token = TOKEN, firmaRota = false }) {
  const cuerpo = Buffer.from(JSON.stringify({ v: 1, exp, n: "x" })).toString("base64url");
  const llave = crypto.createHash("sha256").update("vq-admin-sesion:" + token, "utf8").digest();
  let firma = crypto.createHmac("sha256", llave).update(cuerpo).digest("base64url");
  if (firmaRota) firma = (firma[0] === "A" ? "B" : "A") + firma.slice(1);
  return `${cuerpo}.${firma}`;
}

// ---------------------------------------------------------------------------
async function main() {
  await new Promise(r => servidorFalso.listen(PUERTO_FALSO, "127.0.0.1", r));
  const app = arrancar();
  if (!(await app.listo)) {
    console.log("\n✗ El servidor de pruebas no arrancó:\n" + app.logs.slice(-15).join("\n"));
    await app.parar(); servidorFalso.close(); process.exit(1);
  }
  const B = app.base;

  try {
    // =====================================================================
    seccion("1 · Permisos — nada privado responde sin credencial");
    // =====================================================================
    const privadas = [
      ["GET", "/api/leads"], ["GET", "/api/admin/resumen"],
      ["POST", "/api/admin/resumen-ahora"], ["POST", "/api/admin/probar-avisos"],
      ["POST", "/api/admin/sesion"]
    ];
    await prueba("las 5 rutas privadas responden 404 sin credencial (ni confirman que existen)", async () => {
      let i = 10;
      for (const [metodo, ruta] of privadas) {
        const r = await pedir(B, ruta, { metodo, cabeceras: visitante(i++) });
        afirmar(r.status === 404, `${metodo} ${ruta} respondió ${r.status}`);
        afirmar(!/pedidos|leads|inventario/.test(r.texto), `${ruta} filtró datos sin credencial`);
      }
    });

    // =====================================================================
    seccion("2 · Panel admin — entra quien tiene el secreto, nadie más");
    // =====================================================================
    let sesion = null;
    await prueba("con el token maestro se abre una sesión y la sesión da acceso", async () => {
      const s = await pedir(B, "/api/admin/sesion", { metodo: "POST",
        cabeceras: { ...visitante(20), "X-Leads-Token": TOKEN } });
      afirmar(s.status === 200 && s.json?.sesion, `no se emitió sesión (${s.status})`);
      afirmar(Date.parse(s.json.expira) - Date.now() <= 24 * 3600_000, "la sesión dura más de 24 h");
      sesion = s.json.sesion;
      const r = await pedir(B, "/api/admin/resumen", { cabeceras: { ...visitante(20), Authorization: "Bearer " + sesion } });
      afirmar(r.status === 200 && Array.isArray(r.json?.pedidos), `la sesión no dio acceso (${r.status})`);
    });
    await prueba("un token equivocado no entra", async () => {
      const r = await pedir(B, "/api/admin/resumen", { cabeceras: { ...visitante(21), "X-Leads-Token": TOKEN + "x" } });
      afirmar(r.status === 404, `respondió ${r.status}`);
    });
    await prueba("el token en la URL (?t=) no entra", async () => {
      const r = await pedir(B, "/api/admin/resumen?t=" + encodeURIComponent(TOKEN), { cabeceras: visitante(22) });
      afirmar(r.status === 404, `respondió ${r.status}`);
    });

    // =====================================================================
    seccion("3 · Datos entre clientes — nadie ve ni pisa lo de otro");
    // =====================================================================
    await prueba("consultar un folio no revela nombre, correo, teléfono ni domicilio", async () => {
      const p = await crearPedido(B, 30, [{ sku: "ValPulpo", cantidad: 1 }]);
      afirmar(p.status === 200, `no se creó el pedido (${p.status}: ${p.texto.slice(0, 120)})`);
      const r = await pedir(B, "/api/pedido/" + p.json.folio, { cabeceras: visitante(31) });
      afirmar(r.status === 200, `respondió ${r.status}`);
      for (const dato of ["Ana Ruiz", "ana@ejemplo.mx", "7717959131", "Juárez", "comprador", "whatsapp", "direccion"]) {
        afirmar(!r.texto.includes(dato), `/api/pedido filtra «${dato}» a quien conozca el folio`);
      }
    });
    await prueba("dos clientes detrás de la MISMA IP de Cloudflare no se pisan la reserva", async () => {
      /* El fallo encontrado en producción: con la IP del proxy como identidad,
         «una reserva por visitante» borraba la reserva de OTRO cliente. Aquí
         los dos llegan por la misma conexión —mismo req.ip— y solo los
         distingue la IP real que manda Cloudflare. */
      const antes = (await resumenAdmin(B)).json.inventario.find(p => p.sku === "Endotnissin").apartado_ahora;
      const a = await crearPedido(B, 33, [{ sku: "Endotnissin", cantidad: 2 }]);
      const b = await crearPedido(B, 34, [{ sku: "Endotnissin", cantidad: 1 }]);
      afirmar(a.status === 200 && b.status === 200, `pedidos: ${a.status}/${b.status}`);
      const despues = (await resumenAdmin(B)).json.inventario.find(p => p.sku === "Endotnissin").apartado_ahora;
      afirmar(despues - antes === 3,
        `quedaron ${despues - antes} piezas apartadas en vez de 3: una reserva borró la del otro cliente`);
    });

    // =====================================================================
    seccion("5 · Claves privadas — ningún secreto sale del servidor");
    // =====================================================================
    await prueba("ningún archivo versionado contiene una clave real", () => {
      const archivos = execSync("git ls-files", { cwd: RAIZ, encoding: "utf8" }).split("\n")
        .filter(f => f && !f.startsWith("assets/vendor/") && !/\.(glb|png|jpg|webp|ico|wasm|svg)$/.test(f));
      const patrones = [
        /AIza[0-9A-Za-z_-]{35}/, /APP_USR-\d{6,}-\d{6}-[0-9a-f]{20,}/, /\d{8,10}:AA[0-9A-Za-z_-]{33}/,
        /ghp_[0-9A-Za-z]{30,}/, /github_pat_[0-9A-Za-z_]{30,}/, /-----BEGIN [A-Z ]*PRIVATE KEY/,
        /postgres(?:ql)?:\/\/[^:\s]+:[^@\s]{8,}@(?!localhost|127\.)/
      ];
      const hallados = [];
      for (const f of archivos) {
        let t; try { t = fs.readFileSync(path.join(RAIZ, f), "utf8"); } catch { continue; }
        for (const p of patrones) {
          const m = t.match(p);
          /* El único token de ejemplo que existe en la documentación se llama a sí
             mismo «no es real»: se excluye por eso, y solo por eso. */
          if (m && !/NoEsReal|de-mentira|de-pruebas/i.test(m[0])) hallados.push(`${f}: ${m[0].slice(0, 12)}…`);
        }
      }
      afirmar(!hallados.length, `posibles claves en el repo: ${hallados.join(" | ")}`);
      const env = execSync("git ls-files .env .env.local .env.production", { cwd: RAIZ, encoding: "utf8" }).trim();
      afirmar(!env, `.env está versionado: ${env}`);
    });
    await prueba("/health y / no revelan configuración, proveedor ni modelo", async () => {
      for (const ruta of ["/health", "/"]) {
        const r = await pedir(B, ruta);
        afirmar(JSON.stringify(r.json) === '{"ok":true}', `${ruta} revela: ${r.texto.slice(0, 120)}`);
      }
    });
    await prueba("un error no devuelve trazas internas ni anuncia el framework", async () => {
      const r = await pedir(B, "/api/pago", { metodo: "POST", cabeceras: visitante(40), cuerpo: "{esto no es json" });
      afirmar(r.status === 400, `respondió ${r.status}`);
      afirmar(!/at \w+ \(|node_modules|\.js:\d+/.test(r.texto), "la respuesta lleva una traza interna");
      afirmar(!r.headers.get("x-powered-by"), "la API sigue anunciando x-powered-by");
    });

    // =====================================================================
    seccion("6 · Inicio de sesión — sin fuerza bruta y sin secretos cortos");
    // =====================================================================
    await prueba("5 intentos fallidos bloquean a ESE visitante, incluso con el token bueno", async () => {
      for (let i = 0; i < 5; i++) {
        await pedir(B, "/api/admin/resumen", { cabeceras: { ...visitante(60), "X-Leads-Token": "adivinando-" + i } });
      }
      const bueno = await pedir(B, "/api/admin/resumen", { cabeceras: { ...visitante(60), "X-Leads-Token": TOKEN } });
      afirmar(bueno.status === 404, `tras 5 fallos el token correcto entró (${bueno.status}): no hay bloqueo`);
    });
    await prueba("el bloqueo es de quien falló, no del resto del mundo", async () => {
      const otro = await pedir(B, "/api/admin/resumen", { cabeceras: { ...visitante(61), "X-Leads-Token": TOKEN } });
      afirmar(otro.status === 200, `un visitante limpio quedó bloqueado (${otro.status})`);
    });

    // =====================================================================
    seccion("7 · Sesiones caducadas — lo robado deja de servir");
    // =====================================================================
    await prueba("una sesión caducada no entra aunque la firma sea buena", async () => {
      const vieja = fabricarSesion({ exp: Date.now() - 1000 });
      const r = await pedir(B, "/api/admin/resumen", { cabeceras: { ...visitante(70), Authorization: "Bearer " + vieja } });
      afirmar(r.status === 404, `respondió ${r.status}`);
    });
    await prueba("una sesión con la firma alterada no entra", async () => {
      const rota = fabricarSesion({ exp: Date.now() + 3600_000, firmaRota: true });
      const r = await pedir(B, "/api/admin/resumen", { cabeceras: { ...visitante(71), Authorization: "Bearer " + rota } });
      afirmar(r.status === 404, `respondió ${r.status}`);
    });
    await prueba("rotar LEADS_TOKEN invalida las sesiones firmadas con el anterior", async () => {
      const deOtroToken = fabricarSesion({ exp: Date.now() + 3600_000, token: "token-anterior-ya-rotado-000000000000" });
      const r = await pedir(B, "/api/admin/resumen", { cabeceras: { ...visitante(72), Authorization: "Bearer " + deOtroToken } });
      afirmar(r.status === 404, `respondió ${r.status}`);
    });
    await prueba("una sesión no puede fabricar otra: la caducidad no se renueva sola", async () => {
      afirmar(sesion, "no hay sesión de la prueba 2");
      const r = await pedir(B, "/api/admin/sesion", { metodo: "POST", cabeceras: { ...visitante(73), Authorization: "Bearer " + sesion } });
      afirmar(r.status === 404, `una sesión emitió otra sesión (${r.status})`);
    });
    await prueba("una sesión que dice caducar en un año se rechaza", async () => {
      const eterna = fabricarSesion({ exp: Date.now() + 365 * 24 * 3600_000 });
      const r = await pedir(B, "/api/admin/resumen", { cabeceras: { ...visitante(74), Authorization: "Bearer " + eterna } });
      afirmar(r.status === 404, `respondió ${r.status}`);
    });

    // =====================================================================
    seccion("9 · Inyecciones — nada que el visitante escriba se ejecuta");
    // =====================================================================
    await prueba("cargas de inyección SQL y de rutas acaban en 4xx limpio, nunca en 500", async () => {
      const cargas = ["' OR '1'='1", "1; DROP TABLE pedidos;--", "../../../etc/passwd", "${7*7}", "{{7*7}}", "%00"];
      for (const c of cargas) {
        const a = await pedir(B, "/api/pedido/" + encodeURIComponent(c), { cabeceras: visitante(90) });
        const b = await pedir(B, "/api/envio", { metodo: "POST", cabeceras: visitante(91), cuerpo: { cp_destino: c, items: [{ sku: c, cantidad: 1 }] } });
        afirmar(a.status < 500 && b.status < 500, `«${c}» provocó ${a.status}/${b.status}`);
        afirmar(!/49/.test(b.texto.replace(/\d{3,}/g, "")) || !b.texto.includes("7*7"), `«${c}» se evaluó`);
      }
    });
    await prueba("contaminar el prototipo por el cuerpo no da privilegios", async () => {
      await pedir(B, "/api/pago", { metodo: "POST", cabeceras: visitante(92),
        cuerpo: '{"__proto__":{"admin":true,"ok":true},"constructor":{"prototype":{"admin":true}},"items":[]}' });
      const r = await pedir(B, "/api/admin/resumen", { cabeceras: visitante(93) });
      afirmar(r.status === 404, `tras el intento, el panel respondió ${r.status}`);
    });

    // =====================================================================
    seccion("10 · Código malicioso — lo que escribe un cliente no se ejecuta");
    // =====================================================================
    await prueba("un nombre con HTML llega escapado al aviso de Telegram", () => {
      const { REDACCION } = require("./notificaciones.js");
      const t = REDACCION.pago_aprobado({ total_centavos: 100, folio: "VQ-1",
        comprador: '<img src=x onerror=alert(1)>', direccion: '<script>robar()</script>' });
      afirmar(!/<img|<script/i.test(t), "el aviso interpola HTML del cliente sin escapar");
    });
    await prueba("el panel escapa cada dato de cliente antes de pintarlo", () => {
      const admin = leer("admin/index.html");
      /* Se ejecuta la MISMA función que usa el panel, no una copia. */
      const def = admin.match(/const esc = (s => String\(s \?\? ""\)[\s\S]*?\}\[c\]\)\));/);
      afirmar(def, "no se encontró la función de escape del panel");
      const esc = new Function("return " + def[1])();
      afirmar(esc('<img src=x onerror=alert(1)>') === "&lt;img src=x onerror=alert(1)&gt;", "esc no escapa");
      /* Un dato de cliente pintado EN CRUDO: `${p.nombre}` a secas, o como
         rama de un ternario (`? p.nombre :`). Usarlo como condición
         —`${l.contacto ? esc(l.contacto) : …}`— no pinta nada y es seguro. */
      const crudas = [
        ...admin.matchAll(/\$\{\s*(?:p|l|q|g)\.[\w.]+\s*\}/g),
        ...admin.matchAll(/[?:]\s*(?:p|l|q|g)\.[\w.]+\s*[}:]/g)
      ].map(m => m[0]);
      afirmar(!crudas.length, `datos pintados sin escapar en el panel: ${crudas.join(", ")}`);
      /* Y la prueba de que el detector sirve: se le da una plantilla vulnerable. */
      afirmar(/\$\{\s*(?:p|l|q|g)\.[\w.]+\s*\}/.test("<td>${p.nombre}</td>"),
        "el detector de datos sin escapar no detecta nada");
    });
    await prueba("ninguna página deja ejecutar scripts en línea que no estén firmados", () => {
      const paginas = ["index.html", "dental/index.html", "ia/index.html", "3d/index.html",
        "pack/index.html", "lux/index.html", "gracias/index.html", "admin/index.html"];
      for (const p of paginas) {
        const csp = (leer(p).match(/http-equiv="Content-Security-Policy" content="([^"]+)"/) || [])[1] || "";
        const scriptSrc = (csp.match(/script-src([^;]*)/) || [])[1] || "";
        afirmar(scriptSrc, `${p} no declara script-src`);
        afirmar(!scriptSrc.includes("'unsafe-inline'"), `${p} permite scripts en línea sin firmar`);
        afirmar(!/unsafe-eval'/.test(scriptSrc.replace("'wasm-unsafe-eval'", "")), `${p} permite eval()`);
      }
    });

    // =====================================================================
    seccion("11 · Acciones sensibles — solo desde casa y con permiso");
    // =====================================================================
    await prueba("un sitio ajeno no puede llamar a la API desde el navegador de tu cliente", async () => {
      const r = await fetch(B + "/api/pago", { method: "OPTIONS", headers: {
        Origin: "https://sitio-malicioso.example", "Access-Control-Request-Method": "POST" } });
      afirmar(r.status === 403, `el preflight de un origen ajeno respondió ${r.status}`);
      afirmar(!r.headers.get("access-control-allow-origin"), "se devolvió Access-Control-Allow-Origin a un origen ajeno");
    });
    await prueba("tu dominio sí puede", async () => {
      const r = await fetch(B + "/api/pago", { method: "OPTIONS", headers: {
        Origin: "https://valquiriainc.com", "Access-Control-Request-Method": "POST" } });
      afirmar(r.headers.get("access-control-allow-origin") === "https://valquiriainc.com",
        `el origen legítimo quedó fuera (${r.status})`);
    });

    // =====================================================================
    seccion("12 · Archivos subidos — no hay por dónde subir nada");
    // =====================================================================
    await prueba("un envío multipart no se procesa", async () => {
      const r = await fetch(B + "/api/pago", { method: "POST", headers: {
        ...visitante(120), "Content-Type": "multipart/form-data; boundary=x" },
        body: '--x\r\nContent-Disposition: form-data; name="f"; filename="shell.php"\r\n\r\n<?php system($_GET[c]); ?>\r\n--x--' });
      afirmar(r.status === 400, `respondió ${r.status}`);
    });
    await prueba("un cuerpo de más de 100 KB se rechaza antes de leerse", async () => {
      const r = await pedir(B, "/api/pago", { metodo: "POST", cabeceras: visitante(121),
        cuerpo: { items: [], relleno: "x".repeat(200_000) } });
      afirmar(r.status === 413, `respondió ${r.status}`);
    });

    // =====================================================================
    seccion("13 · Accesos internos — el servidor no va adonde le digan");
    // =====================================================================
    await prueba("un id de pago con ruta relativa no sale de /v1/payments/", async () => {
      falso.rutasMP.length = 0;
      await webhook(B, "../../checkout/preferences");
      const ruta = falso.rutasMP[falso.rutasMP.length - 1] || "";
      afirmar(ruta.startsWith("/v1/payments/") && !ruta.includes("/../"),
        `la consulta escapó a ${ruta}`);
    });

    // =====================================================================
    seccion("14 · Webhooks — solo Mercado Pago puede avisar un pago");
    // =====================================================================
    await prueba("sin firma → 401", async () => {
      afirmar((await webhook(B, "123", { firma: false })).status === 401, "aceptó un aviso sin firma");
    });
    await prueba("firmado con otro secreto → 401", async () => {
      afirmar((await webhook(B, "123", { secreto: "otro-secreto" })).status === 401, "aceptó una firma falsa");
    });
    await prueba("una firma buena pero de hace 20 minutos → 401 (no se puede reenviar)", async () => {
      const r = await webhook(B, "123", { ts: Math.floor(Date.now() / 1000) - 20 * 60 });
      afirmar(r.status === 401, `aceptó un aviso viejo (${r.status})`);
    });

    // =====================================================================
    seccion("15 · Pagos duplicados — el mismo pedido no se cobra dos veces en silencio");
    // =====================================================================
    await prueba("un segundo pago aprobado del mismo folio se marca, no se suma como venta", async () => {
      const p = await crearPedido(B, 150, [{ sku: "DientesRealistas", cantidad: 1 }]);
      afirmar(p.status === 200, `no se creó el pedido (${p.status})`);
      const folio = p.json.folio, total = p.json.desglose.total_centavos;
      const pago = id => ({ id, status: "approved", status_detail: "accredited", external_reference: folio,
        transaction_amount: total / 100, payment_method_id: "visa", payment_type_id: "credit_card", payer: {} });
      falso.pagos.set("dup-1", pago("dup-1"));
      falso.pagos.set("dup-2", pago("dup-2"));

      const vendidoAntes = (await resumenAdmin(B)).json.inventario.find(x => x.sku === "DientesRealistas").vendido_en_esta_sesion;
      const primero = await webhook(B, "dup-1");
      const segundo = await webhook(B, "dup-2");
      afirmar(primero.status === 200 && !primero.json.duplicado, "el primer pago no se procesó normal");
      afirmar(segundo.status === 200 && segundo.json.duplicado === true, "el segundo cobro entró como venta nueva");

      const vendidoDespues = (await resumenAdmin(B)).json.inventario.find(x => x.sku === "DientesRealistas").vendido_en_esta_sesion;
      afirmar(vendidoDespues - vendidoAntes === 1, `el inventario descontó ${vendidoDespues - vendidoAntes} veces`);
      afirmar(app.logs.some(l => l.includes("tipo=pago_duplicado")), "no sonó el aviso de pago duplicado");
    });

    // =====================================================================
    seccion("16 · Limitar solicitudes — por persona real y con techo global");
    // =====================================================================
    const intentoPago = (n, extra = {}) => pedir(B, "/api/pago", { metodo: "POST",
      cabeceras: { ...visitante(n), ...extra }, cuerpo: { items: [{ sku: "ValEnd", cantidad: 1 }], comprador: {} } });
    await prueba("el 7º intento de pago en un minuto se frena", async () => {
      const codigos = [];
      for (let i = 0; i < 7; i++) codigos.push((await intentoPago(160)).status);
      afirmar(codigos[6] === 429, `secuencia ${codigos.join(",")}: el limitador no frenó`);
    });
    await prueba("falsificar X-Forwarded-For no crea una identidad nueva", async () => {
      const r = await intentoPago(160, { "X-Forwarded-For": "203.0.113.77" });
      afirmar(r.status === 429, `con la IP forjada volvió a pasar (${r.status})`);
    });
    await prueba("el freno de uno no alcanza a otro cliente", async () => {
      const r = await intentoPago(161);
      afirmar(r.status === 400, `un cliente limpio recibió ${r.status}`);
    });
    await prueba("el panel también tiene limitador", async () => {
      const codigos = [];
      for (let i = 0; i < 22; i++) {
        codigos.push((await pedir(B, "/api/admin/resumen", { cabeceras: { ...visitante(165), "X-Leads-Token": TOKEN } })).status);
      }
      afirmar(codigos.includes(429), `22 lecturas seguidas del panel sin freno: ${[...new Set(codigos)]}`);
    });
    await prueba("el gasto en Gemini tiene techo GLOBAL, no solo por visitante", async () => {
      /* GEMINI_TOPE_DIARIO=4 en este servidor. Cinco visitantes DISTINTOS: el
         limitador por IP no frenaría a ninguno; el techo global sí. */
      const antes = falso.llamadasGemini;
      const codigos = [];
      for (let i = 0; i < 6; i++) {
        const r = await pedir(B, "/api/chat", { metodo: "POST", cabeceras: visitante(170 + i),
          cuerpo: { messages: [{ role: "user", parts: [{ text: "hola" }] }], carrito: [] } });
        codigos.push(r.status + (r.json?.motivo ? ":" + r.json.motivo : ""));
      }
      afirmar(codigos.some(c => c === "429:presupuesto"), `sin techo global: ${codigos.join(", ")}`);
      afirmar(falso.llamadasGemini - antes <= 4, `se hicieron ${falso.llamadasGemini - antes} llamadas con techo de 4`);
      afirmar(app.logs.some(l => l.includes("tipo=presupuesto_ia")), "no sonó el aviso del tope");
    });

    // =====================================================================
    seccion("17 · Dependencias — sin vulnerabilidades conocidas ni código de terceros");
    // =====================================================================
    await prueba("qs (dependencia de Express) está en la versión corregida", () => {
      const lock = JSON.parse(leer("package-lock.json"));
      const v = lock.packages?.["node_modules/qs"]?.version || "0";
      const [a, b] = v.split(".").map(Number);
      afirmar(a > 6 || (a === 6 && b >= 16), `qs ${v} tiene avisos de seguridad (GHSA-x5fp-wj9c-mxmx)`);
    });
    await prueba("ninguna página ejecuta JavaScript servido por terceros", () => {
      for (const p of ["index.html", "dental/index.html", "ia/index.html", "3d/index.html", "pack/index.html", "lux/index.html", "admin/index.html"]) {
        const html = leer(p);
        const mapa = (html.match(/<script type="importmap">([\s\S]*?)<\/script>/) || [])[1];
        if (mapa) {
          for (const destino of Object.values(JSON.parse(mapa).imports)) {
            afirmar(destino.startsWith("/"), `${p} importa código de ${destino}`);
          }
        }
        for (const m of html.matchAll(/<script[^>]+src="([^"]+)"/g)) {
          afirmar(!/^https?:/.test(m[1]), `${p} carga ${m[1]}`);
        }
        const csp = (html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/) || [])[1] || "";
        afirmar(!/script-src[^;]*https?:\/\//.test(csp), `${p} autoriza scripts de otro dominio`);
      }
      afirmar(!/unpkg\.com/.test(leer("assets/js/modelo.js")), "el decodificador Draco sigue viniendo de unpkg");
    });

    // =====================================================================
    seccion("18 · Paneles expuestos — no se anuncia lo que hay detrás");
    // =====================================================================
    await prueba("el panel pide no ser indexado y robots.txt no lo anuncia", () => {
      afirmar(/name="robots" content="noindex/.test(leer("admin/index.html")), "el panel es indexable");
      const robots = leer("robots.txt");
      afirmar(!/admin/i.test(robots), "robots.txt le dice a cualquiera dónde está el panel");
      afirmar(!/\.md/i.test(robots), "robots.txt enumera los documentos internos");
    });
    await prueba("los documentos internos y el backend no se publican en el sitio", () => {
      const conf = leer("_config.yml");
      for (const f of ["AUDITORIA.md", "PAGOS.md", "SEGURIDAD.md", "server.js", "package.json", ".env.example"]) {
        afirmar(new RegExp(`- ${f.replace(".", "\\.")}\\b`).test(conf), `${f} se publicaría en valquiriainc.com`);
      }
      afirmar(!fs.existsSync(path.join(RAIZ, ".nojekyll")), ".nojekyll apagaría las exclusiones");
    });

    // =====================================================================
    seccion("19 · Accesos sospechosos — te enteras en el momento");
    // =====================================================================
    await prueba("el bloqueo por fuerza bruta avisa, y una sola vez", () => {
      const avisos = app.logs.filter(l => l.includes("tipo=acceso_sospechoso"));
      afirmar(avisos.length >= 1, "5 intentos fallidos al panel no dispararon ningún aviso");
      afirmar(avisos.length <= 2, `el bloqueo disparó ${avisos.length} avisos: se volvería ruido`);
    });
  } finally {
    await app.parar();
  }

  // =======================================================================
  seccion("6 · Un LEADS_TOKEN corto deja el panel CERRADO (servidor aparte)");
  // =======================================================================
  {
    const corto = arrancar({ LEADS_TOKEN: "corto12345" }, PUERTO_APP + 1);
    try {
      await prueba("con un token de 10 caracteres, ni el token correcto abre el panel", async () => {
        afirmar(await corto.listo, "el servidor no arrancó");
        const r = await pedir(corto.base, "/api/admin/resumen", { cabeceras: { ...visitante(1), "X-Leads-Token": "corto12345" } });
        afirmar(r.status === 404, `un token corto abrió el panel (${r.status})`);
        afirmar(corto.logs.some(l => l.includes("panel queda CERRADO")), "no se explica en el log por qué está cerrado");
      });
    } finally { await corto.parar(); }
  }

  // =======================================================================
  seccion("20 · Restaurar respaldos — se apaga, se enciende y los pedidos siguen");
  // =======================================================================
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vq-respaldo-"));
    const ruta = path.join(dir, "valquiria.json");
    const puerto = PUERTO_APP + 2;
    let folio = null;
    const uno = arrancar({ ALMACEN_RUTA: ruta }, puerto);
    try {
      afirmar(await uno.listo, "el servidor con respaldo no arrancó");
      const p = await crearPedido(uno.base, 200, [{ sku: "ValPulpo", cantidad: 1 }]);
      folio = p.json?.folio;
    } finally {
      /* SIGTERM, como lo hace Render al desplegar: dispara el volcado final. */
      await uno.parar("SIGTERM");
    }
    const dos = arrancar({ ALMACEN_RUTA: ruta }, puerto);
    try {
      await prueba("un pedido creado antes del reinicio sigue ahí después", async () => {
        afirmar(folio, "no se pudo crear el pedido de prueba");
        afirmar(await dos.listo, "el servidor no volvió a arrancar");
        afirmar(fs.existsSync(ruta), "no se escribió ningún respaldo en disco");
        const r = await resumenAdmin(dos.base);
        afirmar(r.status === 200, `panel: ${r.status}`);
        afirmar(r.json.pedidos.some(x => x.folio === folio), "el pedido se perdió al reiniciar");
      });
    } finally {
      await dos.parar();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  // =======================================================================
  seccion("Legal · el texto dice lo que la ley vigente dice, y lo que el sistema hace");
  // =======================================================================
  /* Verificado contra el texto oficial de la Cámara de Diputados: LFPDPPP
     publicada en el DOF el 20-03-2025 (última reforma 14-11-2025) y LFPC
     (última reforma 12-12-2025). Estas pruebas no dan por buena la redacción
     jurídica —eso lo hace un abogado—: impiden que vuelva a entrar lo que ya
     se sabe que está mal. */
  const html = leer("index.html");
  const tramo = id => {
    const i = html.indexOf(`id="${id}"`);
    return html.slice(i, html.indexOf("</section>", i)).replace(/\s+/g, " ");
  };
  const privacidad = tramo("v-privacidad");
  const terminos = tramo("v-terminos");

  await prueba("las transferencias sin consentimiento se citan en el art. 36 (el 37 es autorregulación)", () => {
    afirmar(!/art[íi]culo 37 de la LFPDPPP/.test(privacidad), "el aviso sigue citando el artículo 37");
    afirmar(/art[íi]culo 36 de la LFPDPPP/.test(privacidad), "el aviso no cita el artículo 36");
  });
  await prueba("el aviso nombra a quienes de verdad reciben datos de clientes", () => {
    for (const quien of ["Telegram", "Render", "Mercado Pago", "Google"]) {
      afirmar(privacidad.includes(quien), `el aviso no menciona a ${quien}`);
    }
    afirmar(!/se conservan solo mientras dura tu sesión en el navegador/.test(privacidad),
      "el aviso vuelve a afirmar que las conversaciones solo viven en el navegador");
    afirmar(privacidad.includes("Secretaría Anticorrupción y Buen Gobierno"),
      "el aviso no nombra a la autoridad vigente");
  });
  await prueba("los términos no recortan el plazo de reclamación de la LFPC (art. 93: dos meses)", () => {
    afirmar(!/repórtalo dentro de los <strong>cinco días naturales<\/strong>/.test(terminos),
      "los términos vuelven a poner cinco días como límite");
    afirmar(/dos meses/.test(terminos) && /artículo 93/.test(terminos),
      "los términos no reconocen el plazo legal de dos meses");
  });
  await prueba("los términos no liberan al proveedor de su responsabilidad (LFPC art. 90)", () => {
    for (const clausula of ["libera a Valquiria de cualquier responsabilidad",
                            "se limita al importe efectivamente",
                            "renunciando a cualquier otro fuero",
                            "no dan lugar a cancelación ni a indemnización"]) {
      afirmar(!terminos.includes(clausula), `vuelve a estar la cláusula «${clausula}»`);
    }
  });
  await prueba("los términos no prometen un envío fijo que ya no es el que se cobra", () => {
    afirmar(!/aplica un costo de \$150\.00 MXN/.test(terminos),
      "los términos prometen $150 fijos y el checkout cobra según el código postal");
  });

  await prueba("el verificador de producción tolera saltos de línea, no ausencias", () => {
    /* Falso negativo real: con el aviso ya corregido en producción, el
       verificador decía que faltaba «Secretaría Anticorrupción y Buen
       Gobierno» porque el HTML parte la frase en dos líneas. */
    const { faltantesAvisoPrivacidad, TEXTOS_AVISO } = require("./scripts/verificar-produccion.js");
    afirmar(JSON.stringify(TEXTOS_AVISO) === JSON.stringify([
      "artículo 36 de la LFPDPPP", "Telegram", "Render Services",
      "Secretaría Anticorrupción y Buen Gobierno"
    ]), "cambió la lista de textos que exige el verificador");

    /* Los cuatro textos partidos con saltos de línea, tabs y sangría. */
    const partido = t => t.replace(/ /g, () => "\n\t    ");
    const conSaltos = `<p>${TEXTOS_AVISO.map(partido).join("</p>\n<p>")}</p>`;
    afirmar(faltantesAvisoPrivacidad(conSaltos).length === 0,
      `con saltos de línea marca como faltantes: ${faltantesAvisoPrivacidad(conSaltos).join(" · ")}`);

    /* El aviso tal como está en index.html —lo que sirve producción— pasa. */
    afirmar(faltantesAvisoPrivacidad(html).length === 0,
      `el index.html real no pasa: ${faltantesAvisoPrivacidad(html).join(" · ")}`);

    /* Si falta cualquiera de los cuatro, se detecta — y solo ese. */
    for (const quitado of TEXTOS_AVISO) {
      const sinUno = `<p>${TEXTOS_AVISO.filter(t => t !== quitado).map(partido).join("</p><p>")}</p>`;
      const falta = faltantesAvisoPrivacidad(sinUno);
      afirmar(falta.length === 1 && falta[0] === quitado,
        `sin «${quitado}» reportó: ${JSON.stringify(falta)}`);
    }

    /* Y no basta con que las palabras estén sueltas: tienen que ir juntas y
       en orden. */
    for (const casi of ["Secretaría Anticorrupción y Gobierno", "Render <b>Services</b>",
                        "artículo 37 de la LFPDPPP", "Buen Gobierno, Secretaría Anticorrupción y"]) {
      const html2 = `<p>${TEXTOS_AVISO.slice(0, 2).join(" ")} ${casi}</p>`;
      afirmar(faltantesAvisoPrivacidad(html2).length >= 2,
        `«${casi}» se dio por bueno`);
    }
  });

  servidorFalso.close();
  console.log("");
  if (fallos.length) {
    console.log(`✗ ${fallos.length} FALLARON de ${pasadas + fallos.length}`);
    process.exit(1);
  }
  console.log(`✓ ${pasadas}/${pasadas} pruebas de seguridad pasaron.\n`);
}

main().catch(e => { console.error("\n✗ La suite de seguridad se cayó:", e); process.exit(1); });
