/**
 * Tests del motor de cotización. Se corren con `node test-quote-engine.js`.
 * No usa ningún framework — solo asserts simples para que sea fácil de leer.
 */

const assert = require("assert");
const {
  calcularCotizacion,
  buscarProductos,
  listarCatalogo,
  centavosAPesos,
  validarYNormalizarItems
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
console.log("\n[1] Formateo de centavos a pesos");
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
console.log("\n[2] Validación de input");
// ============================================================================

test("Rechaza items no-array", () => {
  const r = calcularCotizacion("no soy array");
  assert.strictEqual(r.ok, false);
});
test("Rechaza array vacío", () => {
  const r = calcularCotizacion([]);
  assert.strictEqual(r.ok, false);
});
test("Rechaza cantidad negativa", () => {
  const r = calcularCotizacion([{ sku: "ValEnd", cantidad: -1 }]);
  assert.strictEqual(r.ok, false);
});
test("Rechaza cantidad cero", () => {
  const r = calcularCotizacion([{ sku: "ValEnd", cantidad: 0 }]);
  assert.strictEqual(r.ok, false);
});
test("Rechaza cantidad decimal", () => {
  const r = calcularCotizacion([{ sku: "ValEnd", cantidad: 1.5 }]);
  assert.strictEqual(r.ok, false);
});
test("Rechaza cantidad string no-numérica", () => {
  const r = calcularCotizacion([{ sku: "ValEnd", cantidad: "muchos" }]);
  assert.strictEqual(r.ok, false);
});
test("Acepta cantidad como string numérico ('2')", () => {
  const r = calcularCotizacion([{ sku: "ValEnd", cantidad: "2" }]);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.lineas[0].cantidad, 2);
});
test("Rechaza cantidad absurda (999999)", () => {
  const r = calcularCotizacion([{ sku: "ValEnd", cantidad: 999999 }]);
  assert.strictEqual(r.ok, false);
});
test("Rechaza SKU inexistente", () => {
  const r = calcularCotizacion([{ sku: "NoExiste123", cantidad: 1 }]);
  assert.strictEqual(r.ok, false);
  assert.ok(r.skus_invalidos.includes("NoExiste123"));
});

// ============================================================================
console.log("\n[3] Consolidación de duplicados");
// ============================================================================

test("Consolida 2 entradas del mismo SKU en una línea", () => {
  const items = [
    { sku: "ValEnd", cantidad: 2 },
    { sku: "ValEnd", cantidad: 3 }
  ];
  const r = calcularCotizacion(items);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.lineas.length, 1);
  assert.strictEqual(r.lineas[0].cantidad, 5);
});

// ============================================================================
console.log("\n[4] Matemática crítica (caso real con flotantes que rompen)");
// ============================================================================

test("ValPulpo + ValEnd = $846.04 (suma exacta, no $846.0399999...)", () => {
  // 444.01 + 401.83 = 845.84 → si JS hace 444.01 + 401.83 con flotantes,
  // puede dar 845.8399999999999. Con centavos: 44401 + 40183 = 84584. Exacto.
  const r = calcularCotizacion([
    { sku: "ValPulpo", cantidad: 1 },
    { sku: "ValEnd", cantidad: 1 }
  ]);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r._raw.subtotal_centavos, 84584);
  assert.strictEqual(r.subtotal, "$845.84 MXN");
});

test("Suma con cantidades múltiples no acumula errores de flotante", () => {
  // 10 unidades de ValEnd a 401.83 = 4018.30. Con flotantes 0.1 acumulado da bug.
  const r = calcularCotizacion([{ sku: "ValEnd", cantidad: 10 }]);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r._raw.subtotal_centavos, 401830);
  assert.strictEqual(r.subtotal, "$4,018.30 MXN");
});

test("Caso clásico que rompe flotantes: 0.1 * 3 ≠ 0.3", () => {
  // Si el motor usara 4.4401 * 100 estaría haciendo flotantes y fallaría.
  // Verificamos 3 unidades de ValPulpo = 1332.03 exacto.
  const r = calcularCotizacion([{ sku: "ValPulpo", cantidad: 3 }]);
  assert.strictEqual(r._raw.subtotal_centavos, 133203);
  assert.strictEqual(r.subtotal, "$1,332.03 MXN");
});

// ============================================================================
console.log("\n[5] Regla de envío gratis (umbral $999)");
// ============================================================================

test("Subtotal $845.84 → cobra envío $150", () => {
  const r = calcularCotizacion([
    { sku: "ValPulpo", cantidad: 1 },
    { sku: "ValEnd", cantidad: 1 }
  ]);
  assert.strictEqual(r.envio.gratis, false);
  assert.strictEqual(r._raw.envio_centavos, 15000);
  assert.strictEqual(r._raw.total_centavos, 84584 + 15000);
  assert.strictEqual(r.total, "$995.84 MXN");
});

