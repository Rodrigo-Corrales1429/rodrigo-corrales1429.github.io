/**
 * ============================================================================
 *  PAGOS — Mercado Pago Checkout Pro
 * ============================================================================
 *  Tres reglas que no se negocian:
 *
 *  1. EL BACKEND ES LA FUENTE DE VERDAD DEL TOTAL. El cliente manda SKUs y
 *     cantidades; los importes se recalculan aquí contra el catálogo. Un
 *     carrito editado desde la consola del navegador no puede cambiar lo que
 *     se cobra, porque el precio que trae ni se lee.
 *
 *  2. NUNCA SE CREE LO QUE LLEGA POR EL WEBHOOK. La notificación solo dice
 *     «mira el pago N». El estado real se pide a la API de Mercado Pago con
 *     el token. Si alguien falsea una notificación de «aprobado», lo único
 *     que consigue es que preguntemos por un pago que no existe.
 *
 *  3. EL SECRETO NO VIVE EN EL CÓDIGO. MP_ACCESS_TOKEN y MP_WEBHOOK_SECRET
 *     salen del entorno. Ver PAGOS.md para darlos de alta en Render.
 *
 *  Sobre las carteras (Google Pay, Apple Pay, saldo, MSI, OXXO, SPEI): en
 *  Checkout Pro NO se activan desde aquí. Mercado Pago pinta en su checkout
 *  los medios que estén habilitados en TU cuenta y disponibles para el país
 *  y el dispositivo del comprador. Por eso este módulo no los declara uno por
 *  uno —hacerlo sería mentirle al lector—: lo que sí hace es no estorbarlos,
 *  y dejar en `MP_EXCLUIR_TIPOS` la puerta para apagar los que no quieras.
 * ============================================================================
 */

const crypto = require("crypto");

/* La API real, salvo que se apunte a otra.
   `MP_API_URL` existe para las PRUEBAS: sin ella no hay forma de ejercitar el
   webhook completo —firma, consulta del pago, cuadre del importe, inventario y
   aviso— sin cobrarle a alguien de verdad, y esa es exactamente la ruta cuyos
   fallos son más caros. En producción no se define y manda la de siempre. */
const MP_API = (process.env.MP_API_URL || "https://api.mercadopago.com").replace(/\/+$/, "");

/* Cuántas cuotas ofrecer. Los meses sin intereses son un acuerdo entre tu
   cuenta y el banco: aquí solo se declara el tope. */
const MAX_CUOTAS = parseInt(process.env.MP_MAX_CUOTAS || "12", 10);

/* Tipos de pago a excluir, separados por coma: "ticket" (efectivo/OXXO),
   "atm" (transferencia en cajero), "credit_card", "debit_card"...
   Vacío = acepta todo lo que tu cuenta tenga habilitado. */
const EXCLUIR_TIPOS = (process.env.MP_EXCLUIR_TIPOS || "")
  .split(",").map(s => s.trim()).filter(Boolean);

/* Minutos que vive el link antes de caducar. Un link eterno es un precio
   eterno: si mañana sube el catálogo, el de ayer sigue cobrando el de ayer.

   Bajó de 1 440 a 60. Antes la reserva de inventario se ataba a este número
   —`Math.max(reserva, vigencia)`—, así que un link de 24 h apartaba
   mercancía 24 h y bastaba una petición para dejar un SKU en cero. Ahora la
   reserva vive sus 15 minutos por su cuenta (ver inventario.js) y esto solo
   decide cuánto tiempo se puede pagar. Si activas pagos en efectivo o SPEI
   —que se liquidan en días— súbelo, sabiendo que un pago que llega con la
   reserva caducada se registra igual pero avisa de que hay que comprobar el
   stock antes de prometer fecha. */
const VIGENCIA_MIN = parseInt(process.env.MP_VIGENCIA_MINUTOS || "60", 10);

/**
 * Arma el cuerpo de la preferencia a partir de una cotización YA calculada
 * por el motor. No recibe precios de fuera: los toma de `cot`.
 *
 * @param {object}   o
 * @param {object}   o.cot        salida de calcularCotizacion (ok:true)
 * @param {function} o.productoPorSku
 * @param {string}   o.folio
 * @param {string}   o.sitioUrl
 * @param {string}   [o.notificacionUrl]
 * @param {object}   [o.comprador] { nombre, email, whatsapp, cp, direccion }
 * @param {object}   [o.envio]     { centavos, servicio } — el envío REAL,
 *   cotizado por código postal con el mismo motor que ve el cliente. Sin él
 *   se usa la tarifa plana de la cotización, que es una estimación y no lo
 *   que se debe cobrar.
 */
