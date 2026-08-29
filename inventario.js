/**
 * ============================================================================
 *  VALQUIRIA — RESERVA DE INVENTARIO  (inventario.js v1)
 * ============================================================================
 *  EL AGUJERO QUE CIERRA:
 *
 *  `quote-engine.js` ya validaba el stock —si pides 30 y hay 27, te lo dice—
 *  pero nadie lo DESCONTABA nunca. Dos personas podían comprar la misma última
 *  pieza con dos minutos de diferencia y las dos veían "pago aprobado". El
 *  segundo se entera cuando no le llega nada.
 *
 *  CÓMO FUNCIONA
 *  Al generar un link de pago se RESERVA la mercancía a nombre de ese folio.
 *  Desde ese momento no está disponible para nadie más. Después:
 *
 *    · pago aprobado  → confirmar(folio): la reserva se vuelve venta.
 *    · pago rechazado → liberar(folio):   vuelve al mostrador de inmediato.
 *    · nadie paga     → caduca sola a los MINUTOS_RESERVA y vuelve.
 *
 *  Esa caducidad es lo que impide que un bot agote el catálogo abriendo links
 *  de pago que nunca completa.
 *
 *  LÍMITE HONESTO, dicho aquí y no en un rincón:
 *  Las reservas viven en la memoria del proceso, igual que los pedidos. Si
 *  Render reinicia, se pierden. La dirección del fallo es la SEGURA —se
 *  liberan reservas, no se inventa stock— pero las ventas ya confirmadas
 *  también se olvidan, así que `productos.json` sigue siendo la única cifra
 *  duradera de existencias y hay que actualizarla a mano cuando se surte.
 *  La forma de quitar este asterisco es una base de datos; hasta entonces,
 *  esto evita el sobreventa dentro de una misma sesión del servidor, que es
 *  donde ocurre el 99 % de las colisiones reales.
 * ============================================================================
 */

"use strict";

const { getProductoPorSku } = require("./catalog.js");

/* QUINCE MINUTOS, no veinticuatro horas.
   ─────────────────────────────────────────────────────────────────────────
   La reserva antes duraba lo que el link de pago —1 440 minutos por
   omisión—, y eso convertía el checkout público en una palanca: una sola
   petición pidiendo las 27 unidades de un SKU dejaba el catálogo en cero
   durante un día entero, sin pagar un peso y sin pasar por ningún límite,
   porque el tope de seis peticiones por minuto no frena a quien solo
   necesita UNA.

   Quince minutos es lo que tarda una compra con tarjeta de principio a fin.
   Lo que dura más que eso —SPEI, efectivo en tienda— se resuelve en
   `confirmar`: si el pago entra con la reserva ya caducada, la venta se
   registra igual y el aviso lo dice, para comprobar el stock antes de
   prometer fecha. Es preferible avisar de una colisión rara que bloquear el
   inventario de todos los días. */
const MINUTOS_RESERVA = Math.max(
  1,
  parseInt(process.env.INVENTARIO_MINUTOS_RESERVA || "15", 10) || 15
);

/* Topes de una SOLA reserva. El mostrador de autoservicio no es el canal de
   mayoreo —el sitio manda a WhatsApp a quien compra por volumen—, así que
   limitarlo aquí no cierra ninguna venta real y sí cierra el desabasto por
   diversión. `CANTIDAD_MAXIMA_POR_LINEA` sigue mandando como techo absoluto:
   lo que no puede cotizarse tampoco puede apartarse. */
const TECHO_LINEA = parseInt(process.env.CANTIDAD_MAXIMA_POR_LINEA || "200", 10) || 200;
const MAX_POR_SKU = Math.min(
  TECHO_LINEA,
  parseInt(process.env.INVENTARIO_MAX_POR_SKU || "6", 10) || 6
);
const MAX_UNIDADES = Math.max(
  MAX_POR_SKU,
  parseInt(process.env.INVENTARIO_MAX_UNIDADES || "12", 10) || 12
);

