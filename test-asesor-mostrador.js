/**
 * ============================================================================
 *  PRUEBAS — EL ASESOR ES EL MOSTRADOR
 * ============================================================================
 *  Cubre los cuatro agujeros que dejaban una tienda que parecía funcionar:
 *
 *    1. El Asesor perdía el hilo al recargar —y pagar ES recargar—, así que
 *       el cliente volvía de Mercado Pago a un chat en blanco.
 *    2. Sin backend, «cuánto es» con el carrito lleno contestaba el catálogo
 *       genérico, como si el visitante acabara de llegar.
 *    3. Se podía generar un link de pago sin un solo dato de contacto: un
 *       pago a medias no tenía a quién escribirle.
 *    4. Tres divisiones (3D, Pack, Lux) enseñaban una nube de puntos donde
 *       las otras enseñaban una pieza.
 *
 *  Lo que se puede ejecutar de verdad —validación del comprador, preferencia
 *  de Mercado Pago, redacción de los avisos— se ejecuta. Lo que vive dentro
 *  del navegador se comprueba por CONTRATO sobre el código fuente: no es una
 *  prueba de comportamiento, y conviene decirlo en voz alta, pero sí impide
 *  que una refactorización se lleve por delante la línea de la que dependen
 *  estos cuatro arreglos.
 *
 *  Correr con:  node test-asesor-mostrador.js
 * ============================================================================
 */

const fs = require("fs");
const path = require("path");

const RAIZ = __dirname;
const leer = f => fs.readFileSync(path.join(RAIZ, f), "utf8");

let pasadas = 0;
const fallos = [];

function prueba(nombre, fn) {
  try {
    fn();
    console.log(`  ✓ ${nombre}`);
    pasadas++;
  } catch (e) {
    console.log(`  ✗ ${nombre}\n      ${e.message}`);
    fallos.push(nombre);
  }
}

function afirmar(condicion, mensaje) {
  if (!condicion) throw new Error(mensaje);
}

/* Los comentarios del propio código explican POR QUÉ no se usa `window.open`,
   así que buscarlo en crudo encuentra la explicación y no la infracción. */
const sinComentarios = t => t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

const app = leer("assets/js/app.js");
const figuras = leer("assets/js/figuras.js");
const config = leer("assets/js/division-config.js");

const {
  sanearComprador,
  contactoEnUnaLinea,
  construirPreferencia
} = require("./pagos.js");
const { REDACCION } = require("./notificaciones.js");

// ---------------------------------------------------------------------------
console.log("\n[MOSTRADOR] El Asesor no pierde la memoria");
// ---------------------------------------------------------------------------

