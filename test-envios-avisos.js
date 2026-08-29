/**
 * ============================================================================
 *  PRUEBAS — envíos, termoformado, Dental OS y centro de avisos
 * ============================================================================
 *  Lo que se prueba aquí es lo que cuesta dinero cuando falla:
 *  un envío mal cobrado, una fecha imposible, un aviso que no sale.
 * ============================================================================
 */

const assert = require("assert");

/* Se silencian los avisos ANTES de cargar el módulo: `notificaciones.js` lee
   el interruptor al importarse. Sin esta línea, ejecutar las pruebas con un
   token de Telegram en el .env le manda al dueño pagos falsos al teléfono. */
process.env.AVISOS_SILENCIO = "1";

const envios = require("./envios.js");
const { estimarTermoformado } = require("./termoformado.js");
const { ejecutarHerramienta, TOOLS, cotizarDentalOs } = require("./gemini-tools.js");
const avisos = require("./notificaciones.js");
const inventario = require("./inventario.js");
const { calcularCotizacion } = require("./quote-engine.js");

let pasadas = 0, fallidas = 0;
const fallos = [];

function test(nombre, fn) {
  try {
    const r = fn();
    if (r instanceof Promise) throw new Error("usa testAsync para pruebas asíncronas");
    console.log(`  ✓ ${nombre}`);
    pasadas++;
  } catch (e) {
    console.log(`  ✗ ${nombre}\n      ${e.message}`);
    fallidas++; fallos.push(nombre);
  }
}

async function testAsync(nombre, fn) {
  try {
    await fn();
    console.log(`  ✓ ${nombre}`);
    pasadas++;
  } catch (e) {
    console.log(`  ✗ ${nombre}\n      ${e.message}`);
    fallidas++; fallos.push(nombre);
  }
}

const centavos = txt => Math.round(parseFloat(String(txt).replace(/[^0-9.]/g, "")) * 100);