/* Reservas vivas que puede tener a la vez un mismo visitante. Sin esto, el
   tope por reserva se esquiva abriendo cinco. */
const MAX_RESERVAS_POR_IDENTIDAD = Math.max(
  1,
  parseInt(process.env.INVENTARIO_MAX_RESERVAS_POR_IDENTIDAD || "3", 10) || 3
);

/* folio → { lineas:[{sku,cantidad}], creada:ms, estado:'reservada'|'vendida',
             identidad:string|null } */
const RESERVAS = new Map();
const MAX_RESERVAS = 500;

/** Unidades vendidas confirmadas en la vida de este proceso, por SKU. */
const VENDIDO = new Map();

function purgarCaducadas(ahora = Date.now()) {
  const corte = ahora - MINUTOS_RESERVA * 60_000;
  for (const [folio, r] of RESERVAS) {
    if (r.estado === "reservada" && r.creada < corte) RESERVAS.delete(folio);
  }
}

/** Unidades comprometidas ahora mismo para un SKU (reservadas + vendidas). */
function comprometido(sku) {
  purgarCaducadas();
  let n = VENDIDO.get(sku) || 0;
  for (const r of RESERVAS.values()) {
    if (r.estado !== "reservada") continue;
    for (const l of r.lineas) if (l.sku === sku) n += l.cantidad;
  }
  return n;
}

/** Lo que de verdad se puede vender de un SKU. Nunca negativo. */
function disponible(sku) {
  const p = getProductoPorSku(sku);
  if (!p) return 0;
  return Math.max(0, (p.stock || 0) - comprometido(sku));
}

/** Reservas vivas —ni vendidas ni caducadas— de un mismo visitante. */
function reservasVivasDe(identidad) {
  if (!identidad) return 0;
  purgarCaducadas();
  let n = 0;
  for (const r of RESERVAS.values()) {
    if (r.estado === "reservada" && r.identidad === identidad) n++;
  }
  return n;
}

/**
 * Aparta mercancía para un folio.
 *
 * Es ATÓMICO: comprueba TODAS las líneas antes de apuntar ninguna. Reservar a
 * medias dejaría al cliente con un pedido que no se puede surtir y con parte
 * del inventario bloqueado sin motivo.
 *
 * Tres puertas, en este orden: cuánto pide de un SKU, cuánto pide en total, y
 * cuántas reservas tiene abiertas ya. Las tres se comprueban ANTES de mirar
 * el stock, porque son sobre la petición y no sobre el almacén: da igual que
 * haya 27 unidades, nadie se lleva 27 por el mostrador de autoservicio.
 *
 * @param {string} folio
 * @param {Array<{sku:string,cantidad:number}>} lineas
 * @param {{identidad?:string}} [opciones]
 * @returns {{ok:true}|{ok:false,motivo:string,error:string,faltantes?:Array}}
 */
function reservar(folio, lineas, opciones = {}) {
  purgarCaducadas();
  if (RESERVAS.has(folio)) return { ok: true, ya_estaba: true };

  const identidad = opciones.identidad ? String(opciones.identidad) : null;

  let unidades = 0;
  for (const l of lineas) {
    unidades += l.cantidad;
    if (l.cantidad > MAX_POR_SKU) {
      const p = getProductoPorSku(l.sku);
      return {
        ok: false,
        motivo: "tope-por-sku",
        error:
          `El máximo por compra en línea es ${MAX_POR_SKU} piezas de ` +
          `${p?.nombre || l.sku}. Para pedidos mayores te atendemos por ` +
          `WhatsApp al +52 771 795 9131 con precio de volumen.`
      };
    }
  }
  if (unidades > MAX_UNIDADES) {
    return {
      ok: false,
      motivo: "tope-unidades",
      error:
        `El máximo por compra en línea es ${MAX_UNIDADES} piezas en total. ` +
        `Para pedidos mayores te atendemos por WhatsApp al +52 771 795 9131 ` +
        `con precio de volumen.`
    };
  }
  if (reservasVivasDe(identidad) >= MAX_RESERVAS_POR_IDENTIDAD) {
    return {
      ok: false,
      motivo: "tope-reservas",
      error:
        `Tienes ${MAX_RESERVAS_POR_IDENTIDAD} pedidos con link de pago sin ` +
        `terminar. Págalos o espera ${MINUTOS_RESERVA} minutos a que se ` +
        `liberen, y vuelve a intentar.`
    };
  }

  const faltantes = [];
  for (const l of lineas) {
    const libre = disponible(l.sku);
    if (l.cantidad > libre) {
      const p = getProductoPorSku(l.sku);
      faltantes.push({
        sku: l.sku,
        nombre: p?.nombre || l.sku,
        pedido: l.cantidad,
        disponible: libre
      });
    }
  }
  if (faltantes.length) return { ok: false, motivo: "stock", faltantes };

  RESERVAS.set(folio, {
    lineas: lineas.map(l => ({ sku: l.sku, cantidad: l.cantidad })),
    creada: Date.now(),
    estado: "reservada",
    identidad
  });
  if (RESERVAS.size > MAX_RESERVAS) {
    RESERVAS.delete(RESERVAS.keys().next().value);
  }
  return { ok: true };
}

