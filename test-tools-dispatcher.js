/**
 * Simula los function calls que haría Gemini, sin pegarle al API real.
 * Verifica que el dispatcher entregue las respuestas correctas.
 */

const { ejecutarHerramienta } = require("./gemini-tools.js");

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
