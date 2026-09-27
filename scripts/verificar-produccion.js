/**
 * ============================================================================
 *  VERIFICAR PRODUCCIÓN — después de cada despliegue
 * ============================================================================
 *  `npm test` prueba el código en tu Mac. Esto prueba lo que de verdad está
 *  sirviendo valquiriainc.com y el backend de Render, desde fuera, como lo
 *  vería cualquiera.
 *
 *  Es de SOLO LECTURA: no crea pedidos, no reserva mercancía, no gasta
 *  créditos de Gemini y no dispara avisos a Telegram. Por eso NO prueba la
 *  fuerza bruta al panel (bloquearía tu propia IP y te mandaría una alerta):
 *  eso lo cubre `test-seguridad.js` en local.
 *
 *  Lo único que deja rastro es la prueba del límite de pagos: tu IP queda
 *  frenada para crear links de pago durante un minuto.
 *
 *  Uso:  node scripts/verificar-produccion.js
 * ============================================================================
 */

"use strict";

const SITIO = process.env.SITIO || "https://valquiriainc.com";
const API = process.env.API || "https://rodrigo-corrales1429-github-io.onrender.com";

let ok = 0;
const mal = [];

/* Los cuatro textos que tiene que contener el aviso de privacidad corregido. */
const TEXTOS_AVISO = [
  "artículo 36 de la LFPDPPP",
  "Telegram",
  "Render Services",
  "Secretaría Anticorrupción y Buen Gobierno"
];

/* El HTML parte las frases largas en varias líneas con sangría —en producción
   el aviso dice «Buen\n          Gobierno»—, y compararlo en crudo daba un falso
   negativo con el aviso ya corregido. Se compara con el espacio normalizado:
   cualquier secuencia de espacios, tabs o saltos de línea cuenta como UN
   espacio. No es más permisivo: cada palabra tiene que estar, en su orden y
   contigua a la siguiente. */
const normalizarEspacios = texto => String(texto).replace(/\s+/g, " ");

/** Los textos del aviso que NO aparecen en el HTML. Vacío = aviso correcto. */
function faltantesAvisoPrivacidad(html) {
  const plano = normalizarEspacios(html);
  return TEXTOS_AVISO.filter(t => !plano.includes(t));
}

async function comprobar(nombre, fn) {
  try {
    const detalle = await fn();
    if (detalle === true || detalle === undefined) { ok++; console.log(`  ✓ ${nombre}`); }
    else { mal.push(nombre); console.log(`  ✗ ${nombre}\n      ${detalle}`); }
  } catch (e) {
    mal.push(nombre); console.log(`  ✗ ${nombre}\n      ${e.message}`);
  }
}

const traer = (url, op = {}) => fetch(url, { redirect: "manual", ...op });
const cuerpoPagoVacio = JSON.stringify({ items: [{ sku: "ValEnd", cantidad: 1 }], comprador: {} });

