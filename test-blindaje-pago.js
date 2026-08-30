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
  romper: false          // simula la API caída
};

const servidorMP = http.createServer((req, res) => {
  let cuerpo = "";
  req.on("data", c => (cuerpo += c));
  req.on("end", () => {
    if (mp.romper) {
      res.writeHead(500, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ message: "caída simulada" }));
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
  const r = await fetch(BASE + ruta, opciones);
  const texto = await r.text();
  let cuerpo = null;
  try { cuerpo = JSON.parse(texto); } catch { cuerpo = texto; }
  return { status: r.status, cuerpo };
}

async function avisarWebhook(pagoId, { conFirma = true } = {}) {
  const requestId = "req-" + pagoId;
  const cabeceras = { "Content-Type": "application/json", "x-request-id": requestId };
  if (conFirma) cabeceras["x-signature"] = firmar(pagoId, requestId);
  return pedir("/api/pago/webhook", {
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

  await prueba("/api/pago cobra el MISMO envío que cotiza /api/envio", async () => {
    /* Lo que ve el cliente en la pantalla. */
    const envio = await pedir("/api/envio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cp_destino: "03330", items: [{ sku: "ValEnd", cantidad: 1 }] })
    });
    afirmar(envio.status === 200 && envio.cuerpo.ok, "no se pudo cotizar el envío");
    const recomendada = envio.cuerpo.opciones.find(o => o.recomendada);
    afirmar(recomendada, "la cotización no trae opción recomendada");

    /* Lo que se va a cobrar. */
    const pago = await pedir("/api/pago", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ sku: "ValEnd", cantidad: 1 }], comprador: COMPRADOR })
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

    folioBueno = pago.cuerpo.folio;
    totalPreferencia = pago.cuerpo.desglose.total_centavos;
  });

  await prueba("un CP inexistente se devuelve como dato que falta, no como avería", async () => {
    const r = await pedir("/api/pago", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: [{ sku: "ValEnd", cantidad: 1 }],
        comprador: { ...COMPRADOR, cp: "00000" }
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
      body: JSON.stringify({ items: [{ sku: "ValEnd", cantidad: 27 }], comprador: COMPRADOR })
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
        comprador: COMPRADOR
      })
    });
    afirmar(r.status === 400, `respondió ${r.status}`);
    afirmar(r.cuerpo.motivo === "tope-unidades", `motivo inesperado: ${r.cuerpo.motivo}`);
  });

  await prueba("abrir pedidos seguidos no acumula mercancía apartada", async () => {
    /* Una reserva viva por visitante, y se consigue reemplazando: el cliente
       que deja un pago a medias y vuelve a intentarlo no se queda bloqueado,
       y lo de antes se libera en el acto. Lo que NO puede pasar es que se
       sumen. */
    const inv = require("./inventario.js");
    const abrir = () => pedir("/api/pago", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ sku: "ValPulpo", cantidad: 5 }], comprador: COMPRADOR })
    });
    const a = await abrir();
    const b = await abrir();
    const c = await abrir();
    [a, b, c].forEach((r, i) =>
      afirmar(r.status === 200, `el intento ${i + 1} se bloqueó (${r.status})`));

    const salud = await pedir("/health");
    const ficha = salud.cuerpo.inventario.apartado_por_sku
      ? salud.cuerpo.inventario.apartado_por_sku.ValPulpo
      : null;
    /* No se puede leer el estado interno del hijo, así que se comprueba lo
       observable: tres pedidos de 5 no dejaron 15 piezas apartadas — si las
       hubieran dejado, el stock de ValPulpo (23) no daría para el siguiente. */
    const cuarto = await abrir();
    afirmar(cuarto.status === 200,
      `las reservas se acumularon: el cuarto pedido ya no cabe (${cuarto.status}: ` +
      `${JSON.stringify(cuarto.cuerpo).slice(0, 120)})`);
    afirmar(ficha === undefined || ficha <= inv.MAX_POR_SKU, "quedó más de una reserva viva");
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

    const r = await avisarWebhook("descuadre-1");
    afirmar(r.status === 200, `respondió ${r.status}`);
    afirmar(r.cuerpo.revision === true, "el pedido no quedó marcado como revisión");

    /* Y el inventario NO se tocó: la única forma de comprobarlo desde fuera es
       que el SKU siga tan disponible como antes de aprobar. */
    const salud = await pedir("/health");
    afirmar(!(salud.cuerpo.inventario.agotados || []).includes("ValEnd"),
      "un descuadre agotó inventario");
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

main().catch(e => {
  console.error("\n✗ Las pruebas de blindaje se cayeron:", e);
  process.exit(1);
});
