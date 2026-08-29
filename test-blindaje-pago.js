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

  await prueba("y no se esquiva abriendo un pedido tras otro", async () => {
    /* El primero ya se creó en B-04, así que con dos más se llega al tope. */
    const abrir = () => pedir("/api/pago", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: [{ sku: "ValPulpo", cantidad: 1 }], comprador: COMPRADOR })
    });
    await abrir();
    await abrir();
    const cuarto = await abrir();
    afirmar(cuarto.status === 400, `el cuarto pedido pasó (${cuarto.status})`);
    afirmar(cuarto.cuerpo.motivo === "tope-reservas", `motivo inesperado: ${cuarto.cuerpo.motivo}`);
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

  const { decidirVeredicto, pistaDeLaUrl, folioDeLaUrl } =
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

  await prueba("de la URL solo se lee la pista mala, nunca la buena", () => {
    afirmar(pistaDeLaUrl(new URLSearchParams("collection_status=approved")) === null,
      "un approved de la URL se está leyendo");
    afirmar(pistaDeLaUrl(new URLSearchParams("estado=aprobado")) === null,
      "un estado=aprobado de la URL se está leyendo");
    afirmar(pistaDeLaUrl(new URLSearchParams("collection_status=rejected")) === "fallo",
      "un rechazo de la URL debería ahorrarse el sondeo");
    afirmar(pistaDeLaUrl(new URLSearchParams("estado=fallo")) === "fallo",
      "la back_url de fallo debería reconocerse");
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