(async () => {

// ══════════════════════════════════════════════════════════════════════
console.log("\n[ENVÍOS] Geografía");
// ══════════════════════════════════════════════════════════════════════

test("un CP de Hidalgo es zona local", () => {
  assert.strictEqual(envios.ubicar("42000").zona, "local");
  assert.strictEqual(envios.ubicar("42000").estado, "Hidalgo");
});

test("CDMX y Edomex son zona metropolitana", () => {
  assert.strictEqual(envios.ubicar("06600").zona, "metropolitana");
  assert.strictEqual(envios.ubicar("53100").zona, "metropolitana");
});

test("la península y la frontera son zona extendida", () => {
  assert.strictEqual(envios.ubicar("77500").zona, "extendida"); // Cancún
  assert.strictEqual(envios.ubicar("21000").zona, "extendida"); // Mexicali
  assert.strictEqual(envios.ubicar("97000").zona, "extendida"); // Mérida
});

test("cada estado cae en algún rango de CP y en alguna zona", () => {
  /* Un CP sin zona haría que un cliente real no pudiera comprar. Se barre
     todo el espacio de prefijos en vez de confiar en una muestra. */
  const huerfanos = [];
  for (let p = 1; p <= 99; p++) {
    const cp = String(p).padStart(2, "0") + "000";
    const u = envios.ubicar(cp);
    if (u && !["local", "metropolitana", "nacional", "extendida"].includes(u.zona)) {
      huerfanos.push(cp);
    }
  }
  assert.strictEqual(huerfanos.length, 0, `prefijos sin zona: ${huerfanos.join(", ")}`);
});

test("un CP inválido se rechaza en vez de inventarse una zona", () => {
  assert.strictEqual(envios.ubicar("123"), null);
  assert.strictEqual(envios.ubicar(""), null);
  assert.strictEqual(envios.ubicar(null), null);
  assert.strictEqual(envios.ubicar("00000"), null); // no existe el prefijo 00
});

test("el CP se normaliza aunque venga con ruido", () => {
  assert.strictEqual(envios.normalizarCP("CP 42000"), "42000");
  assert.strictEqual(envios.normalizarCP("42-000"), "42000");
});

// ══════════════════════════════════════════════════════════════════════
console.log("\n[ENVÍOS] Calendario hábil");
// ══════════════════════════════════════════════════════════════════════

test("sábados y domingos no son hábiles", () => {
  assert.strictEqual(envios.esHabil("2026-08-29"), false); // sábado
  assert.strictEqual(envios.esHabil("2026-08-30"), false); // domingo
  assert.strictEqual(envios.esHabil("2026-08-31"), true);  // lunes
});

test("los feriados mexicanos no son hábiles", () => {
  for (const f of ["2026-09-16", "2026-12-25", "2027-05-01", "2026-11-16"]) {
    assert.strictEqual(envios.esHabil(f), false, `${f} debería ser feriado`);
  }
});

test("Jueves y Viernes Santos no son hábiles: la carga no se mueve", () => {
  assert.strictEqual(envios.esHabil("2026-04-02"), false);
  assert.strictEqual(envios.esHabil("2026-04-03"), false);
});

test("contar días hábiles salta fines de semana y feriados", () => {
  /* Del viernes 11 de septiembre, 1 día hábil es el lunes 14: si cayera en
     sábado, la fecha prometida sería imposible de cumplir. */
  assert.strictEqual(envios.diasHabilesDesde("2026-09-11", 1), "2026-09-14");
  /* Del martes 15 de septiembre, 1 día hábil salta el 16 (independencia). */
  assert.strictEqual(envios.diasHabilesDesde("2026-09-15", 1), "2026-09-17");
});

test("toda fecha de entrega calculada cae en día hábil", () => {
  /* La prueba que de verdad importa: se barre un año entero de fechas de
     partida y ninguna ventana puede terminar en domingo o el 25 de diciembre. */
  let malas = 0;
  let cursor = "2026-09-01";
  for (let i = 0; i < 365; i++) {
    for (const n of [1, 2, 3, 5, 8]) {
      if (!envios.esHabil(envios.diasHabilesDesde(cursor, n))) malas++;
    }
    cursor = envios.diasHabilesDesde(cursor, 1);
  }
  assert.strictEqual(malas, 0, `${malas} fechas de entrega cayeron en día inhábil`);
});

test("después de la hora de corte el pedido sale al día hábil siguiente", () => {
  /* Miércoles 2 de septiembre de 2026, 19:00 hora del centro = 01:00 UTC del 3. */
  const tarde = new Date("2026-09-03T01:00:00Z");
  const temprano = new Date("2026-09-02T15:00:00Z"); // 09:00 del centro
  const vTarde = envios.ventanaDeEntrega(2, 3, tarde);
  const vTemprano = envios.ventanaDeEntrega(2, 3, temprano);
  assert.ok(vTarde.sale_de_taller > vTemprano.sale_de_taller,
    `tarde=${vTarde.sale_de_taller} temprano=${vTemprano.sale_de_taller}`);
});

// ══════════════════════════════════════════════════════════════════════
console.log("\n[ENVÍOS] Peso y tarifa");
// ══════════════════════════════════════════════════════════════════════

test("se cobra el peso volumétrico cuando supera al real", () => {
  const p = envios.pesoFacturable({ peso_kg: 1, largo_cm: 60, ancho_cm: 40, alto_cm: 40 });
  assert.strictEqual(p.manda, "volumétrico");
  assert.ok(p.facturable_kg > 1, "debería facturar más de 1 kg");
});

test("se cobra el peso real cuando supera al volumétrico", () => {
  const p = envios.pesoFacturable({ peso_kg: 12, largo_cm: 20, ancho_cm: 15, alto_cm: 10 });
  assert.strictEqual(p.manda, "real");
});

test("nunca se factura menos de medio kilo", () => {
  assert.ok(envios.pesoFacturable({ peso_kg: 0.05 }).facturable_kg >= 0.5);
});

test("el peso del pedido crece con las piezas y la caja escalona", () => {
  const uno = envios.pesoDelPedido([{ sku: "ValEnd", cantidad: 1 }]);
  const diez = envios.pesoDelPedido([{ sku: "ValEnd", cantidad: 10 }]);
  assert.ok(diez.peso_kg > uno.peso_kg);
  assert.ok(diez.largo_cm > uno.largo_cm, "una caja de 10 piezas debe ser mayor");
});

test("la tarifa nunca baja al subir el peso", () => {
  /* Un escalón mal escrito puede hacer que 6 kg salgan más baratos que 5. */
  for (const zona of ["local", "metropolitana", "nacional", "extendida"]) {
    let previo = 0;
    for (let kg = 0.5; kg <= 45; kg += 0.5) {
      const t = envios.costoPorTabla(zona, "terrestre", kg);
      assert.ok(t.centavos >= previo,
        `${zona}: a ${kg} kg cuesta menos que en el escalón anterior`);
      previo = t.centavos;
    }
  }
});

test("más lejos nunca cuesta menos", () => {
  const kg = 3;
  const orden = ["local", "metropolitana", "nacional", "extendida"];
  let previo = 0;
  for (const z of orden) {
    const c = envios.costoPorTabla(z, "terrestre", kg).centavos;
    assert.ok(c >= previo, `${z} cuesta menos que la zona anterior`);
    previo = c;
  }
});

// ══════════════════════════════════════════════════════════════════════
console.log("\n[ENVÍOS] Cotización completa");
// ══════════════════════════════════════════════════════════════════════

await testAsync("cotiza con opciones ordenadas de más barata a más cara", async () => {
  const r = await envios.cotizarEnvio({ cp_destino: "64000", lineas: [{ sku: "ValEnd", cantidad: 1 }] });
  assert.ok(r.ok);
  assert.ok(r.opciones.length >= 2);
  for (let i = 1; i < r.opciones.length; i++) {
    assert.ok(r.opciones[i].costo_centavos >= r.opciones[i - 1].costo_centavos,
      "las opciones no vienen ordenadas por precio");
  }
  assert.strictEqual(r.opciones[0].recomendada, true);
});

await testAsync("un CP inválido devuelve error legible, no una excepción", async () => {
  const r = await envios.cotizarEnvio({ cp_destino: "xyz" });
  assert.strictEqual(r.ok, false);
  assert.ok(/código postal/i.test(r.error));
});

await testAsync("el envío gratis se aplica SOLO al servicio más barato", async () => {
  const r = await envios.cotizarEnvio({
    cp_destino: "64000",
    lineas: [{ sku: "DientesRealistas", cantidad: 2 }],
    subtotal_centavos: 201422
  });
  assert.strictEqual(r.opciones[0].envio_gratis, true, "el estándar debería ir gratis");
  assert.strictEqual(r.opciones[0].costo_centavos, 0);
  /* Regalar el express convierte una promoción en una fuga. */
  assert.strictEqual(r.opciones[1].envio_gratis, false, "el express NO debe regalarse");
  assert.ok(r.opciones[1].costo_centavos > 0);
});

await testAsync("por debajo del umbral se dice cuánto falta para el envío gratis", async () => {
  const r = await envios.cotizarEnvio({
    cp_destino: "64000",
    lineas: [{ sku: "ValEnd", cantidad: 1 }],
    subtotal_centavos: 40183
  });
  assert.strictEqual(r.falta_para_envio_gratis_centavos, 99900 - 40183);
});

await testAsync("sin paquetería conectada se declara que es estimación", async () => {
  const r = await envios.cotizarEnvio({ cp_destino: "64000", lineas: [] });
  assert.strictEqual(r.es_estimacion, true);
  assert.strictEqual(r.fuente, "referencia");
  assert.ok(/estimaci[oó]n/i.test(r.aviso_para_el_asesor),
    "el asesor debe recibir la advertencia de que es estimación");
});

await testAsync("la entrega siempre se presenta con texto legible por un humano", async () => {
  const r = await envios.cotizarEnvio({ cp_destino: "97000", lineas: [] });
  for (const o of r.opciones) {
    assert.ok(/^Llega/.test(o.texto), `texto poco claro: "${o.texto}"`);
    assert.ok(o.entrega_desde <= o.entrega_hasta);
    assert.ok(envios.esHabil(o.entrega_desde), "entrega en día inhábil");
    assert.ok(envios.esHabil(o.entrega_hasta), "entrega en día inhábil");
  }
});

// ══════════════════════════════════════════════════════════════════════
console.log("\n[PACK] Estimador de termoformado");
// ══════════════════════════════════════════════════════════════════════

test("sin medidas no inventa un número: pide los datos", () => {
  const r = estimarTermoformado({ tiraje: 500 });
  assert.strictEqual(r.ok, false);
  assert.ok(r.falta.includes("largo_cm"));
});

test("una pieza que no cabe en lámina se manda al especialista", () => {
  const r = estimarTermoformado({ largo_cm: 80, ancho_cm: 30 });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.requiere_especialista, true);
});

test("el unitario BAJA al subir el tiraje: es el argumento de venta", () => {
  const r = estimarTermoformado({ largo_cm: 12, ancho_cm: 8, tiraje: 500 });
  const esc = r.escalones_de_tiraje;
  for (let i = 1; i < esc.length; i++) {
    assert.ok(centavos(esc[i].unitario) <= centavos(esc[i - 1].unitario),
      `a ${esc[i].tiraje} piezas el unitario no bajó`);
  }
});

test("el total SUBE al subir el tiraje", () => {
  const r = estimarTermoformado({ largo_cm: 12, ancho_cm: 8, tiraje: 500 });
  const esc = r.escalones_de_tiraje;
  for (let i = 1; i < esc.length; i++) {
    assert.ok(centavos(esc[i].total) > centavos(esc[i - 1].total));
  }
});

test("base + tapa cuesta más que solo base", () => {
  const base = estimarTermoformado({ largo_cm: 12, ancho_cm: 8, tiraje: 500 });
  const juego = estimarTermoformado({ largo_cm: 12, ancho_cm: 8, tiraje: 500, con_tapa: true });
  assert.ok(juego.total_estimado.centro_centavos > base.total_estimado.centro_centavos);
});

test("con molde del cliente no se cobra molde", () => {
  const r = estimarTermoformado({ largo_cm: 12, ancho_cm: 8, tiraje: 500, molde_del_cliente: true });
  assert.strictEqual(r.desglose.molde_centavos, 0);
  assert.ok(/no se cobra/i.test(r.desglose.molde));
});

test("mayor complejidad encarece el molde", () => {
  const s = estimarTermoformado({ largo_cm: 12, ancho_cm: 8, tiraje: 500, complejidad: "simple" });
  const a = estimarTermoformado({ largo_cm: 12, ancho_cm: 8, tiraje: 500, complejidad: "alta" });
  assert.ok(a.desglose.molde_centavos > s.desglose.molde_centavos);
});

test("el material transparente se resuelve desde texto libre", () => {
  assert.strictEqual(estimarTermoformado({ largo_cm: 10, ancho_cm: 10, material: "transparente" }).material.transparente, true);
  assert.strictEqual(estimarTermoformado({ largo_cm: 10, ancho_cm: 10, material: "base blanca" }).material.transparente, false);
});

test("siempre se declara que es estimación y qué NO incluye", () => {
  const r = estimarTermoformado({ largo_cm: 12, ancho_cm: 8, tiraje: 500 });
  assert.strictEqual(r.es_estimacion, true);
  assert.ok(r.condiciones.some(c => /ESTIMACI[OÓ]N/i.test(c)));
  assert.ok(r.condiciones.some(c => /IVA/.test(c)));
});

test("el rango contiene al centro", () => {
  const r = estimarTermoformado({ largo_cm: 12, ancho_cm: 8, tiraje: 500 });
  const [bajo, alto] = r.total_estimado.rango.split("—").map(centavos);
  assert.ok(bajo < r.total_estimado.centro_centavos);
  assert.ok(alto > r.total_estimado.centro_centavos);
});

// ══════════════════════════════════════════════════════════════════════
console.log("\n[DENTAL OS] Cotización del software");
// ══════════════════════════════════════════════════════════════════════

test("un dentista paga exactamente el precio base publicado", () => {
  const r = cotizarDentalOs({ dentistas: 1 });
  const p = n => r.planes.find(x => x.plan === n);
  assert.strictEqual(centavos(p("Lista").total_mensual), 249900);
  assert.strictEqual(centavos(p("Early Adopter").total_mensual), 219900);
  assert.strictEqual(centavos(p("Founder").total_mensual), 199900);
});

test("cada dentista adicional suma el precio de asiento", () => {
  const r = cotizarDentalOs({ dentistas: 3 });
  const f = r.planes.find(x => x.plan === "Founder");
  assert.strictEqual(centavos(f.total_mensual), 199900 + 139900 * 2);
});

test("Founder siempre es más barato que Lista", () => {
  for (const n of [1, 2, 5, 10]) {
    const r = cotizarDentalOs({ dentistas: n });
    const lista = centavos(r.planes.find(x => x.plan === "Lista").total_mensual);
    const founder = centavos(r.planes.find(x => x.plan === "Founder").total_mensual);
    assert.ok(founder < lista, `con ${n} dentistas Founder no es más barato`);
  }
});

test("el anual es doce veces el mensual", () => {
  const r = cotizarDentalOs({ dentistas: 2 });
  for (const p of r.planes) {
    assert.strictEqual(centavos(p.total_anual), centavos(p.total_mensual) * 12);
  }
});

test("los mensajes incluidos crecen con los dentistas", () => {
  assert.ok(/1500/.test(cotizarDentalOs({ dentistas: 1 }).mensajes_incluidos));
  assert.ok(/3500/.test(cotizarDentalOs({ dentistas: 3 }).mensajes_incluidos));
});

test("un número absurdo de dentistas se acota en vez de explotar", () => {
  assert.strictEqual(cotizarDentalOs({ dentistas: 9999 }).dentistas, 50);
  assert.strictEqual(cotizarDentalOs({ dentistas: -5 }).dentistas, 1);
  assert.strictEqual(cotizarDentalOs({}).dentistas, 1);
});

test("prohíbe explícitamente decir 'precio de por vida'", () => {
  /* La promesa contractual es un descuento RELATIVO. Prometer un importe
     congelado crea una obligación que la empresa no puede sostener. */
  const r = cotizarDentalOs({ dentistas: 1 });
  assert.ok(/por vida/i.test(r.aviso_para_el_asesor));
  assert.ok(/registrar_interes/.test(r.siguiente_paso));
});

// ══════════════════════════════════════════════════════════════════════
console.log("\n[HERRAMIENTAS] Despachador");
// ══════════════════════════════════════════════════════════════════════

test("las nueve herramientas están declaradas para Gemini", () => {
  const nombres = TOOLS[0].functionDeclarations.map(d => d.name);
  for (const n of ["consultar_division", "buscar_productos", "listar_catalogo",
                   "calcular_cotizacion", "estimar_impresion_3d", "cotizar_envio",
                   "estimar_termoformado", "cotizar_dental_os", "registrar_interes"]) {
    assert.ok(nombres.includes(n), `falta la herramienta ${n}`);
  }
});

test("toda herramienta declarada tiene descripción y esquema", () => {
  for (const d of TOOLS[0].functionDeclarations) {
    assert.ok(d.description && d.description.length > 40, `${d.name}: descripción pobre`);
    assert.ok(d.parametersJsonSchema, `${d.name}: sin esquema de parámetros`);
  }
});

await testAsync("cotizar_envio usa el carrito real para el peso", async () => {
  const chico = await ejecutarHerramienta(
    { name: "cotizar_envio", args: { cp_destino: "64000" } },
    { carrito: [{ sku: "ValEnd", cantidad: 1 }] });
  const grande = await ejecutarHerramienta(
    { name: "cotizar_envio", args: { cp_destino: "64000" } },
    { carrito: [{ sku: "DientesRealistas", cantidad: 8 }] });
  assert.ok(grande.paquete.facturable_kg > chico.paquete.facturable_kg);
});

await testAsync("el envío gratis se decide con el catálogo, no con lo que diga el cliente", async () => {
  /* El carrito llega del navegador. Si el subtotal se tomara de ahí, cualquiera
     podría regalarse el envío desde la consola. */
  const r = await ejecutarHerramienta(
    { name: "cotizar_envio", args: { cp_destino: "64000" } },
    { carrito: [{ sku: "ValEnd", cantidad: 1, precio: 999999 }] });
  assert.strictEqual(r.opciones[0].envio_gratis, false,
    "un precio inventado por el cliente no debe activar el envío gratis");
});

await testAsync("una herramienta inexistente devuelve error, no una excepción", async () => {
  const r = await ejecutarHerramienta({ name: "borrar_todo", args: {} });
  assert.strictEqual(r.ok, false);
  assert.ok(/no existe/.test(r.error));
});

// ══════════════════════════════════════════════════════════════════════
console.log("\n[AVISOS] Política de interrupción");
// ══════════════════════════════════════════════════════════════════════

test("un pago aprobado interrumpe al momento", () => {
  avisos.avisar({ tipo: "pago_aprobado", folio: "VQ-T1", total_centavos: 120000 });
  const b = avisos.bitacora({ tipo: "pago_aprobado" });
  assert.strictEqual(b[0].folio, "VQ-T1");
  assert.strictEqual(avisos.metricas().pagos_aprobados, 1);
  assert.strictEqual(avisos.metricas().ingreso_centavos, 120000);
});

test("las visitas NO interrumpen: se acumulan para el resumen", () => {
  const antes = avisos.estadoAvisos();
  for (let i = 0; i < 5; i++) avisos.avisar({ tipo: "visita", pagina: "/dental/" });
  assert.strictEqual(avisos.metricas().visitas, 5);
  assert.ok(avisos.metricas().pendientes_de_resumen >= 5, "deberían estar en cola del resumen");
  assert.ok(antes);
});

test("un interés SIN contacto no interrumpe; CON contacto sí", () => {
  /* Un aviso sobre el que no puedes actuar es ruido con disfraz de información. */
  const sin = avisos.metricas().pendientes_de_resumen;
  avisos.avisar({ tipo: "lead", folio: "VQ-SC", division: "pack", contacto: null });
  assert.ok(avisos.metricas().pendientes_de_resumen > sin,
    "un lead sin contacto debería ir al resumen");
  avisos.avisar({ tipo: "lead", folio: "VQ-CC", division: "pack", contacto: "correo@x.com" });
  assert.strictEqual(avisos.bitacora({ tipo: "lead" })[0].folio, "VQ-CC");
});

test("una cotización chica espera al resumen y una grande interrumpe", () => {
  const cola = avisos.metricas().pendientes_de_resumen;
  avisos.avisar({ tipo: "cotizacion", total_centavos: 40000 });   // $400
  assert.ok(avisos.metricas().pendientes_de_resumen > cola);
  avisos.avisar({ tipo: "cotizacion", total_centavos: 300000 });  // $3,000
  assert.strictEqual(avisos.metricas().cotizaciones, 2);
});

test("avisar nunca lanza, ni con basura", () => {
  avisos.avisar({});
  avisos.avisar({ tipo: "desconocido", raro: { a: [1, 2] } });
  avisos.avisar(null);
  assert.ok(true);
});

test("la bitácora no crece sin límite", () => {
  for (let i = 0; i < 1200; i++) avisos.avisar({ tipo: "visita", pagina: "/" });
  assert.ok(avisos.bitacora({ limite: 5000 }).length <= 1000,
    "la bitácora debería estar acotada");
});

await testAsync("sin canales configurados, probar() lo dice claramente", async () => {
  const r = await avisos.probar();
  if (!avisos.estadoAvisos().hay_canal) {
    assert.strictEqual(r.ok, false);
    assert.ok(/TELEGRAM_BOT_TOKEN/.test(r.error), "debe decir qué configurar");
  }
});

await testAsync("el resumen bajo pedido se compone aunque no haya canal", async () => {
  const r = await avisos.resumenAhora();
  assert.ok(/Valquiria/.test(r.texto));
  assert.ok(/Visitas/.test(r.texto));
  assert.ok(/Panel/.test(r.texto), "el resumen debe llevar el enlace al panel");
});

// ══════════════════════════════════════════════════════════════════════
console.log("\n[INVENTARIO] Reserva y sobreventa");
// ══════════════════════════════════════════════════════════════════════

test("reservar aparta la mercancía y baja lo disponible", () => {
  inventario._reiniciar();
  const antes = inventario.disponible("ValEnd");
  assert.ok(antes > 0, "el catálogo debería tener stock de ValEnd");
  assert.strictEqual(inventario.reservar("F1", [{ sku: "ValEnd", cantidad: 3 }]).ok, true);
  assert.strictEqual(inventario.disponible("ValEnd"), antes - 3);
});

test("no se puede vender más de lo que hay: el segundo comprador se rechaza", () => {
  /* Este es el agujero que cerró el módulo: antes los dos recibían link de
     pago y el segundo se enteraba cuando no le llegaba nada.

     Ya no basta con una reserva para agotar un SKU —ese era otro agujero, y
     lo cierra el tope por compra—, así que el stock se consume con varias
     reservas dentro del tope hasta dejarlo en cero. */
  inventario._reiniciar();
  const hay = inventario.disponible("Endotnissin");
  const paso = inventario.MAX_POR_SKU;
  let puestas = 0;
  for (let quedan = hay, i = 0; quedan > 0; i++) {
    const n = Math.min(paso, quedan);
    assert.strictEqual(
      inventario.reservar("A" + i, [{ sku: "Endotnissin", cantidad: n }],
        { identidad: "ip-" + i }).ok,
      true
    );
    quedan -= n; puestas += n;
  }
  assert.strictEqual(puestas, hay);
  const segundo = inventario.reservar("B", [{ sku: "Endotnissin", cantidad: 1 }],
    { identidad: "otra-ip" });
  assert.strictEqual(segundo.ok, false);
  assert.strictEqual(segundo.faltantes[0].disponible, 0);
});

test("la reserva es atómica: si una línea no cabe, no se aparta ninguna", () => {
  /* Reservar a medias dejaría stock bloqueado por un pedido que no se puede
     surtir. */
  inventario._reiniciar();
  const antesEnd = inventario.disponible("ValEnd");
  const r = inventario.reservar("C", [
    { sku: "ValEnd", cantidad: 2 },
    { sku: "Endotnissin", cantidad: 99999 }
  ]);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(inventario.disponible("ValEnd"), antesEnd,
    "ValEnd quedó apartado pese a que el pedido entero se rechazó");
});

test("liberar devuelve la mercancía al mostrador", () => {
  inventario._reiniciar();
  const antes = inventario.disponible("ValPulpo");
  inventario.reservar("D", [{ sku: "ValPulpo", cantidad: 4 }]);
  assert.strictEqual(inventario.disponible("ValPulpo"), antes - 4);
  assert.strictEqual(inventario.liberar("D"), true);
  assert.strictEqual(inventario.disponible("ValPulpo"), antes);
});

test("confirmar convierte la reserva en venta y ya no se puede liberar", () => {
  inventario._reiniciar();
  const antes = inventario.disponible("ValPulpo");
  inventario.reservar("E", [{ sku: "ValPulpo", cantidad: 2 }]);
  assert.strictEqual(inventario.confirmar("E").ok, true);
  assert.strictEqual(inventario.liberar("E"), false, "una venta no se libera");
  assert.strictEqual(inventario.disponible("ValPulpo"), antes - 2);
});

test("reservar dos veces el mismo folio no descuenta doble", () => {
  /* Mercado Pago reintenta avisos; un folio repetido no puede comerse el
     inventario dos veces. */
  inventario._reiniciar();
  const antes = inventario.disponible("ValEnd");
  inventario.reservar("F", [{ sku: "ValEnd", cantidad: 2 }]);
  inventario.reservar("F", [{ sku: "ValEnd", cantidad: 2 }]);
  assert.strictEqual(inventario.disponible("ValEnd"), antes - 2);
});

test("un SKU inexistente no tiene disponibilidad", () => {
  assert.strictEqual(inventario.disponible("NoExiste"), 0);
});

test("la reserva es corta, y un pago tardío se registra igual y se marca", () => {
  /* La regla anterior era «la reserva dura al menos lo que el link». Sonaba
     prudente y salía carísima: ataba el inventario a la vigencia del link
     —1 440 minutos— y bastaba una petición para dejar un SKU en cero un día
     entero sin pagar nada.

     La regla nueva separa las dos cosas. La reserva es corta porque su
     trabajo es cubrir el rato que el comprador pasa en la pasarela; y el
     pago que llega tarde —SPEI, efectivo— no se pierde: `confirmar` lo
     registra desde las líneas del pedido y avisa de que la reserva ya había
     caducado, para comprobar el stock antes de prometer fecha. */
  assert.ok(inventario.MINUTOS_RESERVA <= 30,
    `la reserva volvió a durar ${inventario.MINUTOS_RESERVA} minutos`);

  inventario._reiniciar();
  const antes = inventario.disponible("ValPulpo");
  const tardio = inventario.confirmar("SIN-RESERVA", [{ sku: "ValPulpo", cantidad: 2 }]);
  assert.strictEqual(tardio.ok, true, "un pago tardío no descontó nada");
  assert.strictEqual(tardio.caducada, true, "no se avisó de la reserva caducada");
  assert.strictEqual(inventario.disponible("ValPulpo"), antes - 2);
  inventario._reiniciar();
});

// ══════════════════════════════════════════════════════════════════════
console.log("\n[IMPUESTOS] Desglose de IVA");
// ══════════════════════════════════════════════════════════════════════

test("el IVA se desglosa SIN alterar el total", () => {
  const r = calcularCotizacion([{ sku: "ValEnd", cantidad: 2 }]);
  if (!r.impuestos.incluido) return; // desactivado por configuración
  const base = centavos(r.impuestos.base);
  const iva = centavos(r.impuestos.iva);
  assert.strictEqual(base + iva, r._raw.total_centavos,
    "base + IVA debe dar exactamente el total cobrado");
});

test("el IVA del carrito y el del servidor usan la misma tasa", () => {
  const fs = require("fs");
  const app = fs.readFileSync("assets/js/app.js", "utf8");
  /* Anclado a inicio de línea con la indentación de una propiedad: el
     comentario de arriba de CFG menciona `ivaIncluido:false` como ejemplo, y
     una regex suelta lo lee a él en vez de al valor real. */
  const mTasa = app.match(/^ {2}ivaTasa:\s*(\d+)/m);
  const mOn = app.match(/^ {2}ivaIncluido:\s*(true|false)/m);
  assert.ok(mTasa && mOn, "app.js no declara ivaTasa/ivaIncluido");
  const tasaServidor = Math.round(parseFloat(process.env.IVA_TASA || "0.16") * 100);
  const onServidor = process.env.PRECIOS_LLEVAN_IVA !== "false";
  assert.strictEqual(parseInt(mTasa[1], 10), tasaServidor,
    "la tasa de IVA del carrito no coincide con la del servidor");
  assert.strictEqual(mOn[1] === "true", onServidor,
    "el carrito y el servidor no coinciden en si los precios llevan IVA");
});

// ══════════════════════════════════════════════════════════════════════
console.log("\n[ALMACÉN] Sobrevivir a un reinicio");
// ══════════════════════════════════════════════════════════════════════

test("sin ALMACEN_RUTA el módulo queda inerte y lo dice", () => {
  /* El valor por omisión no puede escribir en disco por sorpresa. */
  const almacen = require("./almacen.js");
  if (!almacen.ACTIVO) {
    assert.strictEqual(almacen.estadoAlmacen().activo, false);
    assert.ok(/se pierde al reiniciar/i.test(almacen.estadoAlmacen().nota),
      "debe advertir que el estado no sobrevive");
    assert.strictEqual(almacen.guardarYa(), false);
  }
});

test("guarda y restaura el estado tal cual", () => {
  /* Se carga una instancia aparte con su propia ruta para no depender de
     cómo esté configurado el entorno donde corren las pruebas. */
  const fs = require("fs"), os = require("os"), path = require("path");
  const ruta = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vq-")), "a.json");
  process.env.ALMACEN_RUTA = ruta;
  delete require.cache[require.resolve("./almacen.js")];
  const a = require("./almacen.js");

  let pedidos = [{ folio: "VQ-1", total_centavos: 12345 }];
  let recuperado = null;
  a.configurar({
    leer: { pedidos: () => pedidos },
    escribir: { pedidos: filas => { recuperado = filas; } }
  });

  assert.strictEqual(a.guardarYa(), true, "debería haber escrito el archivo");
  assert.ok(fs.existsSync(ruta));

  const r = a.restaurar();
  assert.strictEqual(r.restaurado, true);
  assert.deepStrictEqual(recuperado, pedidos, "lo restaurado no es lo guardado");

  delete process.env.ALMACEN_RUTA;
  delete require.cache[require.resolve("./almacen.js")];
});

test("un archivo corrupto NO impide arrancar", () => {
  /* Perder el mirador es recuperable; no poder vender, no. */
  const fs = require("fs"), os = require("os"), path = require("path");
  const ruta = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vq-")), "roto.json");
  fs.writeFileSync(ruta, '{"pedidos":[{"folio"');
  process.env.ALMACEN_RUTA = ruta;
  delete require.cache[require.resolve("./almacen.js")];
  const a = require("./almacen.js");
  a.configurar({ leer: { pedidos: () => [] }, escribir: { pedidos: () => {} } });

  const r = a.restaurar();
  assert.strictEqual(r.restaurado, false, "no debería dar por buena la basura");
  assert.ok(r.motivo, "debe explicar por qué no restauró");

  delete process.env.ALMACEN_RUTA;
  delete require.cache[require.resolve("./almacen.js")];
});

// ══════════════════════════════════════════════════════════════════════
console.log("\n[COHERENCIA] Una sola fuente de verdad");
// ══════════════════════════════════════════════════════════════════════

test("los precios de Dental OS de la web coinciden con los del Asesor", () => {
  /* Si la página dice $1,999 y el Asesor dice otra cosa, el cliente tiene
     razón en desconfiar de los dos. */
  const fs = require("fs");
  const html = fs.readFileSync("ia/index.html", "utf8");
  const r = cotizarDentalOs({ dentistas: 1 });
  for (const p of r.planes) {
    const importe = p.total_mensual.replace(" MXN", "");
    assert.ok(html.includes(importe),
      `la página /ia/ no muestra ${importe} (plan ${p.plan})`);
  }
});

test("el schema de Dental OS declara las tres ofertas con su precio", () => {
  const fs = require("fs");
  const html = fs.readFileSync("ia/index.html", "utf8");
  const bloques = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)];
  const grafo = bloques.flatMap(m => JSON.parse(m[1])["@graph"] || []);
  const app = grafo.find(n => n["@type"] === "SoftwareApplication");
  assert.ok(app, "falta el nodo SoftwareApplication de Dental OS");
  assert.strictEqual(app.offers.length, 3);
  for (const o of app.offers) {
    assert.ok(Number(o.price) > 0);
    assert.strictEqual(o.priceCurrency, "MXN");
  }
});

