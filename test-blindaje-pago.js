/**
 * ============================================================================
 *  PRUEBAS DE BLINDAJE DEL PAGO — se ejecutan de verdad
 * ============================================================================
 *  Estas NO leen el código: lo CORREN. Levantan el servidor real contra un
 *  Mercado Pago falso y reproducen, una por una, las fallas que encontró la
 *  auditoría. Cada prueba de aquí falla con el código anterior:
 *
 *    B-01  una URL con `collection_status=approved` decía «Pago confirmado»
 *          y borraba el carrito sin preguntarle a nadie.
 *    B-02  el webhook respondía 200 ANTES de consultar el pago: si la API de
 *          Mercado Pago fallaba después, el cobro quedaba sin registrar y sin
 *          posibilidad de reintento.
 *    B-03  una sola preferencia podía apartar todo el stock de un SKU durante
 *          24 horas.
 *    B-04  la página cotizaba el envío por código postal y el checkout cobraba
 *          una tarifa plana distinta.
 *    M-02  un descuadre de importe se detectaba, se avisaba… y luego seguía
 *          por la ruta de aprobado: descontaba inventario y pedía surtir.
 *    M-03  cada reintento de Mercado Pago volvía a sonar el teléfono.
 *
 *  Y las de la auditoría de la Fase 2B v5 (servidor aparte, con instantánea):
 *    MAX_PEDIDOS   300 pedidos posteriores expulsaban uno todavía pagable;
 *                  su aprobación firmada llegaba sin artículos ni domicilio.
 *    Orden ausente un pago aprobado de un pedido desconocido o incompleto
 *                  salía como «PAGO APROBADO» normal, listo para surtir.
 *    Replay        perdida la memoria de eventos (reinicio o 800 eventos),
 *                  la misma aprobación volvía a avisar, contar y surtir.
 *
 *  Correr con:  node test-blindaje-pago.js
 * ============================================================================
 */

"use strict";

const http = require("http");
const crypto = require("crypto");
const { spawn } = require("child_process");
const path = require("path");

const PUERTO_MP = 4711;      // el Mercado Pago falso
const PUERTO_APP = 4712;     // el servidor de Valquiria
const SECRETO = "secreto-de-pruebas-no-es-el-de-produccion";
const TOKEN_PANEL = "token-de-pruebas-largo-para-que-el-servidor-no-se-queje";
const BASE = `http://127.0.0.1:${PUERTO_APP}`;

let pasadas = 0;
const fallos = [];

async function prueba(nombre, fn) {
  try {
    await fn();
    console.log(`  ✓ ${nombre}`);
    pasadas++;
  } catch (e) {
    console.log(`  ✗ ${nombre}\n      ${e.message}`);
    fallos.push(nombre);
  }
}

function afirmar(condicion, mensaje) {
  if (!condicion) throw new Error(mensaje);
}

const leerFuente = f => require("fs").readFileSync(path.join(__dirname, f), "utf8");

// ---------------------------------------------------------------------------
//  El Mercado Pago falso
// ---------------------------------------------------------------------------
/* Guarda las preferencias que se le crean y devuelve los pagos que le pidamos
   devolver. `mp.pagos` es el guion de cada prueba: qué contesta la API cuando
   el webhook pregunte por un pago. */
const mp = {
  preferencias: [],
  pagos: new Map(),      // id → cuerpo del pago
  romper: false,         // simula la API caída
  surtidos: []           // lo que llega a PEDIDOS_WEBHOOK_URL: la orden de surtir
};

const servidorMP = http.createServer((req, res) => {
  let cuerpo = "";
  req.on("data", c => (cuerpo += c));
  req.on("end", () => {
    if (mp.romper) {
      res.writeHead(500, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ message: "caída simulada" }));
    }
    if (req.method === "POST" && req.url === "/__surtir") {
      mp.surtidos.push(JSON.parse(cuerpo || "{}"));
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end("{}");
    }
    if (req.method === "POST" && req.url.startsWith("/checkout/preferences")) {
      const pref = JSON.parse(cuerpo || "{}");
      mp.preferencias.push(pref);
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({
        id: "pref-" + mp.preferencias.length,
        init_point: "https://www.mercadopago.com.mx/checkout/v1/redirect?pref_id=x"
      }));
    }
    const m = req.url.match(/^\/v1\/payments\/([^/?]+)/);
    if (m) {
      const pago = mp.pagos.get(m[1]);
      if (!pago) {
        res.writeHead(404, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ message: "no existe" }));
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(pago));
    }
    res.writeHead(404).end("{}");
  });
});

/** La firma que Mercado Pago pone en `x-signature`. */
function firmar(dataId, requestId) {
  const ts = Math.floor(Date.now() / 1000);
  const manifiesto = `id:${String(dataId).toLowerCase()};request-id:${requestId};ts:${ts};`;
  const v1 = crypto.createHmac("sha256", SECRETO).update(manifiesto).digest("hex");
  return `ts=${ts},v1=${v1}`;
}

async function pedir(ruta, opciones = {}) {
  const { base = BASE, ...resto } = opciones;
  const r = await fetch(base + ruta, resto);
  const texto = await r.text();
  let cuerpo = null;
  try { cuerpo = JSON.parse(texto); } catch { cuerpo = texto; }
  return { status: r.status, cuerpo };
}

async function avisarWebhook(pagoId, { conFirma = true, base = BASE } = {}) {
  const requestId = "req-" + pagoId;
  const cabeceras = { "Content-Type": "application/json", "x-request-id": requestId };
  if (conFirma) cabeceras["x-signature"] = firmar(pagoId, requestId);
  return pedir("/api/pago/webhook", {
    base,
    method: "POST",
    headers: cabeceras,
    body: JSON.stringify({ type: "payment", data: { id: String(pagoId) } })
  });
}

const COMPRADOR = {
  nombre: "Ana Ruiz Soto",
  whatsapp: "7717959131",
  email: "ana@ejemplo.mx",
  cp: "03330",
  direccion: "Av. Juárez 120, Centro, Ciudad de México"
};