function construirPreferencia({
  cot, productoPorSku, folio, sitioUrl, notificacionUrl, comprador, envio
}) {
  const items = cot.lineas.map(l => {
    const p = productoPorSku(l.sku);
    return {
      id: l.sku,
      title: l.nombre,
      description: (p && p.descripcion_corta) || l.nombre,
      category_id: "learnings",          // material didáctico
      quantity: l.cantidad,
      currency_id: "MXN",
      /* El precio sale del catálogo, no del cliente. */
      unit_price: p.precio_centavos / 100,
      picture_url: (p && p.imagen) || undefined
    };
  });

  /* EL ENVÍO QUE SE COBRA ES EL QUE SE ENSEÑÓ.
     La cotización trae una tarifa plana de referencia; el cliente vio otra,
     calculada por su código postal. Cobrar la plana cuando la pantalla decía
     la otra es la diferencia de $15 que encontró la auditoría — pequeña en
     pesos y enorme en confianza: el importe del banco no coincidía con el
     del sitio. Si llega `envio`, manda `envio`. */
  const envioCentavos = envio && Number.isInteger(envio.centavos)
    ? envio.centavos
    : cot._raw.envio_centavos;

  if (envioCentavos > 0) {
    items.push({
      id: "ENVIO",
      title: envio?.servicio ? `Envío — ${envio.servicio}` : "Envío a domicilio",
      description: "Envío estándar a domicilio en México",
      category_id: "services",
      quantity: 1,
      currency_id: "MXN",
      unit_price: envioCentavos / 100
    });
  }

  const pref = {
    items,
    external_reference: folio,
    statement_descriptor: "VALQUIRIA",
    binary_mode: false,   // permite pagos en revisión; el webhook los resuelve
    /* Rutas REALES, no fragmentos.
       Mercado Pago pega sus parámetros (`collection_status`, `payment_id`,
       `external_reference`) al final de la URL de retorno, y con un `#` en
       medio el resultado es impredecible: unas veces quedan detrás del hash y
       otras delante, y en ninguno de los dos casos el router del sitio los
       veía. El cliente que acababa de pagar aterrizaba en el home, sin folio
       y sin confirmación.

       `/gracias/` es una página de verdad que recoge esos parámetros y los
       entrega a la aplicación. Las tres rutas van al mismo sitio a propósito:
       incluso un pago rechazado tiene que volver a un lugar que sepa decir
       qué pasó y que conserve el pedido para reintentarlo. */
    back_urls: {
      success: sitioUrl + "/gracias/",
      pending: sitioUrl + "/gracias/?estado=pendiente",
      failure: sitioUrl + "/gracias/?estado=fallo"
    },
    auto_return: "approved",
    payment_methods: {
      installments: MAX_CUOTAS,
      excluded_payment_types: EXCLUIR_TIPOS.map(id => ({ id }))
    },
    expires: true,
    expiration_date_to: new Date(Date.now() + VIGENCIA_MIN * 60_000).toISOString(),
    metadata: {
      folio,
      origen: "asesor-valquiria",
      /* Sirve para cuadrar contra el webhook sin volver a calcular nada. */
      total_centavos: cot._raw.subtotal_centavos + envioCentavos,
      envio_centavos: envioCentavos
    }
  };

  /* El webhook es lo que convierte esto en una tienda de verdad: sin él, la
     única señal de que alguien pagó es que su navegador vuelva al sitio, y
     eso se pierde si cierra la pestaña. */
  if (notificacionUrl) pref.notification_url = notificacionUrl;

  /* Los datos del comprador vienen del navegador y salen hacia un tercero, así
     que se recortan y se les quitan los caracteres de control: un salto de
     línea metido en un nombre es la puerta clásica a inyectar cabeceras o a
     ensuciar el correo que Mercado Pago genera después. */
  const limpio = (v, n) =>
    String(v).replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, n);

  if (comprador && (comprador.email || comprador.nombre)) {
    pref.payer = {};
    if (comprador.nombre) {
      /* Mercado Pago prellena su formulario con esto. Partir el nombre no es
         cosmético: con todo en `name`, el checkout pide apellido igualmente y
         el comprador vuelve a teclear lo que ya escribió. */
      const partes = limpio(comprador.nombre, 100).split(" ").filter(Boolean);
      pref.payer.name = partes[0] || "";
      if (partes.length > 1) pref.payer.surname = partes.slice(1).join(" ");
    }
    /* Un correo con forma rara no se manda: Mercado Pago rechazaría la
       preferencia entera y el cliente vería «no pude generar el link». */
    if (comprador.email) {
      const email = limpio(comprador.email, 160);
      if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) pref.payer.email = email;
    }
    /* El teléfono llega ya normalizado a 52 + diez dígitos. Mercado Pago
       quiere lada y número por separado. */
    const tel = String(comprador.whatsapp || comprador.telefono || "").replace(/\D/g, "");
    const local = tel.length === 12 && tel.startsWith("52") ? tel.slice(2) : tel;
    if (local.length === 10) {
      pref.payer.phone = { area_code: local.slice(0, 3), number: local.slice(3) };
    }
    /* La dirección viaja para que el comprobante y el correo de Mercado Pago
       digan adónde va la caja. La guía la seguimos imprimiendo nosotros: esto
       es contexto, no logística. */
    const cp = String(comprador.cp || "").replace(/\D/g, "");
    const calle = limpio(comprador.direccion || "", 180);
    if (/^\d{5}$/.test(cp) || calle) {
      pref.payer.address = {};
      if (/^\d{5}$/.test(cp)) pref.payer.address.zip_code = cp;
      if (calle) pref.payer.address.street_name = calle;
    }
  }

  return pref;
}

