/**
 * Tests del motor de cotización v2.
 * Incluye los casos del usuario real: "endo", "nisin", "pulpo", "boca completa".
 */

const assert = require("assert");
const {
  calcularCotizacion,
  buscarProductos,
  listarCatalogo,
  centavosAPesos,
  validarYNormalizarItems,
  normalizarTexto,
  levenshtein
} = require("./quote-engine.js");

let pasados = 0;
let fallados = 0;

function test(nombre, fn) {
  try {
    fn();
    console.log(`  ✓ ${nombre}`);
    pasados++;
  } catch (e) {
    console.log(`  ✗ ${nombre}`);
    console.log(`      ${e.message}`);
    fallados++;
  }
}

// ============================================================================
console.log("\n[1] Formateo de centavos (sin cambios)");
// ============================================================================

test("0 centavos → $0.00 MXN", () => {
  assert.strictEqual(centavosAPesos(0), "$0.00 MXN");
});
test("44401 centavos → $444.01 MXN", () => {
  assert.strictEqual(centavosAPesos(44401), "$444.01 MXN");
});
test("100711 centavos → $1,007.11 MXN (separador de miles)", () => {
  assert.strictEqual(centavosAPesos(100711), "$1,007.11 MXN");
});
test("Cifras grandes con separadores", () => {
  assert.strictEqual(centavosAPesos(123456789), "$1,234,567.89 MXN");
});
test("Decimales con cero a la izquierda (5 centavos)", () => {
  assert.strictEqual(centavosAPesos(105), "$1.05 MXN");
});
test("Rechaza no-enteros", () => {
  assert.throws(() => centavosAPesos(100.5));
});

// ============================================================================
console.log("\n[2] Helpers de búsqueda (nuevos)");
// ============================================================================

test("normalizarTexto quita acentos", () => {
  assert.strictEqual(normalizarTexto("Pediatría"), "pediatria");
});
test("normalizarTexto convierte a minúsculas y limpia signos", () => {
  assert.strictEqual(normalizarTexto("¿Endodoncia?"), "endodoncia");
});
test("levenshtein 'nisin' vs 'nissin' = 1", () => {
  assert.strictEqual(levenshtein("nisin", "nissin"), 1);
});
test("levenshtein 'endo' vs 'endodoncia' > 1 (no es typo, es prefijo)", () => {
  assert.ok(levenshtein("endo", "endodoncia") > 1);
});
test("levenshtein iguales = 0", () => {
  assert.strictEqual(levenshtein("hola", "hola"), 0);
});

// ============================================================================
console.log("\n[3] Validación de input (sin cambios)");
// ============================================================================

test("Rechaza items no-array", () => {
  const r = calcularCotizacion("no soy array");
  assert.strictEqual(r.ok, false);
});
test("Rechaza array vacío", () => {
  assert.strictEqual(calcularCotizacion([]).ok, false);
});
test("Rechaza cantidad negativa", () => {
  assert.strictEqual(calcularCotizacion([{ sku: "ValEnd", cantidad: -1 }]).ok, false);
});
test("Rechaza cantidad cero", () => {
  assert.strictEqual(calcularCotizacion([{ sku: "ValEnd", cantidad: 0 }]).ok, false);
});
test("Rechaza cantidad decimal", () => {
  assert.strictEqual(calcularCotizacion([{ sku: "ValEnd", cantidad: 1.5 }]).ok, false);
});
test("Rechaza cantidad string no-numérica", () => {
  assert.strictEqual(calcularCotizacion([{ sku: "ValEnd", cantidad: "muchos" }]).ok, false);
});
test("Acepta cantidad como string numérico", () => {
  const r = calcularCotizacion([{ sku: "ValEnd", cantidad: "2" }]);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.lineas[0].cantidad, 2);
});
test("Rechaza cantidad absurda", () => {
  assert.strictEqual(calcularCotizacion([{ sku: "ValEnd", cantidad: 999999 }]).ok, false);
});
test("Rechaza SKU inexistente", () => {
  const r = calcularCotizacion([{ sku: "NoExiste123", cantidad: 1 }]);
  assert.strictEqual(r.ok, false);
  assert.ok(r.skus_invalidos.includes("NoExiste123"));
});