test("los documentos internos NO se publican en el sitio", () => {
  /* GitHub Pages sirve TODO lo que hay en la rama. Antes de _config.yml,
     https://valquiriainc.com/AUDITORIA.md respondía 200 a cualquiera: el
     inventario exacto de qué defensas están puestas y cuáles faltan.

     Esto depende de que Jekyll siga ACTIVO. Un `.nojekyll` en la raíz lo
     apaga, `exclude` deja de aplicarse y todo vuelve a ser público sin que
     nadie se entere. Por eso se comprueban las dos cosas. */
  const fs = require("fs");
  assert.ok(fs.existsSync("_config.yml"),
    "falta _config.yml: los documentos internos quedarían públicos");
  assert.ok(!fs.existsSync(".nojekyll"),
    "existe .nojekyll: apaga Jekyll y con él la exclusión de _config.yml, " +
    "así que PAGOS.md, SEGURIDAD.md y AUDITORIA.md vuelven a ser públicos");

  const cfg = fs.readFileSync("_config.yml", "utf8");
  /* Todo .md de la raíz debe estar excluido, y también el backend: publicar
     server.js regala la lógica de precios y los nombres de las variables. */
  const deben = fs.readdirSync(".")
    .filter(f => f.endsWith(".md"))
    .concat(["server.js", "conocimiento.js", "quote-engine.js", "productos.json",
             "envios.js", "notificaciones.js", "pagos.js", ".env.example"]);

  const faltan = deben.filter(f => !cfg.includes(`- ${f}`));
  assert.strictEqual(faltan.length, 0,
    `_config.yml no excluye: ${faltan.join(", ")} — serían públicos en valquiriainc.com`);
});