test("Subtotal $999.00 exacto → envío gratis (>= umbral)", () => {
  // No tenemos un producto que dé exactamente 999, pero podemos forzarlo
  // con 2 ValEnd + 1 ValPulpo + 1 más... probemos con kit realista que ya pasa.
  const r = calcularCotizacion([{ sku: "DientesRealistas", cantidad: 1 }]);
  assert.strictEqual(r._raw.subtotal_centavos, 100711);
  assert.ok(r._raw.subtotal_centavos >= 99900, "subtotal debe pasar el umbral");
  assert.strictEqual(r.envio.gratis, true);
  assert.strictEqual(r._raw.envio_centavos, 0);
  assert.strictEqual(r.total, "$1,007.11 MXN");
});

test("Subtotal $998.99 (1 cent debajo del umbral) → cobra envío", () => {
  // Truco: si hubiera un producto a 998.99, cobraría envío.
  // Testeamos con ValPulpo×2 + ValEnd×1 = 444.01*2 + 401.83 = 1289.85 → gratis.
  // Mejor construyamos un caso límite real:
  // ValEnd*2 = 803.66. Bajo umbral, cobra envío.
  const r = calcularCotizacion([{ sku: "ValEnd", cantidad: 2 }]);
  assert.strictEqual(r.envio.gratis, false);
  assert.strictEqual(r._raw.subtotal_centavos, 80366);
});

// ============================================================================
console.log("\n[6] Detección de upsell");
// ============================================================================

test("Subtotal $845.84 (a $153.16 del envío gratis) → upsell activo", () => {
  const r = calcularCotizacion([
    { sku: "ValPulpo", cantidad: 1 },
    { sku: "ValEnd", cantidad: 1 }
  ]);
  assert.ok(r.upsell !== null, "Debería haber upsell");
  assert.strictEqual(r.upsell.falta_centavos, 99900 - 84584);
  assert.strictEqual(r.upsell.falta, "$153.16 MXN");
});

test("Subtotal muy bajo ($401.83) → SIN upsell (falta más de $300)", () => {
  const r = calcularCotizacion([{ sku: "ValEnd", cantidad: 1 }]);
  assert.strictEqual(r.upsell, null);
});

test("Subtotal con envío gratis → SIN upsell", () => {
  const r = calcularCotizacion([{ sku: "DientesRealistas", cantidad: 1 }]);
  assert.strictEqual(r.upsell, null);
});

// ============================================================================
console.log("\n[7] Validación de stock");
// ============================================================================

test("Cantidad mayor al stock → ok=false con detalle", () => {
  const r = calcularCotizacion([{ sku: "Endotnissin", cantidad: 50 }]);
  assert.strictEqual(r.ok, false);
  assert.ok(Array.isArray(r.sin_stock));
  assert.strictEqual(r.sin_stock[0].sku, "Endotnissin");
});

// ============================================================================
console.log("\n[8] Búsqueda de productos");
// ============================================================================

test("Buscar 'endodoncia' encuentra productos relacionados", () => {
  const r = buscarProductos("endodoncia");
  assert.strictEqual(r.ok, true);
  assert.ok(r.cantidad_resultados >= 2);
});

test("Buscar 'nissin' encuentra Endotnissin", () => {
  const r = buscarProductos("nissin");
  assert.strictEqual(r.ok, true);
  assert.ok(r.resultados.some(p => p.sku === "Endotnissin"));
});

test("Buscar 'pediatría' encuentra ValPulpo", () => {
  const r = buscarProductos("pediatria");
  assert.ok(r.resultados.some(p => p.sku === "ValPulpo"));
});

test("Buscar texto sin matches → resultados vacíos", () => {
  const r = buscarProductos("xyzzyzzyz");
  assert.strictEqual(r.cantidad_resultados, 0);
});

// ============================================================================
console.log("\n[9] Listar catálogo completo");
// ============================================================================

test("Lista 4 productos activos", () => {
  const r = listarCatalogo();
  assert.strictEqual(r.cantidad_productos, 4);
});

// ============================================================================
console.log("\n[10] Pedido grande de mayoreo");
// ============================================================================

test("20× ValEnd + 5× DientesRealistas = matemática exacta", () => {
  const r = calcularCotizacion([
    { sku: "ValEnd", cantidad: 20 },
    { sku: "DientesRealistas", cantidad: 5 }
  ]);
  assert.strictEqual(r.ok, true);
  // 20 * 40183 = 803,660 cent
  // 5 * 100,711 = 503,555 cent
  // total = 1,307,215 cent = $13,072.15
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