// ============================================================================
console.log("\n[4] Consolidación de duplicados");
// ============================================================================

test("Consolida 2 entradas del mismo SKU", () => {
  const r = calcularCotizacion([
    { sku: "ValEnd", cantidad: 2 },
    { sku: "ValEnd", cantidad: 3 }
  ]);
  assert.strictEqual(r.lineas.length, 1);
  assert.strictEqual(r.lineas[0].cantidad, 5);
});

// ============================================================================
console.log("\n[5] Matemática crítica (sin cambios desde v1)");
// ============================================================================

test("ValPulpo + ValEnd = $845.84 EXACTO", () => {
  const r = calcularCotizacion([
    { sku: "ValPulpo", cantidad: 1 },
    { sku: "ValEnd", cantidad: 1 }
  ]);
  assert.strictEqual(r._raw.subtotal_centavos, 84584);
  assert.strictEqual(r.subtotal, "$845.84 MXN");
});

test("10× ValEnd = $4,018.30 sin error de flotante acumulado", () => {
  const r = calcularCotizacion([{ sku: "ValEnd", cantidad: 10 }]);
  assert.strictEqual(r._raw.subtotal_centavos, 401830);
  assert.strictEqual(r.subtotal, "$4,018.30 MXN");
});

// ============================================================================
console.log("\n[6] Regla de envío (sin cambios)");
// ============================================================================

test("Subtotal $845.84 → cobra $150 envío", () => {
  const r = calcularCotizacion([
    { sku: "ValPulpo", cantidad: 1 },
    { sku: "ValEnd", cantidad: 1 }
  ]);
  assert.strictEqual(r.envio.gratis, false);
  assert.strictEqual(r.total, "$995.84 MXN");
});

test("DientesRealistas (1007.11) → envío gratis", () => {
  const r = calcularCotizacion([{ sku: "DientesRealistas", cantidad: 1 }]);
  assert.strictEqual(r.envio.gratis, true);
  assert.strictEqual(r.total, "$1,007.11 MXN");
});

// ============================================================================
console.log("\n[7] Búsqueda INTELIGENTE — casos del usuario real");
// ============================================================================

test("'hola que tienen de endo' encuentra productos de endodoncia", () => {
  const r = buscarProductos("hola que tienen de endo");
  assert.strictEqual(r.ok, true);
  assert.ok(r.cantidad_resultados > 0, "Debe haber resultados");
  assert.strictEqual(r.coincidencia_exacta, true);
  assert.ok(
    r.resultados.some(p => p.sku === "ValEnd"),
    "Debe incluir ValEnd"
  );
});

test("'pulpo' encuentra ValPulpo (palabra parcial)", () => {
  const r = buscarProductos("pulpo");
  assert.ok(r.resultados.some(p => p.sku === "ValPulpo"), "Debe incluir ValPulpo");
});

test("'pulpotomi' encuentra ValPulpo (palabra parcial)", () => {
  const r = buscarProductos("pulpotomi");
  assert.ok(r.resultados.some(p => p.sku === "ValPulpo"));
});

test("'nisin' encuentra Endotnissin (typo: falta una s)", () => {
  const r = buscarProductos("nisin");
  assert.ok(r.resultados.some(p => p.sku === "Endotnissin"),
    "Debe encontrar Endotnissin con typo nisin");
});

test("'nicin' encuentra Endotnissin (typo más feo)", () => {
  const r = buscarProductos("nicin");
  assert.ok(r.resultados.some(p => p.sku === "Endotnissin"),
    "Debe encontrar Endotnissin con typo nicin");
});

test("'tipodonto' encuentra Endotnissin", () => {
  const r = buscarProductos("tipodonto");
  assert.ok(r.resultados.some(p => p.sku === "Endotnissin"));
});