test("el CSP lleva el hash de cada script en línea (y no 'unsafe-inline')", () => {
  /* En cuanto hay hashes, el navegador IGNORA 'unsafe-inline'. Si alguien
     edita un script en línea y no regenera el hash, ese script deja de
     ejecutarse EN PRODUCCIÓN sin ningún error visible: la escena 3D
     simplemente no aparece. Esta prueba convierte ese olvido en una prueba
     roja. Se arregla con:  node scripts/csp-hashes.js --escribir */
  const fs = require("fs");
  const { hashesDe, PAGINAS, RAIZ } = require("./scripts/csp-hashes.js");
  const path = require("path");
  const rotas = [];

  for (const rel of PAGINAS) {
    const abs = path.join(RAIZ, rel);
    if (!fs.existsSync(abs)) continue;
    const html = fs.readFileSync(abs, "utf8");
    const csp = (html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/) || [])[1];
    if (!csp) continue;
    const scriptSrc = (csp.match(/script-src([^;]*)/) || [])[1];
    if (!scriptSrc) continue; // hereda default-src 'self': ya es estricto

    if (scriptSrc.includes("'unsafe-inline'")) rotas.push(`${rel}: 'unsafe-inline'`);
    for (const h of hashesDe(html)) {
      if (!scriptSrc.includes(h)) rotas.push(`${rel}: falta ${h}`);
    }
  }
  assert.strictEqual(rotas.length, 0,
    `CSP desactualizado → ${rotas.join(" | ")}\n      Arréglalo: node scripts/csp-hashes.js --escribir`);
});

