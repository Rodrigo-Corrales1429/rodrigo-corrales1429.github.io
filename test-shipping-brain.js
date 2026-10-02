"use strict";

const assert = require("assert");
const http = require("http");
const net = require("net");
const path = require("path");
const { spawn } = require("child_process");
const envios = require("./envios");

let pasadas = 0;
let fallidas = 0;

async function test(nombre, fn) {
  try {
    await fn();
    pasadas++;
    console.log(`  ✓ ${nombre}`);
  } catch (error) {
    fallidas++;
    console.error(`  ✗ ${nombre}`);
    console.error(`    ${error.stack || error.message}`);
  }
}

function tarifa({
  agregador = "envia", rate_id = null, quotation_id = null,
  paqueteria, servicio, tarifa_centavos, dias_min, dias_max,
  fuente = agregador === "tabla" ? "referencia" : agregador
}) {
  return {
    agregador, rate_id, quotation_id, paqueteria, servicio,
    tarifa_centavos, dias_min, dias_max,
    entrega_desde: "2026-10-05", entrega_hasta: "2026-10-09", fuente
  };
}

const MIX = [
  tarifa({ agregador: "tabla", fuente: "referencia", paqueteria: "Paquetexpress",
    servicio: "Terrestre", tarifa_centavos: 14200, dias_min: 4, dias_max: 5 }),
  tarifa({ paqueteria: "FedEx", servicio: "Dos días",
    tarifa_centavos: 17800, dias_min: 2, dias_max: 2 }),
  tarifa({ paqueteria: "Estafeta", servicio: "Día siguiente",
    tarifa_centavos: 16500, dias_min: 1, dias_max: 1 }),
  tarifa({ agregador: "skydropx", paqueteria: "DHL", servicio: "Express",
    tarifa_centavos: 21400, dias_min: 1, dias_max: 1, rate_id: "rate-dhl",
    quotation_id: "quote-1" })
];

const DEPENDENCIAS_MIX = {
  proveedor: "auto",
  enviaConfigurado: true,
  skydropxConfigurado: true,
  cotizarConEnvia: async () => MIX.filter(r => r.agregador === "envia"),
  cotizarConSkydropx: async () => MIX.filter(r => r.agregador === "skydropx")
};

async function cotizar(subtotal, dependencias = DEPENDENCIAS_MIX) {
  return envios.cotizarEnvio({
    cp_destino: "64000",
    direccion_destino: "Av. Constitución 123, Centro, Monterrey",
    lineas: [{ sku: "ValEnd", cantidad: 1 }],
    subtotal_centavos: subtotal
  }, dependencias);
}

const ENVIA_VALIDA = {
  carrier: "paquetexpress", carrierDescription: "Paquetexpress",
  service: "terrestre", serviceDescription: "Terrestre",
  totalPrice: 142, deliveryEstimate: "4 days", currency: "MXN"
};

function hoyMexico() {
  const partes = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date()).map(p => [p.type, p.value]));
  return `${partes.year}-${partes.month}-${partes.day}`;
}

const SKYDROPX_VALIDA = {
  id: "quote-falsa", is_completed: true,
  rates: [{
    id: "rate-falsa", success: true,
    provider_display_name: "DHL", provider_service_name: "Express",
    total: 178, days: 2, currency_code: "MXN"
  }]
};

function responderJson(res, cuerpo, estado = 200) {
  res.writeHead(estado, { "Content-Type": "application/json" });
  res.end(JSON.stringify(cuerpo));
}

function dejarBodyColgado(res) {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.write('{"data":'); // Los headers salen, pero el JSON nunca termina.
}

