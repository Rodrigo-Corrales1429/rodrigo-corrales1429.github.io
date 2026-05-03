/**
 * Simula los function calls que haría Gemini, sin pegarle al API real.
 * Verifica que el dispatcher entregue las respuestas correctas.
 */

const { ejecutarHerramienta } = require("./gemini-tools.js");

let pasados = 0, fallados = 0;
function test(nombre, fn) {
  try {
    fn();
    console.log(`  ✓ ${nombre}`);
    pasados++;
  } catch (e) {
    console.log(`  ✗ ${nombre}\n      ${e.message}`);
    fallados++;
  }
}

console.log("\n[A] Dispatcher: buscar_productos");
test("Búsqueda 'endodoncia' devuelve resultados", () => {
  const r = ejecutarHerramienta({
    name: "buscar_productos",
    args: { query: "endodoncia" }
  });
  if (!r.ok) throw new Error("Esperaba ok=true");
  if (r.cantidad_resultados < 2) throw new Error("Esperaba al menos 2 resultados");
});

test("Búsqueda sin query devuelve error", () => {
  const r = ejecutarHerramienta({ name: "buscar_productos", args: {} });
  if (r.ok) throw new Error("Esperaba ok=false");
});

console.log("\n[B] Dispatcher: listar_catalogo");
test("Lista los 4 productos", () => {
  const r = ejecutarHerramienta({ name: "listar_catalogo", args: {} });
  if (!r.ok) throw new Error("Esperaba ok=true");
  if (r.cantidad_productos !== 4) throw new Error(`Esperaba 4, dio ${r.cantidad_productos}`);
});

console.log("\n[C] Dispatcher: calcular_cotizacion");
test("Cotización válida con upsell", () => {
  const r = ejecutarHerramienta({
    name: "calcular_cotizacion",
    args: { items: [{ sku: "ValPulpo", cantidad: 1 }, { sku: "ValEnd", cantidad: 1 }] }
  });
  if (!r.ok) throw new Error("Esperaba ok=true");
  if (r.subtotal !== "$845.84 MXN") throw new Error(`Subtotal: ${r.subtotal}`);
  if (r.envio.gratis) throw new Error("No debería tener envío gratis");
  if (!r.upsell) throw new Error("Debería haber upsell");
});

test("Cotización con SKU mal escrito por Gemini", () => {
  // Simulamos que Gemini se equivocó: "valend" en minúsculas
  const r = ejecutarHerramienta({
    name: "calcular_cotizacion",
    args: { items: [{ sku: "valend", cantidad: 1 }] }
  });
  if (r.ok) throw new Error("Esperaba ok=false por SKU inválido");
  if (!r.error.includes("valend")) throw new Error("El error debe mencionar el SKU malo");
});

test("Cotización con cantidad 'tres' (string) → rechazada", () => {
  const r = ejecutarHerramienta({
    name: "calcular_cotizacion",
    args: { items: [{ sku: "ValEnd", cantidad: "tres" }] }
  });
  if (r.ok) throw new Error("Esperaba ok=false");
});

test("Cotización envío gratis sin upsell", () => {
  const r = ejecutarHerramienta({
    name: "calcular_cotizacion",
    args: { items: [{ sku: "DientesRealistas", cantidad: 2 }] }
  });
  if (!r.ok) throw new Error("Esperaba ok=true");
  if (!r.envio.gratis) throw new Error("Debería ser envío gratis");
  if (r.upsell !== null) throw new Error("No debería haber upsell");
});

console.log("\n[D] Dispatcher: defensa contra inputs malos");
test("Función inexistente → error claro", () => {
  const r = ejecutarHerramienta({ name: "borrar_inventario", args: {} });
  if (r.ok) throw new Error("Esperaba ok=false");
  if (!r.error.includes("no existe")) throw new Error("Mensaje no es claro");
});

test("Args undefined no rompen el dispatcher", () => {
  const r = ejecutarHerramienta({ name: "calcular_cotizacion", args: undefined });
  if (r.ok) throw new Error("Esperaba ok=false");
  // No debería lanzar excepción
});

console.log(`\n========================================`);
console.log(`  Integración: ${pasados} pasados, ${fallados} fallados`);
console.log(`========================================\n`);
if (fallados > 0) process.exit(1);
