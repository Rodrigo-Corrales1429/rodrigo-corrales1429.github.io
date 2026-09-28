/* ═══════════════════════════════════════════════════════════════════════════
   PII COMERCIAL — identificadores evidentes que el modelo no necesita
   ───────────────────────────────────────────────────────────────────────────
   Para responder sobre productos, envíos o precios, el Asesor no necesita un
   correo, un teléfono ni una tarjeta. Si alguien los escribe en el chat, se
   sustituyen por una marca ANTES de que el texto salga hacia el proveedor de
   IA, y la marca no repite el dato (ni los últimos dígitos).

   TARJETAS. Un número se escribe como se copia: con espacios normales, con
   el espacio duro (U+00A0) que pegan las apps bancarias, con los espacios
   Unicode de ancho fijo o cero, tabuladores, guiones y rayas, puntos,
   paréntesis, y hasta con cada grupo en su renglón. Todo eso une grupos; la
   barra y la coma no (fechas e importes). Es tarjeta la ventana de grupos
   consecutivos —cada uno de 3 o más dígitos, o uno solo pegado— que suma de
   13 a 19 dígitos, empieza como empieza una marca real (Visa 4; Mastercard
   51–55 y 2221–2720; Amex 34/37; Diners, JCB, Discover, UnionPay, Maestro y
   Carnet) con la longitud de esa marca, y pasa Luhn. Las tres condiciones
   juntas son las que evitan convertir en tarjeta cantidades, fechas, folios
   o teléfonos: los números de marca que pasan Luhn son raros por azar. Un
   grupo de 3–4 dígitos pegado detrás de la tarjeta, al final del tramo, es
   su código y se va con ella.

   CÓDIGO DE SEGURIDAD. Cuando se nombra (CVV, CVC, CID, código de seguridad)
   y va detrás, en el mismo renglón o en el siguiente.

   TELÉFONOS Y CORREOS (solo hacia el modelo, ver `minimizar`). Un tramo de
   10 o más dígitos en un renglón; si nada lo reconoció como tarjeta, se
   omite igual.

   LÍMITES, dichos claro: nombres propios y domicilios escritos a mano NO se
   detectan —un detector así destrozaría mensajes normales—; tampoco dígitos
   que no sean ASCII (de ancho completo, arábigos), una tarjeta partida por
   barras o comas, ni un código de 3–4 dígitos suelto sin su palabra y lejos
   de la tarjeta. Esto no promete detección perfecta: es defensa en
   profundidad. El falso positivo conocido: diez o más dígitos seguidos sin
   palabras en medio («1000 1500 2000») forman un tramo de teléfono y se
   omiten hacia el modelo.

   Un solo archivo para los dos lados, para que las reglas no puedan
   divergir: el servidor lo carga con require() y minimiza el historial antes
   de llamar al modelo; el navegador lo importa y quita las tarjetas de lo
   que la persona escribe antes de guardarlo o enviarlo.
   ═══════════════════════════════════════════════════════════════════════════ */
