/* ═══════════════════════════════════════════════════════════════════════════
   ENTREGA PRIVADA — lo que ve el comprador ≠ lo que lee el modelo
   ───────────────────────────────────────────────────────────────────────────
   Nombre, WhatsApp, correo, domicilio, referencias y código postal se piden
   para ENVIAR y para RESCATAR un pago, y viajan solo a /api/pago. El Asesor
   no los necesita para razonar, y su hilo sí sale de casa: va a /api/chat
   —y de ahí al modelo— y se guarda en sessionStorage. Por eso no entran.

   Cada mensaje del checkout tiene dos versiones: `enPantalla`, la burbuja
   que el comprador ve con sus datos, y `paraModelo`, la que queda en el hilo
   sin ninguno. `tacharEntrega` quita nombre, teléfono, correo, domicilio y
   referencias del comprador de cualquier texto antes de que entre al hilo
   del modelo (hilo-asesor.js lo aplica al escribir cada turno).

   Vive aparte de app.js, sin DOM, para que `npm test` lo EJECUTE.
   ═══════════════════════════════════════════════════════════════════════════ */

export const TURNO_DATOS_CAPTURADOS = 'Ya llené mis datos de entrega en el formulario.';
export const TACHADO = '[dato de entrega]';

/* Una versión anterior (837b3bc) guardaba nombre, WhatsApp, correo y
   domicilio en localStorage con esta llave; hoy viven en sessionStorage. El
   cambio de cajón no borraba el viejo: en una computadora compartida los
   datos del comprador anterior seguían ahí indefinidamente. Se borran al
   arrancar y NO se leen nunca —no se restauran—. */
export const LLAVES_LOCALES_OBSOLETAS = ['vq_comprador_v1'];

/* `local` es el localStorage (o un doble de pruebas). Con el almacenamiento
   bloqueado no hay nada que borrar ni por qué romper el arranque. */
export function purgarCompradorAntiguo(local) {
  for (const llave of LLAVES_LOCALES_OBSOLETAS) {
    try { local.removeItem(llave); } catch { /* sin acceso: nada que borrar */ }
  }
}

const primerNombre = nombre => String(nombre || '').trim().split(/\s+/)[0] || '';

export function mensajePedirDatos(nombre, faltaUno) {
  const cola = ' generar tu link de pago me ' + (faltaUno ? 'falta un dato' : 'faltan estos datos') +
    '. Es lo mínimo para poder mandarte la caja y para poder escribirte si ' +
    'algo se atora con el pago.';
  const pila = primerNombre(nombre);
  return { enPantalla: (pila ? pila + ', para' : 'Para') + cola, paraModelo: 'Para' + cola };
}

/* `desglose` llega en sus dos versiones: la de pantalla dice «envío a CP…»,
   la del modelo solo el importe. */
export function mensajeConfirmacion({ nombre, direccion, cp, telefono }, desglose) {
  const pila = primerNombre(nombre);
  const cierre = '\n\nSi está bien, te genero el link de pago.';
  return {
    enPantalla: (pila ? 'Listo, ' + pila + '.' : 'Listo.') + ' Va a **' +
      (direccion || 'la dirección que me diste') + '**, CP ' + (cp || '—') +
      ', y te aviso al **' + telefono + '**.\n\n' + desglose.enPantalla + cierre,
    paraModelo: 'Listo. Los datos de entrega quedaron en el formulario.\n\n' +
      desglose.paraModelo + cierre
  };
}

const escapar = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function patronesDe(datos) {
  const texto = v => String(v || '').trim();
  const patrones = [];
  /* Los valores enteros primero: el domicilio completo antes que sus piezas. */
  for (const campo of ['direccion', 'referencias', 'email', 'nombre']) {
    const v = texto(datos[campo]);
    if (v.length >= 3) patrones.push(new RegExp(escapar(v), 'giu'));
  }
  /* Cada tramo del domicilio que lleva número —calle y número—, aunque se
     escriba suelto. La ciudad o la colonia solas no: «¿envían a Pachuca?» es
     una pregunta normal. Encontrado en la prueba E2E. */
  for (const tramo of texto(datos.direccion).split(',').map(t => t.trim())) {
    if (tramo.length >= 6 && /\d/.test(tramo)) patrones.push(new RegExp(escapar(tramo), 'giu'));
  }
  /* Cada palabra del nombre, sola y como palabra completa: «Listo, Ana». */
  for (const palabra of texto(datos.nombre).split(/\s+/)) {
    if (palabra.length >= 3) {
      patrones.push(new RegExp(`(?<![\\p{L}\\p{N}])${escapar(palabra)}(?![\\p{L}\\p{N}])`, 'giu'));
    }
  }
  /* El teléfono con cualquier separador: 0001112233, 000 111 2233, 000-111-22-33.
     Se guarda con lada de país (52…) y se escribe sin ella: se buscan los diez
     dígitos nacionales. */
  const digitos = texto(datos.whatsapp).replace(/\D/g, '').slice(-10);
  if (digitos.length >= 8) patrones.push(new RegExp(digitos.split('').join('[\\s.()-]*'), 'g'));
  /* El código postal NO se tacha: quien lo escribe en el chat lo hace para
     que le coticen el envío, y la herramienta lo necesita. Lo que no pasa es
     que el checkout lo inyecte: los mensajes `paraModelo` no lo llevan. */
  return patrones;
}

/* Un texto, con los datos que haya ahora. El hilo del modelo lo aplica al
   ESCRIBIR cada turno (ver hilo-asesor.js), no al enviar. */
export function tacharEntrega(texto, datos = {}) {
  if (typeof texto !== 'string' || !texto) return texto;
  return patronesDe(datos || {}).reduce((acc, re) => acc.replace(re, TACHADO), texto);
}

export function sinDatosDeEntrega(mensajes, datos = {}) {
  return mensajes.map(m => ({
    ...m,
    parts: (m.parts || []).map(p => (typeof p.text === 'string' ? { ...p, text: tacharEntrega(p.text, datos) } : p))
  }));
}
