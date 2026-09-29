/**
 * Simula los function calls que haría Gemini, sin pegarle al API real.
 * Verifica que el dispatcher entregue las respuestas correctas.
 */

const { TOOLS, ejecutarHerramienta } = require("./gemini-tools.js");

let pasados = 0, fallados = 0;

/* `ejecutarHerramienta` es asíncrona desde que cotizar_envio puede salir a la
   API de la paquetería. Sin await, cada prueba comprobaba `.ok` sobre una
   promesa —siempre undefined— y pasaba o fallaba por la razón equivocada. */
async function test(nombre, fn) {
  try {
    await fn();
    console.log(`  ✓ ${nombre}`);
    pasados++;
  } catch (e) {
    console.log(`  ✗ ${nombre}\n      ${e.message}`);
    fallados++;
  }
}

(async () => {

console.log("\n[A] Dispatcher: buscar_productos");
await test("Búsqueda 'endodoncia' devuelve resultados", async () => {
  const r = await ejecutarHerramienta({
    name: "buscar_productos",
    args: { query: "endodoncia" }
  });
  if (!r.ok) throw new Error("Esperaba ok=true");
  if (r.cantidad_resultados < 2) throw new Error("Esperaba al menos 2 resultados");
});

await test("Búsqueda sin query devuelve error", async () => {
  const r = await ejecutarHerramienta({ name: "buscar_productos", args: {} });
  if (r.ok) throw new Error("Esperaba ok=false");
});

console.log("\n[B] Dispatcher: listar_catalogo");
await test("Lista los 4 productos", async () => {
  const r = await ejecutarHerramienta({ name: "listar_catalogo", args: {} });
  if (!r.ok) throw new Error("Esperaba ok=true");
  if (r.cantidad_productos !== 4) throw new Error(`Esperaba 4, dio ${r.cantidad_productos}`);
});

console.log("\n[C] Dispatcher: calcular_cotizacion");
await test("Schema distingue vaciar, quitar y acciones con cantidad obligatoria", async () => {
  const declaracion = TOOLS[0].functionDeclarations
    .find(d => d.name === "calcular_cotizacion");
  const schema = declaracion && declaracion.parametersJsonSchema;
  if (!schema || !Array.isArray(schema.anyOf)) {
    throw new Error("El schema no expresa contratos condicionales por acción");
  }
  if ((schema.required || []).includes("items")) {
    throw new Error("items sigue siendo obligatorio globalmente");
  }

  const rama = accion => schema.anyOf.find(r =>
    r.properties?.accion?.enum?.includes(accion));
  const vaciar = rama("vaciar");
  if (!vaciar || (vaciar.required || []).includes("items")) {
    throw new Error("vaciar sigue exigiendo items");
  }
  if (vaciar.properties?.items?.maxItems !== 0) {
    throw new Error("vaciar permite items que luego ignoraría");
  }

  const quitar = rama("quitar");
  if (!quitar || !(quitar.required || []).includes("items")) {
    throw new Error("quitar debe exigir al menos la lista de productos");
  }
  if ((quitar.properties?.items?.items?.required || []).includes("cantidad")) {
    throw new Error("quitar sigue exigiendo cantidad en cada item");
  }

  for (const accion of ["reemplazar", "agregar", "fijar"]) {
    const estricta = rama(accion);
    if (!estricta ||
        !(estricta.properties?.items?.items?.required || []).includes("cantidad")) {
      throw new Error(`${accion} dejó de exigir cantidad`);
    }
    const maximo = estricta.properties?.items?.items?.properties?.cantidad?.maximum;
    if (!Number.isInteger(maximo) || maximo <= 0) {
      throw new Error(`${accion} no declara un máximo transaccional válido`);
    }
  }
});

await test("Cotización válida con upsell", async () => {
  const r = await ejecutarHerramienta({
    name: "calcular_cotizacion",
    args: { items: [{ sku: "ValPulpo", cantidad: 1 }, { sku: "ValEnd", cantidad: 1 }] }
  });
  if (!r.ok) throw new Error("Esperaba ok=true");
  if (r.subtotal !== "$845.84 MXN") throw new Error(`Subtotal: ${r.subtotal}`);
  if (r.envio.gratis) throw new Error("No debería tener envío gratis");
  if (!r.upsell) throw new Error("Debería haber upsell");
});

/* Esta prueba afirmaba lo contrario hasta que el resolvedor entró en juego:
   antes, un SKU con las mayúsculas cambiadas era un error que el usuario
   acababa pagando con una pregunta de más. Ahora se resuelve, y lo que hay
   que garantizar es que se resuelva al producto CORRECTO —no que falle—. */
await test("SKU mal escrito por Gemini se resuelve al producto correcto", async () => {
  const r = await ejecutarHerramienta({
    name: "calcular_cotizacion",
    args: { items: [{ sku: "valend", cantidad: 1 }] }
  });
  if (!r.ok) throw new Error(`Esperaba que se resolviera: ${r.error}`);
  if (r.carrito_final.length !== 1 || r.carrito_final[0].sku !== "ValEnd") {
    throw new Error(`Esperaba ValEnd, hubo ${JSON.stringify(r.carrito_final)}`);
  }
});

await test("Un nombre que no existe en el catálogo sí falla", async () => {
  const r = await ejecutarHerramienta({
    name: "calcular_cotizacion",
    args: { items: [{ sku: "zzzqwerty", cantidad: 1 }] }
  });
  if (r.ok) throw new Error("Esperaba ok=false: no hay producto que se le parezca");
});

await test("Cotización con cantidad 'tres' (string) → rechazada", async () => {
  const r = await ejecutarHerramienta({
    name: "calcular_cotizacion",
    args: { items: [{ sku: "ValEnd", cantidad: "tres" }] }
  });
  if (r.ok) throw new Error("Esperaba ok=false");
});

await test("Cotización envío gratis sin upsell", async () => {
  const r = await ejecutarHerramienta({
    name: "calcular_cotizacion",
    args: { items: [{ sku: "DientesRealistas", cantidad: 2 }] }
  });
  if (!r.ok) throw new Error("Esperaba ok=true");
  if (!r.envio.gratis) throw new Error("Debería ser envío gratis");
  if (r.upsell !== null) throw new Error("No debería haber upsell");
});

await test("Vaciar sin items o con items vacío devuelve estado final vacío", async () => {
  for (const [carrito, args] of [
    [[{ sku: "ValEnd", cantidad: 2 }, { sku: "ValPulpo", cantidad: 1 }],
      { accion: "vaciar" }],
    [[], { accion: "vaciar" }],
    [[{ sku: "ValEnd", cantidad: 2 }], { accion: "vaciar", items: [] }]
  ]) {
    const r = await ejecutarHerramienta({
      name: "calcular_cotizacion",
      args
    }, { carrito });
    if (!r.ok || !r.carrito_vacio || !Array.isArray(r.carrito_final) || r.carrito_final.length) {
      throw new Error(`Estado incoherente: ${JSON.stringify(r)}`);
    }
    if (r.productos || r.resultados) {
      throw new Error("Vaciar devolvió productos o catálogo");
    }
  }
});

await test("Quitar sin cantidad elimina la línea y con cantidad resta parcialmente", async () => {
  const carrito = [{ sku: "ValEnd", cantidad: 3 }, { sku: "ValPulpo", cantidad: 1 }];
  const completa = await ejecutarHerramienta({
    name: "calcular_cotizacion",
    args: { accion: "quitar", items: [{ producto: "pulpo" }] }
  }, { carrito });
  if (!completa.ok || completa.carrito_final.some(i => i.sku === "ValPulpo")) {
    throw new Error(`No retiró la línea completa: ${JSON.stringify(completa.carrito_final)}`);
  }

  const parcial = await ejecutarHerramienta({
    name: "calcular_cotizacion",
    args: { accion: "quitar", items: [{ producto: "endo", cantidad: 2 }] }
  }, { carrito });
  const endo = parcial.carrito_final?.find(i => i.sku === "ValEnd");
  if (!parcial.ok || endo?.cantidad !== 1) {
    throw new Error(`No restó únicamente 2: ${JSON.stringify(parcial.carrito_final)}`);
  }
});

await test("Agregar, reemplazar y fijar rechazan items sin cantidad", async () => {
  for (const accion of ["agregar", "reemplazar", "fijar"]) {
    const r = await ejecutarHerramienta({
      name: "calcular_cotizacion",
      args: { accion, items: [{ producto: "endo" }] }
    }, { carrito: [{ sku: "ValPulpo", cantidad: 1 }] });
    if (r.ok || !/cantidad/i.test(r.error || "")) {
      throw new Error(`${accion} aceptó cantidad ausente: ${JSON.stringify(r)}`);
    }
  }
});

await test("Acciones explícitas inválidas se rechazan sin estado adoptable", async () => {
  const invalidas = ["eliminar", "añadir", "", null, 7, { tipo: "agregar" }];
  for (const accion of invalidas) {
    const carrito = [{ sku: "ValEnd", cantidad: 2 }, { sku: "ValPulpo", cantidad: 1 }];
    const antes = JSON.stringify(carrito);
    const r = await ejecutarHerramienta({
      name: "calcular_cotizacion",
      args: { accion, items: [{ producto: "nissin", cantidad: 2 }] }
    }, { carrito });
    if (r.ok || Object.prototype.hasOwnProperty.call(r, "carrito_final")) {
      throw new Error(`Acción inválida produjo estado adoptable: ${JSON.stringify(r)}`);
    }
    if (JSON.stringify(carrito) !== antes) {
      throw new Error(`La acción inválida mutó el carrito de entrada: ${JSON.stringify(accion)}`);
    }
  }
});

await test("Acción omitida conserva reemplazar por compatibilidad", async () => {
  const r = await ejecutarHerramienta({
    name: "calcular_cotizacion",
    args: { items: [{ producto: "endo", cantidad: 1 }] }
  }, { carrito: [{ sku: "ValPulpo", cantidad: 1 }] });
  if (!r.ok || r.accion !== "reemplazar" ||
      r.carrito_final?.length !== 1 || r.carrito_final[0].sku !== "ValEnd") {
    throw new Error(`No conservó el reemplazo histórico: ${JSON.stringify(r)}`);
  }
});

await test("Cantidad transaccional exige number entero, finito y dentro del máximo", async () => {
  for (const accion of ["agregar", "reemplazar", "fijar", "quitar"]) {
    for (const cantidad of ["2", true, [3], null, Infinity, 201]) {
      const r = await ejecutarHerramienta({
        name: "calcular_cotizacion",
        args: { accion, items: [{ producto: "endo", cantidad }] }
      }, { carrito: [{ sku: "ValPulpo", cantidad: 1 }] });
      if (r.ok || Object.prototype.hasOwnProperty.call(r, "carrito_final")) {
        throw new Error(
          `${accion} aceptó cantidad inválida ${JSON.stringify(cantidad)}: ${JSON.stringify(r)}`
        );
      }
    }
  }

  const valida = await ejecutarHerramienta({
    name: "calcular_cotizacion",
    args: { accion: "agregar", items: [{ producto: "endo", cantidad: 2 }] }
  }, { carrito: [{ sku: "ValPulpo", cantidad: 1 }] });
  if (!valida.ok || valida.carrito_final?.find(i => i.sku === "ValEnd")?.cantidad !== 2) {
    throw new Error(`Rechazó cantidad JSON numérica válida: ${JSON.stringify(valida)}`);
  }
});

await test("Quitar un producto ausente informa idempotencia sin efecto", async () => {
  const carrito = [{ sku: "ValEnd", cantidad: 2 }];
  const r = await ejecutarHerramienta({
    name: "calcular_cotizacion",
    args: { accion: "quitar", items: [{ producto: "nissin" }] }
  }, { carrito });
  if (!r.ok || r.changed !== false || r.sin_efecto !== true) {
    throw new Error(`Falta señal inequívoca de no-efecto: ${JSON.stringify(r)}`);
  }
  if (!/no estaba|no estaban|no se elimin/i.test(r.mensaje_para_asesor || "")) {
    throw new Error(`Mensaje engañoso o ausente: ${JSON.stringify(r)}`);
  }
  if (JSON.stringify(r.carrito_final) !== JSON.stringify(carrito)) {
    throw new Error(`El carrito cambió: ${JSON.stringify(r.carrito_final)}`);
  }
});

await test("Vaciar con items se rechaza sin perder una segunda intención", async () => {
  const carrito = [{ sku: "ValEnd", cantidad: 2 }];
  const r = await ejecutarHerramienta({
    name: "calcular_cotizacion",
    args: { accion: "vaciar", items: [{ producto: "nissin", cantidad: 2 }] }
  }, { carrito });
  if (r.ok || Object.prototype.hasOwnProperty.call(r, "carrito_final")) {
    throw new Error(`Vaciar con items produjo estado adoptable: ${JSON.stringify(r)}`);
  }
  if (!/por separado|operaci[oó]n adecuada|reemplazar/i.test(r.error || "")) {
    throw new Error(`El error puede descartar la segunda intención: ${JSON.stringify(r)}`);
  }
  if (JSON.stringify(carrito) !== JSON.stringify([{ sku: "ValEnd", cantidad: 2 }])) {
    throw new Error("El rechazo mutó el carrito de entrada");
  }
});

await test("Cobertura preparatoria de primitivas para G-03", async () => {
  const ctx = { carrito: [{ sku: "ValEnd", cantidad: 2 }, { sku: "ValPulpo", cantidad: 1 }] };
  const quitar = await ejecutarHerramienta({
    name: "calcular_cotizacion",
    args: { accion: "quitar", items: [{ producto: "endo" }] }
  }, ctx);
  if (!quitar.ok) throw new Error(quitar.error);
  ctx.carrito = quitar.carrito_final;
  const agregar = await ejecutarHerramienta({
    name: "calcular_cotizacion",
    args: { accion: "agregar", items: [{ producto: "nissin", cantidad: 2 }] }
  }, ctx);
  const final = (agregar.carrito_final || [])
    .map(i => `${i.sku}:${i.cantidad}`).sort().join(" ");
  if (!agregar.ok || final !== "Endotnissin:2 ValPulpo:1") {
    throw new Error(`Estado final inesperado: ${final}`);
  }
});

console.log("\n[D] Dispatcher: defensa contra inputs malos");
await test("Función inexistente → error claro", async () => {
  const r = await ejecutarHerramienta({ name: "borrar_inventario", args: {} });
  if (r.ok) throw new Error("Esperaba ok=false");
  if (!r.error.includes("no existe")) throw new Error("Mensaje no es claro");
});

await test("Args undefined no rompen el dispatcher", async () => {
  const r = await ejecutarHerramienta({ name: "calcular_cotizacion", args: undefined });
  if (r.ok) throw new Error("Esperaba ok=false");
  // No debería lanzar excepción
});

console.log(`\n========================================`);
console.log(`  Integración: ${pasados} pasados, ${fallados} fallados`);
console.log(`========================================\n`);
if (fallados > 0) process.exit(1);

})();
