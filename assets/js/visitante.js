/* ═══════════════════════════════════════════════════════════════════════════
   VISITANTE — de quién es una reserva
   ───────────────────────────────────────────────────────────────────────────
   El servidor aparta mercancía «una reserva viva por visitante». El visitante
   es un UUID v4 aleatorio (122 bits) que genera el navegador y guarda
   mientras dura la pestaña: no lleva datos personales, no depende de la red
   y no sirve para nada más. Los límites anti-abuso siguen contando por IP.

   Vive aparte de app.js, sin DOM, para que `npm test` EJECUTE estas reglas.
   Y es el contrato: `identidad.js` declara en el servidor la MISMA expresión
   y test-seguridad.js falla si dejan de coincidir. Con una versión más laxa
   aquí, el navegador conservaba un valor que el servidor rechazaba, y cada
   pedido estrenaba dueño: se perdía el reemplazo de la propia reserva.
   ═══════════════════════════════════════════════════════════════════════════ */

export const VISITANTE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const esVisitante = v => typeof v === 'string' && VISITANTE_UUID.test(v);

/* `randomUUID` solo existe en contextos seguros y navegadores recientes; el
   respaldo arma el mismo UUID v4 con `getRandomValues`. */
export function nuevoVisitante(cripto = globalThis.crypto) {
  if (typeof cripto.randomUUID === 'function') return cripto.randomUUID();
  const b = cripto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;   // versión 4
  b[8] = (b[8] & 0x3f) | 0x80;   // variante RFC 4122
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/* `almacen` es { leer(), escribir(valor) }: lo que no cumple el contrato se
   descarta y se estrena uno nuevo, nunca se reenvía. */
export function visitanteDeSesion(almacen, cripto = globalThis.crypto) {
  const guardado = almacen.leer();
  if (esVisitante(guardado)) return guardado;
  const nuevo = nuevoVisitante(cripto);
  almacen.escribir(nuevo);
  return nuevo;
}
