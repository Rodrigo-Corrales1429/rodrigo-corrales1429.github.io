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
const falso = { pagos: new Map(), rutasMP: [], llamadasGemini: 0, preferencias: 0, cuerposGemini: [],
  /* «#lead:X» → la conversación X. Un freno retiene la SEGUNDA llamada de X
     (la que sigue a registrar_interes) hasta que la prueba lo suelte: así se
     intercalan conversaciones a voluntad. `registrados` avisa cuándo X ya
     registró su lead. */
  frenos: new Map(), registrados: new Map() };
const esperarRegistro = etiqueta => new Promise(r => {
  if (falso.registrados.get(etiqueta) === true) return r();
  falso.registrados.set(etiqueta, r);
});

const servidorFalso = http.createServer((req, res) => {
  let cuerpo = "";
  req.on("data", c => (cuerpo += c));
  req.on("end", async () => {
    const json = (st, d) => { res.writeHead(st, { "Content-Type": "application/json" }); res.end(JSON.stringify(d)); };
    if (req.url.includes(":generateContent")) {
      falso.llamadasGemini++;
      falso.cuerposGemini.push(cuerpo);
      /* «#lead»: el modelo registra el interés con el contacto que VIO, que
         solo pueden ser marcas. Tras la respuesta de la herramienta, texto. */
      let contenidos = [];
      try { contenidos = JSON.parse(cuerpo).contents || []; } catch { /* no JSON */ }
      const ultimo = contenidos[contenidos.length - 1] || {};
      const textoUltimo = (ultimo.parts || []).map(p => p.text || "").join(" ");
      const etiqueta = (JSON.stringify(contenidos).match(/#lead:([A-Z])/) || [])[1] || null;
      if (textoUltimo.includes("#lead") && !(ultimo.parts || []).some(p => p.functionResponse)) {
        const marcas = textoUltimo.match(/\[(teléfono|correo) omitido\]/g) || [];
        return json(200, { candidates: [{ content: { role: "model", parts: [{ functionCall: {
          name: "registrar_interes",
          args: etiqueta
            ? { division: "3d", nombre: `Cliente ${etiqueta}`, contacto: marcas.join(" · "),
                resumen: `Proyecto ${etiqueta}: taller escolar que quiere imprimir 40 piezas de prueba en PLA.` }
            : { division: "3d", resumen: "Taller escolar que quiere imprimir 40 piezas de prueba en PLA.",
                contacto: marcas.join(" · ") } } }] }, finishReason: "STOP" }] });
      }
      if (etiqueta && (ultimo.parts || []).some(p => p.functionResponse)) {
        const aviso = falso.registrados.get(etiqueta);
        falso.registrados.set(etiqueta, true);
        if (typeof aviso === "function") aviso();
        if (falso.frenos.has(etiqueta)) await falso.frenos.get(etiqueta);
      }
      return json(200, { candidates: [{ content: { role: "model",
        parts: [{ text: "Hola, soy el Asesor. ¿Qué necesitas?" }] }, finishReason: "STOP" }] });
    }
    if (req.method === "POST" && req.url.startsWith("/checkout/preferences")) {
      falso.preferencias++;
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
      /* Estas pruebas hacen de Cloudflare: lo piden explícitamente, y nada del
         entorno de quien las corre decide la frontera por ellas. */
      SIMULAR_CLOUDFLARE_EN_PRUEBAS: "1",
      RENDER: undefined,
      IP_CABECERA_CONFIABLE: undefined,
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

/* A1 · el caso EXACTO con el que Codex sacó una tarjeta por todos los caminos
   (pantalla, modelo, /api/chat, minimización y avisos): espacios duros U+00A0
   entre grupos y el CVV en el renglón siguiente. Va con escapes JSON para que
   se lea tal cual lo escribió. Todos los números de tarjeta de esta suite son
   números de PRUEBA publicados (la Visa genérica 4111… y los de la
   documentación de Stripe), no tarjetas reales; pasan Luhn a propósito. */
const CASO_CODEX = JSON.parse('"tarjeta 4111\\u00a01111\\u00a01111\\u00a01111 CVV:\\n123"');
const CON_TABS = "tarjeta 4111\t1111\t1111\t1111\tcvv\t123";
const CVV_ABAJO = "mi tarjeta:\n4111 1111 1111 1111\nCVV:\n123";
const rastroDeTarjeta = t => /4111[\s\S]{0,6}1111|1111[\s\S]{0,6}1111|(cvv|cvc)[^\d]{0,6}123/i.test(t);

async function crearPedido(base, n, items, comprador = COMPRADOR) {
  return pedir(base, "/api/pago", { metodo: "POST", cabeceras: visitante(n),
    cuerpo: { items, comprador, visitante: crypto.randomUUID() } });
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

    /* La reserva es del VISITANTE (UUID del navegador), no de la IP: la IP
       real también la comparten personas distintas —CGNAT, Wi-Fi de una
       universidad, una oficina—. */
    const apartadoValEnd = async () =>
      (await resumenAdmin(B, 251)).json.inventario.find(p => p.sku === "ValEnd").apartado_ahora;
    const pedirComo = (n, idVisitante, cantidad) => pedir(B, "/api/pago", { metodo: "POST", cabeceras: visitante(n),
      cuerpo: { items: [{ sku: "ValEnd", cantidad }], comprador: COMPRADOR, visitante: idVisitante } });
    await prueba("dos compradores con la MISMA IP y visitantes distintos no se reemplazan ni liberan la reserva", async () => {
      const antes = await apartadoValEnd();
      const a = await pedirComo(35, crypto.randomUUID(), 2);
      const b = await pedirComo(35, crypto.randomUUID(), 1);
      afirmar(a.status === 200 && b.status === 200, `pedidos: ${a.status}/${b.status}`);
      const despues = await apartadoValEnd();
      afirmar(despues - antes === 3,
        `quedaron ${despues - antes} piezas apartadas en vez de 3: la IP compartida decidió la propiedad`);
    });
    await prueba("el mismo visitante sí reemplaza su propia reserva, aunque cambie de red", async () => {
      const yo = crypto.randomUUID();
      const antes = await apartadoValEnd();
      const a = await pedirComo(36, yo, 2);
      const b = await pedirComo(37, yo, 1);
      afirmar(a.status === 200 && b.status === 200, `pedidos: ${a.status}/${b.status}`);
      const despues = await apartadoValEnd();
      afirmar(despues - antes === 1,
        `quedaron ${despues - antes} piezas apartadas en vez de 1: su reserva anterior no se reemplazó`);
    });
    await prueba("sin UUID v4 válido: 400, sin reserva, sin link y sin repetir el valor", async () => {
      const antes = await apartadoValEnd();
      const preferencias = falso.preferencias;
      for (const malo of [undefined, "no-es-un-uuid", "------------------------------------",
        "6ba7b810-9dad-11d1-80b4-00c04fd430c8", "01890a5d-ac96-774b-bcce-b302099a8057"]) {
        const r = await pedirComo(38, malo, 1);
        afirmar(r.status === 400 && r.json?.motivo === "visitante", `con ${JSON.stringify(malo)} respondió ${r.status}`);
        afirmar(malo === undefined || !r.texto.includes(malo), "el rechazo repite el valor recibido");
      }
      afirmar(await apartadoValEnd() === antes, "un pedido sin visitante válido apartó mercancía");
      afirmar(falso.preferencias === preferencias, "un pedido sin visitante válido creó un link de pago");
      const bueno = await pedirComo(38, crypto.randomUUID(), 1);
      afirmar(bueno.status === 200, `con un UUID v4 válido respondió ${bueno.status}`);
    });
    await prueba("la tienda manda su visitante, generado con el contrato compartido", () => {
      const front = leer("assets/js/app.js");
      afirmar(/\n {8}visitante: Visitante\.id\(\)\n/.test(front), "el cuerpo de /api/pago ya no lleva el visitante");
      afirmar(/import \{ visitanteDeSesion \} from '\.\/visitante\.js\?v=\d+';/.test(front),
        "app.js dejó de usar visitante.js: el formato volvería a poder divergir del servidor");
    });

    /* El formato lo valida el MISMO contrato en los dos lados. Con uno más
       laxo en el navegador, sessionStorage conservaba un valor que el servidor
       rechazaba y cada pedido estrenaba dueño. */
    const front = await import("./assets/js/visitante.js");
    const servidor = require("./identidad.js");
    const webcrypto = crypto.webcrypto;
    const guardadoEn = inicial => {
      const s = { valor: inicial, escrituras: 0 };
      s.almacen = { leer: () => s.valor, escribir: v => { s.valor = v; s.escrituras++; } };
      return s;
    };
    await prueba("navegador y servidor validan el visitante con la misma expresión", () => {
      afirmar(front.VISITANTE_UUID.source === servidor.VISITANTE_UUID.source &&
        front.VISITANTE_UUID.flags === servidor.VISITANTE_UUID.flags,
        `divergen: ${front.VISITANTE_UUID} ≠ ${servidor.VISITANTE_UUID}`);
    });
    await prueba("un UUID v4 válido guardado se conserva", () => {
      const valido = webcrypto.randomUUID();
      const s = guardadoEn(valido);
      afirmar(front.visitanteDeSesion(s.almacen, webcrypto) === valido && s.escrituras === 0,
        "se regeneró un visitante válido: se perdería el reemplazo de su propia reserva");
    });
    await prueba("36 caracteres mal formados, o un UUID que no es v4, se descartan y se regeneran", () => {
      for (const malo of ["0123456789abcdef-0123456789abcdef-01", "------------------------------------",
        "6ba7b810-9dad-11d1-80b4-00c04fd430c8", "01890a5d-ac96-774b-bcce-b302099a8057",
        "3f1c2a4e-8b7d-4c6a-7e2f-1a2b3c4d5e6f"]) {
        afirmar(malo.length === 36 && !servidor.VISITANTE_UUID.test(malo), `la muestra ${malo} no es inválida`);
        const s = guardadoEn(malo);
        const nuevo = front.visitanteDeSesion(s.almacen, webcrypto);
        afirmar(nuevo !== malo && servidor.VISITANTE_UUID.test(nuevo) && s.valor === nuevo,
          `el navegador conservó «${malo}», que el servidor rechaza`);
      }
    });
    await prueba("los dos generadores (randomUUID y getRandomValues) cumplen el contrato del servidor", () => {
      const soloBytes = { getRandomValues: a => webcrypto.getRandomValues(a) };
      const vistos = new Set();
      for (let i = 0; i < 500; i++) {
        for (const cripto of [webcrypto, soloBytes]) {
          const v = front.nuevoVisitante(cripto);
          afirmar(servidor.VISITANTE_UUID.test(v), `generó «${v}», que el servidor rechazaría`);
          vistos.add(v);
        }
      }
      afirmar(vistos.size === 1000, "dos visitantes generados coincidieron");
    });

    /* Los datos de entrega se ven en pantalla, pero no entran al hilo del
       Asesor: ese hilo viaja a /api/chat —al modelo— y se guarda en la pestaña.
       Datos inventados: teléfono que empieza en 0 y dominio .invalid. El
       WhatsApp va como lo guarda Comprador —con el 52 del país— y el cliente
       lo escribe sin él: así lo encontró la prueba en el navegador. */
    const entrega = await import("./assets/js/entrega-privada.js");
    const DATOS = { nombre: "Mariela Quintanar Olvera", whatsapp: "520001112233", email: "mariela.q@correo.invalid",
      cp: "42083", direccion: "Calle Ficticia 123, Colonia Inventada, Pachuca",
      referencias: "portón verde junto a la farmacia" };
    const fugas = (texto, { conCp = true } = {}) => {
      const t = texto.toLowerCase();
      const hallados = DATOS.nombre.toLowerCase().split(" ").filter(p => t.includes(p)).map(p => "nombre:" + p);
      if (texto.replace(/\D/g, "").includes(DATOS.whatsapp.slice(-10))) hallados.push("whatsapp");
      for (const c of ["email", "direccion", "referencias"]) if (t.includes(DATOS[c].toLowerCase())) hallados.push(c);
      if (conCp && texto.includes(DATOS.cp)) hallados.push("cp");
      return hallados;
    };
    /* El mismo recorrido que hace app.js: pedir datos, el turno del
       formulario y la confirmación, cada uno con su versión para el hilo. */
    const recorrido = () => {
      const hilo = [];
      const pantalla = [];
      const decir = m => { pantalla.push(m.enPantalla); hilo.push({ role: "model", parts: [{ text: m.paraModelo }] }); };
      decir(entrega.mensajePedirDatos(DATOS.nombre, false));
      hilo.push({ role: "user", parts: [{ text: entrega.TURNO_DATOS_CAPTURADOS }] });
      decir(entrega.mensajeConfirmacion({ nombre: DATOS.nombre, direccion: DATOS.direccion, cp: DATOS.cp,
        telefono: "000 111 2233" }, {
        enPantalla: "• **1 × Pulpo** — $444.01\n\nEnvío a CP 42083: **$150.00**\nTotal: **$594.01**",
        paraModelo: "• **1 × Pulpo** — $444.01\n\nEnvío: **$150.00**\nTotal: **$594.01**" }));
      return { hilo, pantalla };
    };
    await prueba("capturar el checkout no mete nombre, teléfono, correo, domicilio ni CP en el hilo del Asesor", () => {
      const { hilo } = recorrido();
      const f = fugas(JSON.stringify(hilo));
      afirmar(!f.length, `el hilo del modelo lleva: ${f.join(", ")}`);
    });
    await prueba("el comprador sigue viendo en pantalla su resumen de entrega completo", () => {
      const { pantalla } = recorrido();
      const confirmacion = pantalla[1];
      for (const dato of ["Mariela", DATOS.direccion, "CP 42083", "000 111 2233"]) {
        afirmar(confirmacion.includes(dato), `la burbuja de confirmación ya no enseña «${dato}»`);
      }
      afirmar(pantalla[0].startsWith("Mariela, para"), "la petición de datos dejó de saludar por su nombre");
    });
    await prueba("la calle y número del domicilio se tachan aunque se escriban sueltos; la ciudad sola no", () => {
      /* Encontrado en la prueba E2E: solo se reconocía el domicilio completo. */
      const t = entrega.tacharEntrega("Vivo en calle ficticia 123 y ¿envían a Pachuca?", DATOS);
      afirmar(!/ficticia 123/i.test(t) && t.includes(entrega.TACHADO), `quedó la calle con número: «${t}»`);
      afirmar(t.includes("Pachuca"), "se tachó la ciudad sola, que es una pregunta normal de envío");
    });
    await prueba("lo que sale a /api/chat va tachado aunque el comprador repita sus datos en el chat", () => {
      const { hilo } = recorrido();
      hilo.push({ role: "user", parts: [{ text: "Soy Mariela Quintanar, cel 000-111-22-33, correo " +
        "MARIELA.Q@correo.invalid, vivo en Calle Ficticia 123, Colonia Inventada, Pachuca (portón verde " +
        "junto a la farmacia). ¿Cuánto cuesta el envío a 42083?" }] });
      const carga = JSON.stringify({ messages: entrega.sinDatosDeEntrega(hilo, DATOS) });
      const f = fugas(carga, { conCp: false });
      afirmar(!f.length, `la carga de /api/chat lleva: ${f.join(", ")}`);
      afirmar(carga.includes(entrega.TACHADO), "no se tachó nada");
      afirmar(carga.includes("42083"), "el CP que el cliente escribe para cotizar su envío se perdió");
    });
    await prueba("app.js escribe cada turno en el hilo del modelo ya saneado, y /api/chat solo envía ese hilo", () => {
      const fuente = leer("assets/js/app.js");
      const sinComentarios = fuente.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
      afirmar(!/\bhistorial\b/.test(sinComentarios), "volvió un hilo único que hace de pantalla y de modelo");
      const culpables = sinComentarios.split(";")
        .filter(s => /(\.decir\(|hilo\.(usuario|bot|nota)\()/.test(s) && /Comprador\./.test(s));
      afirmar(!culpables.length, `texto construido con Comprador.* entra al hilo: ${culpables.map(s => s.trim().slice(0, 90)).join(" | ")}`);
      afirmar(/const paraElModelo = texto => sinTarjetas\(tacharEntrega\(texto, Comprador\.datos\)\);/.test(sinComentarios) &&
        /sanear: paraElModelo/.test(sinComentarios), "el hilo del modelo dejó de sanearse al escribir");
      afirmar(/decir\(texto, paraModelo = texto\) \{[\s\S]*?this\.hilo\.bot\(texto, paraModelo\)/.test(sinComentarios),
        "decir() dejó de separar lo que se ve de lo que va al modelo");
      afirmar(/this\.hilo\.nota\('user', TURNO_DATOS_CAPTURADOS\);\s*this\.hilo\.barrer\(\);/.test(sinComentarios),
        "el formulario de entrega dejó de anotar solo QUE se dieron los datos y de barrer lo escrito antes");
      afirmar(/const visible = sinTarjetas\(texto\);[\s\S]*?this\.hilo\.usuario\(texto, visible\);/.test(sinComentarios),
        "lo que escribe la persona dejó de pasar por el hilo con su versión visible sin tarjetas");
      afirmar(/hiloRecortado\(\) \{ return this\.hilo\.paraEnviar\(\); \}/.test(sinComentarios) &&
        /body: JSON\.stringify\(\{ messages: this\.hiloRecortado\(\), carrito: Carrito\.lista\(\) \}\)/.test(sinComentarios),
        "/api/chat dejó de enviar solo el hilo del modelo");
      afirmar(/'\\nEnvío' \+ \(sinCp \? '' : ' a CP ' \+ e\.cp\)/.test(fuente) &&
        /\(cp && !sinCp \? ' a CP ' \+ cp : ''\)/.test(fuente), "el desglose para el modelo volvió a llevar el CP");
    });

    /* El hilo de pantalla y el del modelo, EJECUTADOS: el mismo `sanear` que
       compone app.js, un almacenamiento de pestaña falso y el recorrido que
       preocupa —datos, primera llamada, olvidar, segunda llamada, otro
       comprador, recargar la pestaña—. */
    const hiloMod = await import("./assets/js/hilo-asesor.js");
    const pii = require("./assets/js/pii-comercial.js");
    const DATOS2 = { nombre: "Rogelio Anzures Téllez", whatsapp: "520009998877", email: "rogelio.a@correo.invalid",
      cp: "06700", direccion: "Avenida Imaginaria 456, Colonia Supuesta, Ciudad de México", referencias: "zaguán azul" };
    const fugasDe = (texto, datos) => {
      const t = texto.toLowerCase();
      const hallados = datos.nombre.toLowerCase().split(" ").filter(p => t.includes(p)).map(p => "nombre:" + p);
      if (texto.replace(/\D/g, "").includes(datos.whatsapp.slice(-10))) hallados.push("whatsapp");
      for (const c of ["email", "direccion", "referencias"]) if (t.includes(datos[c].toLowerCase())) hallados.push(c);
      return hallados;
    };
    const pestaña = (inicial = {}) => {
      const m = new Map(Object.entries(inicial).map(([k, v]) => [k, JSON.stringify(v)]));
      return { m, leer: k => (m.has(k) ? JSON.parse(m.get(k)) : null), escribir: (k, v) => m.set(k, JSON.stringify(v)), borrar: k => m.delete(k) };
    };
    const VACIO = { nombre: "", whatsapp: "", email: "", cp: "", direccion: "", referencias: "" };
    const nuevoHilo = (almacen, comprador) => hiloMod.crearHilo({ almacen, maxTurnos: 40, maxTexto: 24000,
      sanear: t => pii.sinTarjetas(entrega.tacharEntrega(t, comprador.datos)) });
    /* Lo mismo que hace app.js al capturar el formulario y confirmar. */
    const checkout = (hilo, comprador, datos) => {
      comprador.datos = { ...datos };
      hilo.nota("user", entrega.TURNO_DATOS_CAPTURADOS);
      hilo.barrer();
      const c = entrega.mensajeConfirmacion({ nombre: datos.nombre, direccion: datos.direccion, cp: datos.cp,
        telefono: datos.whatsapp.slice(-10) }, { enPantalla: "Envío a CP " + datos.cp + ": **$150.00**", paraModelo: "Envío: **$150.00**" });
      hilo.bot(c.enPantalla, c.paraModelo);
    };
    const escribe = (hilo, texto) => hilo.usuario(texto, pii.sinTarjetas(texto));
    const recorrido2 = () => {
      const almacen = pestaña();
      const comprador = { datos: { ...VACIO } };
      const hilo = nuevoHilo(almacen, comprador);
      escribe(hilo, "Hola, quiero 2 kits de endodoncia");
      /* Lo escribe a mano ANTES de dar sus datos al formulario. */
      escribe(hilo, "Soy Mariela Quintanar, vivo en Calle Ficticia 123, Colonia Inventada, Pachuca; cel 000 111 2233");
      checkout(hilo, comprador, DATOS);
      return { almacen, comprador, hilo };
    };
    await prueba("checkout con nombre, teléfono, correo y domicilio: la primera llamada al modelo no los lleva", () => {
      const { hilo } = recorrido2();
      const f = fugasDe(JSON.stringify(hilo.paraEnviar()), DATOS);
      afirmar(!f.length, `la primera llamada lleva: ${f.join(", ")}`);
      afirmar(JSON.stringify(hilo.pantalla()).includes(DATOS.direccion), "la pantalla perdió la confirmación con su domicilio");
    });
    await prueba("después de Comprador.olvidar(), la segunda llamada tampoco recupera los datos anteriores", () => {
      const { hilo, comprador } = recorrido2();
      comprador.datos = { ...VACIO, cp: DATOS.cp };   // lo mismo que deja Comprador.olvidar()
      escribe(hilo, "¿Cuándo llega mi pedido?");
      const f = fugasDe(JSON.stringify(hilo.paraEnviar()), DATOS);
      afirmar(!f.length, `tras olvidar, la segunda llamada lleva: ${f.join(", ")}`);
    });
    await prueba("cambiar de comprador en la misma pestaña no hace reaparecer los datos del primero", () => {
      const { hilo, comprador } = recorrido2();
      comprador.datos = { ...VACIO, cp: DATOS.cp };
      escribe(hilo, "Ahora el pedido es para mi socio");
      checkout(hilo, comprador, DATOS2);
      const enviado = JSON.stringify(hilo.paraEnviar());
      const f = [...fugasDe(enviado, DATOS), ...fugasDe(enviado, DATOS2)];
      afirmar(!f.length, `con el segundo comprador la llamada lleva: ${f.join(", ")}`);
    });
    await prueba("restaurar la pestaña no mezcla la pantalla con el hilo del modelo", () => {
      const { almacen, hilo } = recorrido2();
      hilo.guardar();
      const guardadoModelo = almacen.m.get(hiloMod.LLAVE_MODELO);
      const guardadoPantalla = almacen.m.get(hiloMod.LLAVE_PANTALLA);
      afirmar(!fugasDe(guardadoModelo, DATOS).length, "la llave del modelo guarda datos del comprador");
      afirmar(guardadoPantalla.includes(DATOS.direccion), "la llave de pantalla no guarda lo que el comprador vio");
      /* Una entrada de más en la pantalla —con datos— no se cuela al modelo. */
      const pantallaAlterada = JSON.parse(guardadoPantalla);
      pantallaAlterada.m.push({ quien: "yo", texto: "Soy " + DATOS.nombre + " de " + DATOS.direccion });
      almacen.m.set(hiloMod.LLAVE_PANTALLA, JSON.stringify(pantallaAlterada));
      const otra = nuevoHilo(almacen, { datos: { ...VACIO } });
      afirmar(otra.restaurar() === true, "no se restauró la conversación");
      afirmar(JSON.stringify(otra.paraEnviar()) === JSON.stringify(hilo.paraEnviar()),
        "el hilo del modelo restaurado no es el que se guardó");
      afirmar(!fugasDe(JSON.stringify(otra.paraEnviar()), DATOS).length, "al restaurar, la pantalla se coló al modelo");
    });
    await prueba("el formato v1 inseguro se borra del storage y una versión ajena se descarta", () => {
      const almacen = pestaña({ vq_asesor_v1: { v: 1, saludado: true, h: [{ role: "user", parts: [{ text:
        "Mis datos de entrega: " + DATOS.nombre + ", CP " + DATOS.cp + ", " + DATOS.direccion }] }] } });
      const hilo = nuevoHilo(almacen, { datos: { ...VACIO } });
      afirmar(hilo.restaurar() === false, "se restauró un hilo v1");
      afirmar(!almacen.m.has("vq_asesor_v1"), "el hilo v1 con datos sigue en el storage");
      afirmar(hilo.paraEnviar().length === 0, "algo del hilo v1 quedó para enviarse");
      afirmar(hiloMod.VERSION_HILO === 3 && /_v3$/.test(hiloMod.LLAVE_MODELO) && /_v3$/.test(hiloMod.LLAVE_PANTALLA),
        "el formato nuevo no está versionado explícitamente");
      const ajeno = pestaña({ [hiloMod.LLAVE_MODELO]: { v: 2, h: [] }, [hiloMod.LLAVE_PANTALLA]: { v: 3, m: [] } });
      afirmar(nuevoHilo(ajeno, { datos: { ...VACIO } }).restaurar() === false && !ajeno.m.has(hiloMod.LLAVE_MODELO),
        "un hilo de otra versión se restauró o se quedó en el storage");
    });
    await prueba("una tarjeta escrita en el chat no queda en ningún hilo ni en el storage", () => {
      const almacen = pestaña();
      const hilo = nuevoHilo(almacen, { datos: { ...VACIO } });
      escribe(hilo, "mi tarjeta es 4111 1111 1111 1111 y el cvv 123");
      hilo.guardar();
      const todo = [...almacen.m.values()].join("\n");
      afirmar(!todo.includes("4111") && !/cvv 123/.test(todo), "la tarjeta quedó guardada");
      afirmar(todo.includes("[tarjeta omitida]"), "no se dejó constancia de que se omitió");
    });

    /* ─── A1 · tarjetas con separadores reales (casos arriba) ─────────── */
    await prueba("A1 · el caso de Codex (NBSP + CVV abajo), con tabs o en renglones: nada en pantalla, modelo ni sessionStorage", () => {
      afirmar(CASO_CODEX.includes("\u{a0}") && CASO_CODEX.includes("CVV:\n123"), "el caso de regresión dejó de ser el de Codex");
      for (const caso of [CASO_CODEX, CON_TABS, CVV_ABAJO]) {
        const almacen = pestaña();
        const hilo = nuevoHilo(almacen, { datos: { ...VACIO } });
        escribe(hilo, caso);
        hilo.guardar();
        const lugares = { pantalla: JSON.stringify(hilo.pantalla()), modelo: JSON.stringify(hilo.paraEnviar()),
          sessionStorage: [...almacen.m.values()].join("\n") };
        for (const [donde, texto] of Object.entries(lugares)) {
          /* El único número legítimo es la versión del formato («"v":3»). */
          afirmar(!rastroDeTarjeta(texto) && !/\d/.test(texto.replace(/"v":\d+/g, "")),
            `${JSON.stringify(caso)}: en ${donde} quedaron dígitos: ${texto}`);
          afirmar(texto.includes("[tarjeta omitida]") && texto.includes("[código omitido]"), `${donde} no dejó constancia de lo omitido`);
        }
      }
    });
    await prueba("A1 · Visa, Mastercard y Amex con espacio duro, espacios Unicode, tabs, saltos, guiones, puntos y paréntesis", () => {
      const PRUEBA = { visa: ["4111", "1111", "1111", "1111"], visa2: ["4242", "4242", "4242", "4242"],
        mastercard: ["5555", "5555", "5555", "4444"], mastercard2: ["2223", "0031", "2200", "3222"],
        amex: ["3782", "822463", "10005"], amex2: ["3714", "496353", "98431"] };
      const SEPARADORES = { espacio: " ", nbsp: "\u{a0}", estrecho: "\u{202f}", "de cifra": "\u{2007}", fino: "\u{2009}",
        "ancho cero": "\u{200b}", tab: "\t", salto: "\n", crlf: "\r\n", "espacio y salto": " \n", guion: "-",
        raya: "\u{2013}", punto: ".", "guion con espacios": " - ", "dos espacios": "  " };
      for (const [marca, grupos] of Object.entries(PRUEBA)) {
        afirmar(pii.pareceTarjeta(grupos.join("")), `${marca}: el número de prueba no se reconoce como tarjeta`);
        afirmar(pii.sinTarjetas(grupos.join("")) === "[tarjeta omitida]", `${marca} pegada`);
        for (const [nombre, sep] of Object.entries(SEPARADORES)) {
          const texto = `pago con ${grupos.join(sep)} gracias`;
          for (const f of [pii.sinTarjetas, pii.minimizar]) {
            afirmar(f(texto) === "pago con [tarjeta omitida] gracias", `${marca} con ${nombre}: ${f.name} → ${JSON.stringify(f(texto))}`);
          }
        }
        const conParentesis = `(${grupos[0]}) ${grupos.slice(1).join(" ")}`;
        afirmar(!/\d/.test(pii.sinTarjetas(conParentesis)), `${marca} con paréntesis → ${pii.sinTarjetas(conParentesis)}`);
      }
    });
    await prueba("A1 · el CVV/CVC se va en el mismo renglón y en el siguiente, y ninguna marca repite dígitos", () => {
      const casos = [CASO_CODEX, CON_TABS, CVV_ABAJO, "4111 1111 1111 1111 cvv 123", "4111 1111 1111 1111 CVV: 123",
        "4111\u{a0}1111\u{a0}1111\u{a0}1111 CVC\u{a0}987", "4111 1111 1111 1111\ncvc\t4567", "4111 1111 1111 1111\r\nCVV2:\r\n123",
        "5555 5555 5555 4444\ncódigo de seguridad:\n321", "3782 822463 10005 CID 1234", "cvv 123 de la 4111 1111 1111 1111",
        "4111 1111 1111 1111 123", "4111 1111 1111 1111\n123", "tarjeta:\u{a0}4242\u{2009}4242\u{2009}4242\u{2009}4242 cvv123"];
      for (const caso of casos) {
        for (const f of [pii.sinTarjetas, pii.minimizar]) {
          const r = f(caso);
          /* Ni un dígito (fuera del nombre «CVV2»): la marca no repite los
             últimos cuatro ni el código. */
          afirmar(!/\d/.test(r.replace(/c[vc][vc]2/gi, "")) && r.includes("[tarjeta omitida]"),
            `${f.name}(${JSON.stringify(caso)}) → ${JSON.stringify(r)}`);
        }
      }
      for (const caso of [CASO_CODEX, "cvv\n123", "CVC:\t\u{a0}456", "código de seguridad\n789"]) {
        afirmar(pii.sinTarjetas(caso).includes("[código omitido]") && !/\d{3}/.test(pii.sinTarjetas(caso)), `código sin omitir: ${JSON.stringify(caso)}`);
      }
      afirmar(pii.contactoEscrito([CASO_CODEX, CON_TABS]).telefono === null, "una tarjeta se extrajo como teléfono de contacto");
      afirmar(pii.contactoEscrito(["cel 55\u{a0}0000\u{a0}5678"]).telefono?.replace(/\D/g, "") === "5500005678",
        "un teléfono con espacio duro ya no se retiene para el registro de interés");
    });
    await prueba("A1 · cantidades, SKU, CP, teléfonos, folios, fechas y medidas no se vuelven tarjeta", () => {
      const intactos = ["Quiero 2 kits de endodoncia y 1500 piezas de PLA", "cantidades: 100, 250, 500 y 1000",
        "3 cajas de 120 y 4 de 240", "Precio $1,245.00 más $1,500.00", "total 12450.00 + 1500.00 + 999.99",
        "SKU ValEnd, ValPulpo y Endotnissin", "SKU 4111-1111", "CP 42083", "envío a 03330 o 42083", "cp: 42083 y 01000",
        "folio VQ-MFZ3K2A1-4F2A9C", "folio VQ-LX3K9-2B7F1A", "pedido #1045 y #1046", "28/09/2026", "del 28/09/2026 al 05/10/2026",
        "2026-09-28 a 2026-10-05", "28-09-2026\n05-10-2026", "medidas 20 x 30 x 15 cm", "200 x 200 x 250 mm",
        "1.75 mm y 2.85 mm", "caja de 30.5 x 22.0 x 10.5 cm, 1.2 kg", "hora 14:00 a 18:30", "RFC XAXX010101000",
        "tengo 3 dudas: 1) precio 2) envío 3) tiempo", "lista:\n2\n3\n15\n120"];
      for (const t of intactos) {
        afirmar(pii.sinTarjetas(t) === t, `el navegador alteró «${t}» → «${pii.sinTarjetas(t)}»`);
        afirmar(pii.minimizar(t) === t, `el servidor alteró «${t}» → «${pii.minimizar(t)}»`);
      }
      const telefonos = ["+52 771 795 9131", "771 795 9131", "(771) 795-9131", "+52 1 55 0000 1234", "5215500001234",
        "+1 (415) 555-0132", "+44 20 7946 0958", "55\u{a0}0000\u{a0}5678", "55\t0000\t5678"];
      for (const t of telefonos) {
        afirmar(pii.sinTarjetas(t) === t, `un teléfono se tomó por tarjeta: «${t}» → «${pii.sinTarjetas(t)}»`);
        afirmar(pii.minimizar(t) === "[teléfono omitido]", `«${t}» → «${pii.minimizar(t)}»`);
      }
      /* Largos, pero sin prefijo y longitud de marca o sin Luhn: tampoco. */
      for (const t of ["1000 1500 2000 2500", "2000 2500 3000 3500", "lote 2025-0001-4455", "4111 1111 1111 1112",
        "28.09.2026 - 05.10.2026", "cuenta 000000000000000000", "modelo ABC4111111111111111"]) {
        afirmar(!pii.sinTarjetas(t).includes("[tarjeta omitida]") && !pii.minimizar(t).includes("[tarjeta omitida]"),
          `«${t}» se tomó por tarjeta`);
      }
    });
    await prueba("A1 · 24 000 caracteres hostiles se sanean en tiempo lineal", () => {
      for (const hostil of ["4".repeat(24000), "1 ".repeat(12000), "123\n".repeat(6000), "4111\u{a0}".repeat(4800),
        "cvv:\n".repeat(4800), "a.".repeat(12000), "(1)".repeat(8000)]) {
        const t0 = process.hrtime.bigint();
        pii.minimizar(hostil); pii.sinTarjetas(hostil); pii.contactoEscrito([hostil]);
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;
        afirmar(ms < 300, `${JSON.stringify(hostil.slice(0, 8))}… tardó ${ms.toFixed(0)} ms`);
      }
    });
    await prueba("localStorage.vq_comprador_v1 (de 837b3bc) se purga al arrancar y no se restaura", () => {
      const viejo = { nombre: "Persona Antigua", whatsapp: "520001112233", email: "antigua@correo.invalid",
        cp: "42083", direccion: "Calle Vieja 1, Centro" };
      const local = new Map([["vq_comprador_v1", JSON.stringify(viejo)], ["vq_carrito_v1", "[]"], ["vq_cp", "42083"]]);
      entrega.purgarCompradorAntiguo({ removeItem: k => local.delete(k) });
      afirmar(!local.has("vq_comprador_v1"), "los datos del comprador anterior siguen en localStorage");
      afirmar(local.has("vq_carrito_v1") && local.has("vq_cp"), "la purga se llevó el carrito o el CP");
      entrega.purgarCompradorAntiguo({ removeItem() { throw new Error("SecurityError"); } });   // bloqueado: no rompe
      afirmar(entrega.LLAVES_LOCALES_OBSOLETAS.includes("vq_comprador_v1"), "la llave vieja salió de la lista de purga");
      /* Cableado: arrancar() purga ANTES de leer al comprador, y el comprador
         ya no lee de localStorage (Memoria sin «persistente»). */
      const front = leer("assets/js/app.js").replace(/\/\*[\s\S]*?\*\//g, "");
      afirmar(/function arrancar\(\) \{\s*try \{ purgarCompradorAntiguo\(localStorage\); \} catch \{\s*\}[\s\S]*?Comprador\.cargar\(\);/.test(front),
        "arrancar() no purga el comprador viejo antes de Comprador.cargar()");
      const comprador = front.slice(front.indexOf("const Comprador = {"), front.indexOf("revisar(id, bruto)"));
      afirmar(/Memoria\.leer\(this\.LLAVE\)/.test(comprador) && !/Memoria\.(leer|escribir)\(this\.LLAVE,[^)]*true\)/.test(comprador) &&
        !/localStorage\.(getItem|setItem)\(this\.LLAVE/.test(comprador), "el comprador volvió a usar localStorage");
    });
    await prueba("junto al chat, en el prompt y en el aviso: política comercial genérica, sin lógica clínica", () => {
      /* Valquiria Inc es un e-commerce de material didáctico: la política del
         chat es la de cualquier tienda, no la de un sistema clínico. */
      const html = leer("index.html");
      const pie = (html.match(/<p class="asesor-legal">([\s\S]*?)<\/p>/) || [])[1].replace(/\s+/g, " ");
      afirmar(pie.includes("No compartas contraseñas, datos de tarjeta, datos personales sensibles ni información privada de terceros."),
        `el aviso junto al chat no tiene la política genérica: «${pie.trim()}»`);
      const prompt = leer("server.js").match(/const SYSTEM_PROMPT = `([\s\S]*?)`;/)[1];
      afirmar(/Nunca pidas en el chat contraseñas, datos de tarjeta, datos personales\s+sensibles ni información privada de terceros/.test(prompt) &&
        /no los repitas ni los uses/.test(prompt), "el prompt ya no prohíbe pedir ni usar datos sensibles");
      const seccionesChat = [pie, prompt.slice(prompt.indexOf("11 · LÍMITES")),
        html.slice(html.indexOf("<h3>2. Datos personales"), html.indexOf("<h3>5. Transferencias")),
        html.slice(html.indexOf("<h3>8. Conservación"), html.indexOf("<h3>9. Cambios"))];
      for (const texto of seccionesChat) {
        afirmar(!/pacient|expediente|radiograf|cl[ií]nic/i.test(texto), "volvió lógica clínica a la política del chat o del aviso");
      }
      const plano = html.replace(/\s+/g, " ");
      afirmar(!plano.includes("No recabamos datos personales sensibles"),
        "el aviso vuelve a afirmar en absoluto que no se recaban sensibles");
      afirmar(plano.includes("No solicitamos ni pretendemos tratar datos personales sensibles") &&
        plano.includes("No podemos impedir técnicamente que alguien los escriba"),
        "el aviso no dice que no se solicitan, ni que escribirlos no se puede impedir");
      afirmar(plano.includes("no se envían al modelo"), "el aviso no dice que los datos de entrega no van al modelo");
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
      cabeceras: { ...visitante(n), ...extra },
      cuerpo: { items: [{ sku: "ValEnd", cantidad: 1 }], comprador: {}, visitante: crypto.randomUUID() } });
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
    await prueba("estrenar un visitante en cada intento no esquiva el límite por IP", async () => {
      const codigos = [];
      for (let i = 0; i < 7; i++) {
        codigos.push((await pedir(B, "/api/pago", { metodo: "POST", cabeceras: visitante(162),
          cuerpo: { items: [{ sku: "ValEnd", cantidad: 1 }], comprador: {}, visitante: crypto.randomUUID() } })).status);
      }
      afirmar(codigos[6] === 429, `secuencia ${codigos.join(",")}: el visitante nuevo reinició el cupo`);
    });

    /* La red se calcula sobre la dirección NORMALIZADA. Antes el /64 salía de
       partir el texto por «:», y `2001:db8::1` daba la clave «2001:db8::1::/64»:
       con cada último grupo nuevo, un contador nuevo. */
    const { claveDeRed, crearIdentidad } = require("./identidad.js");
    await prueba("una IPv4 válida es su propia red; 999.999.999.999 y la basura no son IP", () => {
      afirmar(claveDeRed("198.51.100.7") === "198.51.100.7", "una IPv4 válida no se reconoció");
      for (const malo of ["999.999.999.999", "01.2.3.4", "1.2.3", "abc:", "::::::", "2001:db8::1::2", ""]) {
        afirmar(claveDeRed(malo) === null, `«${malo}» pasó por IP`);
      }
      const red = crearIdentidad({ RENDER: "true" });
      afirmar(red.identidad({ get: () => "999.999.999.999", ip: "203.0.113.9" }) === "203.0.113.9",
        "una cabecera que no es IP se usó como identidad");
    });
    await prueba("dos IPv6 del mismo /64 son una red; de /64 distintos, dos", () => {
      afirmar(claveDeRed("2001:db8:abcd:12::1") === "2001:db8:abcd:12::/64", claveDeRed("2001:db8:abcd:12::1"));
      afirmar(claveDeRed("2001:db8:abcd:12::2") === claveDeRed("2001:db8:abcd:12::1"), "el mismo /64 dio dos redes");
      afirmar(claveDeRed("2001:db8:abcd:13::1") !== claveDeRed("2001:db8:abcd:12::1"), "dos /64 distintos dieron la misma red");
    });
    await prueba("las formas comprimidas, expandidas y en mayúsculas de una IPv6 son la misma red", () => {
      const grupos = [
        ["2001:db8:abcd:12::1", "2001:0DB8:ABCD:0012:0000:0000:0000:0001", "2001:db8:abcd:12:0:0:0:1", "2001:db8:abcd:0012::0:ffff"],
        ["2001:db8::1", "2001:db8:0:0:ffff::2", "2001:0db8:0000:0000::", "2001:DB8::"],
        ["::ffff:198.51.100.7", "::FFFF:c633:6407", "198.51.100.7"],
        ["fe80::1%eth0", "fe80:0:0:0::2"]
      ];
      for (const g of grupos) {
        const claves = new Set(g.map(claveDeRed));
        afirmar(claves.size === 1 && !claves.has(null), `${g.join(" | ")} dieron ${[...claves].join(" | ")}`);
      }
    });
    const pagoDesde = ip => pedir(B, "/api/pago", { metodo: "POST", cabeceras: { "CF-Connecting-IP": ip },
      cuerpo: { items: [{ sku: "ValEnd", cantidad: 1 }], comprador: {}, visitante: crypto.randomUUID() } }).then(r => r.status);
    await prueba("cambiar el último grupo de una IPv6 comprimida no reinicia el cupo de pagos", async () => {
      const codigos = [];
      /* Con dos grupos antes de «::» el corte por texto metía el último grupo
         en la clave: `2001:db8::1` y `2001:db8::2` eran dos contadores. */
      for (let i = 1; i <= 7; i++) codigos.push(await pagoDesde(`2001:db8::${i}`));
      afirmar(codigos[6] === 429, `secuencia ${codigos.join(",")}: cada dirección del /64 tuvo su propio cupo`);
    });
    await prueba("escribir la misma IPv6 de otra forma no reinicia el cupo de pagos", async () => {
      const formas = ["2001:db8:77:1::1", "2001:0db8:0077:0001::2", "2001:db8:77:1:0:0:0:3", "2001:DB8:77:1::A",
        "2001:0DB8:0077:0001:0000:0000:0000:0001", "2001:db8:77:1:ffff:ffff:ffff:ffff", "2001:db8:77:1::5"];
      const codigos = [];
      for (const ip of formas) codigos.push(await pagoDesde(ip));
      afirmar(codigos[6] === 429, `secuencia ${codigos.join(",")}: una variante textual abrió un contador nuevo`);
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
    seccion("SQL productivo · adaptador confiable; herramientas del modelo aisladas");
    // =====================================================================
    /* El adaptador productivo verifica al proveedor y escribe evento/estado/outbox
       juntos. Las herramientas del modelo NO adquieren capacidad SQL directa. */
    const PROHIBIDOS_2B = ["services/payments.js", "services/orders.js", "services/inventory.js",
      "db/pool.js", "repositories/core.js"];
    const { dependenciasDe, grafoDesde } = require("./scripts/grafo-dependencias.js");
    const relativos = g => g.modulos.map(m => path.relative(RAIZ, m));
    /* Fixtures en un directorio temporal que apuntan a los archivos 2B reales. */
    const sonda = archivos => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vq-sonda-2b-"));
      for (const [nombre, codigo] of Object.entries(archivos)) fs.writeFileSync(path.join(dir, nombre), codigo);
      return { dir, entrada: path.join(dir, Object.keys(archivos)[0]), limpiar: () => fs.rmSync(dir, { recursive: true, force: true }) };
    };
    const real = f => JSON.stringify(path.join(RAIZ, f));

    await prueba("server alcanza SQL por el adaptador; gemini-tools y frontend no adquieren capacidad SQL", () => {
      const g = grafoDesde(path.join(RAIZ, "server.js"));
      const modulos = relativos(g);
      afirmar(modulos.length > 10, `el recorrido solo vio ${modulos.length} módulos: la prueba no mira nada`);
      afirmar(!g.dudosos.length, `hay cargas que el análisis no puede seguir (falla cerrado): ${g.dudosos.join(" | ")}`);
      const conectados = modulos.filter(m => PROHIBIDOS_2B.includes(m));
      afirmar(conectados.length === PROHIBIDOS_2B.length && modulos.includes("services/postgres-runtime.js"), "falta la integración SQL confiable");
      afirmar(g.externos.includes("pg"), "falta el driver del adaptador SQL");
      for (const entry of ["gemini-tools.js", "assets/js/app.js"]) {
        const isolated = grafoDesde(path.join(RAIZ, entry));
        afirmar(!relativos(isolated).some(m => PROHIBIDOS_2B.includes(m) || m === "services/postgres-runtime.js"), `${entry} adquiere autoridad SQL`);
        afirmar(!isolated.externos.includes("pg"), `${entry} carga pg`);
      }
    });
    await prueba("modo legacy explícito no carga servicios SQL ni driver pg", async () => {
      const hijo = spawn(process.execPath, ["-e",
        "require(process.argv[1]); setTimeout(() => { process.stdout.write(\"\\n@@MODULOS@@\" + JSON.stringify(Object.keys(require.cache)), () => process.exit(0)); }, 1500);",
        path.join(RAIZ, "server.js")], {
        env: { ...process.env, PORT: "0", NODE_ENV: "test", AVISOS_SILENCIO: "1", GEMINI_API_KEY: "clave-falsa-de-pruebas",
          PERSISTENCIA: "legacy", ALMACEN_RUTA: "", DATABASE_URL: undefined, TEST_DATABASE_URL: undefined, RENDER: undefined },
        stdio: ["ignore", "pipe", "ignore"] });
      let salida = "";
      hijo.stdout.on("data", d => (salida += d));
      await new Promise(r => hijo.once("exit", r));
      const cargados = JSON.parse(salida.slice(salida.indexOf("@@MODULOS@@") + "@@MODULOS@@".length));
      const propios = cargados.filter(f => !f.includes(`${path.sep}node_modules${path.sep}`)).map(f => path.relative(RAIZ, f));
      afirmar(propios.includes("server.js") && propios.includes("gemini-tools.js"), `no arrancó el servidor real: ${propios.join(", ")}`);
      const conectados = propios.filter(m => PROHIBIDOS_2B.includes(m));
      afirmar(!conectados.length, `al arrancar se cargó 2B: ${conectados.join(", ")}`);
      afirmar(!cargados.some(f => f.includes(`${path.sep}node_modules${path.sep}pg${path.sep}`)), "al arrancar se cargó el driver pg");
    });
    await prueba("el análisis reconoce cada forma de import, CommonJS y ESM", () => {
      const casos = {
        "require('./x')": "require", 'import("./x")': "import()", 'import x from "./x";': "import estático",
        'import { a, b as c } from "./x";': "import estático", 'import * as n from "./x";': "import estático",
        'import "./x";': "import de efecto", 'export { a } from "./x";': "export … from", 'export * from "./x";': "export … from",
        'export * as n from "./x";': "export … from",
        "const x = `${require('./x')}`;": "require"
      };
      for (const [codigo, forma] of Object.entries(casos)) {
        const { deps, dudosos } = dependenciasDe(codigo);
        afirmar(deps.length === 1 && deps[0].forma === forma && deps[0].especificador === "./x" && !dudosos.length,
          `«${codigo}» → ${JSON.stringify({ deps, dudosos })}`);
      }
      /* Lo que solo parece una carga no lo es: comentarios, cadenas y regex. */
      const inocente = dependenciasDe('// require("./x")\n/* import "./y" */\nconst s = "require(\'./z\')";\n' +
        'const re = /require\\("w"\\)/g; const t = typeof re / 2;');
      afirmar(!inocente.deps.length && !inocente.dudosos.length, `falso positivo: ${JSON.stringify(inocente)}`);
    });
    await prueba("el análisis falla cerrado ante cargas dinámicas o que no puede seguir", () => {
      const dudosas = ["require(nombre)", "import(`./services/${x}.js`)", "const r = require; r('./x')",
        "module.require('./x')", "const { createRequire } = m; createRequire(u)('./x')", "eval(codigo)",
        "new Function('return 1')", "require.resolve('./x')", "const s = 'sin cerrar", "vm.runInThisContext(c)",
        "globalThis['require']('./x')", "module['require']('./x')", "({}).constructor.constructor('return 1')()",
        "const cargar = m => import(m)", "process['mainModule'].require('./x')",
        /* El lexer se confunde (regex tras «)»): no entiende → dudoso. */
        "if (x) /\"/.test(s); require('./x')"];
      for (const codigo of dudosas) {
        const { dudosos } = dependenciasDe(codigo);
        afirmar(dudosos.length > 0, `«${codigo}» pasó como seguro`);
      }
    });
    await prueba("el recorrido detecta 2B por require, import, export y a través de otro módulo", () => {
      const variantes = [
        { "a.js": `require(${real("services/payments.js")});` },
        { "a.mjs": `import { applyVerifiedPayment } from ${real("services/payments.js")};` },
        { "a.mjs": `import ${real("db/pool.js")};` },
        { "a.mjs": `export * from ${real("services/orders.js")};` },
        { "a.mjs": `export { releaseReservation } from ${real("services/inventory.js")};` },
        { "a.js": `const m = import(${real("repositories/core.js")});` },
        /* Lateral: el servidor carga un módulo inocente que reexporta 2B. */
        { "a.js": 'require("./util.mjs");', "util.mjs": `export * from ${real("services/orders.js")};` }
      ];
      for (const archivos of variantes) {
        const s = sonda(archivos);
        try {
          const g = grafoDesde(s.entrada);
          const conectados = relativos(g).filter(m => PROHIBIDOS_2B.includes(m));
          afirmar(conectados.length > 0, `no vio 2B en ${JSON.stringify(archivos)}`);
        } finally { s.limpiar(); }
      }
      const dinamico = sonda({ "a.js": "const n = './services/payments.js'; require(n);" });
      try { afirmar(grafoDesde(dinamico.entrada).dudosos.length > 0, "un require con variable pasó como seguro"); }
      finally { dinamico.limpiar(); }
    });
    await prueba("escapes en cadenas e identificadores (require(\"\\x70g\"), r\\u0065quire) fallan cerrado", async () => {
      /* Las dos evasiones LOW de Codex. El lexer no decodifica escapes: leía
         «\x70g» como «x70g» y no veía `require` escrito con \u0065. Ahora
         cualquier especificador o nombre escrito con escapes es dudoso. */
      const B = String.fromCharCode(92);
      const evasiones = [
        `require("${B}x70g")`, `require('${B}x70g')`, `require(\`${B}x70g\`)`, `import("${B}u0070g")`,
        `import x from "${B}x70g";`, `export * from "./serv${B}x69ces/payments.js";`,
        `r${B}u0065quire("pg")`, `const r = r${B}u{65}quire; r("./x")`, `globalThis["${B}x72equire"]("pg")`,
        `m${B}u006fdule.require("pg")`
      ];
      for (const codigo of evasiones) {
        const { deps, dudosos } = dependenciasDe(codigo);
        afirmar(dudosos.length > 0 && !deps.some(d => d.especificador === "pg" || /x70g|u0070g/.test(d.especificador)),
          `«${codigo}» pasó como seguro: ${JSON.stringify({ deps, dudosos })}`);
      }
      /* Un escape dentro de una cadena que NO es un especificador sigue siendo
         normal: el grafo productivo tiene muchos. */
      const normal = dependenciasDe(`const s = "hola${B}n"; require("./x");`);
      afirmar(normal.deps.length === 1 && !normal.dudosos.length, `falso positivo: ${JSON.stringify(normal)}`);
      /* Y son evasiones de verdad: Node las carga. En un directorio aparte, un
         objetivo inocente; el recorrido lo marca dudoso sin verlo. */
      for (const [nombre, codigo] of [["cadena", `require("${B}x2e/objetivo.js");`],
                                      ["identificador", `r${B}u0065quire("./objetivo.js");`]]) {
        const s = sonda({ "a.js": codigo, "objetivo.js": "globalThis.__cargado = true;" });
        try {
          const g = grafoDesde(s.entrada);
          afirmar(g.dudosos.length > 0 && !relativos(g).some(m => m.endsWith("objetivo.js")),
            `${nombre}: el recorrido no falló cerrado: ${JSON.stringify(g.dudosos)}`);
          const r = await new Promise(ok => {
            const h = spawn(process.execPath, ["-e", `require(${JSON.stringify(s.entrada)}); process.stdout.write(String(globalThis.__cargado))`],
              { stdio: ["ignore", "pipe", "ignore"] });
            let out = ""; h.stdout.on("data", d => (out += d)); h.once("exit", () => ok(out));
          });
          afirmar(r === "true", `${nombre}: la fixture no es una evasión real (Node no cargó el objetivo)`);
        } finally { s.limpiar(); }
      }
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
    await prueba("engines.node declara el mínimo que exigen las dependencias instaladas, y este Node lo cumple", () => {
      /* package.json decía >=18 y @google/genai 1.52 exige >=20: Render podía
         elegir un Node con el que el SDK no promete funcionar. */
      const pkg = JSON.parse(leer("package.json"));
      const lock = JSON.parse(leer("package-lock.json"));
      const minimo = r => { const m = String(r).match(/>=?\s*(\d+)(?:\.(\d+))?/); return m ? [Number(m[1]), Number(m[2] || 0)] : null; };
      const cmp = (x, y) => x[0] - y[0] || x[1] - y[1];
      let exigido = [0, 0], quien = "";
      for (const [nombre, p] of Object.entries(lock.packages || {})) {
        if (!nombre || p.dev || !p.engines?.node) continue;
        const m = minimo(p.engines.node);
        if (m && cmp(m, exigido) > 0) { exigido = m; quien = `${nombre.replace(/^node_modules\//, "")}@${p.version} (${p.engines.node})`; }
      }
      const declarado = minimo(pkg.engines?.node);
      afirmar(declarado && cmp(declarado, exigido) >= 0, `package.json declara ${pkg.engines?.node}, pero ${quien} exige más`);
      afirmar(lock.packages[""]?.engines?.node === pkg.engines.node, "package-lock.json no refleja el engines de package.json");
      for (const [nombre, p] of Object.entries(lock.packages)) {
        if (!nombre || p.dev || !fs.existsSync(path.join(RAIZ, nombre, "package.json"))) continue;
        afirmar(JSON.parse(leer(path.join(nombre, "package.json"))).version === p.version, `${nombre} instalado no es el del lock`);
      }
      const actual = process.versions.node.split(".").map(Number);
      afirmar(cmp(actual, declarado) >= 0, `este Node (${process.version}) no cumple ${pkg.engines.node}`);
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
  seccion("16 · Frontera de confianza — CF-Connecting-IP solo donde Render lo garantiza");
  // =======================================================================
  {
    const { confiaEnCloudflare, crearIdentidad } = require("./identidad.js");
    await prueba("se cree en Render, no fuera, y en pruebas solo si se pide", () => {
      const casos = [
        [{ RENDER: "true" }, true],
        [{}, false],
        [{ NODE_ENV: "production" }, false],
        [{ NODE_ENV: "test", SIMULAR_CLOUDFLARE_EN_PRUEBAS: "1" }, true],
        [{ NODE_ENV: "production", SIMULAR_CLOUDFLARE_EN_PRUEBAS: "1" }, false],
        [{ RENDER: "true", IP_CABECERA_CONFIABLE: "" }, false],
        [{ RENDER: "true", IP_CABECERA_CONFIABLE: "x-real-ip" }, false],
        [{ RENDER: "true", IP_CABECERA_CONFIABLE: "CF-Connecting-IP" }, true]
      ];
      for (const [env, esperado] of casos) {
        afirmar(confiaEnCloudflare(env) === esperado, `${JSON.stringify(env)} → ${!esperado}`);
      }
      afirmar(crearIdentidad({}).trustProxy === false, "fuera de Render se cree X-Forwarded-For");
      afirmar(crearIdentidad({ RENDER: "true" }).trustProxy === 1, "en Render no se cree al proxy de Render");
    });
    await prueba("apagar la confianza en Render falla cerrado: sin trust proxy y con la IP del socket", () => {
      const apagada = crearIdentidad({ RENDER: "true", IP_CABECERA_CONFIABLE: "" });
      afirmar(apagada.trustProxy === false, `trust proxy quedó en ${apagada.trustProxy} con la confianza apagada`);
      const req = { get: () => "203.0.113.5", ip: "198.51.100.1", socket: { remoteAddress: "::ffff:10.0.0.7" } };
      afirmar(apagada.identidad(req) === "10.0.0.7",
        `usó ${apagada.identidad(req)} en vez de la dirección del socket`);
      afirmar(crearIdentidad({ RENDER: "true" }).identidad({ ...req, get: () => "no-es-ip" }) === "198.51.100.1",
        "con Cloudflare, una cabecera inválida no cayó al salto que puso el proxy de Render");
    });

    const intentos = async (base, cabeceras) => {
      const codigos = [];
      for (const c of cabeceras) {
        codigos.push((await pedir(base, "/api/pago", { metodo: "POST", cabeceras: c,
          cuerpo: { items: [{ sku: "ValEnd", cantidad: 1 }], comprador: {}, visitante: crypto.randomUUID() } })).status);
      }
      return codigos;
    };
    const rotando = (n, nombre, prefijo) => Array.from({ length: n }, (_, i) => ({ [nombre]: `${prefijo}${i + 1}` }));

    const fuera = arrancar({ SIMULAR_CLOUDFLARE_EN_PRUEBAS: undefined }, PUERTO_APP + 3);
    try {
      await prueba("fuera de Render, rotar CF-Connecting-IP o X-Forwarded-For no crea visitantes nuevos", async () => {
        afirmar(await fuera.listo, "el servidor no arrancó");
        afirmar(fuera.logs.some(l => l.includes("Red del visitante: socket · trust proxy: false")),
          "el arranque no declara que fuera de Render solo cuenta el socket");
        const codigos = await intentos(fuera.base, [
          ...rotando(6, "CF-Connecting-IP", "203.0.113."), ...rotando(2, "X-Forwarded-For", "192.0.2.")]);
        afirmar(codigos[6] === 429 && codigos[7] === 429,
          `secuencia ${codigos.join(",")}: una cabecera elegida por el cliente abrió un contador nuevo`);
      });
    } finally { await fuera.parar(); }

    const enRender = arrancar({ SIMULAR_CLOUDFLARE_EN_PRUEBAS: undefined, NODE_ENV: "production", RENDER: "true",
      SITIO_URL: "https://valquiriainc.com" }, PUERTO_APP + 4);
    try {
      await prueba("en Render, CF-Connecting-IP identifica a cada visitante", async () => {
        afirmar(await enRender.listo, "el servidor no arrancó");
        afirmar(enRender.logs.some(l => l.includes("Red del visitante: CF-Connecting-IP · trust proxy: 1")),
          "el arranque no declara que en Render se cree a Cloudflare");
        const distintos = await intentos(enRender.base, rotando(7, "CF-Connecting-IP", "203.0.113."));
        afirmar(!distintos.includes(429), `secuencia ${distintos.join(",")}: siete visitantes compartieron cupo`);
        const mismo = await intentos(enRender.base, Array(7).fill(visitante(9)));
        afirmar(mismo[6] === 429, `secuencia ${mismo.join(",")}: el mismo visitante no se frenó`);
      });
    } finally { await enRender.parar(); }

    const apagado = arrancar({ SIMULAR_CLOUDFLARE_EN_PRUEBAS: undefined, NODE_ENV: "production", RENDER: "true",
      IP_CABECERA_CONFIABLE: "", SITIO_URL: "https://valquiriainc.com" }, PUERTO_APP + 5);
    try {
      await prueba("en Render con la confianza apagada, el «socket» del log es el socket de verdad", async () => {
        afirmar(await apagado.listo, "el servidor no arrancó");
        afirmar(apagado.logs.some(l => l.includes("Red del visitante: socket · trust proxy: false")),
          "el arranque no declara socket y trust proxy apagado");
        const codigos = await intentos(apagado.base, [
          ...rotando(4, "CF-Connecting-IP", "203.0.113."), ...rotando(4, "X-Forwarded-For", "192.0.2.")]);
        afirmar(codigos[6] === 429 && codigos[7] === 429,
          `secuencia ${codigos.join(",")}: una cabecera del cliente cambió la identidad`);
        const frenos = apagado.logs.filter(l => l.includes("[rate-limit:pago]"));
        afirmar(frenos.length && frenos.every(l => l.includes("] 127.0.0.1 frenada")),
          `el limitador contó a alguien distinto del socket: ${frenos.join(" | ")}`);
        afirmar(!frenos.some(l => /203\.0\.113\.|192\.0\.2\./.test(l)), "una IP forjada llegó a ser identidad");
      });
    } finally { await apagado.parar(); }
  }

  // =======================================================================
  seccion("PII comercial — lo que llega al proveedor de IA (servidor aparte)");
  // =======================================================================
  {
    /* Servidor propio: el principal ya gastó su techo global de IA a propósito. */
    const ia = arrancar({ GEMINI_TOPE_DIARIO: "50", RATE_LIMIT_POR_MINUTO: "100" }, PUERTO_APP + 6);
    const charla = (n, texto) => pedir(ia.base, "/api/chat", { metodo: "POST", cabeceras: visitante(n),
      cuerpo: { messages: [{ role: "user", parts: [{ text: texto }] }], carrito: [] } });
    /* Solo la conversación que recibió el proveedor, sin el prompt del sistema. */
    const conversacionEnviada = () => {
      const c = JSON.parse(falso.cuerposGemini[falso.cuerposGemini.length - 1]);
      return (c.contents || []).flatMap(x => (x.parts || []).map(p => p.text || "")).join("\n");
    };
    try {
      await prueba("una conversación comercial normal llega intacta al proveedor", async () => {
        afirmar(await ia.listo, "el servidor no arrancó");
        const texto = "¿Cuánto cuesta el kit de endodoncia? Quiero 2 piezas, envío a 42083; el total fue $1,245.00";
        const r = await charla(201, texto);
        afirmar(r.status === 200, `respondió ${r.status}`);
        afirmar(conversacionEnviada().includes(texto), "se alteró un mensaje comercial normal");
      });
      await prueba("correo, teléfono y tarjeta evidentes no llegan al proveedor, y la marca no repite el dato", async () => {
        const r = await charla(202, "Soy Juan Pérez, mi teléfono es 55 0000 1122, mi correo es " +
          "juan.perez@correo.invalid y pago con 4111 1111 1111 1111 cvv 123");
        afirmar(r.status === 200, `respondió ${r.status}`);
        const enviado = conversacionEnviada();
        for (const crudo of ["correo.invalid", "juan.perez@", "0000 1122", "4111", "cvv 123"]) {
          afirmar(!enviado.includes(crudo), `el proveedor recibió «${crudo}»`);
        }
        afirmar(!/\d{4}/.test(enviado.replace(/\s/g, "")), "quedaron dígitos del teléfono o de la tarjeta");
        for (const marca of ["[teléfono omitido]", "[correo omitido]", "[tarjeta omitida]", "[código omitido]"]) {
          afirmar(enviado.includes(marca), `falta la marca ${marca}`);
        }
        afirmar(!ia.logs.some(l => /correo\.invalid|5500001122|0000 1122|4111/.test(l)), "el dato quedó en los logs");
      });
      await prueba("un registro de interés conserva el contacto aunque el modelo solo vio la marca", async () => {
        const r = await charla(203, "#lead Quiero imprimir 40 piezas; mi WhatsApp es 55 0000 3344 y mi correo prospecto@correo.invalid");
        afirmar(r.status === 200, `respondió ${r.status}`);
        const vistos = falso.cuerposGemini.slice(-2).join("\n");
        afirmar(!vistos.includes("prospecto@correo.invalid") && !vistos.includes("0000 3344"),
          "el modelo recibió el contacto del prospecto");
        const leads = (await pedir(ia.base, "/api/leads", { cabeceras: { ...visitante(204), "X-Leads-Token": TOKEN } })).json;
        const lead = (leads?.leads || []).find(l => /40 piezas/.test(l.resumen || ""));
        afirmar(lead, "no se registró el interés");
        afirmar(/55 0000 3344/.test(lead.contacto || "") && /prospecto@correo\.invalid/.test(lead.contacto || ""),
          `el lead perdió el contacto: ${lead.contacto}`);
      });
      await prueba("A1 · el caso de Codex, con tabs o con el CVV abajo no llega al proveedor, ni a los avisos, ni a los logs", async () => {
        /* Por /api/chat SIN pasar por el navegador: la minimización del
           servidor tiene que sostenerse sola. */
        for (const [i, caso] of [CASO_CODEX, CON_TABS, CVV_ABAJO].entries()) {
          const r = await charla(206 + i, caso);
          afirmar(r.status === 200, `respondió ${r.status}`);
          const enviado = conversacionEnviada();
          afirmar(!rastroDeTarjeta(enviado) && !/\d/.test(enviado), `el proveedor recibió dígitos de ${JSON.stringify(caso)}: ${enviado}`);
          afirmar(enviado.includes("[tarjeta omitida]") && enviado.includes("[código omitido]"), "faltan las marcas");
          afirmar(!rastroDeTarjeta(r.texto), "la respuesta al navegador repite la tarjeta");
        }
        const actividad = (await resumenAdmin(ia.base, 209)).json.actividad || [];
        const preguntas = actividad.filter(e => e.tipo === "pregunta" && /tarjeta/.test(e.texto || ""));
        afirmar(preguntas.length >= 3, `solo hay ${preguntas.length} avisos de pregunta con la tarjeta omitida`);
        afirmar(preguntas.every(e => !/\d/.test(e.texto)), "un aviso lleva dígitos de la tarjeta");
        afirmar(!rastroDeTarjeta(JSON.stringify(actividad)), "la bitácora de avisos guarda la tarjeta");
        afirmar(!ia.logs.some(rastroDeTarjeta), "la tarjeta quedó en los logs");
      });
      await prueba("el checkout sigue funcionando con sus datos, que no pasan por la minimización del chat", async () => {
        const r = await crearPedido(ia.base, 205, [{ sku: "ValEnd", cantidad: 1 }]);
        afirmar(r.status === 200 && r.json?.url, `/api/pago respondió ${r.status}`);
      });
    } finally { await ia.parar(); }
  }

  // =======================================================================
  seccion("Leads concurrentes — cada aviso lleva los datos de SU conversación (servidor aparte)");
  // =======================================================================
  {
    /* Codex: A registra su lead y queda esperando al modelo; B registra y
       termina; termina A. El aviso de A tomaba contacto, nombre y resumen de
       B porque se leía el «último lead» del proceso. Aquí el Gemini falso
       retiene la segunda llamada de cada conversación hasta que la prueba la
       suelta, así que el orden lo decide la prueba y no la suerte. */
    const srv = arrancar({ GEMINI_TOPE_DIARIO: "200", GEMINI_TOPE_MINUTO: "200", RATE_LIMIT_POR_MINUTO: "200" }, PUERTO_APP + 8);
    const PERSONAS = Object.fromEntries("ABCDEFG".split("").map((x, i) =>
      [x, { tel: `55 0000 ${String(1001 + i * 1111).slice(0, 4)}`, correo: `cliente.${x.toLowerCase()}@correo.invalid` }]));
    const conversar = (x, n) => pedir(srv.base, "/api/chat", { metodo: "POST", cabeceras: visitante(n),
      cuerpo: { messages: [{ role: "user", parts: [{ text: `#lead:${x} Quiero imprimir 40 piezas; mi WhatsApp es ` +
        `${PERSONAS[x].tel} y mi correo ${PERSONAS[x].correo}` }] }], carrito: [] } });
    const frenar = x => { let soltar; falso.frenos.set(x, new Promise(r => (soltar = r))); return soltar; };
    const avisosDeLead = async () => ((await resumenAdmin(srv.base, 260)).json.actividad || []).filter(e => e.tipo === "lead");
    const comprobar = (avisos, r, x) => {
      afirmar(r.status === 200 && r.json?.lead?.folio, `${x} respondió ${r.status}`);
      const suyos = avisos.filter(e => e.folio === r.json.lead.folio);
      afirmar(suyos.length === 1, `${x}: ${suyos.length} avisos con su folio`);
      const a = suyos[0];
      afirmar(a.contacto?.includes(PERSONAS[x].tel) && a.contacto.includes(PERSONAS[x].correo), `aviso ${x} sin su contacto: ${a.contacto}`);
      afirmar(a.nombre === `Cliente ${x}` && a.resumen.startsWith(`Proyecto ${x}:`), `aviso ${x} con datos ajenos: ${a.nombre} / ${a.resumen}`);
      for (const y of Object.keys(PERSONAS).filter(y => y !== x)) {
        const t = JSON.stringify(a);
        afirmar(!t.includes(PERSONAS[y].tel) && !t.includes(PERSONAS[y].correo) && !t.includes(`Proyecto ${y}`) &&
          !t.includes(`Cliente ${y}`), `el aviso de ${x} lleva datos de ${y}`);
      }
      afirmar(!JSON.stringify(r.json).includes(PERSONAS[x].correo) && !r.texto.includes(PERSONAS[x].tel),
        `la respuesta al navegador de ${x} lleva su contacto`);
    };
    try {
      await prueba("A registra y espera, B registra y termina, luego A: cada aviso solo con lo suyo", async () => {
        afirmar(await srv.listo, "el servidor no arrancó");
        const soltarA = frenar("A");
        const pA = conversar("A", 61);
        await esperarRegistro("A");                // A ya registró y espera al modelo
        const rB = await conversar("B", 62);       // B termina primero
        soltarA();
        const rA = await pA;
        afirmar(rA.json?.lead?.folio && rB.json?.lead?.folio && rA.json.lead.folio !== rB.json.lead.folio,
          `los folios se cruzaron: ${rA.json?.lead?.folio} / ${rB.json?.lead?.folio}`);
        const avisos = await avisosDeLead();
        comprobar(avisos, rA, "A");
        comprobar(avisos, rB, "B");
      });
      await prueba("cinco conversaciones intercaladas, soltadas en otro orden: ningún aviso ni folio se cruza", async () => {
        const orden = ["C", "D", "E", "F", "G"];
        const soltar = Object.fromEntries(orden.map(x => [x, frenar(x)]));
        const promesas = Object.fromEntries(orden.map((x, i) => [x, conversar(x, 70 + i)]));
        await Promise.all(orden.map(esperarRegistro));  // las cinco registraron y esperan
        for (const x of ["F", "C", "G", "D", "E"]) { soltar[x](); await promesas[x]; }
        const respuestas = Object.fromEntries(await Promise.all(orden.map(async x => [x, await promesas[x]])));
        const folios = orden.map(x => respuestas[x].json?.lead?.folio);
        afirmar(new Set(folios).size === orden.length, `folios repetidos: ${folios.join(", ")}`);
        const avisos = await avisosDeLead();
        for (const x of orden) comprobar(avisos, respuestas[x], x);
      });
      await prueba("ni el teléfono ni el correo de ninguno llegó al proveedor de IA", () => {
        const todo = falso.cuerposGemini.join("\n");
        for (const [x, p] of Object.entries(PERSONAS)) {
          afirmar(!todo.includes(p.correo) && !todo.includes(p.tel) && !todo.includes(p.tel.replace(/\s/g, "")),
            `el proveedor recibió el contacto de ${x}`);
        }
        afirmar(todo.includes("[teléfono omitido]") && todo.includes("[correo omitido]"), "no se ve la minimización");
      });
      await prueba("el aviso ya no lee un «último lead» global: el lead viaja por un mapa de la petición", () => {
        const tools = leer("gemini-tools.js"), srvJs = leer("server.js");
        afirmar(!/ultimoLeadRegistrado|LEADS_EN_MEMORIA\s*\[\s*LEADS_EN_MEMORIA\.length/.test(tools + srvJs),
          "volvió la lectura del último lead global");
        afirmar(/ctx\.leads\.set\(lead\.id, lead\)/.test(tools) && /leads: leadsDeEstaConversacion/.test(srvJs),
          "registrar_interes ya no deja el lead en el mapa de la conversación");
      });
    } finally { await srv.parar(); }
  }

  // =======================================================================
  seccion("Abuso de reservas — nadie deja el stock en cero sin pagar (servidor aparte)");
  // =======================================================================
  {
    /* Inventario limpio. Cada atacante llega con su propia IP y su propio
       UUID —el caso distribuido—, pide 6 (el máximo por SKU) y, cada vez que
       el servidor dice que ya no cabe, vuelve a probar con una pieza menos,
       hasta que no cabe ni una. */
    const tienda = arrancar({}, PUERTO_APP + 7);
    const apartar = (ip, sku, cantidad) => pedir(tienda.base, "/api/pago", { metodo: "POST",
      cabeceras: { "CF-Connecting-IP": `203.0.113.${ip}` },
      cuerpo: { items: [{ sku, cantidad }], comprador: COMPRADOR, visitante: crypto.randomUUID() } });
    try {
      await prueba("atacantes con IPs y UUID distintos llenan el techo, pero ningún SKU queda en cero", async () => {
        afirmar(await tienda.listo, "el servidor no arrancó");
        const catalogo = (await resumenAdmin(tienda.base, 240)).json.inventario;
        let ip = 1;
        for (const p of catalogo) {
          let pide = 6;
          for (let vuelta = 0; vuelta < 30 && pide > 0; vuelta++) {
            const r = await apartar(ip++, p.sku, pide);
            if (r.status === 200) continue;
            afirmar(r.status === 400 && r.json?.motivo === "stock-protegido", `${p.sku}: ${r.status} ${r.json?.motivo}`);
            pide--;
          }
        }
        const despues = (await resumenAdmin(tienda.base, 241)).json.inventario;
        for (const p of despues) {
          const techo = Math.min(Math.floor(p.stock_declarado * 0.5), p.stock_declarado - 1);
          afirmar(p.apartado_ahora === techo, `${p.sku}: apartado ${p.apartado_ahora} con techo ${techo}`);
          afirmar(p.disponible === p.stock_declarado - techo && p.disponible >= 1,
            `${p.sku}: disponible ${p.disponible} de ${p.stock_declarado}`);
        }
      });
      await prueba("con el techo lleno, quien sí va a comprar cae a WhatsApp y el aviso de apartado suena", async () => {
        const r = await apartar(200, "ValEnd", 1);
        afirmar(r.status === 400 && r.json?.motivo === "stock-protegido" && /WhatsApp/.test(r.json.error || ""),
          `respondió ${r.status} ${r.json?.motivo}`);
        /* Va al resumen del día, no al teléfono: se ve en la bitácora del panel. */
        const actividad = (await resumenAdmin(tienda.base, 243)).json.actividad || [];
        afirmar(actividad.some(e => e.tipo === "inventario_apretado"), "el aviso de apartado lleno no sonó");
      });
      await prueba("un pedido multi-SKU del atacante tampoco pasa del techo de ninguno de sus SKU", async () => {
        const r = await pedir(tienda.base, "/api/pago", { metodo: "POST", cabeceras: { "CF-Connecting-IP": "203.0.113.201" },
          cuerpo: { items: [{ sku: "ValEnd", cantidad: 1 }, { sku: "ValPulpo", cantidad: 1 }], comprador: COMPRADOR,
            visitante: crypto.randomUUID() } });
        afirmar(r.status === 400 && r.json?.motivo === "stock-protegido", `respondió ${r.status} ${r.json?.motivo}`);
        const inv = (await resumenAdmin(tienda.base, 242)).json.inventario;
        afirmar(inv.every(p => p.disponible >= 1), "un SKU quedó en cero");
      });
    } finally { await tienda.parar(); }
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
