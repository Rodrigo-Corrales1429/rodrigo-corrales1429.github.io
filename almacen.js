/**
 * ============================================================================
 *  VALQUIRIA — INSTANTÁNEA EN DISCO  (almacen.js v1)
 * ============================================================================
 *  EL PROBLEMA
 *  Pedidos, intereses y bitácora viven en la memoria del proceso. Render
 *  reinicia al desplegar y duerme el plan gratuito: cuando eso pasa, el panel
 *  amanece en blanco y los prospectos del día se evaporan.
 *
 *  POR QUÉ UNA INSTANTÁNEA Y NO UNA BASE DE DATOS
 *  Una base de datos obliga a reescribir cada punto donde se toca el estado
 *  —incluida la ruta de pagos, que es la que NO se debe tocar sin necesidad— y
 *  añade una dependencia, credenciales y un servicio más que puede caerse.
 *  Esto, en cambio, no toca ninguna ruta caliente: cada cierto tiempo vuelca
 *  el estado a un archivo, y al arrancar lo lee. Si el archivo no existe o
 *  está corrupto, el servidor arranca vacío exactamente como hoy.
 *
 *  ⚠️  LO QUE HAY QUE SABER PARA QUE ESTO SIRVA DE ALGO
 *  En Render el sistema de archivos es EFÍMERO: se borra en cada despliegue.
 *  Sin un Persistent Disk montado, esto no persiste nada y es un adorno.
 *
 *      Render → tu servicio → Disks → Add Disk
 *      Mount path: /var/data     Size: 1 GB
 *      Variable:   ALMACEN_RUTA=/var/data/valquiria.json
 *
 *  Sin ALMACEN_RUTA el módulo queda desactivado y todo funciona como antes.
 *
 *  CUÁNDO CAMBIAR A UNA BASE DE DATOS DE VERDAD
 *  Cuando haya más de un proceso sirviendo (escalado horizontal): dos
 *  instancias escribiendo el mismo archivo se pisan. Mientras sea una sola
 *  —que es lo normal en este tamaño— esto es suficiente y mucho más simple.
 * ============================================================================
 */

"use strict";

const fs = require("fs");
const path = require("path");

const RUTA = (process.env.ALMACEN_RUTA || "").trim();
const ACTIVO = Boolean(RUTA);

/* Cada cuánto se vuelca. No se escribe en cada evento: una visita no vale una
   escritura a disco, y con 30 s la pérdida máxima ante un corte brusco son 30
   segundos de bitácora. Los pedidos, además, se fuerzan al momento. */
const INTERVALO_MS = parseInt(process.env.ALMACEN_INTERVALO_MS || "30000", 10);

/* Tope de seguridad: un archivo que crece sin freno acaba llenando el disco y
   tumbando el servicio por algo que era una comodidad. */
const MAX_BYTES = parseInt(process.env.ALMACEN_MAX_BYTES || "5000000", 10);

let fuentes = null;      // de dónde leer el estado vivo
let destinos = null;     // dónde volverlo a meter al arrancar
let reloj = null;
let pendiente = false;
let ultimoError = null;
let ultimoGuardado = null;

/**
 * Conecta el almacén con los módulos que tienen el estado.
 *
 * Se inyectan funciones en vez de importar los módulos para no crear ciclos
 * de dependencias (server.js → almacen.js → server.js) y para que las pruebas
 * puedan pasar objetos falsos.
 */
function configurar({ leer, escribir }) {
  fuentes = leer;
  destinos = escribir;
}

/** Lee el archivo y devuelve el estado al proceso. Se llama una vez, al arrancar. */
function restaurar() {
  if (!ACTIVO || !destinos) return { restaurado: false, motivo: "desactivado" };
  try {
    if (!fs.existsSync(RUTA)) {
      return { restaurado: false, motivo: "todavía no hay instantánea" };
    }
    const crudo = fs.readFileSync(RUTA, "utf8");
    const datos = JSON.parse(crudo);

    const resumen = {};
    for (const [nombre, poner] of Object.entries(destinos)) {
      const filas = Array.isArray(datos[nombre]) ? datos[nombre] : [];
      poner(filas);
      resumen[nombre] = filas.length;
    }
    return { restaurado: true, guardado_el: datos._guardado || null, ...resumen };
  } catch (e) {
    /* Un archivo corrupto NO puede impedir que el servidor arranque: se
       ignora, se avisa, y se sigue con el estado vacío. Perder el mirador es
       recuperable; no poder vender, no. */
    ultimoError = String(e?.message || e).slice(0, 200);
    console.error(`[almacen] No se pudo leer ${RUTA}: ${ultimoError}. Se arranca vacío.`);
    return { restaurado: false, motivo: ultimoError };
  }
}

/** Vuelca el estado a disco. Escritura atómica: primero .tmp, luego rename. */
function guardarYa() {
  if (!ACTIVO || !fuentes) return false;
  try {
    const datos = { _guardado: new Date().toISOString(), _version: 1 };
    for (const [nombre, sacar] of Object.entries(fuentes)) {
      datos[nombre] = sacar() || [];
    }
    const texto = JSON.stringify(datos);

    if (texto.length > MAX_BYTES) {
      console.error(
        `[almacen] La instantánea pesa ${texto.length} bytes y el tope es ` +
        `${MAX_BYTES}. No se guarda para no llenar el disco.`
      );
      return false;
    }

    fs.mkdirSync(path.dirname(RUTA), { recursive: true });
    /* Escribir directamente sobre el archivo bueno deja basura irrecuperable
       si el proceso muere a media escritura —que es justo cuando Render mata
       el contenedor—. Se escribe aparte y se renombra, que es atómico. */
    const tmp = `${RUTA}.tmp`;
    fs.writeFileSync(tmp, texto, "utf8");
    fs.renameSync(tmp, RUTA);

    ultimoGuardado = new Date().toISOString();
    pendiente = false;
    return true;
  } catch (e) {
    ultimoError = String(e?.message || e).slice(0, 200);
    console.error(`[almacen] No se pudo guardar en ${RUTA}: ${ultimoError}`);
    return false;
  }
}

/** Marca que hay algo que guardar. El reloj lo recoge. */
function marcarSucio() {
  pendiente = true;
}

function arrancar() {
  if (!ACTIVO) return;
  reloj = setInterval(() => { if (pendiente) guardarYa(); }, INTERVALO_MS);
  reloj.unref();
}

function detener() {
  if (reloj) clearInterval(reloj);
  /* Último volcado antes de morir: es el que salva el pedido que entró en el
     minuto anterior al despliegue. */
  return guardarYa();
}

function estadoAlmacen() {
  return {
    activo: ACTIVO,
    ruta: ACTIVO ? RUTA : null,
    ultimo_guardado: ultimoGuardado,
    hay_cambios_sin_guardar: pendiente,
    ultimo_error: ultimoError,
    nota: ACTIVO
      ? "Instantánea en disco activa."
      : "Sin ALMACEN_RUTA: el estado vive solo en memoria y se pierde al reiniciar Render."
  };
}

module.exports = {
  configurar, restaurar, guardarYa, marcarSucio,
  arrancar, detener, estadoAlmacen,
  ACTIVO
};
