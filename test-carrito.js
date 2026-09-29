/**
 * ============================================================================
 *  PRUEBAS — resolución de productos y acciones de carrito
 * ============================================================================
 *  Cubre, entre otras, las tres regresiones reportadas desde el sitio:
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
  ok("vaciar devuelve carrito_final como arreglo vacío",
     Array.isArray(r.carrito_final) && r.carrito_final.length === 0);
}
{
  const r = cotizarConCarrito({ accion: "vaciar" }, []);
  ok("vaciar un carrito ya vacío también responde ok", r.ok);
  ok("vaciar un carrito ya vacío conserva estado final vacío",
     Array.isArray(r.carrito_final) && r.carrito_final.length === 0);
  ok("vaciar no devuelve productos ni catálogo", !r.productos && !r.resultados);
}
{
  const r = cotizarConCarrito({ accion: "vaciar", items: [] }, CARRITO);
  ok("vaciar con items vacío también es válido",
     r.ok && Array.isArray(r.carrito_final) && r.carrito_final.length === 0,
     JSON.stringify(r));
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
  const r = cotizarConCarrito({
    accion: "quitar",
    items: [{ producto: "endo", cantidad: 2 }]
  }, [{ sku: "ValEnd", cantidad: 3 }, { sku: "ValPulpo", cantidad: 1 }]);
  ok("quitar 2 resta únicamente 2",
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
  const r = cotizarConCarrito({
    accion: "quitar",
    items: [{ producto: "nissin" }]
  }, CARRITO);
  ok("quitar un ausente conserva el carrito",
     carrito(r) === "ValEnd:2 ValPulpo:1", carrito(r));
  ok("quitar un ausente marca changed=false y sin_efecto=true",
     r.ok && r.changed === false && r.sin_efecto === true, JSON.stringify(r));
  ok("quitar un ausente no afirma que eliminó algo",
     /no estaba|no estaban|no se elimin/i.test(r.mensaje_para_asesor || ""),
     r.mensaje_para_asesor);
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
  const invalidas = ["eliminar", "añadir", "", null, 7, { tipo: "agregar" }];
  for (const accion of invalidas) {
    const entrada = CARRITO.map(item => ({ ...item }));
    const antes = JSON.stringify(entrada);
    const r = cotizarConCarrito({
      accion,
      items: [{ producto: "endo", cantidad: 1 }]
    }, entrada);
    ok(`acción explícita inválida ${JSON.stringify(accion)} se rechaza`,
       !r.ok && !Object.prototype.hasOwnProperty.call(r, "carrito_final"),
       JSON.stringify(r));
    ok(`acción explícita inválida ${JSON.stringify(accion)} no muta la entrada`,
       JSON.stringify(entrada) === antes, JSON.stringify(entrada));
  }
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
for (const accion of ["agregar", "reemplazar", "fijar"]) {
  const r = cotizarConCarrito({
    accion,
    items: [{ producto: "endo" }]
  }, CARRITO);
  ok(`${accion} sin cantidad se rechaza`, !r.ok && /cantidad/i.test(r.error || ""),
     JSON.stringify(r));
}
for (const accion of ["agregar", "reemplazar", "fijar", "quitar"]) {
  for (const cantidad of ["2", true, [3], null, Infinity, 201]) {
    const r = cotizarConCarrito({
      accion,
      items: [{ producto: "endo", cantidad }]
    }, CARRITO);
    ok(`${accion} rechaza cantidad no contractual ${JSON.stringify(cantidad)}`,
       !r.ok && !Object.prototype.hasOwnProperty.call(r, "carrito_final"),
       JSON.stringify(r));
  }
}
{
  const r = cotizarConCarrito({
    accion: "agregar",
    items: [{ producto: "endo", cantidad: 2 }]
  }, CARRITO);
  ok("cantidad JSON numérica válida sigue funcionando",
     r.ok && carrito(r) === "ValEnd:4 ValPulpo:1", JSON.stringify(r));
}
{
  const entrada = CARRITO.map(item => ({ ...item }));
  const antes = JSON.stringify(entrada);
  const r = cotizarConCarrito({
    accion: "vaciar",
    items: [{ producto: "nissin", cantidad: 2 }]
  }, entrada);
  ok("vaciar con items se rechaza sin carrito_final",
     !r.ok && !Object.prototype.hasOwnProperty.call(r, "carrito_final"),
     JSON.stringify(r));
  ok("vaciar con items preserva la segunda intención en el error",
     /por separado|operaci[oó]n adecuada|reemplazar/i.test(r.error || ""), r.error);
  ok("vaciar con items no muta el carrito de entrada",
     JSON.stringify(entrada) === antes, JSON.stringify(entrada));
}

// ---------------------------------------------------------------------------
console.log("");
if (fallos.length) {
  console.log(`✗ ${fallos.length} FALLARON de ${pasadas + fallos.length}:`);
  fallos.forEach(f => console.log("   · " + f));
  process.exit(1);
}
console.log(`✓ ${pasadas}/${pasadas} pruebas de carrito y resolución pasaron.`);
