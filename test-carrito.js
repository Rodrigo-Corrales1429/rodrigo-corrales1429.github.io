/**
 * ============================================================================
 *  PRUEBAS — resolución de productos y acciones de carrito
 * ============================================================================
 *  Cubre exactamente los tres fallos que se reportaron desde el sitio:
 *    1. Listas largas de las que se perdían artículos.
 *    2. Correcciones del carrito («vacía y pon esto», «quita los de endo»).
 *    3. Nombres informales y mal escritos.
 *
 *  Todo esto vive ahora en código determinista, así que se puede probar sin
 *  gastar una llamada al modelo.
 *
 *  Correr con:  node test-carrito.js
 * ============================================================================
 */

const { resolverSku } = require("./resolver-productos.js");
const { cotizarConCarrito } = require("./gemini-tools.js");

let pasadas = 0;
const fallos = [];

function ok(nombre, condicion, detalle = "") {
  if (condicion) { pasadas++; return; }
  fallos.push(`${nombre}${detalle ? " — " + detalle : ""}`);
}

/** El carrito resultante, como texto ordenado y comparable. */
const carrito = (r) =>
  (r.carrito_final || [])
    .map(l => `${l.sku}:${l.cantidad}`)
    .sort()
    .join(" ");

// ---------------------------------------------------------------------------
console.log("\n1 · Resolución de nombres informales y con erratas");
// ---------------------------------------------------------------------------
const NOMBRES = {
  ValEnd: ["endo", "endos", "endodoncia", "kit endo", "ValEnd", "valend",
           "conducto", "endodonzia", "dientes para practicar endodoncia"],
  ValPulpo: ["pulpo", "pulpos", "pulpotomia", "pulpotomía", "pediatria",
             "odontopediatria", "dientes de niño", "infantil"],
  DientesRealistas: ["realistas", "realista", "kit completo", "32 dientes",
                     "boca completa", "estuche", "ultra realista"],
  Endotnissin: ["nissin", "nisin", "nisiin", "nissim", "nissan", "nicin",
                "tipodonto", "tipo nissin", "kit nissin"]
};
for (const [sku, textos] of Object.entries(NOMBRES)) {
  for (const t of textos) {
    const r = resolverSku(t);
    ok(`"${t}" → ${sku}`, r.ok && r.sku === sku,
       r.ok ? `devolvió ${r.sku}` : r.error);
  }
}
const basura = resolverSku("zzz qwerty");
ok("texto sin sentido no inventa producto", !basura.ok);

// ---------------------------------------------------------------------------
console.log("2 · Listas largas: no se pierde ni un artículo");
// ---------------------------------------------------------------------------
{
  // El caso literal del reporte: «2 endo, 1 pulpo, 3 realistas y 2 nissin».
  const r = cotizarConCarrito({
    items: [
      { producto: "endo", cantidad: 2 },
      { producto: "pulpo", cantidad: 1 },
      { producto: "realistas", cantidad: 3 },
      { producto: "nissin", cantidad: 2 }
    ]
  }, []);
  ok("lista de 4 cotiza ok", r.ok, r.error);
  ok("lista de 4 conserva las 4 líneas", r.lineas && r.lineas.length === 4,
     `hubo ${r.lineas ? r.lineas.length : 0}`);
  ok("lista de 4 con cantidades correctas",
     carrito(r) === "DientesRealistas:3 Endotnissin:2 ValEnd:2 ValPulpo:1",
     carrito(r));

  // Aritmética verificada a mano: 2×401.83 + 1×444.01 + 3×1007.11 + 2×719.58
  // = 803.66 + 444.01 + 3021.33 + 1439.16 = 5708.16, envío gratis.
  ok("total de la lista de 4 es exacto", r.total === "$5,708.16 MXN", r.total);
  ok("envío gratis por superar el umbral", r.envio && r.envio.gratis === true);
}
{
  // Mismo producto repetido en la misma lista: se consolida, no se pisa.
  const r = cotizarConCarrito({
    items: [
      { producto: "endo", cantidad: 2 },
      { producto: "endodoncia", cantidad: 3 }
    ]
  }, []);
  ok("el mismo producto dos veces se suma", carrito(r) === "ValEnd:5", carrito(r));
}
{
  // Un producto no identificable NO tumba el resto del pedido.
  const r = cotizarConCarrito({
    items: [
      { producto: "endo", cantidad: 2 },
      { producto: "zzzz qwerty", cantidad: 1 }
    ]
  }, []);
  ok("lo identificable se cotiza aunque algo falle", r.ok && carrito(r) === "ValEnd:2",
     carrito(r));
  ok("y se avisa de lo que no se identificó",
     Array.isArray(r.avisos) && r.avisos.some(a => /no identifiqu/i.test(a)));
}

// ---------------------------------------------------------------------------
console.log("3 · Acciones de carrito");
// ---------------------------------------------------------------------------
const CARRITO = [{ sku: "ValEnd", cantidad: 2 }, { sku: "ValPulpo", cantidad: 1 }];

