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
const MINUTOS_RESERVA_PEDIDO =
  parseInt(process.env.INVENTARIO_MINUTOS_RESERVA || "15", 10) || 15;

/* El tope está TOPADO. Un despliegue no es un `git pull`: la variable vieja
   sigue viva en el panel de Render mucho después de que el código cambie, y
   un `INVENTARIO_MINUTOS_RESERVA=1440` heredado devolvería el agujero entero
   sin que nadie tocara una línea. Sesenta minutos es el techo duro; si algún
   día hace falta más, se sube aquí a la vista de todos. */
const TECHO_MINUTOS_RESERVA = 60;
const MINUTOS_RESERVA = Math.min(
  TECHO_MINUTOS_RESERVA,
  Math.max(1, MINUTOS_RESERVA_PEDIDO)
);
if (MINUTOS_RESERVA_PEDIDO > TECHO_MINUTOS_RESERVA) {
  console.warn(
    `[inventario] INVENTARIO_MINUTOS_RESERVA=${MINUTOS_RESERVA_PEDIDO} está por ` +
    `encima del techo; se usa ${MINUTOS_RESERVA}. Una reserva larga deja el ` +
    `catálogo agotable con links de pago que nadie completa.`
  );
}

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

/* UNA reserva viva por visitante. Estaba en tres, y tres por identidad son
   dieciocho piezas de un mismo producto en manos de alguien que no ha pagado
   nada. O estás pagando o no estás: no hay motivo legítimo para tener dos
   links de pago abiertos a la vez. */
const MAX_RESERVAS_POR_IDENTIDAD = Math.max(
  1,
  parseInt(process.env.INVENTARIO_MAX_RESERVAS_POR_IDENTIDAD || "1", 10) || 1
);

/* ═══ EL TECHO QUE NO DEPENDE DE QUIÉN PIDA ═══
   Los topes de arriba son por visitante, y un visitante son cinco pestañas o
   cinco IPs. Con reserva de 15 min, 6 por SKU y 3 por identidad, dos
   identidades bastaban para dejar un producto de 27 piezas en cero:
   6+6+6 desde una y 6+3 desde otra. El tope por identidad es fricción, no
   defensa.

   La defensa es esta: las reservas SIN PAGAR nunca pueden retener más de una
   fracción de lo que queda por vender. Da igual cuántas IPs use quien lo
   intente — siempre queda mercancía comprable para quien sí va a pagar. Las
   ventas confirmadas no cuentan aquí: esas son reales y descuentan de verdad.

   El suelo de MAX_POR_SKU existe para que una compra normal quepa siempre,
   incluso con el catálogo casi agotado. */
const FRACCION_RESERVABLE = Math.min(
  0.8,
  Math.max(0.1, parseFloat(process.env.INVENTARIO_FRACCION_RESERVABLE || "0.5") || 0.5)
);

/* Piezas que NUNCA se apartan sin pagar, por encima de lo que diga la
   fracción. Con stock bajo la fracción sola no basta: de 2 piezas, la mitad es
   1 y la otra se puede apartar — pero de 1 pieza, la mitad es 0 y sin este
   suelo el redondeo dejaría pasar la última. Es la garantía de que quien
   entra a comprar de verdad SIEMPRE encuentra algo que comprar. */
