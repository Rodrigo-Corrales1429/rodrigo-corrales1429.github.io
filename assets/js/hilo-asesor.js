/* ═══════════════════════════════════════════════════════════════════════════
   HILO DEL ASESOR — lo que se ve ≠ lo que se envía
   ───────────────────────────────────────────────────────────────────────────
   Dos historiales, separados por construcción:

     · PANTALLA — lo que el comprador ve, para repintar la conversación al
       volver de pagar. Puede llevar su domicilio en la confirmación del
       pedido: es su pestaña y su dato.
     · MODELO — lo ÚNICO que sale hacia /api/chat. Cada texto entra ya
       saneado en el momento de escribirlo (sin los datos del checkout), y
       nunca se deriva de la pantalla.

   Sanear al escribir, y no al enviar, es lo que importa: si el comprador se
   olvida después —o cambia de comprador en la misma pestaña—, en el hilo del
   modelo no queda nada crudo que un filtro posterior ya no sepa reconocer.

   Cada historial vive en su propia llave de sessionStorage y con versión
   explícita. La llave antigua `vq_asesor_v1` guardaba UN solo hilo que hacía
   de las dos cosas, y se borra en cuanto el Asesor arranca.

   Sin DOM, para que `npm test` lo ejecute.
   ═══════════════════════════════════════════════════════════════════════════ */

export const VERSION_HILO = 3;
export const LLAVE_MODELO = 'vq_asesor_modelo_v3';
export const LLAVE_PANTALLA = 'vq_asesor_pantalla_v3';
export const LLAVES_OBSOLETAS = ['vq_asesor_v1'];

const textoDe = m => ((m && m.parts) || []).map(p => (p && p.text) || '').join(' ');

/* `almacen` es { leer(llave), escribir(llave, valor), borrar(llave) }.
   `sanear(texto)` devuelve el texto apto para el modelo con los datos que
   haya EN ESE MOMENTO. */
export function crearHilo({ almacen, sanear, maxTurnos = 40, maxTexto = 24000 }) {
  let modelo = [];
  let pantalla = [];
  let saludado = false;

  const alModelo = (role, texto) => modelo.push({ role, parts: [{ text: sanear(String(texto)) }] });

  /* Por los DOS topes, de lo más reciente hacia atrás: los turnos son los que
     manda el servidor; los caracteres, los que el servidor recorta. */
  function recortado() {
    const salida = [];
    let chars = 0;
    for (let i = modelo.length - 1; i >= 0; i--) {
      const n = textoDe(modelo[i]).length;
      if (salida.length >= maxTurnos || chars + n > maxTexto) break;
      chars += n;
      salida.unshift(modelo[i]);
    }
    return salida;
  }

  return {
    get saludado() { return saludado; },
    set saludado(v) { saludado = Boolean(v); },

    usuario(texto, enPantalla = texto) {
      pantalla.push({ quien: 'yo', texto: String(enPantalla) });
      alModelo('user', texto);
    },
    bot(enPantalla, paraModelo = enPantalla) {
      pantalla.push({ quien: 'bot', texto: String(enPantalla) });
      alModelo('model', paraModelo);
    },
    /* Un turno que el modelo necesita y que no se pinta (el formulario ya
       está a la vista). */
    nota(role, texto) { alModelo(role, texto); },

    /* Vuelve a sanear lo ya escrito con los datos de ahora: lo que el
       comprador tecleó en el chat ANTES de dar sus datos al formulario. */
    barrer() {
      modelo = modelo.map(m => ({ role: m.role, parts: [{ text: sanear(textoDe(m)) }] }));
    },

    paraEnviar() { return recortado().map(m => ({ role: m.role, parts: [{ text: textoDe(m) }] })); },
    pantalla() { return pantalla.map(e => ({ ...e })); },

    guardar() {
      modelo = recortado();
      pantalla = pantalla.slice(-maxTurnos);
      almacen.escribir(LLAVE_MODELO, { v: VERSION_HILO, saludado, h: modelo });
      almacen.escribir(LLAVE_PANTALLA, { v: VERSION_HILO, m: pantalla });
    },

    /* Cada historial sale SOLO de su llave. Si falta uno o no es de esta
       versión, se descartan los dos: medio hilo desincronizado es peor que
       empezar de cero. Lo del modelo se vuelve a sanear al cargarlo. */
    restaurar() {
      for (const llave of LLAVES_OBSOLETAS) almacen.borrar(llave);
      const m = almacen.leer(LLAVE_MODELO);
      const p = almacen.leer(LLAVE_PANTALLA);
      if (!m || m.v !== VERSION_HILO || !p || p.v !== VERSION_HILO) {
        almacen.borrar(LLAVE_MODELO);
        almacen.borrar(LLAVE_PANTALLA);
        return false;
      }
      modelo = (Array.isArray(m.h) ? m.h : [])
        .filter(x => x && (x.role === 'user' || x.role === 'model') && textoDe(x).trim())
        .map(x => ({ role: x.role, parts: [{ text: sanear(textoDe(x)) }] }));
      pantalla = (Array.isArray(p.m) ? p.m : [])
        .filter(e => e && (e.quien === 'yo' || e.quien === 'bot') && typeof e.texto === 'string' && e.texto.trim());
      saludado = Boolean(m.saludado);
      return pantalla.length > 0;
    },

    olvidar() {
      modelo = [];
      pantalla = [];
      almacen.borrar(LLAVE_MODELO);
      almacen.borrar(LLAVE_PANTALLA);
    }
  };
}