test("el umbral de envío gratis es el mismo en los CINCO lugares donde vive", () => {
  /* El umbral está escrito en el motor de cotización, el de envíos, el
     carrito, la memoria del Asesor y dos frases de la home. No hay una forma
     barata de tener una sola copia sin añadir una petición al arranque de la
     página, así que la defensa es esta prueba: si alguien cambia uno y olvida
     los otros, `npm test` lo dice antes de que un cliente vea dos promesas
     distintas en la misma pantalla. */
  const fs = require("fs");
  const enElMotor = parseInt(process.env.ENVIO_GRATIS_DESDE_CENTAVOS || "99900", 10);
  const enPesos = (enElMotor / 100).toFixed(2);          // "999.00"
  const enPesosCorto = String(Math.round(enElMotor / 100)); // "999"

  const app = fs.readFileSync("assets/js/app.js", "utf8");
  const m = app.match(/envioGratisDesde:\s*(\d+)/);
  assert.ok(m, "no se encontró envioGratisDesde en app.js");
  assert.strictEqual(parseInt(m[1], 10), enElMotor,
    "el carrito usa un umbral distinto del motor");

  const cot = calcularCotizacion([{ sku: "ValEnd", cantidad: 1 }]);
  assert.ok(cot.envio.umbral_envio_gratis.includes(enPesos),
    `quote-engine anuncia ${cot.envio.umbral_envio_gratis}`);

  const conocimiento = fs.readFileSync("conocimiento.js", "utf8");
  assert.ok(conocimiento.includes(enPesosCorto),
    "conocimiento.js (lo que dice el Asesor) tiene otro umbral");

  const home = fs.readFileSync("index.html", "utf8");
  assert.ok(home.includes(`$${enPesosCorto}`),
    "la home promete un umbral distinto del que cobra el servidor");
});

// ══════════════════════════════════════════════════════════════════════
console.log("\n" + "═".repeat(62));
console.log(`  ${pasadas} pasadas · ${fallidas} fallidas`);
if (fallidas) {
  console.log("  Fallaron:\n" + fallos.map(f => `    · ${f}`).join("\n"));
}
console.log("═".repeat(62) + "\n");
process.exit(fallidas ? 1 : 0);

})();