async function conServidorFalso(handler, fn) {
  const conexiones = new Set();
  const servidor = http.createServer(handler);
  servidor.on("connection", socket => {
    conexiones.add(socket);
    socket.on("close", () => conexiones.delete(socket));
  });
  await new Promise(resolve => servidor.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${servidor.address().port}`;
  try {
    return await fn(baseUrl);
  } finally {
    for (const socket of conexiones) socket.destroy();
    await new Promise(resolve => servidor.close(resolve));
  }
}

async function antesDe(promesa, ms, mensaje) {
  let reloj;
  try {
    return await Promise.race([
      promesa,
      new Promise((_, reject) => {
        reloj = setTimeout(() => reject(new Error(mensaje)), ms);
      })
    ]);
  } finally {
    clearTimeout(reloj);
  }
}

function dependenciasLocales(baseUrl, timeoutMs = 150) {
  return {
    proveedor: "auto", enviaConfigurado: true, skydropxConfigurado: true,
    timeoutMs,
    cotizarConEnvia: (origen, destino, paquete, opciones) => envios.cotizarConEnvia(
      origen, destino, paquete,
      { ...opciones, apiKey: "clave-falsa", baseUrl, timeoutMs }
    ),
    cotizarConSkydropx: (origen, destino, paquete, opciones) => envios.cotizarConSkydropx(
      origen, destino, paquete,
      { ...opciones, apiKey: "clave-falsa", baseUrl, timeoutMs,
        origen: { address_template_id: "origen-falso" } }
    )
  };
}

async function puertoLibre() {
  const servidor = net.createServer();
  await new Promise(resolve => servidor.listen(0, "127.0.0.1", resolve));
  const puerto = servidor.address().port;
  await new Promise(resolve => servidor.close(resolve));
  return puerto;
}

async function conApiFalsa(baseUrl, fn) {
  const puerto = await puertoLibre();
  const api = `http://127.0.0.1:${puerto}`;
  const hijo = spawn(process.execPath, [path.join(__dirname, "server.js")], {
    env: {
      ...process.env,
      PORT: String(puerto), NODE_ENV: "test", AVISOS_SILENCIO: "1",
      GEMINI_API_KEY: "clave-falsa", ALMACEN_RUTA: "",
      ENVIOS_PROVEEDOR: "auto", ENVIOS_TIMEOUT_MS: "150",
      ENVIA_API_KEY: "clave-falsa", ENVIA_API_URL: baseUrl,
      SKYDROPX_API_KEY: "clave-falsa", SKYDROPX_API_URL: baseUrl,
      SKYDROPX_ORIGEN_TEMPLATE_ID: "origen-falso"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let salida = "";
  hijo.stdout.on("data", chunk => { salida += chunk.toString(); });
  hijo.stderr.on("data", chunk => { salida += chunk.toString(); });
  try {
    let listo = false;
    for (let i = 0; i < 40 && !listo; i++) {
      if (hijo.exitCode !== null) break;
      try {
        const r = await fetch(`${api}/health`, { signal: AbortSignal.timeout(150) });
        listo = r.ok;
      } catch { /* Aún no escucha. */ }
      if (!listo) await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(listo, `el servidor de prueba no arrancó: ${salida.slice(-600)}`);
    return await fn(api);
  } finally {
    if (hijo.exitCode === null) {
      hijo.kill("SIGTERM");
      await antesDe(new Promise(resolve => hijo.once("exit", resolve)), 500,
        "el servidor de prueba no terminó").catch(() => hijo.kill("SIGKILL"));
    }
  }
}

async function pedirEnvio(api) {
  const r = await fetch(`${api}/api/envio`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      cp_destino: "64000", direccion_destino: "Av. Constitución 123, Centro, Monterrey",
      items: [{ sku: "ValEnd", cantidad: 1 }]
    })
  });
  assert.strictEqual(r.status, 200);
  return r.json();
}

async function main() {
console.log("\n[SHIPPING BRAIN V1] Política determinista A–J");

await test("Caso A: pagado elige la opción rápida dentro del premio y suma maniobra", async () => {
  const r = await cotizar(99999);
  assert.strictEqual(r.opciones.length, 1);
  assert.strictEqual(r.opciones[0].paqueteria, "Estafeta");
  assert.strictEqual(r.opciones[0].costo_centavos, 20000);
  assert.strictEqual(r.logistica.transportista_centavos, 16500);
  assert.strictEqual(r.logistica.manejo_interno_centavos, 3500);
  assert.strictEqual(r.logistica.costo_logistico_centavos, 20000);
  assert.strictEqual(r.logistica.cobrado_cliente_centavos, 20000);
});

await test("Caso B: gratis cobra cero pero conserva el costo logístico real", async () => {
  const r = await cotizar(147800);
  assert.strictEqual(r.opciones[0].paqueteria, "Estafeta");
  assert.strictEqual(r.opciones[0].envio_gratis, true);
  assert.strictEqual(r.opciones[0].costo_centavos, 0);
  assert.strictEqual(r.logistica.transportista_centavos, 16500);
  assert.strictEqual(r.logistica.manejo_interno_centavos, 3500);
  assert.strictEqual(r.logistica.costo_logistico_centavos, 20000);
  assert.strictEqual(r.logistica.cobrado_cliente_centavos, 0);
});

await test("Caso C: $999.99 no activa envío gratis", async () => {
  const r = await cotizar(99999);
  assert.strictEqual(r.opciones[0].envio_gratis, false);
  assert.ok(r.opciones[0].costo_centavos > 0);
  assert.strictEqual(r.falta_para_envio_gratis_centavos, 1);
});

await test("Caso D: $1,000.00 activa envío gratis", async () => {
  const r = await cotizar(100000);
  assert.strictEqual(r.opciones[0].envio_gratis, true);
  assert.strictEqual(r.opciones[0].costo_centavos, 0);
});

await test("Caso E: auto consulta ambos agregadores y combina sus tarifas", async () => {
  let envia = 0;
  let skydropx = 0;
  const r = await cotizar(0, {
    proveedor: "auto", enviaConfigurado: true, skydropxConfigurado: true,
    cotizarConEnvia: async () => { envia++; return [MIX[2]]; },
    cotizarConSkydropx: async () => { skydropx++; return [MIX[3]]; }
  });
  assert.strictEqual(envia, 1);
  assert.strictEqual(skydropx, 1);
  assert.deepStrictEqual(r.logistica.proveedores_consultados.sort(), ["envia", "skydropx"]);
});

await test("Auto usa el único agregador configurado", async () => {
  let envia = 0;
  let skydropx = 0;
  const r = await cotizar(0, {
    proveedor: "auto", enviaConfigurado: true, skydropxConfigurado: false,
    cotizarConEnvia: async () => { envia++; return [MIX[2]]; },
    cotizarConSkydropx: async () => { skydropx++; return [MIX[3]]; }
  });
  assert.strictEqual(envia, 1);
  assert.strictEqual(skydropx, 0);
  assert.deepStrictEqual(r.logistica.proveedores_consultados, ["envia"]);
});

await test("Caso F: auto aísla el fallo de un proveedor y usa el otro", async () => {
  const r = await cotizar(0, {
    proveedor: "auto", enviaConfigurado: true, skydropxConfigurado: true,
    cotizarConEnvia: async () => { throw new Error("proveedor caído"); },
    cotizarConSkydropx: async () => [MIX[3]]
  });
  assert.strictEqual(r.es_estimacion, false);
  assert.strictEqual(r.opciones[0].paqueteria, "DHL");
  assert.deepStrictEqual(r.logistica.proveedores_fallidos, ["envia"]);
});

await test("Caso G: si ambos fallan cae a tabla y lo declara estimado", async () => {
  const r = await cotizar(0, {
    proveedor: "auto", enviaConfigurado: true, skydropxConfigurado: true,
    cotizarConEnvia: async () => null,
    cotizarConSkydropx: async () => { throw new Error("timeout"); }
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.es_estimacion, true);
  assert.strictEqual(r.fuente, "referencia");
  assert.match(r.aviso_para_el_asesor, /estimación/i);
  assert.deepStrictEqual(r.logistica.proveedores_fallidos.sort(), ["envia", "skydropx"]);
});

await test("Caso H: una opción mucho más rápida gana si cuesta hasta $60 más", () => {
  const elegida = envios.seleccionarMejorEnvio([
    tarifa({ paqueteria: "Lenta", servicio: "7 días", tarifa_centavos: 14200,
      dias_min: 5, dias_max: 7 }),
    tarifa({ paqueteria: "Rápida", servicio: "2 días", tarifa_centavos: 16200,
      dias_min: 2, dias_max: 2 })
  ], { envio_gratis: false });
  assert.strictEqual(elegida.paqueteria, "Rápida");
});

await test("Caso I: una opción rápida demasiado cara pierde por costo", () => {
  const elegida = envios.seleccionarMejorEnvio([
    tarifa({ paqueteria: "Barata", servicio: "5 días", tarifa_centavos: 14200,
      dias_min: 4, dias_max: 5 }),
    tarifa({ paqueteria: "Equilibrada", servicio: "2 días", tarifa_centavos: 17800,
      dias_min: 2, dias_max: 2 }),
    tarifa({ paqueteria: "Muy cara", servicio: "1 día", tarifa_centavos: 26000,
      dias_min: 1, dias_max: 1 })
  ], { envio_gratis: false });
  assert.strictEqual(elegida.paqueteria, "Equilibrada");
});

await test("Caso J: la respuesta pública no expone la maniobra ni telemetría operativa", async () => {
  const interna = await cotizar(99999);
  const publica = envios.respuestaPublicaEnvio(interna);
  const serializada = JSON.stringify(publica);
  assert.strictEqual(publica.opciones.length, 1);
  assert.ok(!("logistica" in publica));
  for (const palabra of ["manejo_interno", "transportista_centavos", "costo_logistico",
    "rate_id", "quotation_id", "tarifa_centavos", "proveedores_fallidos"]) {
    assert.ok(!serializada.includes(palabra), `se filtró ${palabra}`);
  }
});

await test("Envia normaliza el contrato real sin inventar campos ausentes", () => {
  const ventana = envios.ventanaDeEntrega(1, 1);
  const filas = envios.normalizarTarifasEnvia([{
    carrier: "estafeta", carrierDescription: "Estafeta",
    service: "dia-siguiente", serviceDescription: "Día siguiente",
    totalPrice: 165, deliveryEstimate: "1 day",
    deliveryDate: { date: ventana.entrega_desde, dateDifference: 1 }
  }]);
  assert.deepStrictEqual(filas[0], {
    agregador: "envia", rate_id: null, quotation_id: null,
    paqueteria: "Estafeta", servicio: "Día siguiente",
    tarifa_centavos: 16500, dias_min: 1, dias_max: 1,
    entrega_desde: filas[0].entrega_desde,
    entrega_hasta: filas[0].entrega_hasta,
    fuente: "envia"
  });
  assert.strictEqual(filas[0].entrega_desde, ventana.entrega_desde);
  assert.strictEqual(filas[0].entrega_hasta, ventana.entrega_hasta);
  assert.deepStrictEqual(envios.normalizarTarifasEnvia([{
    carrier: "dhl", service: "express", totalPrice: 214
  }]), [], "sin tránsito no debe inventarse una promesa");
});

await test("Envia rechaza tránsitos negativos, cero, NaN, Infinity y booleanos", () => {
  for (const estimacion of [-1, 0, Number.NaN, Number.POSITIVE_INFINITY, true]) {
    const filas = envios.normalizarTarifasEnvia([{
      ...ENVIA_VALIDA, deliveryEstimate: estimacion
    }]);
    assert.deepStrictEqual(filas, [], `aceptó deliveryEstimate=${String(estimacion)}`);
  }
});

await test("Envia convierte 24 horas en un día, nunca en 24 días", () => {
  const filas = envios.normalizarTarifasEnvia([{
    ...ENVIA_VALIDA, deliveryEstimate: "24 horas"
  }]);
  assert.strictEqual(filas.length, 1);
  assert.deepStrictEqual([filas[0].dias_min, filas[0].dias_max], [1, 1]);
});

await test("Envia interpreta 48 horas como dos días, nunca 48 días", () => {
  const filas = envios.normalizarTarifasEnvia([{
    ...ENVIA_VALIDA, deliveryEstimate: "48 horas"
  }]);
  assert.strictEqual(filas.length, 1);
  assert.deepStrictEqual([filas[0].dias_min, filas[0].dias_max], [2, 2]);
});

await test("Envia rechaza el decimal ambiguo 2.5", () => {
  assert.deepStrictEqual(envios.normalizarTarifasEnvia([{
    ...ENVIA_VALIDA, deliveryEstimate: "2.5"
  }]), []);
});

await test("Envia no acepta precio booleano ni moneda incompatible", () => {
  assert.deepStrictEqual(envios.normalizarTarifasEnvia([{
    ...ENVIA_VALIDA, totalPrice: true
  }]), [], "totalPrice=true se convirtió en un precio");
  assert.deepStrictEqual(envios.normalizarTarifasEnvia([{
    ...ENVIA_VALIDA, currency: "USD"
  }]), [], "se aceptó USD como MXN");
});

await test("Envia ignora fechas externas imposibles o pasadas sin perder tránsito válido", () => {
  const calculada = envios.ventanaDeEntrega(2, 2);
  for (const fecha of ["2026-02-30", "2026-13-01", "2020-01-01", "basura"]) {
    const filas = envios.normalizarTarifasEnvia([{
      ...ENVIA_VALIDA, deliveryEstimate: "2 days",
      deliveryDate: { date: fecha, dateDifference: 2 }
    }]);
    assert.strictEqual(filas.length, 1, `perdió una tarifa por fecha externa: ${fecha}`);
    assert.strictEqual(filas[0].entrega_desde, calculada.entrega_desde);
    assert.strictEqual(filas[0].entrega_hasta, calculada.entrega_hasta);
  }
});

await test("Envia conserva fecha carrier realista y suma preparación a la promesa visible", async () => {
  const calculada = envios.ventanaDeEntrega(2, 2);
  const fechaCarrier = envios.diasHabilesDesde(hoyMexico(), 2);
  assert.ok(fechaCarrier < calculada.entrega_desde,
    "el fixture debe reproducir una fecha carrier anterior a la promesa de Valquiria");
  const filas = envios.normalizarTarifasEnvia([{
    ...ENVIA_VALIDA, deliveryEstimate: "2 days",
    deliveryDate: { date: fechaCarrier, dateDifference: 2 }
  }]);
  assert.strictEqual(filas.length, 1);
  const r = await cotizar(0, {
    proveedor: "envia", enviaConfigurado: true,
    cotizarConEnvia: async () => filas
  });
  assert.strictEqual(r.fuente, "envia");
  assert.ok(r.opciones[0].entrega_desde >= r.opciones[0].sale_de_taller);
  assert.ok(r.opciones[0].entrega_hasta >= r.opciones[0].entrega_desde);
  assert.strictEqual(r.opciones[0].entrega_desde, calculada.entrega_desde,
    "la fecha del carrier omitió el tránsito posterior a la preparación");
  assert.ok(!/undefined|NaN/.test(r.opciones[0].texto));
});

await test("Envia no usa fecha carrier igual al despacho ni descarta la tarifa", async () => {
  const calculada = envios.ventanaDeEntrega(2, 2);
  const filas = envios.normalizarTarifasEnvia([{
    ...ENVIA_VALIDA, deliveryEstimate: "2 days",
    deliveryDate: { date: calculada.sale_de_taller, dateDifference: 2 }
  }]);
  assert.strictEqual(filas.length, 1);
  const r = await cotizar(0, {
    proveedor: "envia", enviaConfigurado: true,
    cotizarConEnvia: async () => filas
  });
  assert.strictEqual(r.fuente, "envia");
  assert.strictEqual(r.es_estimacion, false);
  assert.strictEqual(r.opciones[0].entrega_desde, calculada.entrega_desde);
  assert.ok(r.opciones[0].entrega_desde >= r.opciones[0].sale_de_taller);
});

await test("Envia conserva el set oficial de cuatro tarifas con fecha carrier realista", async () => {
  const hoy = hoyMexico();
  const oficiales = [
    ["Paquetexpress", 142, 4], ["FedEx", 178, 2],
    ["Estafeta", 165, 1], ["DHL", 214, 1]
  ].map(([carrier, totalPrice, dias]) => ({
    carrier, service: "Terrestre", totalPrice, currency: "MXN",
    deliveryEstimate: `${dias} días`,
    deliveryDate: { date: envios.diasHabilesDesde(hoy, dias) }
  }));
  const normalizadas = envios.normalizarTarifasEnvia(oficiales);
  assert.strictEqual(normalizadas.length, 4, "no debe perder tarifas por preparación propia");
  const r = await cotizar(0, {
    proveedor: "envia", enviaConfigurado: true,
    cotizarConEnvia: (origen, destino, paquete, opciones) => envios.cotizarConEnvia(
      origen, destino, paquete, {
        ...opciones, apiKey: "clave-falsa", baseUrl: "https://example.invalid",
        fetchFn: async () => ({ ok: true, json: async () => ({ data: oficiales }) })
      }
    )
  });
  assert.strictEqual(r.fuente, "envia");
  assert.strictEqual(r.es_estimacion, false);
  assert.strictEqual(r.opciones[0].paqueteria, "Estafeta");
  assert.deepStrictEqual(r.logistica.proveedores_fallidos, []);
  assert.ok(r.opciones[0].entrega_desde > r.opciones[0].sale_de_taller);
  assert.strictEqual(r.opciones[0].entrega_desde, envios.ventanaDeEntrega(1, 1).entrega_desde);
});

await test("Envia colgado tras headers deja usar Skydropx", async () => {
  let bodiesColgados = 0;
  await conServidorFalso((req, res) => {
    if (req.url === "/ship/rate/") {
      bodiesColgados++;
      return dejarBodyColgado(res);
    }
    if (req.url === "/api/v1/quotations") return responderJson(res, SKYDROPX_VALIDA);
    return responderJson(res, {}, 404);
  }, async baseUrl => {
    const r = await antesDe(cotizar(0, dependenciasLocales(baseUrl)), 750,
      "Envia dejó la cotización esperando un body que no termina");
    assert.strictEqual(bodiesColgados, 1);
    assert.strictEqual(r.fuente, "skydropx");
    assert.strictEqual(r.es_estimacion, false);
    assert.deepStrictEqual(r.logistica.proveedores_fallidos, ["envia"]);
  });
});

await test("Skydropx colgado tras headers deja usar Envia", async () => {
  let bodiesColgados = 0;
  await conServidorFalso((req, res) => {
    if (req.url === "/api/v1/quotations") {
      bodiesColgados++;
      return dejarBodyColgado(res);
    }
    if (req.url === "/ship/rate/") return responderJson(res, { data: [ENVIA_VALIDA] });
    return responderJson(res, {}, 404);
  }, async baseUrl => {
    const r = await antesDe(cotizar(0, dependenciasLocales(baseUrl)), 750,
      "Skydropx dejó la cotización esperando un body que no termina");
    assert.strictEqual(bodiesColgados, 1);
    assert.strictEqual(r.fuente, "envia");
    assert.strictEqual(r.es_estimacion, false);
    assert.deepStrictEqual(r.logistica.proveedores_fallidos, ["skydropx"]);
  });
});

await test("Dos proveedores colgados devuelven tabla estimada", async () => {
  let bodiesColgados = 0;
  await conServidorFalso((req, res) => {
    bodiesColgados++;
    dejarBodyColgado(res);
  }, async baseUrl => {
    const r = await antesDe(cotizar(0, dependenciasLocales(baseUrl)), 750,
      "dos bodies incompletos bloquearon la tabla de referencia");
    assert.strictEqual(bodiesColgados, 2);
    assert.strictEqual(r.fuente, "referencia");
    assert.strictEqual(r.es_estimacion, true);
    assert.deepStrictEqual(r.logistica.proveedores_fallidos.sort(), ["envia", "skydropx"]);
  });
});

await test("Skydropx crea la cotización, consulta tasas progresivas y no crea envíos", async () => {
  const llamadas = [];
  const respuestas = [
    { ok: true, json: async () => ({ id: "quote-1", is_completed: false, rates: [{
      id: "rate-1", success: true, provider_display_name: "DHL",
      provider_service_name: "Express", total: 214, days: 1
    }] }) },
    { ok: true, json: async () => ({ id: "quote-1", is_completed: true, rates: [{
      id: "rate-2", success: true, provider_display_name: "FedEx",
      provider_service_name: "Dos días", total: 178, days: 2
    }] }) }
  ];
  const fetchFn = async (url, opciones = {}) => {
    llamadas.push({ url, opciones });
    return respuestas.shift();
  };
  const filas = await envios.cotizarConSkydropx(
    { cp: "42000", estado: "Hidalgo" },
    { cp: "64000", estado: "Nuevo León" },
    { facturable_kg: 1, largo_cm: 25, ancho_cm: 20, alto_cm: 12,
      direccion_destino: "Av. Constitución 123, Centro, Monterrey" },
    { apiKey: "test", baseUrl: "https://example.invalid/api/v1",
      fetchFn, esperarFn: async () => {}, maxIntentos: 2,
      origen: { address_template_id: "origin-template" } }
  );
  assert.strictEqual(llamadas.length, 2);
  assert.strictEqual(llamadas[0].opciones.method, "POST");
  assert.match(llamadas[0].url, /\/quotations$/);
  assert.match(llamadas[1].url, /\/quotations\/quote-1$/);
  assert.ok(llamadas.every(l => !/shipments/.test(l.url)), "no debe crear shipment");
  assert.deepStrictEqual(filas.map(f => [f.quotation_id, f.rate_id]), [
    ["quote-1", "rate-1"], ["quote-1", "rate-2"]
  ]);
});

await test("Skydropx conserva un rate previo si el siguiente poll tiene JSON inválido", async () => {
  let llamadas = 0;
  const fetchFn = async () => {
    llamadas++;
    if (llamadas === 1) return {
      ok: true,
      json: async () => ({ ...SKYDROPX_VALIDA, is_completed: false })
    };
    return { ok: true, json: async () => { throw new SyntaxError("JSON truncado"); } };
  };
  const filas = await envios.cotizarConSkydropx(
    { cp: "42000", estado: "Hidalgo" },
    { cp: "64000", estado: "Nuevo León" },
    { facturable_kg: 1, largo_cm: 25, ancho_cm: 20, alto_cm: 12,
      direccion_destino: "Av. Constitución 123, Centro, Monterrey" },
    { apiKey: "clave-falsa", baseUrl: "https://example.invalid/api/v1",
      fetchFn, esperarFn: async () => {}, maxIntentos: 2,
      origen: { address_template_id: "origen-falso" } }
  );
  assert.strictEqual(llamadas, 2);
  assert.deepStrictEqual(filas?.map(f => f.rate_id), ["rate-falsa"]);
});

await test("Skydropx conserva un rate previo si el siguiente poll agota su deadline", async () => {
  let polls = 0;
  await conServidorFalso((req, res) => {
    if (req.method === "POST" && req.url === "/api/v1/quotations") {
      return responderJson(res, { ...SKYDROPX_VALIDA, is_completed: false });
    }
    if (req.method === "GET" && req.url === "/api/v1/quotations/quote-falsa") {
      polls++;
      return dejarBodyColgado(res);
    }
    return responderJson(res, {}, 404);
  }, async baseUrl => {
    const filas = await antesDe(envios.cotizarConSkydropx(
      { cp: "42000", estado: "Hidalgo" },
      { cp: "64000", estado: "Nuevo León" },
      { facturable_kg: 1, largo_cm: 25, ancho_cm: 20, alto_cm: 12,
        direccion_destino: "Av. Constitución 123, Centro, Monterrey" },
      { apiKey: "clave-falsa", baseUrl, timeoutMs: 150,
        esperarFn: async () => {}, maxIntentos: 2,
        origen: { address_template_id: "origen-falso" } }
    ), 750, "poll de Skydropx quedó leyendo un body incompleto");
    assert.strictEqual(polls, 1);
    assert.deepStrictEqual(filas?.map(f => f.rate_id), ["rate-falsa"]);
  });
});

await test("E2E /api/envio descarta Envia -1 y elige Paquetexpress válido", async () => {
  await conServidorFalso((req, res) => {
    if (req.url === "/ship/rate/") return responderJson(res, {
      data: [{ ...ENVIA_VALIDA, totalPrice: 1, deliveryEstimate: -1 }]
    });
    if (req.url === "/api/v1/quotations") return responderJson(res, {
      ...SKYDROPX_VALIDA,
      rates: [{ ...SKYDROPX_VALIDA.rates[0], provider_display_name: "Paquetexpress",
        provider_service_name: "Terrestre", total: 142, days: 4 }]
    });
    return responderJson(res, {}, 404);
  }, async baseUrl => {
    await conApiFalsa(baseUrl, async api => {
      const r = await antesDe(pedirEnvio(api), 750, "/api/envio no respondió");
      assert.strictEqual(r.fuente, "skydropx");
      assert.strictEqual(r.es_estimacion, false);
      assert.strictEqual(r.opciones[0].paqueteria, "Paquetexpress");
      assert.strictEqual(r.opciones[0].costo_centavos, 17700);
    });
  });
});

await test("E2E /api/envio responde con Skydropx cuando Envia deja body colgado", async () => {
  let bodiesColgados = 0;
  await conServidorFalso((req, res) => {
    if (req.url === "/ship/rate/") {
      bodiesColgados++;
      return dejarBodyColgado(res);
    }
    if (req.url === "/api/v1/quotations") return responderJson(res, SKYDROPX_VALIDA);
    return responderJson(res, {}, 404);
  }, async baseUrl => {
    await conApiFalsa(baseUrl, async api => {
      const r = await antesDe(pedirEnvio(api), 750,
        "/api/envio quedó esperando el body incompleto de Envia");
      assert.strictEqual(bodiesColgados, 1);
      assert.strictEqual(r.fuente, "skydropx");
      assert.strictEqual(r.es_estimacion, false);
      assert.strictEqual(r.opciones[0].paqueteria, "DHL");
    });
  });
});

console.log("\n" + "═".repeat(62));
console.log(`  ${pasadas} pasadas · ${fallidas} fallidas`);
console.log("═".repeat(62));
if (fallidas) process.exitCode = 1;
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