/**
 * Crea la preferencia contra la API de Mercado Pago.
 *
 * La clave de idempotencia evita el peor accidente de un checkout: un doble
 * clic —o un reintento de la red— que genera dos preferencias y acaba en dos
 * cobros. Con la misma clave, Mercado Pago devuelve la preferencia original.
 */
async function crearPreferencia(preferencia, token, conTimeout) {
  const r = await conTimeout(
    fetch(`${MP_API}/checkout/preferences`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        "X-Idempotency-Key": preferencia.external_reference
      },
      body: JSON.stringify(preferencia)
    }),
    15000,
    "Mercado Pago no respondió a tiempo."
  );

  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.init_point) {
    const detalle = (data && (data.message || data.error)) || `HTTP ${r.status}`;
    const e = new Error(`Mercado Pago no devolvió un link de pago: ${detalle}`);
    e.mpStatus = r.status;
    e.mpBody = data;
    throw e;
  }
  return data;
}

/**
 * Valida la firma de una notificación de Mercado Pago.
 *
 * Cabecera:  x-signature: ts=1704908010,v1=<hmac-sha256>
 * Manifiesto: id:<data.id>;request-id:<x-request-id>;ts:<ts>;
 *
 * Sin `MP_WEBHOOK_SECRET` definido devuelve `omitida`: el webhook sigue
 * funcionando —y sigue verificando el pago contra la API, que es la defensa
 * de verdad— pero conviene configurarlo. Ver PAGOS.md.
 */
function validarFirmaWebhook({ xSignature, xRequestId, dataId, secreto }) {
  if (!secreto) return { ok: true, estado: "omitida" };
  if (typeof xSignature !== "string" || !xSignature) {
    return { ok: false, estado: "sin-firma" };
  }

  const partes = Object.fromEntries(
    xSignature.split(",").map(p => {
      const i = p.indexOf("=");
      return i === -1 ? ["", ""] : [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    })
  );
  const ts = partes.ts;
  const v1 = partes.v1;
  if (!ts || !v1) return { ok: false, estado: "firma-malformada" };

  /* Los ids alfanuméricos viajan en minúsculas en el manifiesto. */
  const id = /^[a-zA-Z0-9]+$/.test(String(dataId || ""))
    ? String(dataId).toLowerCase()
    : String(dataId || "");

  const manifiesto = `id:${id};request-id:${xRequestId || ""};ts:${ts};`;
  const esperado = crypto.createHmac("sha256", secreto).update(manifiesto).digest("hex");

  const a = Buffer.from(esperado, "utf8");
  const b = Buffer.from(v1, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, estado: "firma-invalida" };
  }

  /* Ventana de 15 minutos contra reenvíos de una notificación vieja. */
  const edadMs = Math.abs(Date.now() - Number(ts) * (String(ts).length <= 10 ? 1000 : 1));
  if (Number.isFinite(edadMs) && edadMs > 15 * 60_000) {
    return { ok: false, estado: "firma-caducada" };
  }

  return { ok: true, estado: "valida" };
}

/** Consulta el estado REAL de un pago. Es la única fuente que se cree. */
async function consultarPago(pagoId, token, conTimeout) {
  const r = await conTimeout(
    fetch(`${MP_API}/v1/payments/${encodeURIComponent(pagoId)}`, {
      headers: { Authorization: `Bearer ${token}` }
    }),
    12000,
    "Mercado Pago no respondió al consultar el pago."
  );
  if (!r.ok) {
    const e = new Error(`No se pudo consultar el pago ${pagoId} (HTTP ${r.status}).`);
    e.mpStatus = r.status;
    throw e;
  }
  return r.json();
}