async function main() {
  console.log(`\nSitio: ${SITIO}\nAPI:   ${API}`);
  console.log("Despertando el backend (Render gratuito puede tardar ~50 s)…");
  await traer(API + "/health").catch(() => {});

  console.log("\n[Sitio]");
  await comprobar("los documentos internos y el backend no se publican", async () => {
    const expuestos = [];
    for (const f of ["AUDITORIA.md", "PAGOS.md", "INCIDENTES.md", "SEGURIDAD.md", "server.js",
                     "package.json", ".env.example", ".env", "test-seguridad.js", ".git/config"]) {
      if ((await traer(`${SITIO}/${f}`)).status === 200) expuestos.push(f);
    }
    return expuestos.length ? `se sirven: ${expuestos.join(", ")}` : true;
  });

  const inicio = await (await traer(SITIO + "/")).text();
  await comprobar("la página ya no ejecuta código de unpkg", () =>
    !/unpkg\.com/.test(inicio) || "index.html todavía carga three.js desde unpkg");
  await comprobar("el aviso de privacidad es la versión corregida", () => {
    const falta = faltantesAvisoPrivacidad(inicio);
    return falta.length ? `falta: ${falta.join(" · ")}` : true;
  });
  await comprobar("los términos reconocen los plazos de la LFPC", () =>
    (/dos meses/.test(inicio) && !/aplica un costo de \$150\.00 MXN/.test(inicio)) ||
    "los términos siguen con el plazo de cinco días o el envío fijo");

  await comprobar("robots.txt no anuncia el panel", async () => {
    const r = await (await traer(SITIO + "/robots.txt")).text();
    return !/admin/i.test(r) || "robots.txt menciona /admin";
  });
  await comprobar("el panel no permite scripts en línea sin firmar", async () => {
    const h = await (await traer(SITIO + "/admin/")).text();
    const csp = (h.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/) || [])[1] || "";
    return !/script-src[^;]*'unsafe-inline'/.test(csp) || "el CSP del panel tiene 'unsafe-inline'";
  });

  console.log("\n[API]");
  await comprobar("/health no revela configuración", async () => {
    const r = await traer(API + "/health");
    const t = await r.text();
    if (t.trim() !== '{"ok":true}') return `revela: ${t.slice(0, 100)}`;
    return !r.headers.get("x-powered-by") || "sigue anunciando x-powered-by";
  });
  await comprobar("las rutas del panel no responden sin credencial", async () => {
    const abiertas = [];
    for (const [m, ruta] of [["GET", "/api/admin/resumen"], ["GET", "/api/leads"],
                             ["POST", "/api/admin/probar-avisos"], ["POST", "/api/admin/sesion"]]) {
      if ((await traer(API + ruta, { method: m })).status !== 404) abiertas.push(ruta);
    }
    return abiertas.length ? `responden: ${abiertas.join(", ")}` : true;
  });
  await comprobar("el webhook rechaza avisos sin firma (401; un 503 = falta el secreto)", async () => {
    const r = await traer(API + "/api/pago/webhook?type=payment&data.id=1", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    return r.status === 401 || `respondió ${r.status}`;
  });
  await comprobar("un sitio ajeno no puede llamar a la API", async () => {
    const r = await traer(API + "/api/chat", { method: "OPTIONS", headers: {
      Origin: "https://sitio-malicioso.example", "Access-Control-Request-Method": "POST" } });
    return (r.status === 403 && !r.headers.get("access-control-allow-origin")) || `respondió ${r.status}`;
  });
  await comprobar("no se crea un link de pago sin datos del comprador", async () => {
    const r = await traer(API + "/api/pago", { method: "POST",
      headers: { "Content-Type": "application/json" }, body: cuerpoPagoVacio });
    return [400, 429].includes(r.status) || `respondió ${r.status}`;
  });
  await comprobar("el límite de pagos cuenta por VISITANTE, no por la IP de Cloudflare", async () => {
    /* Con el fallo, el servidor contaba por la IP de salida de Cloudflare, que
       ROTA — pero no siempre: a veces una ráfaga entera sale por la misma IP y
       el límite parece funcionar. Por eso no basta con ver UN 429. La firma
       del fallo es otra: 429 y 400 intercalados, porque tus peticiones caen en
       contadores distintos. Con el arreglo, en cuanto sale el primer 429 todos
       los siguientes lo son, y el primero llega a más tardar en el 7º intento. */
    const codigos = [];
    for (let i = 0; i < 12; i++) {
      const r = await traer(API + "/api/pago", { method: "POST",
        headers: { "Content-Type": "application/json" }, body: cuerpoPagoVacio });
      codigos.push(r.status);
    }
    const primero = codigos.indexOf(429);
    if (primero === -1) return `12 intentos seguidos sin freno: ${codigos.join(" ")}`;
    if (primero > 6) return `el freno llegó tarde (intento ${primero + 1}): ${codigos.join(" ")}`;
    const colados = codigos.slice(primero).filter(c => c !== 429).length;
    return colados === 0 ||
      `${colados} intentos pasaron DESPUÉS del freno — la firma del contador por IP de Cloudflare: ${codigos.join(" ")}`;
  });

  console.log("");
  if (mal.length) {
    console.log(`✗ ${mal.length} de ${ok + mal.length} comprobaciones fallaron.`);
    console.log("  Si acabas de desplegar, espera 2–3 minutos a que Render y GitHub Pages");
    console.log("  terminen y vuelve a correrlo.\n");
    process.exit(1);
  }
  console.log(`✓ ${ok}/${ok}: producción tiene los arreglos de seguridad.\n`);
}

/* Solo se sale a producción cuando se ejecuta el script. Importado desde las
   pruebas, expone la comprobación del aviso sin hacer ni una petición. */
if (require.main === module) {
  main().catch(e => { console.error("✗ No se pudo verificar:", e.message); process.exit(1); });
}

module.exports = { faltantesAvisoPrivacidad, TEXTOS_AVISO };