test("'boca completa' encuentra DientesRealistas", () => {
  const r = buscarProductos("boca completa");
  assert.ok(r.resultados.some(p => p.sku === "DientesRealistas"),
    "Boca completa debería encontrar el kit de 32");
});

test("'boca completa endo' encuentra DientesRealistas (ranking #1)", () => {
  const r = buscarProductos("boca completa endo");
  assert.strictEqual(r.resultados[0].sku, "DientesRealistas");
});

test("'32 dientes' encuentra DientesRealistas", () => {
  const r = buscarProductos("32 dientes");
  assert.ok(r.resultados.some(p => p.sku === "DientesRealistas"));
});

test("'pediatria' (sin acento) encuentra ValPulpo", () => {
  const r = buscarProductos("pediatria");
  assert.ok(r.resultados.some(p => p.sku === "ValPulpo"));
});

test("'pediatría' (con acento) encuentra ValPulpo", () => {
  const r = buscarProductos("pediatría");
  assert.ok(r.resultados.some(p => p.sku === "ValPulpo"));
});

test("'odontopediatria' encuentra ValPulpo", () => {
  const r = buscarProductos("odontopediatria");
  assert.ok(r.resultados.some(p => p.sku === "ValPulpo"));
});

test("'molar' encuentra DientesRealistas", () => {
  const r = buscarProductos("molar");
  assert.ok(r.resultados.some(p => p.sku === "DientesRealistas"));
});

// ============================================================================
console.log("\n[8] Búsqueda — fallback cuando query es solo stop-words");
// ============================================================================

test("'hola' solo → devuelve catálogo (no se rinde)", () => {
  const r = buscarProductos("hola");
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.coincidencia_exacta, false);
  assert.ok(r.resultados.length > 0);
  assert.ok(r.mensaje_para_asesor !== undefined);
});

test("'hola buenas tardes' solo → devuelve catálogo", () => {
  const r = buscarProductos("hola buenas tardes");
  assert.strictEqual(r.ok, true);
  assert.ok(r.resultados.length > 0);
});

test("'que tienen' solo stop-words → devuelve catálogo", () => {
  const r = buscarProductos("que tienen");
  assert.strictEqual(r.ok, true);
  assert.ok(r.resultados.length > 0);
});

// ============================================================================
console.log("\n[9] Búsqueda — fallback cuando query no matchea nada");
// ============================================================================

test("'xyzzyzzyz' (sin matches) → devuelve top productos", () => {
  const r = buscarProductos("xyzzyzzyz");
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.coincidencia_exacta, false);
  assert.ok(r.resultados.length > 0,
    "Debe devolver productos aunque no haya match");
});

// ============================================================================
console.log("\n[10] Validación de stock");
// ============================================================================

test("Cantidad mayor al stock → ok=false con detalle", () => {
  const r = calcularCotizacion([{ sku: "Endotnissin", cantidad: 50 }]);
  assert.strictEqual(r.ok, false);
  assert.ok(Array.isArray(r.sin_stock));
});

// ============================================================================
console.log("\n[11] Listar catálogo");
// ============================================================================

test("listarCatalogo devuelve los 4 productos activos", () => {
  const r = listarCatalogo();
  assert.strictEqual(r.cantidad_productos, 4);
});

// ============================================================================
console.log("\n[12] Mayoreo");
// ============================================================================

test("20× ValEnd + 5× DientesRealistas = matemática exacta", () => {
  const r = calcularCotizacion([
    { sku: "ValEnd", cantidad: 20 },
    { sku: "DientesRealistas", cantidad: 5 }
  ]);
  assert.strictEqual(r._raw.subtotal_centavos, 803660 + 503555);
  assert.strictEqual(r.subtotal, "$13,072.15 MXN");
  assert.strictEqual(r.envio.gratis, true);
});

// ============================================================================
console.log(`\n========================================`);
console.log(`  Pasados: ${pasados}`);
console.log(`  Fallados: ${fallados}`);
console.log(`========================================\n`);

if (fallados > 0) process.exit(1);