/**
 * ═══ A QUIÉN LE MANDAMOS LA CAJA ═══
 *
 * El hueco más caro que tenía la tienda: se creaba una preferencia de pago
 * SIN un solo dato de contacto. Cuando el pago se quedaba a medias —y una
 * parte siempre se queda a medias— quedaba un folio, un importe y nadie a
 * quien escribirle. El pedido existía, el dinero no llegaba, y el cliente se
 * perdía sin que nadie pudiera rescatarlo.
 *
 * Estos cinco campos son el mínimo para poder ENVIAR y para poder RESCATAR.
 * Se validan en el SERVIDOR porque el navegador es una sugerencia: quien
 * llame a /api/pago con curl tiene que pasar por lo mismo. El front hace la
 * misma comprobación antes de pedir el link, pero por cortesía, no por
 * seguridad.
 *
 * La respuesta 400 no es un portazo: dice EXACTAMENTE qué falta, en `faltan`,
 * para que el Asesor lo pregunte en vez de enseñar un error rojo.
 */
const ROTULO_CAMPO = {
  nombre: "tu nombre completo",
  whatsapp: "tu WhatsApp a 10 dígitos",
  email: "tu correo",
  cp: "tu código postal",
  direccion: "tu calle con número, colonia y ciudad"
};

/** Limpia un valor de texto que viene del navegador y va a salir hacia un
 *  tercero (Mercado Pago) y hacia un aviso (Telegram). Los caracteres de
 *  control se van: un salto de línea metido en un nombre es la puerta clásica
 *  a ensuciar el mensaje que se genera después. */
function limpiarTexto(v, tope) {
  return String(v == null ? "" : v)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, tope);
}

function sanearComprador(bruto) {
  const c = (bruto && typeof bruto === "object") ? bruto : {};
  const datos = {};
  const faltan = [];

  const nombre = limpiarTexto(c.nombre, 80);
  if (nombre.length >= 3 && /[a-zá-úñ]/i.test(nombre)) datos.nombre = nombre;
  else faltan.push("nombre");

  /* México: diez dígitos. Se aceptan con 52, con el 1 viejo de WhatsApp o a
     secas, y se guardan siempre como 52 + diez, que es como hay que marcar
     desde fuera del país. */
  let tel = limpiarTexto(c.whatsapp || c.telefono, 24).replace(/\D/g, "");
  if (tel.length === 13 && tel.startsWith("521")) tel = tel.slice(3);
  else if (tel.length === 12 && tel.startsWith("52")) tel = tel.slice(2);
  else if (tel.length === 11 && tel.startsWith("1")) tel = tel.slice(1);
  if (tel.length === 10) datos.whatsapp = "52" + tel;
  else faltan.push("whatsapp");

  const email = limpiarTexto(c.email, 160).toLowerCase();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) datos.email = email;
  else faltan.push("email");

  const cp = limpiarTexto(c.cp, 10).replace(/\D/g, "");
  if (/^\d{5}$/.test(cp)) datos.cp = cp;
  else faltan.push("cp");

  /* Un número exterior no es un capricho: sin él la guía no se imprime y el
     paquete vuelve al taller con el flete pagado dos veces. */
  const direccion = limpiarTexto(c.direccion, 180);
  if (direccion.length >= 10 && /\d/.test(direccion)) datos.direccion = direccion;
  else faltan.push("direccion");

  datos.referencias = limpiarTexto(c.referencias, 140);

  return {
    ok: faltan.length === 0,
    datos,
    faltan,
    texto: faltan.map(f => ROTULO_CAMPO[f] || f).join(", ")
  };
}

/** Una línea con todo lo que hace falta para atender el pedido a mano. */
function contactoEnUnaLinea(d) {
  if (!d) return null;
  return [
    d.nombre,
    d.whatsapp ? `wa.me/${d.whatsapp}` : "",
    d.email,
    d.direccion ? `${d.direccion} (CP ${d.cp})` : (d.cp ? `CP ${d.cp}` : ""),
    d.referencias ? `Ref: ${d.referencias}` : ""
  ].filter(Boolean).join(" · ") || null;
}

module.exports = {
  construirPreferencia,
  sanearComprador,
  contactoEnUnaLinea,
  limpiarTexto,
  crearPreferencia,
  validarFirmaWebhook,
  consultarPago,
  MP_API
};