const STOCK_SEGURIDAD = Math.max(
  1,
  parseInt(process.env.INVENTARIO_STOCK_SEGURIDAD || "1", 10) || 1
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

/** Unidades de un SKU apartadas y todavía SIN pagar. */
function apartadoSinPagar(sku) {
  purgarCaducadas();
  let n = 0;
  for (const r of RESERVAS.values()) {
    if (r.estado !== "reservada") continue;
    for (const l of r.lineas) if (l.sku === sku) n += l.cantidad;
  }
  return n;
}

/**
 * Cuánto de un SKU pueden retener a la vez TODAS las reservas sin pagar.
 *
 * EL ERROR QUE TENÍA: `Math.max(MAX_POR_SKU, fracción)`.
 * Ese suelo parecía sensato —«que una compra normal quepa siempre»— y anulaba
 * la protección entera justo cuando más falta hacía. Con 27 piezas vendidas 21,
 * quedaban 6, la fracción daba 3… y el `max` lo subía a 6: una sola reserva sin
 * pagar volvía a dejar disponible en CERO. El agujero no estaba en el número,
 * estaba en mezclar dos límites que no son lo mismo.
 *
 * Son independientes, y ninguno puede levantar al otro:
 *   · MAX_POR_SKU es un límite POR PEDIDO — cuánto se lleva alguien de una vez.
 *   · Esto es un límite POR PRODUCTO — cuánto puede estar apartado sin pagar.
 *
 * Y encima del fraccional, una reserva de seguridad: `STOCK_SEGURIDAD` piezas
 * que no se apartan nunca de forma anónima. Es lo que hace que el invariante
 * sea cierto para CUALQUIER nivel de stock y no solo para el catálogo lleno.
 *
 *   quedan 27 → apartable 13 → siempre comprables 14
 *   quedan 10 → apartable  5 → siempre comprables  5
 *   quedan  6 → apartable  3 → siempre comprables  3
 *   quedan  2 → apartable  1 → siempre comprables  1
 *   quedan  1 → apartable  0 → la última pieza no se aparta sola
 *
 * La última línea es una decisión, no un descuido: no se puede sostener a la
 * vez «un bot nunca aparta la última pieza» y «cualquier anónimo puede apartar
 * la última pieza». Se elige proteger la pieza; quien la quiera de verdad la
 * cierra por WhatsApp, y ahí hay una persona mirando.
 */
function techoReservable(sku) {
  const p = getProductoPorSku(sku);
  if (!p) return 0;
  const porVender = Math.max(0, (p.stock || 0) - (VENDIDO.get(sku) || 0));
  const fraccional = Math.floor(porVender * FRACCION_RESERVABLE);
  const conSeguridad = Math.max(0, porVender - STOCK_SEGURIDAD);
  return Math.min(fraccional, conSeguridad);
}

/** Lo que todavía se puede apartar sin pagar de un SKU. Nunca negativo. */
function cupoReservable(sku) {
  return Math.max(0, techoReservable(sku) - apartadoSinPagar(sku));
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
  /* Una reserva viva por visitante, y se consigue REEMPLAZANDO, no negando.
     Negar la segunda castiga al caso común —quien deja un pago a medias y a
     los dos minutos vuelve a intentarlo— con trece minutos de espera y una
     llamada a soporte. Reemplazar deja el mismo invariante («una viva por
     identidad») y libera de inmediato la mercancía del intento anterior, que
     es justo lo que se quería.

     Si el cliente acaba pagando el link viejo, no se pierde nada: `confirmar`
     registra la venta desde las líneas del pedido y avisa de que la reserva
     había caducado. */
  const sobrantes = [];
  for (const [f, r] of RESERVAS) {
    if (r.estado === "reservada" && identidad && r.identidad === identidad) sobrantes.push(f);
  }
  /* Se deja hueco para la nueva: si el tope algún día sube de 1, se sueltan
     las más viejas primero. */
  sobrantes
    .slice(0, Math.max(0, sobrantes.length - (MAX_RESERVAS_POR_IDENTIDAD - 1)))
    .forEach(f => RESERVAS.delete(f));

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

  /* El cupo va DESPUÉS del stock, y el orden importa para decir la verdad:
     «se agotó» y «queda, pero no se aparta sin pagar» son dos cosas distintas
     y el cliente merece saber cuál de las dos le está pasando. */
  for (const l of lineas) {
    const cupo = cupoReservable(l.sku);
    if (l.cantidad > cupo) {
      const p = getProductoPorSku(l.sku);
      const nombre = p?.nombre || l.sku;
      return {
        ok: false,
        motivo: "stock-protegido",
        sku: l.sku,
        disponible: disponible(l.sku),
        apartado: apartadoSinPagar(l.sku),
        techo: techoReservable(l.sku),
        maximo_comprable_en_linea: cupo,
        error: cupo > 0
          ? `De ${nombre} puedo apartarte ${cupo} ` +
            `${cupo === 1 ? "pieza" : "piezas"} ahora mismo. Si necesitas más, ` +
            `escríbenos por WhatsApp al +52 771 795 9131 y te las apartamos a mano.`
          : `Nos quedan muy pocas piezas de ${nombre} y las últimas no se ` +
            `apartan solas: así nos aseguramos de que no se pierdan en un ` +
            `carrito que nadie termina. Escríbenos por WhatsApp al ` +
            `+52 771 795 9131 y te la guardamos en el momento.`
      };
    }
  }

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
  apartadoSinPagar, techoReservable, cupoReservable,
  MINUTOS_RESERVA, TECHO_MINUTOS_RESERVA, MAX_POR_SKU, MAX_UNIDADES,
  MAX_RESERVAS_POR_IDENTIDAD, FRACCION_RESERVABLE, STOCK_SEGURIDAD,
  _reiniciar
};