// ---------------------------------------------------------------------------
async function main() {
  process.env.MP_API_URL = `http://127.0.0.1:${PUERTO_MP}`;

  await new Promise(r => servidorMP.listen(PUERTO_MP, "127.0.0.1", r));

  const hijo = spawn(process.execPath, [path.join(__dirname, "server.js")], {
    env: {
      ...process.env,
      PORT: String(PUERTO_APP),
      NODE_ENV: "test",
      AVISOS_SILENCIO: "1",
      GEMINI_API_KEY: "no-se-usa-en-estas-pruebas",
      MP_ACCESS_TOKEN: "APP_USR-de-mentira",
      MP_WEBHOOK_SECRET: SECRETO,
      MP_API_URL: `http://127.0.0.1:${PUERTO_MP}`,
      /* El limitador de pagos (6/min) va DELANTE de las reglas de negocio, así
         que con el valor de producción esta suite chocaría contra él y no
         llegaría a probar los topes de reserva. Se sube aquí a propósito: lo
         que se está midiendo es lo que hay DEBAJO del limitador. Que el
         limitador funciona ya se ve solo — es lo primero con lo que topa
         cualquiera que insista. */
      RATE_LIMIT_PAGO_POR_MINUTO: "100",
      RATE_LIMIT_PULSO_POR_MINUTO: "200",
      LEADS_TOKEN: TOKEN_PANEL,
      SITIO_URL: "https://valquiriainc.com",
      BACKEND_URL: BASE,
      ALMACEN_RUTA: ""
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  hijo.stdout.on("data", () => {});
  hijo.stderr.on("data", () => {});

  /* Esperar a que levante. Si no levanta, mejor decirlo que fallar 20 veces. */
  let vivo = false;
  for (let i = 0; i < 60 && !vivo; i++) {
    await new Promise(r => setTimeout(r, 120));
    try { vivo = (await fetch(BASE + "/health")).ok; } catch { /* todavía no */ }
  }
  if (!vivo) {
    hijo.kill("SIGKILL");
    servidorMP.close();
    console.log("\n✗ El servidor de pruebas no arrancó.\n");
    process.exit(1);
  }

  try {
    await correrPruebas();
    await correrPruebasDeRetencion();
  } finally {
    hijo.kill("SIGKILL");
    servidorMP.close();
  }

  console.log("");
  if (fallos.length) {
    console.log(`✗ ${fallos.length} FALLARON de ${pasadas + fallos.length}`);
    process.exit(1);
  }
  console.log(`✓ ${pasadas}/${pasadas} pruebas de blindaje del pago pasaron.\n`);
}

async function correrPruebas() {
  // -------------------------------------------------------------------------
  console.log("\n[B-04] El total de la página y el que cobra Mercado Pago");
  // -------------------------------------------------------------------------

  let folioBueno = null;
  let totalPreferencia = null;

  await prueba("/api/pago rechaza cantidad string antes de cualquier efecto", async () => {
    const panelAntes = await pedir("/api/admin/resumen", {
      headers: { "X-Leads-Token": TOKEN_PANEL }
    });
    afirmar(panelAntes.status === 200, "no se pudo observar el estado inicial");
    const preferenciasAntes = mp.preferencias.length;
    const surtidosAntes = mp.surtidos.length;

    const pago = await pedir("/api/pago", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ sku: "ValEnd", cantidad: "2" }],
        comprador: COMPRADOR,
        visitante: crypto.randomUUID()
      })
    });

    afirmar(pago.status === 400, `respondió ${pago.status}: ${JSON.stringify(pago.cuerpo)}`);
    afirmar(/cantidad/i.test(pago.cuerpo?.error || ""), "el rechazo no identifica la cantidad inválida");

    const panelDespues = await pedir("/api/admin/resumen", {
      headers: { "X-Leads-Token": TOKEN_PANEL }
    });
    afirmar(panelDespues.status === 200, "no se pudo observar el estado final");
    afirmar(
      JSON.stringify(panelDespues.cuerpo.inventario) === JSON.stringify(panelAntes.cuerpo.inventario),
      "la petición inválida reservó o modificó inventario"
    );
    afirmar(
      panelDespues.cuerpo.dinero.pedidos_totales === panelAntes.cuerpo.dinero.pedidos_totales,
      "la petición inválida creó un pedido"
    );
    afirmar(
      JSON.stringify(panelDespues.cuerpo.actividad) === JSON.stringify(panelAntes.cuerpo.actividad),
      "la petición inválida produjo actividad transaccional"
    );
    afirmar(mp.preferencias.length === preferenciasAntes, "la petición inválida inició un pago");
    afirmar(mp.surtidos.length === surtidosAntes, "la petición inválida pidió surtir mercancía");
  });

  await prueba("/api/pago cobra el MISMO envío que cotiza /api/envio", async () => {
    /* Lo que ve el cliente en la pantalla. */
    const envio = await pedir("/api/envio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cp_destino: "03330", items: [{ sku: "ValEnd", cantidad: 1 }] })
    });
    afirmar(envio.status === 200 && envio.cuerpo.ok, "no se pudo cotizar el envío");
    afirmar(envio.cuerpo.opciones.length === 1, "la API pública expuso más de una opción");
    const jsonPublico = JSON.stringify(envio.cuerpo);
    for (const campo of ["logistica", "manejo_interno", "transportista_centavos",
      "costo_logistico", "rate_id", "quotation_id"]) {
      afirmar(!jsonPublico.includes(campo), `/api/envio filtró ${campo}`);
    }
    const recomendada = envio.cuerpo.opciones.find(o => o.recomendada);
    afirmar(recomendada, "la cotización no trae opción recomendada");

    /* Lo que se va a cobrar. */
    const pago = await pedir("/api/pago", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ sku: "ValEnd", cantidad: 1 }], comprador: COMPRADOR,
        visitante: crypto.randomUUID() })
    });
    afirmar(pago.status === 200, `/api/pago respondió ${pago.status}: ${JSON.stringify(pago.cuerpo)}`);
    afirmar(pago.cuerpo.desglose, "la respuesta no trae desglose para la página");

    afirmar(
      pago.cuerpo.desglose.envio_centavos === recomendada.costo_centavos,
      `envío de la página ${recomendada.costo_centavos} vs. del checkout ` +
      `${pago.cuerpo.desglose.envio_centavos}`
    );

    /* Y lo que de verdad viaja a Mercado Pago, sumando línea por línea. */
    const pref = mp.preferencias[mp.preferencias.length - 1];
    const enMP = Math.round(
      pref.items.reduce((s, i) => s + i.unit_price * i.quantity, 0) * 100
    );
    afirmar(enMP === pago.cuerpo.desglose.total_centavos,
      `la preferencia cobra ${enMP} y la página enseña ${pago.cuerpo.desglose.total_centavos}`);

    const panel = await pedir("/api/admin/resumen", {
      headers: { "X-Leads-Token": TOKEN_PANEL }
    });
    const orden = panel.cuerpo.pedidos.find(p => p.folio === pago.cuerpo.folio);
    afirmar(orden?.logistica?.manejo_interno_centavos === 3500,
      "el dashboard no conservó la maniobra interna");
    afirmar(orden.logistica.costo_logistico_centavos === recomendada.costo_centavos,
      "la telemetría interna no coincide con lo cobrado");

    folioBueno = pago.cuerpo.folio;
    totalPreferencia = pago.cuerpo.desglose.total_centavos;
  });

  await prueba("un CP inexistente se devuelve como dato que falta, no como avería", async () => {
    const r = await pedir("/api/pago", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ sku: "ValEnd", cantidad: 1 }],
        comprador: { ...COMPRADOR, cp: "00000" },
        visitante: crypto.randomUUID()
      })
    });
    afirmar(r.status === 400, `respondió ${r.status}`);
    afirmar((r.cuerpo.faltan || []).includes("cp"), "no dice que el problema es el CP");
  });

  // -------------------------------------------------------------------------
  console.log("\n[B-03] Nadie deja un SKU en cero de un golpe");
  // -------------------------------------------------------------------------

  await prueba("una sola preferencia no puede llevarse las 27 unidades", async () => {
    const antes = await pedir("/api/envio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cp_destino: "03330", items: [{ sku: "ValEnd", cantidad: 1 }] })
    });
    afirmar(antes.status === 200, "el servidor dejó de responder");

    const r = await pedir("/api/pago", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ sku: "ValEnd", cantidad: 27 }], comprador: COMPRADOR,
        visitante: crypto.randomUUID() })
    });
    afirmar(r.status === 400, `respondió ${r.status}: ${JSON.stringify(r.cuerpo)}`);
    afirmar(r.cuerpo.motivo === "tope-por-sku", `motivo inesperado: ${r.cuerpo.motivo}`);
    afirmar(/WhatsApp/i.test(r.cuerpo.error),
      "se rechaza sin ofrecer el canal de mayoreo, que es donde sí se vende eso");
  });

  await prueba("tampoco repartiéndolas entre varios SKU", async () => {
    const r = await pedir("/api/pago", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [
          { sku: "ValEnd", cantidad: 5 },
          { sku: "ValPulpo", cantidad: 5 },
          { sku: "Endotnissin", cantidad: 5 }
        ],
        comprador: COMPRADOR,
        visitante: crypto.randomUUID()
      })
    });
    afirmar(r.status === 400, `respondió ${r.status}`);
    afirmar(r.cuerpo.motivo === "tope-unidades", `motivo inesperado: ${r.cuerpo.motivo}`);
  });

  await prueba("abrir pedidos seguidos no acumula mercancía apartada", async () => {
    /* Una reserva viva por visitante, y se consigue reemplazando: el cliente
       que deja un pago a medias y vuelve a intentarlo no se queda bloqueado,
       y lo de antes se libera en el acto. Lo que NO puede pasar es que se
       sumen. El visitante es el UUID que manda la tienda, no la IP: la IP la
       comparten personas distintas. */
    const yo = crypto.randomUUID();
    const abrir = () => pedir("/api/pago", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ sku: "ValPulpo", cantidad: 5 }], comprador: COMPRADOR, visitante: yo })
    });
    const a = await abrir();
    const b = await abrir();
    const c = await abrir();
    [a, b, c].forEach((r, i) =>
      afirmar(r.status === 200, `el intento ${i + 1} se bloqueó (${r.status})`));

    /* No se puede leer el estado interno del hijo, así que se comprueba lo
       observable: tres pedidos de 5 no dejaron 15 piezas apartadas — si las
       hubieran dejado, el stock de ValPulpo (23) no daría para el siguiente. */
    const cuarto = await abrir();
    afirmar(cuarto.status === 200,
      `las reservas se acumularon: el cuarto pedido ya no cabe (${cuarto.status}: ` +
      `${JSON.stringify(cuarto.cuerpo).slice(0, 120)})`);
  });

  await prueba("sin visitante UUID v4 válido no se aparta nada ni se crea link", async () => {
    /* Ausente, mal formado o de otra versión (v1): 400 antes de reservar o
       de hablar con Mercado Pago. Si alguno hubiera apartado sus 5 piezas,
       la prueba siguiente ya no cabría. */
    const preferenciasAntes = mp.preferencias.length;
    for (const visitante of [undefined, "no-es-un-uuid", "6ba7b810-9dad-11d1-80b4-00c04fd430c8"]) {
      const r = await pedir("/api/pago", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: [{ sku: "ValPulpo", cantidad: 5 }], comprador: COMPRADOR, visitante })
      });
      afirmar(r.status === 400 && r.cuerpo.motivo === "visitante",
        `con visitante ${JSON.stringify(visitante)} respondió ${r.status} (${r.cuerpo.motivo})`);
      afirmar(!JSON.stringify(r.cuerpo).includes(String(visitante)) || visitante === undefined,
        "el rechazo repite el valor recibido");
    }
    afirmar(mp.preferencias.length === preferenciasAntes, "un pedido sin visitante válido llegó a Mercado Pago");
  });

  await prueba("estrenar un UUID en cada pedido topa con el techo sin pagar", async () => {
    /* Un UUID nuevo por pedido no se reemplaza a sí mismo: lo que acota eso
       es el techo fraccional (más el limitador por IP). ValPulpo tiene 23,
       se apartan como mucho 11 sin pagar, y ya hay 5 del visitante anterior. */
    const conUuidNuevo = () => pedir("/api/pago", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ sku: "ValPulpo", cantidad: 5 }], comprador: COMPRADOR,
        visitante: crypto.randomUUID() })
    });
    const primero = await conUuidNuevo();
    const segundo = await conUuidNuevo();
    afirmar(primero.status === 200, `el primer pedido se bloqueó (${primero.status})`);
    afirmar(segundo.status === 400 && segundo.cuerpo.motivo === "stock-protegido",
      `las reservas sin pagar pasaron del techo (${segundo.status}: ${segundo.cuerpo.motivo})`);
  });

  await prueba("ni muchas identidades pueden dejar un producto en cero", () => {
    /* El ataque que quedaba: 6+6+6 desde una IP y 6+3 desde otra dejaban
       ValEnd en cero. El tope por identidad es fricción, no defensa —un
       visitante son cinco pestañas o cinco IPs—; la defensa es que las
       reservas SIN PAGAR nunca retengan más de una fracción de lo que queda
       por vender.

       Se prueba contra el módulo y no por HTTP porque desde una sola máquina
       todas las peticiones comparten IP: lo que hay que demostrar es que el
       techo aguanta aunque las identidades sean infinitas. */
    const inv = require("./inventario.js");
    inv._reiniciar();

    const stock = inv.disponible("ValEnd");
    afirmar(stock > 0, "no hay stock con el que probar");

    /* Cincuenta identidades distintas, cada una pidiendo el máximo. */
    let aceptadas = 0;
    for (let i = 0; i < 50; i++) {
      const r = inv.reservar("ATAQUE-" + i, [{ sku: "ValEnd", cantidad: inv.MAX_POR_SKU }],
        { identidad: "ip-" + i });
      if (r.ok) aceptadas++;
    }

    const apartado = inv.apartadoSinPagar("ValEnd");
    const queda = inv.disponible("ValEnd");
    afirmar(queda > 0,
      `${aceptadas} reservas desde 50 identidades dejaron el producto en cero`);
    afirmar(apartado <= inv.techoReservable("ValEnd"),
      `se apartaron ${apartado} piezas y el techo era ${inv.techoReservable("ValEnd")}`);
    afirmar(queda >= Math.floor(stock * (1 - inv.FRACCION_RESERVABLE)),
      `quedaron ${queda} de ${stock}: por debajo de la fracción reservada`);

    /* Y el ataque exacto que reportó la auditoría, tal cual. */
    inv._reiniciar();
    inv.reservar("A1", [{ sku: "ValEnd", cantidad: 6 }], { identidad: "ipA" });
    inv.reservar("A2", [{ sku: "ValEnd", cantidad: 6 }], { identidad: "ipA" });
    inv.reservar("A3", [{ sku: "ValEnd", cantidad: 6 }], { identidad: "ipA" });
    inv.reservar("B1", [{ sku: "ValEnd", cantidad: 6 }], { identidad: "ipB" });
    inv.reservar("B2", [{ sku: "ValEnd", cantidad: 3 }], { identidad: "ipB" });
    afirmar(inv.disponible("ValEnd") > 0,
      "el ataque de la auditoría (6+6+6 / 6+3) sigue dejando ValEnd en cero");
    inv._reiniciar();
  });

  await prueba("al vencer el TTL se libera el techo, y mientras dura el stock de seguridad no se aparta", () => {
    /* Reloj simulado: 15 minutos no se esperan. Muchas identidades llenan el
       techo; mientras las reservas viven, lo que queda nunca baja del stock de
       seguridad; al vencer, lo apartado vuelve a cero y se puede apartar otra
       vez. Ni la IP ni el UUID cambian nada de esto: es por producto. */
    const inv = require("./inventario.js");
    const relojReal = Date.now;
    let ahora = relojReal();
    Date.now = () => ahora;
    try {
      inv._reiniciar();
      const sku = "Endotnissin";
      let n = 0;
      while (n < 50 && inv.reservar(`TTL-${n}`, [{ sku, cantidad: 1 }], { identidad: `visitante:ttl-${n}` }).ok) n++;
      afirmar(n === inv.techoReservable(sku), `se apartaron ${n} con techo ${inv.techoReservable(sku)}`);
      afirmar(inv.disponible(sku) >= inv.STOCK_SEGURIDAD,
        `quedan ${inv.disponible(sku)}, por debajo del stock de seguridad ${inv.STOCK_SEGURIDAD}`);
      ahora += inv.MINUTOS_RESERVA * 60_000 - 1000;
      afirmar(inv.apartadoSinPagar(sku) === n, "las reservas vencieron antes del TTL");
      ahora += 2000;
      afirmar(inv.apartadoSinPagar(sku) === 0, "tras el TTL siguen apartadas");
      afirmar(inv.reservar("TTL-nueva", [{ sku, cantidad: 1 }], { identidad: "visitante:ttl-nueva" }).ok,
        "tras vencer no se puede apartar de nuevo");
    } finally {
      Date.now = relojReal;
      inv._reiniciar();
    }
  });

  await prueba("ninguna reserva sin pagar deja el stock en cero, en NINGÚN nivel", () => {
    /* El hueco que quedaba: el techo era `max(MAX_POR_SKU, fracción)`, y ese
       suelo anulaba la protección justo cuando quedaba poco. Con 21 de 27
       vendidas quedaban 6, la fracción daba 3, el `max` lo subía a 6 — y una
       sola reserva sin pagar volvía a dejar disponible en cero.

       Esto recorre los VEINTIOCHO niveles de stock, no solo el catálogo
       recién arrancado, y en cada uno lanza 100 identidades distintas
       pidiendo desde el máximo hacia abajo. */
    const inv = require("./inventario.js");
    const STOCK = 27;   // ValEnd, según productos.json

    for (let vendidas = 0; vendidas <= STOCK; vendidas++) {
      inv._reiniciar();
      /* Las ventas confirmadas sí pueden llevar el stock a cero: eso es
         vender. Lo que no puede es una reserva que nadie pagó. */
      if (vendidas) inv.confirmar("VENTA", [{ sku: "ValEnd", cantidad: vendidas }]);
      const quedan = inv.disponible("ValEnd");

      for (let i = 0; i < 100; i++) {
        for (let q = inv.MAX_POR_SKU; q >= 1; q--) {
          if (inv.reservar(`A${i}-${q}`, [{ sku: "ValEnd", cantidad: q }],
              { identidad: "ip" + i }).ok) break;
        }
      }

      const apartado = inv.apartadoSinPagar("ValEnd");
      const techo = inv.techoReservable("ValEnd");
      afirmar(apartado <= techo,
        `con ${quedan} en stock se apartaron ${apartado} y el techo era ${techo}`);
      afirmar(inv.disponible("ValEnd") >= Math.min(quedan, inv.STOCK_SEGURIDAD),
        `con ${quedan} en stock, 100 identidades dejaron disponible en ` +
        `${inv.disponible("ValEnd")}`);
    }
    inv._reiniciar();
  });

  await prueba("el caso exacto del informe: 21 vendidas, quedan 6, reserva de 6", () => {
    const inv = require("./inventario.js");
    inv._reiniciar();
    inv.confirmar("VENTA", [{ sku: "ValEnd", cantidad: 21 }]);
    afirmar(inv.disponible("ValEnd") === 6, "no quedaron 6 piezas");

    const r = inv.reservar("BOT", [{ sku: "ValEnd", cantidad: 6 }], { identidad: "bot" });
    afirmar(!r.ok, "la reserva de las 6 últimas pasó");
    afirmar(r.motivo === "stock-protegido", `motivo inesperado: ${r.motivo}`);
    afirmar(r.maximo_comprable_en_linea === 3,
      `el cupo debería ser 3 y fue ${r.maximo_comprable_en_linea}`);
    afirmar(/WhatsApp/.test(r.error), "el rechazo no ofrece salida");
    afirmar(inv.disponible("ValEnd") === 6, "el intento fallido movió el inventario");
    inv._reiniciar();
  });

  await prueba("MAX_POR_SKU es un límite por pedido y NUNCA levanta el techo", () => {
    const inv = require("./inventario.js");
    inv._reiniciar();
    for (let vendidas = 0; vendidas <= 27; vendidas++) {
      if (vendidas) { inv._reiniciar(); inv.confirmar("V", [{ sku: "ValEnd", cantidad: vendidas }]); }
      const porVender = 27 - vendidas;
      const esperado = Math.min(
        Math.floor(porVender * inv.FRACCION_RESERVABLE),
        Math.max(0, porVender - inv.STOCK_SEGURIDAD)
      );
      afirmar(inv.techoReservable("ValEnd") === esperado,
        `con ${porVender} por vender el techo fue ${inv.techoReservable("ValEnd")} ` +
        `y debía ser ${esperado}`);
    }
    inv._reiniciar();
  });

  await prueba("las variables absurdas se recortan en vez de abrir el agujero", () => {
    const inv = require("./inventario.js");
    afirmar(inv.FRACCION_RESERVABLE >= 0.1 && inv.FRACCION_RESERVABLE <= 0.8,
      `la fracción quedó en ${inv.FRACCION_RESERVABLE}`);
    afirmar(inv.STOCK_SEGURIDAD >= 1, "la reserva de seguridad bajó de 1");
    afirmar(inv.MINUTOS_RESERVA >= 1 && inv.MINUTOS_RESERVA <= 60,
      `la reserva dura ${inv.MINUTOS_RESERVA} minutos`);
  });

  await prueba("una reserva larga heredada del panel no revive el agujero", () => {
    const inv = require("./inventario.js");
    afirmar(inv.MINUTOS_RESERVA <= inv.TECHO_MINUTOS_RESERVA,
      "la reserva superó su propio techo");
    afirmar(inv.TECHO_MINUTOS_RESERVA <= 60,
      "el techo de la reserva subió: una reserva larga vuelve a agotar el catálogo");
    afirmar(inv.MAX_RESERVAS_POR_IDENTIDAD === 1,
      `hay ${inv.MAX_RESERVAS_POR_IDENTIDAD} reservas vivas por identidad`);
  });

  // -------------------------------------------------------------------------
  console.log("\n[B-02] El webhook acusa recibo cuando ya terminó");
  // -------------------------------------------------------------------------

  await prueba("sin firma se rechaza con 401 y no se procesa nada", async () => {
    const r = await avisarWebhook("999", { conFirma: false });
    afirmar(r.status === 401, `respondió ${r.status}`);
  });

  await prueba("si Mercado Pago no responde, se pide reintento con 5xx", async () => {
    mp.romper = true;
    const r = await avisarWebhook("777");
    mp.romper = false;
    afirmar(r.status >= 500, `respondió ${r.status}; con un 200 se perdería el pago`);
  });

  // -------------------------------------------------------------------------
  console.log("\n[M-02] Un descuadre no surte, no descuenta y no se da por bueno");
  // -------------------------------------------------------------------------

  await prueba("un importe que no cuadra deja el pedido en revisión", async () => {
    afirmar(folioBueno, "no hay folio de la prueba anterior");
    mp.pagos.set("descuadre-1", {
      id: "descuadre-1",
      status: "approved",
      status_detail: "accredited",
      external_reference: folioBueno,
      /* Un peso menos del total real: basta para no surtir. */
      transaction_amount: (totalPreferencia - 100) / 100,
      payment_method_id: "visa",
      payment_type_id: "credit_card",
      payer: { email: "otro@ejemplo.mx" }
    });

    const inventarioAntes = await pedir("/api/admin/resumen", {
      headers: { "X-Leads-Token": TOKEN_PANEL }
    });
    afirmar(inventarioAntes.status === 200, "no se pudo consultar el inventario antes del aviso");

    const r = await avisarWebhook("descuadre-1");
    afirmar(r.status === 200, `respondió ${r.status}`);
    afirmar(r.cuerpo.revision === true, "el pedido no quedó marcado como revisión");

    /* Comparar el estado interno por la ruta autenticada, no por health. */
    const inventarioDespues = await pedir("/api/admin/resumen", {
      headers: { "X-Leads-Token": TOKEN_PANEL }
    });
    afirmar(inventarioDespues.status === 200, "no se pudo consultar el inventario después del aviso");
    afirmar(JSON.stringify(inventarioDespues.cuerpo.inventario) === JSON.stringify(inventarioAntes.cuerpo.inventario),
      "un descuadre modificó el inventario");
  });

  // -------------------------------------------------------------------------
  console.log("\n[M-03] Mercado Pago reintenta; el teléfono no repite");
  // -------------------------------------------------------------------------

  await prueba("el mismo aviso dos veces se procesa una sola vez", async () => {
    mp.pagos.set("repe-1", {
      id: "repe-1",
      status: "approved",
      status_detail: "accredited",
      external_reference: "VQ-NO-EXISTE-AQUI",
      transaction_amount: 100,
      payment_method_id: "visa",
      payment_type_id: "credit_card",
      payer: { email: "x@y.mx" }
    });
    const primero = await avisarWebhook("repe-1");
    const segundo = await avisarWebhook("repe-1");
    afirmar(primero.status === 200 && !primero.cuerpo.repetido, "el primero no se procesó");
    afirmar(segundo.status === 200 && segundo.cuerpo.repetido === true,
      "el reintento se volvió a procesar: el aviso suena dos veces");
  });

  // -------------------------------------------------------------------------
  console.log("\n[M-04] El token del panel no viaja en la URL");
  // -------------------------------------------------------------------------

  await prueba("el token BUENO en la query ya no abre el panel", async () => {
    /* Con el token correcto: por cabecera entra, por query string no. Esa es
       toda la prueba — un token que funciona en la URL acaba en el historial
       del navegador, en las capturas y en el Referer. */
    const porCabecera = await pedir("/api/admin/resumen", {
      headers: { "X-Leads-Token": TOKEN_PANEL }
    });
    afirmar(porCabecera.status === 200,
      `la cabecera dejó de funcionar (${porCabecera.status}): se rompió el panel`);

    const porQuery = await pedir("/api/admin/resumen?t=" + encodeURIComponent(TOKEN_PANEL));
    afirmar(porQuery.status === 404, `el token en la URL sigue abriendo el panel (${porQuery.status})`);
  });

  await prueba("el panel cuenta aparte los pedidos en revisión", async () => {
    const r = await pedir("/api/admin/resumen", { headers: { "X-Leads-Token": TOKEN_PANEL } });
    afirmar(r.status === 200, `respondió ${r.status}`);
    afirmar(typeof r.cuerpo.dinero.en_revision === "number",
      "los descuadres se siguen contando como ventas");
    afirmar(r.cuerpo.dinero.en_revision >= 1,
      "el descuadre de la prueba anterior no aparece como pedido en revisión");

    const elDescuadrado = r.cuerpo.pedidos.find(p => p.folio === folioBueno);
    afirmar(elDescuadrado, "el pedido descuadrado desapareció del panel");
    afirmar(elDescuadrado.estado === "revision",
      `el pedido descuadrado quedó como «${elDescuadrado.estado}»`);
    afirmar(!r.cuerpo.pedidos.some(p => p.folio === folioBueno && p.estado === "approved"),
      "un descuadre se está contando como cobrado");
  });

  // -------------------------------------------------------------------------
  console.log("\n[B-01] La URL de retorno no es una prueba de pago");
  // -------------------------------------------------------------------------

  const { decidirVeredicto, autoridadDeLaUrl, folioDeLaUrl } =
    await import("./assets/js/veredicto-pago.js");

  /* Las esperas del sondeo se acortan: se prueba la lógica, no la paciencia. */
  const sinEsperas = { dormir: async () => {}, esperas: [0, 0, 0] };

  const consultarContra = respuestas => {
    let i = 0;
    return async () => respuestas[Math.min(i++, respuestas.length - 1)];
  };

  await prueba("URL forjada con approved: ni confirma ni vacía el carrito", async () => {
    const params = new URLSearchParams(
      "collection_status=approved&status=approved&external_reference=VQ-FALSO1-ABCDEF"
    );
    const v = await decidirVeredicto({
      params,
      enCurso: null,
      /* El servidor no conoce ese folio, que es lo que pasa de verdad. */
      consultar: consultarContra([{ status: 404 }]),
      ...sinEsperas
    });
    afirmar(v.estado !== "aprobado", `dijo «${v.estado}» a un folio inventado`);
    afirmar(v.estado === "sin-verificar", `estado inesperado: ${v.estado}`);
    afirmar(v.vaciarCarrito === false, "borró el carrito de alguien que no compró");
  });

  await prueba("URL forjada sobre un folio real pendiente: sigue sin confirmar", async () => {
    const params = new URLSearchParams(
      "collection_status=approved&external_reference=VQ-REAL01-ABCDEF"
    );
    const v = await decidirVeredicto({
      params,
      enCurso: null,
      /* El servidor lo conoce, pero el webhook aún no llegó. */
      consultar: consultarContra([{ status: 200, body: { ok: true, estado: "pendiente" } }]),
      ...sinEsperas
    });
    afirmar(v.estado === "pendiente", `estado inesperado: ${v.estado}`);
    afirmar(v.vaciarCarrito === false, "vació el carrito sin confirmación del servidor");
  });

  await prueba("un backend caído tampoco confirma nada", async () => {
    const v = await decidirVeredicto({
      params: new URLSearchParams("collection_status=approved&external_reference=VQ-REAL01-ABCDEF"),
      enCurso: null,
      consultar: async () => { throw new Error("red caída"); },
      ...sinEsperas
    });
    afirmar(v.estado === "sin-verificar", `estado inesperado: ${v.estado}`);
    afirmar(v.vaciarCarrito === false, "vació el carrito con el backend caído");
  });

  await prueba("solo el servidor confirma, y entonces sí se vacía el carrito", async () => {
    const v = await decidirVeredicto({
      params: new URLSearchParams("external_reference=VQ-REAL01-ABCDEF"),
      enCurso: null,
      /* Primero pendiente —el webhook tarda— y luego aprobado. */
      consultar: consultarContra([
        { status: 200, body: { ok: true, estado: "pendiente" } },
        { status: 200, body: { ok: true, estado: "approved", total: "$536.83 MXN" } }
      ]),
      ...sinEsperas
    });
    afirmar(v.estado === "aprobado", `estado inesperado: ${v.estado}`);
    afirmar(v.vaciarCarrito === true, "un pago confirmado no vació el carrito");
  });

  await prueba("un pedido en revisión no se anuncia como pagado", async () => {
    const v = await decidirVeredicto({
      params: new URLSearchParams("collection_status=approved&external_reference=VQ-REAL01-ABCDEF"),
      enCurso: null,
      consultar: consultarContra([{ status: 200, body: { ok: true, estado: "revision" } }]),
      ...sinEsperas
    });
    afirmar(v.estado === "revision", `estado inesperado: ${v.estado}`);
    afirmar(v.vaciarCarrito === false, "vació el carrito de un pedido en revisión");
  });

  await prueba("abrir /gracias sin haber pagado no dice absolutamente nada", async () => {
    const v = await decidirVeredicto({
      params: new URLSearchParams(""),
      enCurso: null,
      consultar: consultarContra([{ status: 404 }]),
      ...sinEsperas
    });
    afirmar(v.hablar === false, "la página afirmó algo sin que nadie viniera de pagar");
    afirmar(v.vaciarCarrito === false, "vació el carrito de un visitante cualquiera");
  });

  await prueba("NINGÚN estado de la URL produce veredicto, tampoco el malo", () => {
    ["collection_status=approved", "estado=aprobado", "collection_status=rejected",
     "estado=fallo", "status=cancelled", "payment_status=failure"].forEach(q => {
      afirmar(autoridadDeLaUrl(new URLSearchParams(q)) === null,
        `«${q}» de la URL se está leyendo como veredicto`);
    });
  });

  await prueba("un rejected forjado NO puede anunciar un pago que sí entró", async () => {
    /* El agujero que quedaba. Se aceptaba el `rejected` de la URL «porque no
       puede hacer daño»: y el daño era este —la página anunciaba que el pago
       había fallado y ofrecía pagar OTRA VEZ algo ya cobrado—. */
    let consultas = 0;
    const v = await decidirVeredicto({
      params: new URLSearchParams(
        "collection_status=rejected&estado=fallo&external_reference=VQ-REAL01-ABCDEF"
      ),
      enCurso: null,
      consultar: async () => {
        consultas++;
        return { status: 200, body: { ok: true, estado: "approved" } };
      },
      ...sinEsperas
    });
    afirmar(consultas > 0, "ni siquiera se le preguntó al servidor");
    afirmar(v.estado === "aprobado",
      `la URL impuso «${v.estado}» sobre el approved del servidor`);
    afirmar(v.vaciarCarrito === true, "un pago confirmado no vació el carrito");
  });

  await prueba("un rechazo de verdad sigue reconociéndose, pero lo dice el servidor", async () => {
    const v = await decidirVeredicto({
      params: new URLSearchParams("collection_status=rejected&external_reference=VQ-REAL01-ABCDEF"),
      enCurso: null,
      consultar: async () => ({ status: 200, body: { ok: true, estado: "rejected" } }),
      ...sinEsperas
    });
    afirmar(v.estado === "fallo", `estado inesperado: ${v.estado}`);
    afirmar(v.vaciarCarrito === false, "un pago rechazado vació el carrito");
  });

  await prueba("con la URL en rejected y el backend mudo, no se ofrece pagar de nuevo", async () => {
    /* `sin-verificar` es el único desenlace honesto cuando nadie confirma. La
       página, en ese estado, ofrece WhatsApp y carrito — nunca un segundo
       cobro. */
    const v = await decidirVeredicto({
      params: new URLSearchParams("collection_status=rejected&external_reference=VQ-REAL01-ABCDEF"),
      enCurso: null,
      consultar: async () => { throw new Error("red caída"); },
      ...sinEsperas
    });
    afirmar(v.estado === "sin-verificar",
      `con el backend caído dijo «${v.estado}» en vez de sin-verificar`);
    afirmar(v.vaciarCarrito === false, "vació el carrito");
    const front = leerFuente("assets/js/app.js");
    afirmar(/estado === 'fallo' && Carrito\.piezas\(\) > 0/.test(front),
      "el botón de pagar dejó de estar reservado al fallo confirmado");
  });

  await prueba("el sondeo tiene tope de reloj: nunca gira para siempre", async () => {
    /* Cada consulta puede tardar: en el plan gratuito de Render el backend
       duerme. Sin tope de reloj, seis consultas lentas dejan a alguien que
       acaba de pagar mirando «un momento…» durante más de un minuto. */
    let consultas = 0;
    let reloj = 0;
    const v = await decidirVeredicto({
      params: new URLSearchParams("external_reference=VQ-REAL01-ABCDEF"),
      enCurso: null,
      consultar: async () => {
        consultas++;
        reloj += 9000;                      // cada consulta tarda nueve segundos
        return { status: 200, body: { ok: true, estado: "pendiente" } };
      },
      dormir: async () => {},
      ahora: () => reloj,
      esperas: [0, 1200, 2000, 3500, 5000, 6000]
    });
    afirmar(consultas <= 3,
      `se hicieron ${consultas} consultas: el tope de reloj no frenó el sondeo`);
    afirmar(v.estado === "pendiente", `estado inesperado: ${v.estado}`);
    afirmar(v.vaciarCarrito === false, "vació el carrito");
  });

  await prueba("un folio con forma rara no llega ni a preguntarse", () => {
    afirmar(folioDeLaUrl("VQ-M1ABCD-A1B2C3") === "VQ-M1ABCD-A1B2C3", "rechazó un folio válido");
    ["", "cualquier cosa", "<img src=x>", "VQ-", "../../etc/passwd",
     "VQ-M1ABCD-A1B2C3 extra"].forEach(malo => {
      afirmar(folioDeLaUrl(malo) === "", `aceptó «${malo}» como folio`);
    });
  });
}

