/**
 * ============================================================================
 *  VALQUIRIA — QUIÉN ES QUIÉN  (identidad.js)
 * ============================================================================
 *  Dos preguntas distintas, con dos respuestas distintas:
 *
 *    · ¿Quién abusa?  → la RED de la que llega: la IPv4, o el /64 de IPv6.
 *      Sirve para los rate limits y para el bloqueo del panel.
 *    · ¿De quién es esta reserva? → el VISITANTE: un UUID v4 del navegador.
 *
 *  Mezclarlas hacía que dos personas detrás de la misma IP pública (CGNAT,
 *  Wi-Fi de universidad, oficina) se borraran la reserva entre sí.
 * ============================================================================
 */

"use strict";

const net = require("net");

/* ═══ CUÁNDO SE CREE UNA CABECERA DE PROXY ═══
   Solo cuando la infraestructura lo garantiza, y la frontera está en el
   código, no en un comentario:

     · En Render (`RENDER=true`, que Render pone siempre en runtime) todo el
       tráfico entra por Cloudflare, que escribe la IP real en
       CF-Connecting-IP y responde 403 a quien intenta mandarla él mismo
       (comprobado en producción el 26-09-2026). Detrás hay exactamente un
       proxy propio de Render: `trust proxy = 1`.
     · Fuera de Render nadie lo garantiza. Quien llega directo al proceso
       elige ese valor —y el de X-Forwarded-For— a su gusto, así que no se
       cree ninguno de los dos: cuenta la dirección del socket.
     · En pruebas, simular a Cloudflare se pide de forma explícita
       (`SIMULAR_CLOUDFLARE_EN_PRUEBAS=1`), y solo vale con NODE_ENV=test.

   `IP_CABECERA_CONFIABLE` ya no ELIGE cabecera —una cabecera configurable
   como «confiable» es una puerta que alguien abre sin querer—: solo puede
   APAGAR la confianza. Vacía o con cualquier valor distinto de
   `cf-connecting-ip`, no se cree ninguna: ni CF-Connecting-IP ni
   X-Forwarded-For (trust proxy apagado), y la identidad sale de la
   dirección del socket, no de un `req.ip` que Express pudo derivar de
   cabeceras. Apagar la confianza es fallar cerrado, también en Render. */
const CABECERA_CLOUDFLARE = "cf-connecting-ip";

function confiaEnCloudflare(env = process.env) {
  const ajuste = env.IP_CABECERA_CONFIABLE;
  if (ajuste !== undefined && ajuste.trim().toLowerCase() !== CABECERA_CLOUDFLARE) return false;
  if (env.RENDER === "true") return true;
  return env.NODE_ENV === "test" && env.SIMULAR_CLOUDFLARE_EN_PRUEBAS === "1";
}

/* Los ocho grupos de 16 bits de una IPv6 ya validada por net.isIP. Deshace
   la compresión `::`, la cola IPv4 (`::ffff:1.2.3.4`) y la zona (`%eth0`). */
function hextetos(ip) {
  let s = ip.toLowerCase().split("%")[0];
  const cola4 = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (cola4) {
    const [a, b, c, d] = cola4[2].split(".").map(Number);
    s = `${cola4[1]}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [cabeza, cola] = s.split("::");
  const izquierda = cabeza ? cabeza.split(":") : [];
  const derecha = cola ? cola.split(":") : [];
  const ceros = cola === undefined ? 0 : 8 - izquierda.length - derecha.length;
  return [...izquierda, ...Array(ceros).fill("0"), ...derecha].map(g => parseInt(g, 16));
}

/**
 * La red de una dirección, en forma canónica: la misma clave para todas las
 * maneras de escribir una misma IPv6 y para todo su /64 —una persona suele
 * tener un /64 entero, y cambiar el último grupo no debe reiniciar su cupo—.
 * Una IPv4 dentro de IPv6 cuenta como esa IPv4. Lo que no es IP: null.
 */
function claveDeRed(valor) {
  if (typeof valor !== "string") return null;
  const ip = valor.trim();
  const familia = net.isIP(ip);
  if (familia === 4) return ip;
  if (familia !== 6) return null;
  const g = hextetos(ip);
  if (g.slice(0, 5).every(x => x === 0) && g[5] === 0xffff) {
    return [g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255].join(".");
  }
  return g.slice(0, 4).map(x => x.toString(16)).join(":") + "::/64";
}

function crearIdentidad(env = process.env) {
  const cloudflare = confiaEnCloudflare(env);
  return {
    confiaEnCloudflare: cloudflare,
    // Solo se cree al proxy de Render cuando también se cree a Cloudflare.
    trustProxy: cloudflare && env.RENDER === "true" ? 1 : false,
    identidad(req) {
      /* Con Cloudflare, una cabecera que no es IP válida no cuenta: queda
         `req.ip`, el salto que añadió el proxy de Render, no el cliente. */
      if (cloudflare) {
        return claveDeRed(String(req.get(CABECERA_CLOUDFLARE) || "")) || claveDeRed(req.ip) || "desconocida";
      }
      return claveDeRed(req.socket?.remoteAddress) || "desconocida";
    }
  };
}

// El MISMO contrato que assets/js/visitante.js; test-seguridad.js falla si divergen.
const VISITANTE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/* El dueño de una reserva, o null. Sin un UUID v4 válido NO hay reserva: el
   servidor ya no inventa un dueño —uno aleatorio nunca podía reemplazar su
   propia reserva, así que cada petición anónima apartaba de nuevo— ni cae a
   la IP. El frontend lo genera desde app.js v76. */
function duenoDeReserva(req) {
  const v = req.body?.visitante;
  return typeof v === "string" && VISITANTE_UUID.test(v) ? "visitante:" + v.toLowerCase() : null;
}

module.exports = { CABECERA_CLOUDFLARE, VISITANTE_UUID, claveDeRed, confiaEnCloudflare, crearIdentidad, duenoDeReserva };
