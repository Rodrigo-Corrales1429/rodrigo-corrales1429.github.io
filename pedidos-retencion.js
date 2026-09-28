/**
 * ============================================================================
 *  RETENCIÓN DE PEDIDOS EN MEMORIA — qué se puede olvidar y qué no
 * ============================================================================
 *  Los pedidos del runtime actual viven en un Map con tope (MAX_PEDIDOS). El
 *  tope se hacía cumplir expulsando el MÁS VIEJO, fuera cual fuera su estado:
 *  con 300 pedidos posteriores, uno pendiente de pago salía del mapa, y
 *  cuando llegaba su aprobación firmada el servidor ya no tenía artículos,
 *  domicilio ni importe esperado.
 *
 *  La regla ahora: un pedido solo se olvida cuando ya no puede llegarle un
 *  pago que haya que surtir, y si no hay lugar así, el pedido NUEVO no se
 *  crea (el comprador conserva su carrito y se le ofrece WhatsApp). Nunca se
 *  expulsa un pedido vivo para hacerle sitio a otro.
 *
 *  Se puede olvidar un pedido cuando TODO esto se cumple:
 *    · no tiene un pago en curso (pending, in_process, authorized,
 *      in_mediation): ese pago todavía puede aprobarse;
 *    · su link de pago ya venció (`vence`, o `creado` + la vigencia);
 *    · pasó la gracia desde lo último que se supo de él: 24 h si nunca llegó
 *      ningún aviso de pago («pendiente»), 7 días si llegó alguno (un pago
 *      aprobado sigue siendo la referencia contra reintentos y cobros dobles).
 *  Sin fechas legibles no se olvida: ante la duda, se conserva.
 *
 *  Si aun así llegara un pago de un pedido olvidado, el webhook no lo surte:
 *  lo manda a revisión con su id, folio e importe (ver server.js).
 *
 *  Esto es un endurecimiento TEMPORAL del runtime en memoria; la solución de
 *  fondo es PostgreSQL con payment_events (Fase 2E).
 * ============================================================================
 */

"use strict";

const PAGO_EN_CURSO = new Set(["pending", "in_process", "authorized", "in_mediation"]);
const GRACIA_SIN_PAGO_MS = 24 * 3600_000;
const GRACIA_CON_PAGO_MS = 7 * 24 * 3600_000;

const ms = iso => {
  const t = typeof iso === "string" ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : NaN;
};

/** ¿Se puede olvidar este pedido sin perder un pago que haya que surtir? */
function esOlvidable(pedido, ahora, vigenciaMs) {
  if (!pedido || typeof pedido !== "object") return true;   // no lleva nada
  if (PAGO_EN_CURSO.has(pedido.estado)) return false;
  const creado = ms(pedido.creado);
  const vence = Number.isFinite(ms(pedido.vence)) ? ms(pedido.vence) : creado + vigenciaMs;
  /* Un link nuestro cuyo vencimiento no se puede calcular no se olvida. */
  if (Number.isFinite(creado) && !Number.isFinite(vence)) return false;
  /* Lo último que se supo: el vencimiento del link o el último aviso. Un
     registro que abrió el webhook (pedido desconocido) solo tiene lo segundo. */
  const marcas = [vence, ms(pedido.actualizado), ms(pedido.pagado)].filter(Number.isFinite);
  if (!marcas.length) return false;
  const gracia = pedido.estado === "pendiente" ? GRACIA_SIN_PAGO_MS : GRACIA_CON_PAGO_MS;
  return ahora > Math.max(...marcas) + gracia;
}

/**
 * Deja lugar para `nuevos` pedidos sin pasar de `max`, olvidando SOLO los
 * olvidables. Devuelve { ok, olvidados }: con ok:false no hay lugar seguro y
 * el pedido nuevo no debe crearse.
 */
function hacerLugar(pedidos, { max, nuevos = 1, ahora = Date.now(), vigenciaMs }) {
  let olvidados = 0;
  if (pedidos.size + nuevos > max) {
    for (const [folio, p] of pedidos) {
      if (esOlvidable(p, ahora, vigenciaMs)) { pedidos.delete(folio); olvidados++; }
    }
  }
  return { ok: pedidos.size + nuevos <= max, olvidados };
}

module.exports = { esOlvidable, hacerLugar, PAGO_EN_CURSO, GRACIA_SIN_PAGO_MS, GRACIA_CON_PAGO_MS };