{
  const r = cotizarConCarrito({ accion: "vaciar" }, CARRITO);
  ok("vaciar responde ok", r.ok);
  ok("vaciar deja el carrito en cero", carrito(r) === "");
  ok("vaciar marca carrito_vacio", r.carrito_vacio === true);
}
{
  // «vacía el carrito y ponme 3 realistas» = un solo reemplazo.
  const r = cotizarConCarrito({
    accion: "reemplazar",
    items: [{ producto: "realistas", cantidad: 3 }]
  }, CARRITO);
  ok("reemplazar descarta lo anterior",
     carrito(r) === "DientesRealistas:3", carrito(r));
}
{
  const r = cotizarConCarrito({
    accion: "agregar",
    items: [{ producto: "nissin", cantidad: 2 }]
  }, CARRITO);
  ok("agregar conserva lo que había y suma lo nuevo",
     carrito(r) === "Endotnissin:2 ValEnd:2 ValPulpo:1", carrito(r));
}
{
  const r = cotizarConCarrito({
    accion: "agregar",
    items: [{ producto: "endo", cantidad: 3 }]
  }, CARRITO);
  ok("agregar sobre un producto que ya estaba acumula",
     carrito(r) === "ValEnd:5 ValPulpo:1", carrito(r));
}
{
  // «quita los de endodoncia» — sin cantidad = la línea entera.
  const r = cotizarConCarrito({
    accion: "quitar",
    items: [{ producto: "endo" }]
  }, CARRITO);
  ok("quitar sin cantidad retira la línea completa",
     carrito(r) === "ValPulpo:1", carrito(r));
}
{
  const r = cotizarConCarrito({
    accion: "quitar",
    items: [{ producto: "endo", cantidad: 1 }]
  }, CARRITO);
  ok("quitar con cantidad resta parcialmente",
     carrito(r) === "ValEnd:1 ValPulpo:1", carrito(r));
}
{
  // Quitar de más no deja cantidades negativas.
  const r = cotizarConCarrito({
    accion: "quitar",
    items: [{ producto: "endo", cantidad: 99 }]
  }, CARRITO);
  ok("quitar de más no produce negativos",
     carrito(r) === "ValPulpo:1", carrito(r));
}
{
  // Quitar TODO es un éxito con carrito vacío, no un error.
  const r = cotizarConCarrito({
    accion: "quitar",
    items: [{ producto: "endo" }, { producto: "pulpo" }]
  }, CARRITO);
  ok("vaciar por sustracción responde ok", r.ok, r.error);
  ok("vaciar por sustracción marca carrito_vacio", r.carrito_vacio === true);
  ok("vaciar por sustracción deja carrito_final vacío", carrito(r) === "");
}
{
  // «de los endo ponme 5» — fija uno y no toca el resto.
  const r = cotizarConCarrito({
    accion: "fijar",
    items: [{ producto: "endo", cantidad: 5 }]
  }, CARRITO);
  ok("fijar cambia solo ese producto",
     carrito(r) === "ValEnd:5 ValPulpo:1", carrito(r));
}
{
  const r = cotizarConCarrito({
    accion: "fijar",
    items: [{ producto: "nissin", cantidad: 2 }]
  }, CARRITO);
  ok("fijar un producto nuevo lo añade sin borrar nada",
     carrito(r) === "Endotnissin:2 ValEnd:2 ValPulpo:1", carrito(r));
}
{
  const r = cotizarConCarrito({
    items: [{ producto: "endo", cantidad: 1 }]
  }, CARRITO);
  ok("sin accion, el defecto es reemplazar",
     r.accion === "reemplazar" && carrito(r) === "ValEnd:1", carrito(r));
}
{
  const r = cotizarConCarrito({
    accion: "ACCION_INVENTADA",
    items: [{ producto: "endo", cantidad: 1 }]
  }, CARRITO);
  ok("una accion desconocida cae en reemplazar y no rompe",
     r.ok && r.accion === "reemplazar", r.accion);
}

// ---------------------------------------------------------------------------
console.log("4 · Blindaje: el carrito del cliente no fija precios");
// ---------------------------------------------------------------------------
{
  // Un carrito manipulado desde la consola con precio y SKU falsos: el precio
  // se ignora siempre —los importes salen del catálogo— y el SKU inexistente
  // ni siquiera llega hasta aquí (server.js lo filtra con sanearCarrito).
  const r = cotizarConCarrito({
    accion: "agregar",
    items: [{ producto: "endo", cantidad: 1 }]
  }, [{ sku: "ValEnd", cantidad: 1, precio_centavos: 1 }]);
  ok("el precio inyectado en el carrito se ignora",
     r.total === "$953.66 MXN", r.total);   // 2 × 401.83 + 150 de envío
}
{
  const r = cotizarConCarrito({
    items: [{ producto: "endo", cantidad: 0 }]
  }, []);
  ok("cantidad 0 se rechaza", !r.ok, JSON.stringify(r.total));
}
{
  const r = cotizarConCarrito({
    items: [{ producto: "endo", cantidad: -5 }]
  }, []);
  ok("cantidad negativa se rechaza", !r.ok);
}
{
  const r = cotizarConCarrito({ items: [] }, CARRITO);
  ok("lista vacía no destruye el carrito", !r.ok, "debería pedir corrección");
}

// ---------------------------------------------------------------------------
console.log("");
if (fallos.length) {
  console.log(`✗ ${fallos.length} FALLARON de ${pasadas + fallos.length}:`);
  fallos.forEach(f => console.log("   · " + f));
  process.exit(1);
}
console.log(`✓ ${pasadas}/${pasadas} pruebas de carrito y resolución pasaron.`);