prueba("el hilo se guarda en sessionStorage, no solo en RAM", () => {
  afirmar(app.includes("LLAVE: 'vq_asesor_v1'"), "falta la clave del hilo");
  afirmar(/recordar\(\)\s*\{[\s\S]*?Memoria\.escribir\(this\.LLAVE/.test(app),
    "`recordar` no escribe el hilo");
  afirmar(app.includes("restaurar()"), "no hay forma de repintar la conversación");
  afirmar(app.includes("Asesor.restaurar();"), "el arranque no restaura el hilo");
});

prueba("el hilo se recorta por turnos Y por caracteres", () => {
  afirmar(app.includes("MAX_TURNOS: 40"), "falta el tope de turnos");
  afirmar(app.includes("MAX_TEXTO: 24000"),
    "falta el tope de caracteres, que es el que aplica el servidor");
  afirmar(/hiloRecortado\(\)[\s\S]*?MAX_TURNOS[\s\S]*?MAX_TEXTO/.test(app),
    "el recorte no aplica los dos topes");
});

prueba("lo que se guarda es texto: ni llaves ni tokens", () => {
  const bloque = app.slice(app.indexOf("recordar()"), app.indexOf("olvidar()"));
  afirmar(!/token|api[_-]?key|secret/i.test(bloque),
    "la persistencia toca algo que huele a credencial");
});

// ---------------------------------------------------------------------------
console.log("\n[MOSTRADOR] Sin backend, el carrito manda");
// ---------------------------------------------------------------------------

prueba("con carrito, la última red NO es el catálogo genérico", () => {
  const i = app.indexOf("if (hayCarrito) {\n      return { reply:\n        'No te entendí del todo");
  const j = app.indexOf("Te muestro el catálogo completo");
  afirmar(i > 0, "desapareció la red de seguridad con carrito");
  afirmar(j > i, "el catálogo genérico ya no queda DESPUÉS del rescate del carrito");
});

prueba("«cuánto es», «desglosa» y «el link» son preguntas del pedido", () => {
  const m = app.match(/const preguntaPedido = \/(.+?)\/\.test\(q\)/);
  afirmar(m, "no existe el reconocedor de preguntas sobre el pedido");
  const re = new RegExp(m[1]);
  ["cuanto es", "desglosa mi pedido", "el total", "que pedi", "el link",
   "mi carrito", "cuanto sale"].forEach(frase => {
    afirmar(re.test(frase), `«${frase}» no se reconoce como pregunta del pedido`);
  });
});

prueba("un código postal suelto cotiza el envío en vez de buscar catálogo", () => {
  afirmar(app.includes("const cpSuelto ="), "no se detecta el CP suelto");
  afirmar(/if \(cpNuevo\) \{[\s\S]{0,400}?await cotizarEnvio\(cpNuevo\)/.test(app),
    "el CP no dispara la cotización de envío");
  /* Cinco dígitos NO son un CP si nadie habló de envío: «quiero 12000
     dientes» no puede cotizar una entrega a la Ciudad de México. */
  const m = app.match(/const pistaEnvio = \/(.+?)\/\.test\(q\)/);
  afirmar(m, "el CP se acepta sin comprobar que el mensaje hable de envío");
  const re = new RegExp(m[1]);
  ["envio a 03330", "cp 42000", "a donde me llega"].forEach(f =>
    afirmar(re.test(f), `«${f}» debería contar como pista de envío`));
  afirmar(!re.test("quiero 12000 dientes"),
    "una cantidad grande se confunde con un código postal");
});

prueba("el 429 propio dice cuánto esperar y conserva el pedido", () => {
  afirmar(leer("server.js").includes("espera_s: esperaS"),
    "el servidor no manda los segundos de espera");
  afirmar(app.includes("e.espera = parseInt(j.espera_s, 10) || 0"),
    "el front no lee los segundos de espera");
  afirmar(app.includes("'El Asesor está ocupado ~'"),
    "el mensaje de rate limit no dice la verdad");
  afirmar(app.includes("Tu carrito sigue aquí."),
    "el mensaje de rate limit no tranquiliza sobre el pedido");
});

// ---------------------------------------------------------------------------
console.log("\n[MOSTRADOR] No hay link de pago sin contacto");
// ---------------------------------------------------------------------------

prueba("un comprador vacío se rechaza y dice QUÉ falta", () => {
  const r = sanearComprador({});
  afirmar(!r.ok, "un pedido sin datos pasó la validación");
  afirmar(r.faltan.join(",") === "nombre,whatsapp,email,cp,direccion",
    `faltantes inesperados: ${r.faltan.join(",")}`);
  afirmar(r.texto.includes("WhatsApp"), "el texto del error no es accionable");
});

prueba("un comprador completo se normaliza a formato de operación", () => {
  const r = sanearComprador({
    nombre: "  Rodrigo   Corrales ",
    whatsapp: "(771) 795-9131",
    email: "RODRIGO@Ejemplo.MX",
    cp: "03330",
    direccion: "Av. Juárez 120, Centro, Pachuca",
    referencias: "Portón negro"
  });
  afirmar(r.ok, `debería pasar: ${r.faltan.join(",")}`);
  afirmar(r.datos.nombre === "Rodrigo Corrales", "el nombre no se compactó");
  afirmar(r.datos.whatsapp === "527717959131",
    `el WhatsApp no quedó marcable: ${r.datos.whatsapp}`);
  afirmar(r.datos.email === "rodrigo@ejemplo.mx", "el correo no se normalizó");
});

prueba("el WhatsApp se acepta escrito de las cuatro formas de siempre", () => {
  ["7717959131", "527717959131", "5217717959131", "17717959131"].forEach(t => {
    const r = sanearComprador({ nombre: "Ana Ruiz", whatsapp: t,
      email: "a@b.mx", cp: "42000", direccion: "Calle 5 num 3, Centro, Pachuca" });
    afirmar(r.ok && r.datos.whatsapp === "527717959131",
      `«${t}» no se normalizó (quedó ${r.datos.whatsapp})`);
  });
});

prueba("una dirección sin número exterior no pasa: la guía no se imprime", () => {
  const r = sanearComprador({ nombre: "Ana Ruiz", whatsapp: "7717959131",
    email: "a@b.mx", cp: "42000", direccion: "mi casa de siempre" });
  afirmar(!r.ok && r.faltan.includes("direccion"),
    "una dirección sin número pasó la validación");
});

prueba("los caracteres de control se limpian antes de salir hacia terceros", () => {
  const r = sanearComprador({ nombre: "Ana\nRuiz", whatsapp: "7717959131",
    email: "a@b.mx", cp: "42000", direccion: "Calle 5 num 3,\r\nCentro, Pachuca" });
  afirmar(r.ok, "el saneado tumbó un pedido válido");
  const crudo = Object.values(r.datos).join("");
  // eslint-disable-next-line no-control-regex
  afirmar(!/[\u0000-\u001F\u007F]/.test(crudo), "sobrevivió un carácter de control");
  afirmar(r.datos.nombre === "Ana Ruiz", "el salto de línea no se volvió espacio");
});

prueba("el contacto cabe en una línea que se puede leer en el teléfono", () => {
  const { datos } = sanearComprador({ nombre: "Ana Ruiz", whatsapp: "7717959131",
    email: "a@b.mx", cp: "42000", direccion: "Calle 5 num 3, Centro, Pachuca" });
  const linea = contactoEnUnaLinea(datos);
  afirmar(linea.includes("wa.me/527717959131"), "sin WhatsApp no hay rescate");
  afirmar(linea.includes("CP 42000"), "sin CP no hay envío");
});

prueba("el front tampoco pide el link sin contacto, y manda el comprador", () => {
  afirmar(/const faltan = Comprador\.faltantes\(\);[\s\S]{0,400}?Asesor\.pedirDatos\(faltan\)/.test(app),
    "`irAPagar` no exige contacto antes de llamar al servidor");
  afirmar(app.includes("comprador: Comprador.paraServidor()"),
    "el POST /api/pago no manda al comprador");
  afirmar(app.includes("Array.isArray(data.faltan)"),
    "el front ignora el 400 que dice qué falta");
});

// ---------------------------------------------------------------------------
console.log("\n[MOSTRADOR] Ir a pagar y volver sin perder nada");
// ---------------------------------------------------------------------------

prueba("el pago va en la MISMA pestaña, nunca en una ventana nueva", () => {
  const bloque = sinComentarios(app.slice(app.indexOf("async function irAPagar"),
                                          app.indexOf("/* ── La vuelta de Mercado Pago")));
  afirmar(!bloque.includes("window.open"),
    "el checkout volvió a abrir una pestaña: en iOS eso se bloquea");
  afirmar(bloque.includes("location.href = listo.url"),
    "el checkout no navega en la misma pestaña");
});

prueba("el estado se escribe ANTES de saltar a Mercado Pago", () => {
  const i = app.indexOf("function guardarAntesDeSaltar");
  const bloque = app.slice(i, i + 400);
  ["Asesor.recordar()", "Comprador.guardar()", "Carrito.guardar()",
   "Memoria.escribir(PAGO_EN_CURSO"].forEach(t => {
    afirmar(bloque.includes(t), `no se persiste ${t} antes del salto`);
  });
  const guarda = app.indexOf("guardarAntesDeSaltar({");
  afirmar(guarda > 0 && guarda < app.indexOf("location.href = listo.url"),
    "se salta a la pasarela ANTES de guardar el estado");
});

prueba("solo se navega a un dominio de Mercado Pago", () => {
  afirmar(app.includes("function esLinkDeMercadoPago"),
    "el link de pago se sigue a ciegas: es un redirector abierto");
  const usos = (app.match(/esLinkDeMercadoPago\(/g) || []).length;
  afirmar(usos >= 3, "queda algún salto sin comprobar el destino");
});

prueba("las URLs de retorno son rutas reales, sin fragmento", () => {
  const pref = construirPreferencia({
    cot: { lineas: [], _raw: { subtotal_centavos: 100000, envio_centavos: 0, total_centavos: 100000 } },
    productoPorSku: () => ({ precio_centavos: 100000 }),
    folio: "VQ-TEST",
    sitioUrl: "https://valquiriainc.com"
  });
  afirmar(pref.back_urls.success === "https://valquiriainc.com/gracias/",
    `success apunta a ${pref.back_urls.success}`);
  afirmar(pref.back_urls.pending.endsWith("/gracias/?estado=pendiente"),
    `pending apunta a ${pref.back_urls.pending}`);
  afirmar(pref.back_urls.failure.endsWith("/gracias/?estado=fallo"),
    `failure apunta a ${pref.back_urls.failure}`);
  Object.values(pref.back_urls).forEach(u => afirmar(!u.includes("#"),
    `una URL de retorno lleva fragmento: ${u}`));
});

prueba("el comprador viaja a Mercado Pago con lada, número y CP separados", () => {
  const { datos } = sanearComprador({ nombre: "Ana Ruiz Soto", whatsapp: "7717959131",
    email: "a@b.mx", cp: "42000", direccion: "Calle 5 num 3, Centro, Pachuca" });
  const pref = construirPreferencia({
    cot: { lineas: [], _raw: { subtotal_centavos: 100000, envio_centavos: 0, total_centavos: 100000 } },
    productoPorSku: () => ({ precio_centavos: 100000 }),
    folio: "VQ-TEST",
    sitioUrl: "https://valquiriainc.com",
    comprador: datos
  });
  afirmar(pref.payer.name === "Ana", "el nombre no se partió");
  afirmar(pref.payer.surname === "Ruiz Soto", "el apellido no se partió");
  afirmar(pref.payer.phone.area_code === "771" && pref.payer.phone.number === "7959131",
    `teléfono mal partido: ${JSON.stringify(pref.payer.phone)}`);
  afirmar(pref.payer.address.zip_code === "42000", "el CP no viaja");
});

prueba("existe la página puente /gracias/ y devuelve los parámetros a la app", () => {
  const puente = leer("gracias/index.html");
  afirmar(puente.includes("location.replace('/#/gracias'"),
    "el puente no entrega los parámetros a la aplicación");
  afirmar(puente.includes('name="robots" content="noindex'),
    "la página de retorno se indexaría");
  afirmar(/script-src [^;"]*'sha256-/.test(puente),
    "el script del puente no tiene hash en el CSP: no se ejecutaría");
});

prueba("el router entiende una ruta con cola de parámetros", () => {
  afirmar(app.includes("function hashPartido()"), "el hash no se parte");
  afirmar(app.includes("const fragmento = hashPartido().ruta;"),
    "`rutaActual` sigue leyendo el hash en crudo");
  afirmar(app.includes("function parametrosVisita()"),
    "no hay lectura unificada de los parámetros de retorno");
});

// ---------------------------------------------------------------------------
console.log("\n[MOSTRADOR] El aviso dice a quién escribirle");
// ---------------------------------------------------------------------------

const eventoPago = {
  total_centavos: 124767,
  folio: "VQ-TEST",
  comprador: "Rodrigo Corrales · wa.me/527717959131 · r@e.mx",
  whatsapp: "527717959131",
  direccion: "Av. Juárez 120, Centro, Pachuca",
  cp: "03330",
  items: "2× endo, 1× pulpo",
  metodo: "credit_card/visa"
};

prueba("un pago aprobado llega con nombre, WhatsApp y dirección", () => {
  const t = REDACCION.pago_aprobado(eventoPago);
  ["Rodrigo Corrales", "wa.me/527717959131", "Av. Juárez 120", "CP 03330",
   "2× endo"].forEach(x => afirmar(t.includes(x), `el aviso no lleva ${x}`));
});

prueba("un pago aprobado SIN contacto lo grita en vez de callarlo", () => {
  const t = REDACCION.pago_aprobado({ ...eventoPago, comprador: null, whatsapp: null });
  afirmar(t.includes("SIN datos de contacto"),
    "un pago sin dueño pasa desapercibido");
});

prueba("un pago rechazado trae el teléfono, que es lo que lo rescata", () => {
  const t = REDACCION.pago_rechazado({ ...eventoPago, detalle: "cc_rejected_high_risk" });
  afirmar(t.includes("wa.me/527717959131"), "sin teléfono no hay rescate");
});

prueba("un pago pendiente avisa y pide NO enviar todavía", () => {
  afirmar(typeof REDACCION.pago_pendiente === "function",
    "los pagos en proceso siguen sin avisar");
  const t = REDACCION.pago_pendiente({ ...eventoPago, detalle: "pending_waiting_transfer" });
  afirmar(t.includes("NO lo mandes todavía"),
    "el aviso no impide enviar mercancía sin cobrar");
});

// ---------------------------------------------------------------------------
console.log("\n[MOSTRADOR] Las seis divisiones enseñan SU pieza");
// ---------------------------------------------------------------------------

const DIVISIONES = {
  dental: { figura: "diente", tope: "1" },
  ia: { figura: "cyborg", tope: "0.94" },
  "3d": { figura: "engrane", tope: "0.62" },
  pack: { figura: "empaque", tope: "0.88" },
  lux: { figura: "lampara", tope: "0.68" }
};

prueba("las tres figuras de taller se curan como pieza, no como nube", () => {
  ["engrane", "empaque", "lampara"].forEach(id => {
    const bloque = figuras.match(new RegExp(`${id}: \\{[\\s\\S]*?\\n  \\}`))[0];
    afirmar(/solida: true/.test(bloque), `${id} sigue siendo una nube de puntos`);
    afirmar(/paso: 0\.0\d+/.test(bloque) && /pasoMovil: 0\.0\d+/.test(bloque),
      `${id} se cura con la rejilla gruesa y sale de palomitas`);
  });
});

prueba("la rejilla móvil cabe en el presupuesto de puntos que aplica montar()", () => {
  const escena = leer("assets/js/escena.js");
  afirmar(escena.includes("F.solida ? 80000 : 26000"),
    "cambió el presupuesto de puntos en móvil: revisa los `pasoMovil`");
  ["engrane", "empaque", "lampara"].forEach(id => {
    const bloque = figuras.match(new RegExp(`${id}: \\{[\\s\\S]*?\\n  \\}`))[0];
    const paso = parseFloat(bloque.match(/pasoMovil: (0\.0\d+)/)[1]);
    afirmar(paso >= 0.014, `${id} muestrea demasiado fino para un teléfono`);
  });
});

prueba("cada división monta su figura y su avance", () => {
  Object.entries(DIVISIONES).forEach(([id, { figura, tope }]) => {
    const bloque = config.match(new RegExp(`'?${id}'?: Object\\.freeze\\(\\{[\\s\\S]*?\\}\\)`));
    afirmar(bloque, `falta ${id} en DIVISION_CONFIG`);
    afirmar(bloque[0].includes(`figure: '${figura}'`), `${id} no monta ${figura}`);
    afirmar(bloque[0].includes(`progress: ${tope}`), `${id} no imprime hasta ${tope}`);
  });
});

prueba("el avance de cada división dice lo mismo en el hub y en su página", () => {
  Object.entries(DIVISIONES).forEach(([id, { figura, tope }]) => {
    const ruta = app.match(new RegExp(`'/${id}':\\s*\\{[^}]*\\}`));
    afirmar(ruta, `falta la ruta /${id} en el hub`);
    afirmar(ruta[0].includes(`fig:'${figura}'`), `el hub monta otra figura en /${id}`);
    const topeHub = (ruta[0].match(/tope:\s*([\d.]+)/) || [])[1];
    afirmar(parseFloat(topeHub) === parseFloat(tope),
      `/${id}: el hub imprime hasta ${topeHub} y su página hasta ${tope}`);
  });
});

prueba("las cinco páginas de división traen canvas, riel y motor", () => {
  Object.keys(DIVISIONES).forEach(id => {
    const html = leer(`${id}/index.html`);
    afirmar(html.includes(`<body data-division="${id}">`),
      `${id}/ no declara su división`);
    afirmar(html.includes('id="escena"'), `${id}/ no tiene canvas`);
    afirmar(html.includes("data-division-experience"), `${id}/ no monta la experiencia`);
    afirmar(html.includes("assets/js/division-page.js"), `${id}/ no carga el motor`);
    afirmar(/script-src [^;"]*'sha256-/.test(html),
      `${id}/ tiene scripts en línea sin hash: el CSP los bloquearía`);
    afirmar(html.includes("'wasm-unsafe-eval'"),
      `${id}/ no permite WebAssembly: Draco no descomprime la malla`);
  });
});

prueba("ninguna página pública enlaza a una ruta hash que rebota", () => {
  const hub = leer("index.html");
  const mapa = hub.match(/var limpias = \{([\s\S]*?)\};/)[1];
  const legacy = [...mapa.matchAll(/'(#[^']+)':/g)].map(m => m[1]);
  afirmar(legacy.length >= 6, "no se pudo leer el redirector de rutas antiguas");
  ["dental", "ia", "3d", "pack", "lux", "catalogo", "gracias"].forEach(dir => {
    const html = leer(`${dir}/index.html`);
    for (const m of html.matchAll(/href="\/(#[^"]*)"/g)) {
      afirmar(!legacy.includes(m[1]),
        `${dir}/ enlaza /${m[1]}, que el redirector devuelve al punto de partida`);
    }
  });
});

// ---------------------------------------------------------------------------
console.log("");
if (fallos.length) {
  console.log(`✗ ${fallos.length} FALLARON de ${pasadas + fallos.length}`);
  process.exit(1);
}
console.log(`✓ ${pasadas}/${pasadas} pruebas del mostrador pasaron.\n`);
