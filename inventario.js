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

/* Debe ser >= MP_VIGENCIA_MINUTOS: si el link de pago vive más que la reserva,
   alguien puede pagar mercancía que ya se le dio a otro. */
const MINUTOS_RESERVA = Math.max(
  parseInt(process.env.INVENTARIO_MINUTOS_RESERVA || "0", 10) || 0,
  parseInt(process.env.MP_VIGENCIA_MINUTOS || "1440", 10)
);

/* folio → { lineas:[{sku,cantidad}], creada:ms, estado:'reservada'|'vendida' } */
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

/**
 * Aparta mercancía para un folio.
 *
 * Es ATÓMICO: comprueba TODAS las líneas antes de apuntar ninguna. Reservar a
 * medias dejaría al cliente con un pedido que no se puede surtir y con parte
 * del inventario bloqueado sin motivo.
 *
 * @returns {{ok:true}|{ok:false,faltantes:Array}}
 */
function reservar(folio, lineas) {
  purgarCaducadas();
  if (RESERVAS.has(folio)) return { ok: true, ya_estaba: true };

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
  if (faltantes.length) return { ok: false, faltantes };

  RESERVAS.set(folio, {
    lineas: lineas.map(l => ({ sku: l.sku, cantidad: l.cantidad })),
    creada: Date.now(),
    estado: "reservada"
  });
  if (RESERVAS.size > MAX_RESERVAS) {
    RESERVAS.delete(RESERVAS.keys().next().value);
  }
  return { ok: true };
}

/** El pago entró: la reserva pasa a venta y ya no caduca. */
function confirmar(folio) {
  const r = RESERVAS.get(folio);
  if (!r || r.estado === "vendida") return false;
  r.estado = "vendida";
  for (const l of r.lineas) {
    VENDIDO.set(l.sku, (VENDIDO.get(l.sku) || 0) + l.cantidad);
  }
  return true;
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
  disponible, comprometido, estadoInventario,
  MINUTOS_RESERVA,
  _reiniciar
};
