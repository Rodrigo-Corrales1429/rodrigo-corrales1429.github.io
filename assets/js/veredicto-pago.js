/* ═══════════════════════════════════════════════════════════════════════════
   VEREDICTO DE PAGO — qué se puede creer al volver de Mercado Pago
   ───────────────────────────────────────────────────────────────────────────
   Vive aparte de app.js por un motivo concreto: aquí no hay DOM, no hay red y
   no hay `location`. Todo entra por parámetros. Eso permite EJECUTAR estas
   reglas en `npm test` —no comprobar que existan, sino correrlas contra un
   ataque real— y fue justo lo que faltó: una auditoría abrió

       /#/gracias?collection_status=approved&external_reference=VQ-FALSO

   y el sitio dijo «Pago confirmado», enseñó el folio inventado y borró el
   carrito. No despachaba mercancía —el webhook firmado sigue siendo quien
   manda— pero le mentía al cliente y le destruía el pedido.

   LA REGLA, ENTERA:
     · De la URL solo se acepta el FOLIO, y solo si tiene la forma que genera
       este servidor. La URL no prueba nada; sirve para saber por qué preguntar.
     · El estado lo dice el servidor, que a su vez solo lo sabe por el webhook
       firmado de Mercado Pago.
     · Mientras el servidor no diga `approved`, no se afirma que hubo pago y
       NO se toca el carrito.
     · La única pista de la URL que se lee es la MALA (rechazado), porque no
       puede hacer daño: conserva el carrito y ahorra la espera del sondeo.
   ═══════════════════════════════════════════════════════════════════════════ */

/* Lo que responde /api/pedido/:folio, traducido a los cinco estados que la
   página sabe contar. `revision` es el pedido cuyo importe no cuadró: ni se
   surte ni se da por bueno. */
export const ESTADO_SERVIDOR = {
  approved: 'aprobado',
  rejected: 'fallo',
  cancelled: 'fallo',
  refunded: 'fallo',
  charged_back: 'fallo',
  revision: 'revision',
  pendiente: 'pendiente',
  pending: 'pendiente',
  in_process: 'pendiente',
  in_mediation: 'pendiente',
  authorized: 'pendiente'
};

/* El sondeo no es capricho. Mercado Pago devuelve al cliente al instante y su
   webhook llega uno o dos segundos después, así que la primera respuesta casi
   siempre es «pendiente». Sin reintentos, toda compra buena se anunciaría como
   «estamos confirmando»: honesto y desconcertante. Suman ~17 s. */
export const ESPERAS_SONDEO = [0, 1200, 2000, 3500, 5000, 6000];

/* La forma exacta que genera el servidor: VQ- + base36 del reloj + 6 hex. No
   demuestra nada —por eso se pregunta—, pero evita mandar basura al endpoint
   y evita pintar como «folio» un texto que escribió un desconocido. */
const FORMA_FOLIO = /^VQ-[A-Z0-9]{6,20}-[A-F0-9]{6}$/;

export function folioDeLaUrl(valor) {
  const v = String(valor == null ? '' : valor).trim();
  return FORMA_FOLIO.test(v) ? v : '';
}

/**
 * Lee la ÚNICA pista de la URL que se puede usar: que el pago falló.
 *
 * Un `rejected` en la barra de direcciones no puede causar daño —conserva el
 * carrito y ofrece reintentar—, así que se acepta y se ahorran quince segundos
 * de espera. Un `approved` no se lee nunca: esa es exactamente la mentira que
 * este módulo existe para impedir.
 */
export function pistaDeLaUrl(params) {
  const leer = k => String((params && params.get(k)) || '').toLowerCase();
  const propio = leer('estado');
  const mp = leer('collection_status') || leer('status') || leer('payment_status');

  if (mp === 'rejected' || mp === 'cancelled' || mp === 'failure' || propio === 'fallo') {
    return 'fallo';
  }
  return null;
}

const dormirDeVerdad = ms => new Promise(r => setTimeout(r, ms));

/**
 * Pregunta al servidor por el folio, varias veces.
 *
 * `consultar` recibe el folio y devuelve `{ status, body }`. Se inyecta para
 * que las pruebas puedan simular un backend dormido, un 404 o un webhook que
 * tarda, sin red y sin esperar diecisiete segundos de verdad.
 *
 * Un 404 es CONCLUYENTE: «este folio no existe aquí». O alguien lo inventó, o
 * el servidor se reinició y perdió la memoria. En los dos casos la respuesta
 * correcta es la misma —no se puede verificar— y el carrito se queda donde
 * está.
 */
export async function verificarPago(folio, opciones = {}) {
  if (!folio) return { estado: 'sin-verificar', motivo: 'sin-folio' };

  const consultar = opciones.consultar;
  const dormir = opciones.dormir || dormirDeVerdad;
  const esperas = opciones.esperas || ESPERAS_SONDEO;
  if (typeof consultar !== 'function') {
    return { estado: 'sin-verificar', motivo: 'sin-consulta' };
  }

  let ultimo = null;
  for (const espera of esperas) {
    if (espera) await dormir(espera);
    try {
      const r = await consultar(folio);
      if (!r) continue;
      if (r.status === 404) return { estado: 'sin-verificar', motivo: 'folio-desconocido' };
      if (r.status !== 200) continue;

      const d = r.body;
      if (!d || !d.ok) continue;

      const estado = ESTADO_SERVIDOR[d.estado] || 'pendiente';
      if (estado !== 'pendiente') return { estado, pedido: d };
      ultimo = { estado: 'pendiente', pedido: d };
    } catch {
      /* El backend duerme o la red falló: se reintenta. Un fallo de red no
         es un pago rechazado, y tratarlo como tal borraría el carrito de
         alguien que sí pagó. */
    }
  }
  return ultimo || { estado: 'sin-verificar', motivo: 'sin-respuesta' };
}

/**
 * La decisión completa de la página de gracias.
 *
 * @param {object}  o
 * @param {object}  o.params     lector de la query (URLSearchParams o similar)
 * @param {object}  [o.enCurso]  el pago que ESTA pestaña dejó anotado al saltar
 * @param {function} o.consultar consulta al backend por folio
 * @param {function} [o.dormir]  espera entre sondeos (las pruebas la acortan)
 * @param {Array}   [o.esperas]
 *
 * @returns {{hablar:boolean, estado:string, folio:string, vaciarCarrito:boolean}}
 *   `hablar:false` significa que nadie viene de pagar —alguien abrió /gracias
 *   a pelo— y la página no debe afirmar absolutamente nada.
 */
export async function decidirVeredicto(o = {}) {
  const enCurso = o.enCurso || null;
  const folio = folioDeLaUrl(o.params && o.params.get('external_reference')) ||
                (enCurso && enCurso.folio) || '';

  if (!folio && !enCurso) {
    return { hablar: false, estado: 'sin-verificar', folio: '', vaciarCarrito: false };
  }

  const pista = pistaDeLaUrl(o.params);
  const veredicto = pista === 'fallo'
    ? { estado: 'fallo' }
    : await verificarPago(folio, o);

  return {
    hablar: true,
    estado: veredicto.estado,
    folio,
    pedido: veredicto.pedido || null,
    /* La única puerta por la que se borra el pedido de alguien. Vaciarlo de
       más destruye la compra de quien no compró; dejarlo de más, como mucho,
       le sobra un carrito lleno que puede vaciar él. */
    vaciarCarrito: veredicto.estado === 'aprobado'
  };
}