(function (raiz) {
  'use strict';

  const MARCA = {
    correo: '[correo omitido]',
    telefono: '[teléfono omitido]',
    tarjeta: '[tarjeta omitida]',
    codigo: '[código omitido]'
  };

  /* Solo empieza donde empieza la parte local: sin el lookbehind, 24 000
     dígitos seguidos costaban medio segundo (cada posición recorría el resto
     buscando la arroba). */
  const CORREO = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

  /* Espacio en un renglón: el de siempre, tabulador, el duro (U+00A0), los
     de ancho fijo y cero (U+2000–U+200D), el estrecho (U+202F), el
     matemático, el unidor de palabras, el ideográfico y el BOM. */
  const ESPACIO = '\\t\\v\\f \\u00a0\\u1680\\u2000-\\u200d\\u202f\\u205f\\u2060\\u3000\\ufeff';
  /* Guion ASCII, guiones y rayas Unicode (U+2010–U+2015) y el signo menos. */
  const GUION = '\\-\\u2010-\\u2015\\u2212';
  const SEPARADOR = `[${ESPACIO}${GUION}.()]`;
  const SALTO = '(?:\\r\\n|[\\n\\r\\u2028\\u2029])';

  /* Grupos de dígitos unidos por hasta cuatro separadores, o por un salto
     de línea con sus espacios alrededor. Sin letra ni dígito justo delante:
     «VQ4111…» es un código, no una tarjeta. Separadores y dígitos no se
     solapan, así que no hay retroceso catastrófico. */
  const TRAMO_TARJETA = new RegExp(
    `(?<![\\p{L}\\d_])\\d+(?:(?:${SEPARADOR}{1,4}|${SEPARADOR}{0,4}${SALTO}${SEPARADOR}{0,4})\\d+)*`, 'gu');

  /* Teléfono: un solo renglón, con «+» y paréntesis opcionales. */
  const TRAMO_TELEFONO = new RegExp(`\\+?\\(?\\d(?:${SEPARADOR}{0,3}\\d){9,22}\\)?`, 'gu');

  const NO_DIGITO = '[^\\d\\n\\r\\u2028\\u2029]';
  const CODIGO = new RegExp(
    `(?<![\\p{L}\\d])(cvv2?|cvc2?|cid|c[oó]d(?:igo|\\.)?(?:\\s|[\\u200b-\\u200d\\u2060])+de` +
    `(?:\\s|[\\u200b-\\u200d\\u2060])+seguridad)` +
    `(${NO_DIGITO}{0,12}(?:${SALTO}${NO_DIGITO}{0,12})?)\\d{3,4}(?!\\d)`, 'giu');

  function pasaLuhn(digitos) {
    let suma = 0;
    for (let i = 0; i < digitos.length; i++) {
      let d = digitos.charCodeAt(digitos.length - 1 - i) - 48;
      if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
      suma += d;
    }
    return suma % 10 === 0;
  }

  /* Prefijo y longitud de una marca real, más Luhn. */
  function pareceTarjeta(d) {
    const n = d.length;
    if (!/^\d{13,19}$/.test(d) || !pasaLuhn(d)) return false;
    const p2 = Number(d.slice(0, 2));
    const p4 = Number(d.slice(0, 4));
    if (d[0] === '4') return n === 13 || n === 16 || n === 19;                 // Visa
    if ((p2 >= 51 && p2 <= 55) || (p4 >= 2221 && p4 <= 2720)) return n === 16; // Mastercard
    if (p2 === 34 || p2 === 37) return n === 15;                               // Amex
    if (p2 === 36 || p2 === 38 || p2 === 39 || (p4 >= 3000 && p4 <= 3059)) return n >= 14; // Diners
    if (p4 >= 3528 && p4 <= 3589) return n >= 16;                              // JCB
    if (p2 === 50 || (p2 >= 56 && p2 <= 58)) return true;                      // Maestro, Carnet
    if (d[0] === '6') return n >= 16;                                          // Discover, UnionPay, Maestro
    return false;
  }

  /* Dentro de un tramo, la primera ventana de grupos que es tarjeta —la más
     larga desde ese grupo—, o null. Con «+» delante y hasta 15 dígitos es un
     teléfono internacional. */
  function ventanaDeTarjeta(grupos, conMas) {
    for (let i = 0; i < grupos.length; i++) {
      if (grupos[i].d.length < 3) continue;
      let digitos = '';
      let fin = -1;
      for (let j = i; j < grupos.length && grupos[j].d.length >= 3; j++) {
        digitos += grupos[j].d;
        if (digitos.length > 19) break;
        if (pareceTarjeta(digitos) && !(conMas && i === 0 && digitos.length <= 15)) fin = j;
      }
      if (fin < 0) continue;
      const cola = grupos[fin + 1];
      if (cola && fin + 2 === grupos.length && cola.d.length >= 3 && cola.d.length <= 4) fin++;
      return { i, fin };
    }
    return null;
  }

  function tacharTarjetas(tramo, conMas) {
    const grupos = [...tramo.matchAll(/\d+/g)].map(m => ({ d: m[0], ini: m.index, fin: m.index + m[0].length }));
    const v = ventanaDeTarjeta(grupos, conMas);
    if (!v) return tramo;
    return tramo.slice(0, grupos[v.i].ini) + MARCA.tarjeta + tacharTarjetas(tramo.slice(grupos[v.fin].fin), false);
  }

  /* Solo tarjetas y códigos de seguridad. El navegador lo aplica a todo lo
     que escribe la persona antes de guardarlo o enviarlo: una tarjeta no
     sirve para nada aquí. Teléfono y correo sí viajan al servidor —que los
     quita antes del modelo— porque un registro de interés los necesita.
     La tarjeta va primero: así un «cvv» delante de la tarjeta no se lleva
     sus primeros dígitos y deja el resto a la vista. */
  function sinTarjetas(texto) {
    if (typeof texto !== 'string' || !texto) return texto;
    return texto
      .replace(TRAMO_TARJETA, (tramo, pos, todo) => tacharTarjetas(tramo, todo[pos - 1] === '+'))
      .replace(CODIGO, (_, palabra, entre) => palabra + entre + MARCA.codigo);
  }

  function minimizar(texto) {
    if (typeof texto !== 'string' || !texto) return texto;
    return sinTarjetas(texto.replace(CORREO, MARCA.correo))
      .replace(TRAMO_TELEFONO, MARCA.telefono);
  }

  /* De 10 a 13 dígitos (México con lada 52 o 521), o hasta 15 con «+»
     (E.164). Un tramo más largo no se guarda como contacto de nadie. */
  function esTelefono(tramo) {
    const n = tramo.replace(/\D/g, '').length;
    return n >= 10 && n <= (tramo.startsWith('+') ? 15 : 13);
  }

  /* El último correo y el último teléfono que la persona escribió. Los usa el
     SERVIDOR —nunca el modelo— para completar un registro de interés cuando
     el modelo solo vio la marca. Una tarjeta jamás se extrae: se quita antes
     de buscar el teléfono. */
  function contactoEscrito(textos) {
    let correo = null;
    let telefono = null;
    for (const texto of textos) {
      if (typeof texto !== 'string') continue;
      for (const m of texto.matchAll(CORREO)) correo = m[0];
      for (const m of sinTarjetas(texto.replace(CORREO, ' ')).matchAll(TRAMO_TELEFONO)) {
        if (esTelefono(m[0])) telefono = m[0].trim();
      }
    }
    return { correo, telefono };
  }

  const api = { MARCA, minimizar, sinTarjetas, contactoEscrito, pasaLuhn, pareceTarjeta };
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else raiz.VQPiiComercial = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