/**
 * El pago entró: la reserva pasa a venta y ya no caduca.
 *
 * `lineasRespaldo` es lo que salva a los pagos lentos. Con la reserva en 15
 * minutos, un SPEI o un pago en OXXO llega cuando ya caducó, y sin respaldo
 * la venta no descontaría nada: el stock quedaría inflado y se volvería a
 * vender lo mismo. Con él, la venta se registra igual y se devuelve
 * `caducada:true` para que el aviso lo diga — puede que en ese rato otro se
 * haya llevado la última pieza, y eso hay que mirarlo con los ojos, no
 * suponerlo.
 *
 * @returns {{ok:boolean, caducada:boolean, repetida:boolean}}
 */
function confirmar(folio, lineasRespaldo) {
  const r = RESERVAS.get(folio);

  if (r && r.estado === "vendida") return { ok: true, caducada: false, repetida: true };

  const lineas = r
    ? r.lineas
    : (Array.isArray(lineasRespaldo) ? lineasRespaldo : [])
        .map(l => ({ sku: l.sku, cantidad: parseInt(l.cantidad, 10) || 0 }))
        .filter(l => l.sku && l.cantidad > 0);

  if (!lineas.length) return { ok: false, caducada: !r, repetida: false };

  RESERVAS.set(folio, {
    lineas, creada: r ? r.creada : Date.now(),
    estado: "vendida", identidad: r ? r.identidad : null
  });
  for (const l of lineas) {
    VENDIDO.set(l.sku, (VENDIDO.get(l.sku) || 0) + l.cantidad);
  }
  return { ok: true, caducada: !r, repetida: false };
}

/** El pago no entró: la mercancía vuelve al mostrador ya. */
function liberar(folio) {
  const r = RESERVAS.get(folio);
  if (!r || r.estado === "vendida") return false;
  RESERVAS.delete(folio);
  return true;
}

/** Foto del inventario para el panel. */
function estadoInventario() {
  purgarCaducadas();
  const { getCatalogoActivo } = require("./catalog.js");
  return getCatalogoActivo().map(p => ({
    sku: p.sku,
    nombre: p.nombre,
    stock_declarado: p.stock,
    vendido_en_esta_sesion: VENDIDO.get(p.sku) || 0,
    apartado_ahora: comprometido(p.sku) - (VENDIDO.get(p.sku) || 0),
    disponible: disponible(p.sku),
    agotado: disponible(p.sku) === 0
  }));
}

/** Solo para pruebas: deja el módulo como recién arrancado. */
function _reiniciar() {
  RESERVAS.clear();
  VENDIDO.clear();
}

module.exports = {
  reservar, confirmar, liberar,
  disponible, comprometido, estadoInventario, reservasVivasDe,
  MINUTOS_RESERVA, MAX_POR_SKU, MAX_UNIDADES, MAX_RESERVAS_POR_IDENTIDAD,
  _reiniciar
};