// ---------------------------------------------------------------------------
//  Retención de pedidos y replay — servidor aparte, con instantánea en disco
// ---------------------------------------------------------------------------
/* Otro proceso real de server.js, con ALMACEN_RUTA en un directorio temporal
   para poder apagarlo y encenderlo —perdiendo lo que solo vive en memoria,
   como EVENTOS_VISTOS— y con PEDIDOS_WEBHOOK_URL apuntando al falso, que
   cuenta cada orden de surtir. */
const PUERTO_RET = 4713;
const BASE_RET = `http://127.0.0.1:${PUERTO_RET}`;

async function levantarRetencion(ruta) {
  const hijo = spawn(process.execPath, [path.join(__dirname, "server.js")], {
    env: {
      ...process.env,
      PORT: String(PUERTO_RET), NODE_ENV: "test", AVISOS_SILENCIO: "1",
      GEMINI_API_KEY: "no-se-usa-en-estas-pruebas", MP_ACCESS_TOKEN: "APP_USR-de-mentira",
      MP_WEBHOOK_SECRET: SECRETO, MP_API_URL: `http://127.0.0.1:${PUERTO_MP}`,
      RATE_LIMIT_PAGO_POR_MINUTO: "100", RATE_LIMIT_ADMIN_POR_MINUTO: "1000", RATE_LIMIT_ADMIN_POR_DIA: "10000",
      LEADS_TOKEN: TOKEN_PANEL, SITIO_URL: "https://valquiriainc.com", BACKEND_URL: BASE_RET,
      ALMACEN_RUTA: ruta, PEDIDOS_WEBHOOK_URL: `http://127.0.0.1:${PUERTO_MP}/__surtir`,
      LEADS_WEBHOOK_URL: "", DATABASE_URL: undefined, RENDER: undefined
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const logs = [];
  hijo.stdout.on("data", d => logs.push(String(d)));
  hijo.stderr.on("data", d => logs.push(String(d)));
  for (let i = 0; i < 80; i++) {
    await new Promise(r => setTimeout(r, 100));
    try { if ((await fetch(BASE_RET + "/health")).ok) break; } catch { /* aún no */ }
  }
  let vivo = true;
  hijo.once("exit", () => { vivo = false; });
  /* SIGTERM, como Render al desplegar: dispara el volcado final a disco. */
  const parar = () => (vivo ? new Promise(r => { hijo.once("exit", r); hijo.kill("SIGTERM"); }) : Promise.resolve());
  return { hijo, logs, parar };
}

async function correrPruebasDeRetencion() {
  const fs = require("fs");
  const os = require("os");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vq-retencion-"));
  const ruta = path.join(dir, "valquiria.json");
  const panel = async () => (await pedir("/api/admin/resumen", { base: BASE_RET,
    headers: { "X-Leads-Token": TOKEN_PANEL } })).cuerpo;
  const pagar = (items, comprador = COMPRADOR) => pedir("/api/pago", { base: BASE_RET, method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items, comprador, visitante: crypto.randomUUID() }) });
  const webhook = id => avisarWebhook(id, { base: BASE_RET });
  const aprobado = (id, folio, centavos, extra = {}) => mp.pagos.set(id, { id, status: "approved",
    status_detail: "accredited", external_reference: folio, transaction_amount: centavos / 100,
    payment_method_id: "visa", payment_type_id: "credit_card", payer: { email: "x@correo.invalid" }, ...extra });
  const vendido = (p, sku) => p.inventario.find(x => x.sku === sku).vendido_en_esta_sesion;
  /* La orden de surtir sale sin await (el webhook no espera al CRM): se
     sondea hasta que llegue, y antes de afirmar que NO llegó otra se deja
     pasar un rato. */
  const surtidosDe = folio => mp.surtidos.filter(s => s.folio === folio).length;
  const esperarSurtidos = async (folio, n) => {
    for (let i = 0; i < 40 && surtidosDe(folio) < n; i++) await new Promise(r => setTimeout(r, 50));
    await new Promise(r => setTimeout(r, 250));
    return surtidosDe(folio);
  };
  const iso = ms => new Date(ms).toISOString();
  const HORA = 3600_000, DIA = 24 * HORA;

  /* Pedidos que no creó esta prueba, escritos directo en la instantánea: con
     datos inventados (correos .invalid), como los que dejaría un proceso
     anterior. `crear(n, f)` da n pedidos con la forma que devuelva f(i). */
  const sinteticos = (n, prefijo, f) => Array.from({ length: n }, (_, i) => ({
    folio: `VQ-${prefijo}${String(i).padStart(4, "0")}-000000`, total: "$500.00 MXN", total_centavos: 50000,
    items: [{ sku: "ValPulpo", cantidad: 1, titulo: "Pulpo" }],
    comprador: { nombre: `Comprador ${prefijo} ${i}`, whatsapp: "520000000000", email: `c${i}@correo.invalid`,
      cp: "42083", direccion: `Calle Inventada ${i}, Pachuca` },
    ...f(i)
  }));
  const reescribir = cambiar => {
    const foto = JSON.parse(fs.readFileSync(ruta, "utf8"));
    cambiar(foto);
    fs.writeFileSync(ruta, JSON.stringify(foto));
  };

  let srv = null;
  try {
    // -----------------------------------------------------------------------
    console.log("\n[MAX_PEDIDOS] Un pedido que todavía puede cobrarse no se expulsa");
    // -----------------------------------------------------------------------
    let A = null;
    await prueba("pedido A + 300 posteriores que pueden pagarse: el checkout nuevo falla cerrado", async () => {
      srv = await levantarRetencion(ruta);
      const r = await pagar([{ sku: "ValEnd", cantidad: 1 }]);
      afirmar(r.status === 200, `no se creó A (${r.status})`);
      A = { folio: r.cuerpo.folio, total: r.cuerpo.total_centavos };
      await srv.parar();
      /* Los 300 posteriores: links vigentes, o pagos en curso. */
      const ahora = Date.now();
      reescribir(foto => foto.pedidos.push(...sinteticos(300, "POST", i => ({
        estado: i % 3 === 0 ? "pending" : "pendiente", creado: iso(ahora + i), vence: iso(ahora + HORA)
      }))));
      srv = await levantarRetencion(ruta);
      const antes = await panel();
      afirmar(antes.dinero.pedidos_totales === 301, `se restauraron ${antes.dinero.pedidos_totales} pedidos`);
      const preferencias = mp.preferencias.length;
      for (let i = 0; i < 3; i++) {
        const n = await pagar([{ sku: "ValPulpo", cantidad: 1 }]);
        afirmar(n.status === 503 && n.cuerpo.motivo === "capacidad", `el pedido nuevo respondió ${n.status} ${n.cuerpo.motivo}`);
        afirmar(/WhatsApp/.test(n.cuerpo.error) && /carrito sigue/.test(n.cuerpo.error), "el rechazo no ofrece salida ni tranquiliza sobre el carrito");
      }
      afirmar(mp.preferencias.length === preferencias, "se creó un link de pago sin lugar para el pedido");
      const despues = await panel();
      afirmar(JSON.stringify(despues.inventario) === JSON.stringify(antes.inventario), "un checkout rechazado apartó mercancía");
      afirmar(despues.dinero.pedidos_totales === 301, "un pedido anterior desapareció para hacer lugar");
      const configs = despues.actividad.filter(e => e.tipo === "config" && /checkout rechaza/.test(e.detalle || ""));
      afirmar(configs.length === 1, `avisos de checkout cerrado: ${configs.length} (se espera uno, no uno por intento)`);
    });
    await prueba("el pago firmado de A sigue encontrando artículos, domicilio e importe esperado", async () => {
      afirmar(A, "no hay pedido A");
      const pA = (await panel()).pedidos.find(p => p.folio === A.folio);
      afirmar(pA && pA.items.length && pA.destino?.direccion, "A perdió sus artículos o su domicilio");
      const antes = await panel();
      aprobado("ret-a-1", A.folio, A.total);
      const r = await webhook("ret-a-1");
      afirmar(r.status === 200 && !r.cuerpo.revision && !r.cuerpo.repetido, `webhook: ${r.status} ${JSON.stringify(r.cuerpo)}`);
      const d = await panel();
      const aviso = d.actividad.find(e => e.tipo === "pago_aprobado" && e.folio === A.folio);
      afirmar(aviso && /ValEnd|Endodoncia|1×/.test(aviso.items || "") && aviso.direccion === COMPRADOR.direccion &&
        aviso.cp === COMPRADOR.cp && aviso.total_centavos === A.total, `aviso de A incompleto: ${JSON.stringify(aviso)}`);
      afirmar(vendido(d, "ValEnd") === vendido(antes, "ValEnd") + 1, "el pago de A no descontó inventario");
      afirmar(await esperarSurtidos(A.folio, 1) === 1, `órdenes de surtir de A: ${surtidosDe(A.folio)}`);
      /* Y el cuadre de importe sigue vivo: otro pedido pagado de menos. */
      afirmar(d.pedidos.find(p => p.folio === A.folio).estado === "approved", "A no quedó aprobado");
    });

    // -----------------------------------------------------------------------
    console.log("\n[MAX_PEDIDOS] Solo se olvida lo que ya no puede recibir un pago");
    // -----------------------------------------------------------------------
    await prueba("con 300 llenos, se olvidan los cerrados y vencidos, nunca los pagables", async () => {
      await srv.parar();
      const ahora = Date.now();
      reescribir(foto => {
        foto.pedidos = foto.pedidos.filter(p => !p.folio.startsWith("VQ-POST"));
        foto.pedidos.push(
          /* Olvidables: link vencido y sin pago en curso, pasada la gracia. */
          ...sinteticos(40, "OLVP", () => ({ estado: "pendiente", creado: iso(ahora - 3 * DIA), vence: iso(ahora - 3 * DIA + HORA) })),
          ...sinteticos(30, "OLVR", () => ({ estado: "rejected", creado: iso(ahora - 10 * DIA), actualizado: iso(ahora - 10 * DIA) })),
          ...sinteticos(30, "OLVA", i => ({ estado: "approved", creado: iso(ahora - 10 * DIA), actualizado: iso(ahora - 10 * DIA),
            pago_aprobado_id: `olvidado-${i}` })),
          /* Pagables: link vigente, pago en curso, o dentro de la gracia. */
          ...sinteticos(80, "VIVP", () => ({ estado: "pendiente", creado: iso(ahora - HORA / 2), vence: iso(ahora + HORA / 2) })),
          ...sinteticos(40, "VIVE", () => ({ estado: "in_process", creado: iso(ahora - 30 * DIA), vence: iso(ahora - 29 * DIA) })),
          ...sinteticos(40, "VIVR", () => ({ estado: "rejected", creado: iso(ahora - 10 * HORA), vence: iso(ahora + HORA) })),
          ...sinteticos(40, "VIVA", i => ({ estado: "approved", creado: iso(ahora - 2 * DIA), actualizado: iso(ahora - 2 * DIA),
            pago_aprobado_id: `reciente-${i}` })));
      });
      srv = await levantarRetencion(ruta);
      afirmar((await panel()).dinero.pedidos_totales === 301, "la instantánea no trae los 301 pedidos");
      const r = await pagar([{ sku: "ValPulpo", cantidad: 1 }]);
      afirmar(r.status === 200, `con olvidables disponibles el checkout respondió ${r.status} ${r.cuerpo.motivo || ""}`);
      const folios = (await panel()).pedidos.map(p => p.folio);
      const cuenta = pre => folios.filter(f => f.startsWith("VQ-" + pre)).length;
      afirmar(cuenta("OLVP") + cuenta("OLVR") + cuenta("OLVA") === 0, "quedaron pedidos olvidables");
      for (const [pre, n] of [["VIVP", 80], ["VIVE", 40], ["VIVR", 40], ["VIVA", 40]]) {
        afirmar(cuenta(pre) === n, `de ${pre} quedan ${cuenta(pre)} de ${n}: se olvidó un pedido pagable`);
      }
      afirmar(folios.includes(A.folio) && folios.includes(r.cuerpo.folio), "falta A o el pedido nuevo");
    });

    // -----------------------------------------------------------------------
    console.log("\n[Orden ausente] Un pago firmado sin pedido completo va a revisión, nunca a surtir");
    // -----------------------------------------------------------------------
    await prueba("un pago aprobado de un pedido ya olvidado no se surte: queda en revisión con id, folio e importe", async () => {
      const antes = await panel();
      aprobado("olvidado-3", "VQ-OLVA0003-000000", 50000);
      const r = await webhook("olvidado-3");
      afirmar(r.status === 200 && r.cuerpo.revision === true, `respondió ${r.status} ${JSON.stringify(r.cuerpo)}`);
      const d = await panel();
      const rev = d.actividad.find(e => e.tipo === "pago_revision" && e.pago_id === "olvidado-3");
      afirmar(rev && rev.folio === "VQ-OLVA0003-000000" && rev.total_centavos === 50000 && rev.motivo === "pedido-desconocido",
        `aviso de revisión: ${JSON.stringify(rev)}`);
      afirmar(!d.actividad.some(e => e.tipo === "pago_aprobado" && e.folio === "VQ-OLVA0003-000000"), "salió un PAGO APROBADO para surtir");
      afirmar(d.hoy.pagos_aprobados === antes.hoy.pagos_aprobados && d.hoy.ingreso_centavos === antes.hoy.ingreso_centavos,
        "contó como ingreso");
      afirmar(JSON.stringify(d.inventario) === JSON.stringify(antes.inventario), "tocó el inventario");
      afirmar(await esperarSurtidos("VQ-OLVA0003-000000", 1) === 0, "mandó la orden de surtir");
      const guardado = d.pedidos.find(p => p.folio === "VQ-OLVA0003-000000");
      afirmar(guardado && guardado.estado === "revision", "no quedó registro en revisión con el folio");
    });
    await prueba("orden realmente desconocida, sin folio o incompleta: revisión, sin inventario y sin surtido", async () => {
      const antes = await panel();
      aprobado("desconocido-1", "VQ-NOEXISTE-000000", 123400);
      aprobado("sinfolio-1", null, 99900);
      /* Un pendiente de un folio desconocido abre un registro sin artículos
         ni domicilio; su aprobación NO puede surtirse con eso. */
      mp.pagos.set("parcial-1", { id: "parcial-1", status: "pending", status_detail: "pending_waiting_payment",
        external_reference: "VQ-PARCIAL-000000", transaction_amount: 777, payment_type_id: "ticket", payment_method_id: "oxxo" });
      afirmar((await webhook("parcial-1")).status === 200, "el pendiente parcial no se procesó");
      aprobado("parcial-2", "VQ-PARCIAL-000000", 77700);
      const motivos = {};
      for (const id of ["desconocido-1", "sinfolio-1", "parcial-2"]) {
        const r = await webhook(id);
        afirmar(r.status === 200 && r.cuerpo.revision === true, `${id}: ${r.status} ${JSON.stringify(r.cuerpo)}`);
      }
      const d = await panel();
      for (const e of d.actividad.filter(e => e.tipo === "pago_revision")) motivos[e.pago_id] = e.motivo;
      afirmar(motivos["desconocido-1"] === "pedido-desconocido" && motivos["sinfolio-1"] === "sin-folio" &&
        motivos["parcial-2"] === "pedido-incompleto", `motivos: ${JSON.stringify(motivos)}`);
      afirmar(!d.actividad.some(e => e.tipo === "pago_aprobado" && ["VQ-NOEXISTE-000000", "VQ-PARCIAL-000000", null].includes(e.folio)),
        "una orden sin pedido completo produjo un PAGO APROBADO");
      afirmar(JSON.stringify(d.inventario) === JSON.stringify(antes.inventario), "se descontó inventario de una orden desconocida");
      afirmar(d.hoy.pagos_aprobados === antes.hoy.pagos_aprobados, "una orden desconocida contó como venta");
      afirmar(await esperarSurtidos("VQ-NOEXISTE-000000", 1) + surtidosDe("VQ-PARCIAL-000000") === 0, "se ordenó surtir una orden desconocida");
    });

    // -----------------------------------------------------------------------
    console.log("\n[Replay] La misma aprobación, tras perder EVENTOS_VISTOS, no produce nada");
    // -----------------------------------------------------------------------
    let X = null;
    let tras = null;
    await prueba("aprobación válida: un aviso, una métrica, una venta, una orden de surtir", async () => {
      const r = await pagar([{ sku: "ValEnd", cantidad: 1 }]);
      afirmar(r.status === 200, `no se creó X (${r.status} ${r.cuerpo.motivo || ""})`);
      X = { folio: r.cuerpo.folio, total: r.cuerpo.total_centavos };
      const antes = await panel();
      aprobado("rep-x-1", X.folio, X.total);
      const w = await webhook("rep-x-1");
      afirmar(w.status === 200 && !w.cuerpo.repetido && !w.cuerpo.revision, `webhook: ${JSON.stringify(w.cuerpo)}`);
      tras = await panel();
      afirmar(tras.hoy.pagos_aprobados === antes.hoy.pagos_aprobados + 1, "no se contó la venta");
      afirmar(tras.hoy.ingreso_centavos === antes.hoy.ingreso_centavos + X.total, "no se sumó el ingreso");
      afirmar(vendido(tras, "ValEnd") === vendido(antes, "ValEnd") + 1, "no se descontó");
      afirmar(await esperarSurtidos(X.folio, 1) === 1, "no salió la orden de surtir");
    });
    await prueba("reinicio (EVENTOS_VISTOS vacío) + la misma aprobación firmada: 0 avisos, 0 métricas, 0 ventas", async () => {
      await srv.parar();
      srv = await levantarRetencion(ruta);
      const antes = await panel();
      afirmar(antes.hoy.pagos_aprobados === tras.hoy.pagos_aprobados, "la bitácora no sobrevivió al reinicio: la prueba no mide nada");
      const w = await webhook("rep-x-1");
      afirmar(w.status === 200 && w.cuerpo.repetido === true, `el replay se procesó otra vez: ${JSON.stringify(w.cuerpo)}`);
      const d = await panel();
      afirmar(d.hoy.pagos_aprobados === antes.hoy.pagos_aprobados, "segundo PAGO APROBADO");
      afirmar(d.hoy.ingreso_centavos === antes.hoy.ingreso_centavos, "segunda métrica de ingreso");
      afirmar(vendido(d, "ValEnd") === vendido(antes, "ValEnd"), "segunda venta en inventario");
      afirmar(await esperarSurtidos(X.folio, 2) === 1, `órdenes de surtir de X: ${surtidosDe(X.folio)}`);
      /* También las revisiones y los duplicados ya avisados. */
      const revisiones = d.actividad.filter(e => e.tipo === "pago_revision").length;
      afirmar((await webhook("desconocido-1")).cuerpo.repetido === true, "una revisión ya avisada volvió a sonar");
      afirmar((await panel()).actividad.filter(e => e.tipo === "pago_revision").length === revisiones, "segundo aviso de revisión");
    });
    await prueba("801 eventos ajenos expulsan EVENTOS_VISTOS en caliente, y el replay sigue sin efectos", async () => {
      const antes = await panel();
      for (let i = 0; i < 801; i++) {
        mp.pagos.set(`ruido-${i}`, { id: `ruido-${i}`, status: "rejected", status_detail: "cc_rejected_other_reason",
          external_reference: null, transaction_amount: 1, payment_type_id: "credit_card", payment_method_id: "visa" });
        await webhook(`ruido-${i}`);
      }
      /* Control positivo: el primer evento de ruido ya no está en la memoria. */
      const control = await webhook("ruido-0");
      afirmar(control.status === 200 && !control.cuerpo.repetido, "EVENTOS_VISTOS no se vació: la prueba no mide nada");
      const w = await webhook("rep-x-1");
      afirmar(w.status === 200 && w.cuerpo.repetido === true, `el replay se procesó otra vez: ${JSON.stringify(w.cuerpo)}`);
      const d = await panel();
      afirmar(d.hoy.eventos_en_bitacora < 1000, "la bitácora se desbordó: la cuenta de métricas no sería fiable");
      afirmar(d.hoy.pagos_aprobados === antes.hoy.pagos_aprobados && d.hoy.ingreso_centavos === antes.hoy.ingreso_centavos,
        "segundo aviso o métrica");
      afirmar(vendido(d, "ValEnd") === vendido(antes, "ValEnd") && await esperarSurtidos(X.folio, 2) === 1, "segunda venta u orden de surtir");
    });
    await prueba("otro payment ID del mismo pedido sigue siendo cobro doble (no replay), y avisa una sola vez", async () => {
      const antes = await panel();
      aprobado("rep-x-2", X.folio, X.total);
      const w = await webhook("rep-x-2");
      afirmar(w.status === 200 && w.cuerpo.duplicado === true && !w.cuerpo.repetido, `respondió ${JSON.stringify(w.cuerpo)}`);
      let d = await panel();
      const dups = () => d.actividad.filter(e => e.tipo === "pago_duplicado" && e.pago_duplicado === "rep-x-2").length;
      afirmar(dups() === 1 && d.hoy.pagos_aprobados === antes.hoy.pagos_aprobados, "no se trató como cobro doble");
      await srv.parar();
      srv = await levantarRetencion(ruta);
      afirmar((await webhook("rep-x-2")).cuerpo.repetido === true, "el cobro doble se procesó otra vez tras reiniciar");
      d = await panel();
      afirmar(dups() === 1, `avisos de cobro doble: ${dups()}`);
      afirmar(await esperarSurtidos(X.folio, 2) === 1 && vendido(d, "ValEnd") === 0, "el cobro doble surtió o vendió");
    });
    await prueba("la idempotencia no depende de un pedido expulsable: X aprobado sigue con el checkout lleno", async () => {
      await srv.parar();
      const ahora = Date.now();
      reescribir(foto => foto.pedidos.push(...sinteticos(300, "LLEN", i => ({
        estado: "pendiente", creado: iso(ahora + i), vence: iso(ahora + HORA) }))));
      srv = await levantarRetencion(ruta);
      const n = await pagar([{ sku: "ValPulpo", cantidad: 1 }]);
      afirmar(n.status === 503 && n.cuerpo.motivo === "capacidad", `con el mapa lleno respondió ${n.status}`);
      afirmar((await panel()).pedidos.some(p => p.folio === X.folio), "X desapareció para hacer lugar");
      const antes = await panel();
      afirmar((await webhook("rep-x-1")).cuerpo.repetido === true, "con el mapa lleno el replay se procesó");
      const d = await panel();
      afirmar(d.hoy.pagos_aprobados === antes.hoy.pagos_aprobados && await esperarSurtidos(X.folio, 2) === 1, "segundo aviso u orden de surtir");
    });
    await prueba("tres checkouts simultáneos por el último lugar: entra uno, los otros fallan cerrado", async () => {
      await srv.parar();
      const ahora = Date.now();
      reescribir(foto => {
        foto.pedidos = foto.pedidos.filter(p => !p.folio.startsWith("VQ-LLEN"));
        foto.pedidos.push(...sinteticos(299 - foto.pedidos.length, "ULTI", i => ({
          estado: "pendiente", creado: iso(ahora + i), vence: iso(ahora + HORA) })));
      });
      srv = await levantarRetencion(ruta);
      afirmar((await panel()).dinero.pedidos_totales === 299, "no quedó exactamente un lugar libre");
      const r = await Promise.all([0, 1, 2].map(() => pagar([{ sku: "ValPulpo", cantidad: 1 }])));
      const estados = r.map(x => x.status).sort();
      afirmar(JSON.stringify(estados) === "[200,503,503]", `respuestas: ${estados.join(", ")}`);
      afirmar((await panel()).dinero.pedidos_totales === 300, "se pasó del tope");
    });
    await prueba("sin fechas legibles o con un pago en curso, un pedido nunca se olvida", () => {
      const { esOlvidable, hacerLugar } = require("./pedidos-retencion.js");
      const hace = d => new Date(Date.now() - d * 24 * 3600_000).toISOString();
      afirmar(!esOlvidable({ estado: "approved" }, Date.now(), 3600_000), "sin fechas se olvidó");
      afirmar(!esOlvidable({ estado: "approved", creado: hace(30) }, Date.now(), NaN), "sin vigencia calculable se olvidó");
      for (const e of ["pending", "in_process", "authorized", "in_mediation"]) {
        afirmar(!esOlvidable({ estado: e, creado: hace(90), actualizado: hace(90) }, Date.now(), 3600_000), `${e} se olvidó`);
      }
      afirmar(esOlvidable({ estado: "approved", creado: hace(9), actualizado: hace(9) }, Date.now(), 3600_000), "un cerrado viejo no se olvida");
      const m = new Map([["a", { estado: "pending", creado: hace(90) }], ["b", { estado: "approved", creado: hace(1) }]]);
      afirmar(hacerLugar(m, { max: 2, vigenciaMs: 3600_000 }).ok === false && m.size === 2, "hizo lugar expulsando un pedido vivo");
    });
  } finally {
    if (srv) await srv.parar();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch(e => {
  console.error("\n✗ Las pruebas de blindaje se cayeron:", e);
  process.exit(1);
});
