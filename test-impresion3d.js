/**
 * Pruebas del motor de estimación de impresión 3D (impresion3d.js).
 * Mismo formato que test-quote-engine.js: cero dependencias, node directo.
 */

const { estimarImpresion3D, tarifasDeReferencia } = require("./impresion3d.js");
const { ejecutarHerramienta } = require("./gemini-tools.js");

let pasados = 0, fallados = 0;
const pendientes = [];

function test(nombre, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === "function") {
      /* Una prueba puede devolver promesa; se acumula y se espera al final
         para no reordenar la salida ni convertir todo el archivo en async. */
      pendientes.push(
        r.then(() => { console.log(`  ✓ ${nombre}`); pasados++; },
               e => { console.log(`  ✗ ${nombre}\n      ${e.message}`); fallados++; })
      );
      return;
    }
    console.log(`  ✓ ${nombre}`);
    pasados++;
  } catch (e) {
    console.log(`  ✗ ${nombre}\n      ${e.message}`);
    fallados++;
  }
}

console.log("\n[A] Estimación básica por gramo");
test("100 g de PLA = $250.00 MXN", () => {
  const r = estimarImpresion3D({ material: "pla", gramos: 100 });
  if (!r.ok) throw new Error(r.error);
  if (r.total_estimado !== "$250.00 MXN") throw new Error(`Total: ${r.total_estimado}`);
  if (r.pedido_minimo_aplicado) throw new Error("No debería aplicar mínimo");
});

test("40 g de PLA ($100) sube al pedido mínimo de $150", () => {
  const r = estimarImpresion3D({ material: "pla", gramos: 40 });
  if (!r.ok) throw new Error(r.error);
  if (r.total_estimado !== "$150.00 MXN") throw new Error(`Total: ${r.total_estimado}`);
  if (!r.pedido_minimo_aplicado) throw new Error("Debería avisar del mínimo");
});

console.log("\n[B] La regla 'lo que más convenga al cliente'");
test("200 g PLA ($500) vs 3 h ($240): gana la hora", () => {
  const r = estimarImpresion3D({ material: "pla", gramos: 200, horas: 3 });
  if (!r.ok) throw new Error(r.error);
  if (r.total_estimado !== "$240.00 MXN") throw new Error(`Total: ${r.total_estimado}`);
  if (!r.desglose.criterio_aplicado.includes("hora")) throw new Error("Criterio equivocado");
});

test("60 g PLA ($150) vs 10 h ($800): gana el gramo", () => {
  const r = estimarImpresion3D({ material: "pla", gramos: 60, horas: 10 });
  if (!r.ok) throw new Error(r.error);
  if (r.total_estimado !== "$150.00 MXN") throw new Error(`Total: ${r.total_estimado}`);
  if (!r.desglose.criterio_aplicado.includes("gramo")) throw new Error("Criterio equivocado");
});

console.log("\n[C] Materiales y sinónimos");
test("'ASA' resuelve a ABS/ASA a $3.00/g", () => {
  const r = estimarImpresion3D({ material: "ASA", gramos: 100 });
  if (!r.ok) throw new Error(r.error);
  if (r.total_estimado !== "$300.00 MXN") throw new Error(`Total: ${r.total_estimado}`);
});

test("'resina SLA' resuelve a resina a $5.00/g", () => {
  const r = estimarImpresion3D({ material: "resina SLA", gramos: 100 });
  if (!r.ok) throw new Error(r.error);
  if (r.total_estimado !== "$500.00 MXN") throw new Error(`Total: ${r.total_estimado}`);
});

test("Material desconocido → error orientador", () => {
  const r = estimarImpresion3D({ material: "unobtainium", gramos: 100 });
  if (r.ok) throw new Error("Esperaba ok=false");
  if (!r.error.includes("PLA")) throw new Error("El error debe listar materiales");
});

console.log("\n[D] Post-procesado y cantidad");
test("Pintura +50%: 100 g PLA = $375.00", () => {
  const r = estimarImpresion3D({ material: "pla", gramos: 100, postprocesado: "pintura" });
  if (!r.ok) throw new Error(r.error);
  if (r.total_estimado !== "$375.00 MXN") throw new Error(`Total: ${r.total_estimado}`);
});

test("Lijado +20% con sinónimo 'pulido'", () => {
  const r = estimarImpresion3D({ material: "pla", gramos: 100, postprocesado: "pulido" });
  if (!r.ok) throw new Error(r.error);
  if (r.total_estimado !== "$300.00 MXN") throw new Error(`Total: ${r.total_estimado}`);
});

test("5 piezas de 100 g PLA = $1,250.00", () => {
  const r = estimarImpresion3D({ material: "pla", gramos: 100, cantidad: 5 });
  if (!r.ok) throw new Error(r.error);
  if (r.total_estimado !== "$1,250.00 MXN") throw new Error(`Total: ${r.total_estimado}`);
  if (r.es_mayoreo) throw new Error("5 piezas no es mayoreo");
});

test("12 piezas marca mayoreo para el asesor", () => {
  const r = estimarImpresion3D({ material: "pla", gramos: 100, cantidad: 12 });
  if (!r.ok) throw new Error(r.error);
  if (!r.es_mayoreo) throw new Error("12 piezas debería marcar mayoreo");
  if (!r.nota_para_asesor.includes("mayoreo")) throw new Error("La nota debe mencionarlo");
});

console.log("\n[E] Defensa contra inputs malos");
test("Gramos negativos → rechazado", () => {
  const r = estimarImpresion3D({ material: "pla", gramos: -5 });
  if (r.ok) throw new Error("Esperaba ok=false");
});

test("Gramos 'doscientos' (string no numérica) → rechazado", () => {
  const r = estimarImpresion3D({ material: "pla", gramos: "doscientos" });
  if (r.ok) throw new Error("Esperaba ok=false");
});

test("Cantidad 0 → rechazada", () => {
  const r = estimarImpresion3D({ material: "pla", gramos: 100, cantidad: 0 });
  if (r.ok) throw new Error("Esperaba ok=false");
});

test("Args undefined no lanzan excepción", () => {
  const r = estimarImpresion3D(undefined);
  if (r.ok) throw new Error("Esperaba ok=false");
});

console.log("\n[F] Integración con el dispatcher");
/* `ejecutarHerramienta` es asíncrona desde que cotizar_envio puede salir a la
   API de la paquetería. Esta prueba resuelve la promesa antes de comprobar; el
   resto del archivo prueba el motor directamente y sigue siendo síncrono. */
test("estimar_impresion_3d vía ejecutarHerramienta", () =>
  ejecutarHerramienta({
    name: "estimar_impresion_3d",
    args: { material: "petg", gramos: 150, postprocesado: "pintura" }
  }).then(r => {
    if (!r.ok) throw new Error(r.error);
    // 150 g × $3.00 = $450 + 50% = $675
    if (r.total_estimado !== "$675.00 MXN") throw new Error(`Total: ${r.total_estimado}`);
  }));

test("tarifasDeReferencia trae la regla comercial", () => {
  const t = tarifasDeReferencia();
  if (!t.regla_comercial.includes("convenga")) throw new Error("Falta la regla comercial");
  if (t.por_gramo.length < 5) throw new Error("Faltan materiales");
});

Promise.all(pendientes).then(() => {
  console.log(`\n========================================`);
  console.log(`  Impresión 3D: ${pasados} pasados, ${fallados} fallados`);
  console.log(`========================================\n`);
  if (fallados > 0) process.exit(1);
});
