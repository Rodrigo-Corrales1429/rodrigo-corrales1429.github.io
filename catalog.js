/**
 * ============================================================================
 *  CATÁLOGO VALQUIRIA — lee desde productos.json
 * ============================================================================
 *  Para editar precios, stock o agregar productos: edita productos.json.
 *  Este archivo NO necesita tocarse.
 *
 *  Formato esperado de cada producto en productos.json:
 *    {
 *      "id": número,
 *      "sku": "string único",
 *      "nombre": "string",
 *      "precio_regular": número en pesos (ej: 539.00),
 *      "precio_promocion": número en pesos (ej: 444.01),
 *      "stock": entero,
 *      "activo": true | false,
 *      "keywords": ["palabra1", "palabra2"],
 *      "descripcion": "string larga"
 *    }
 *
 *  IMPORTANTE — manejo de precios:
 *  En el JSON los escribimos en PESOS (444.01) porque es legible para humanos.
 *  Al cargar el archivo, este módulo convierte cada precio a CENTAVOS ENTEROS
 *  (44401) usando Math.round para evitar el bug de flotantes de JavaScript.
 *  Toda la matemática del backend trabaja en centavos enteros desde ese punto.
 * ============================================================================
 */

const fs = require("fs");
const path = require("path");

const RUTA_JSON = path.join(__dirname, "productos.json");

/**
 * Convierte un precio en pesos (con 2 decimales) a centavos enteros.
 * Math.round protege contra bugs como 444.01 * 100 = 44401.00000000001.
 */
function pesosACentavos(pesos) {
  if (typeof pesos !== "number" || !Number.isFinite(pesos) || pesos < 0) {
    throw new Error(`Precio inválido: ${pesos}`);
  }
  return Math.round(pesos * 100);
}

/**
 * Carga y valida productos.json al arrancar.
 * Si algún producto tiene datos inválidos, lanza un error que tumba el
 * servidor — preferimos no arrancar a arrancar con datos corruptos.
 */
function cargarCatalogo() {
  let textoJson;
  try {
    textoJson = fs.readFileSync(RUTA_JSON, "utf8");
  } catch (e) {
    throw new Error(`No se pudo leer productos.json en ${RUTA_JSON}: ${e.message}`);
  }

  let productosRaw;
  try {
    productosRaw = JSON.parse(textoJson);
  } catch (e) {
    throw new Error(`productos.json tiene JSON inválido: ${e.message}`);
  }

  if (!Array.isArray(productosRaw)) {
    throw new Error("productos.json debe ser un arreglo de productos.");
  }

  const skusVistos = new Set();
  const productos = productosRaw.map((p, i) => {
    // Validaciones campo por campo, con mensajes claros.
    if (!p || typeof p !== "object") {
      throw new Error(`productos.json: el item en posición ${i} no es un objeto.`);
    }
    if (typeof p.sku !== "string" || p.sku.trim() === "") {
      throw new Error(`productos.json: item ${i} no tiene "sku" válido.`);
    }
    if (skusVistos.has(p.sku)) {
      throw new Error(`productos.json: SKU duplicado "${p.sku}".`);
    }
    skusVistos.add(p.sku);

    if (typeof p.nombre !== "string" || p.nombre.trim() === "") {
      throw new Error(`productos.json: SKU "${p.sku}" no tiene "nombre" válido.`);
    }
    if (typeof p.precio_promocion !== "number") {
      throw new Error(`productos.json: SKU "${p.sku}" no tiene "precio_promocion" numérico.`);
    }
    if (typeof p.precio_regular !== "number") {
      throw new Error(`productos.json: SKU "${p.sku}" no tiene "precio_regular" numérico.`);
    }
    if (!Number.isInteger(p.stock) || p.stock < 0) {
      throw new Error(`productos.json: SKU "${p.sku}" tiene "stock" inválido (debe ser entero >= 0).`);
    }
    if (typeof p.activo !== "boolean") {
      throw new Error(`productos.json: SKU "${p.sku}" debe tener "activo": true o false.`);
    }
    if (!Array.isArray(p.keywords)) {
      throw new Error(`productos.json: SKU "${p.sku}" debe tener "keywords" como arreglo (puede estar vacío).`);
    }
    if (typeof p.descripcion !== "string") {
      throw new Error(`productos.json: SKU "${p.sku}" no tiene "descripcion".`);
    }
    if (typeof p.imagen !== "string" || !/^https?:\/\//.test(p.imagen)) {
      throw new Error(
        `productos.json: SKU "${p.sku}" debe tener "imagen" como URL ` +
        `(http:// o https://). Recibido: ${JSON.stringify(p.imagen)}`
      );
    }

    return {
      id: p.id,
      sku: p.sku,
      nombre: p.nombre,
      division: "Valquiria Dental",
      // Convertimos a centavos enteros aquí, una sola vez:
      precio_centavos: pesosACentavos(p.precio_promocion),
      precio_regular_centavos: pesosACentavos(p.precio_regular),
      stock: p.stock,
      activo: p.activo,
      imagen: p.imagen,
      keywords: p.keywords,
      descripcion: p.descripcion,
      // Versión corta autogenerada para el chat (primeras ~200 chars de descripción)
      descripcion_corta: p.descripcion.split("\n")[0].slice(0, 220)
    };
  });

  console.log(`[catalog] Cargados ${productos.length} productos desde productos.json`);
  return productos;
}

// ----- Carga única al arrancar -----
const CATALOGO = cargarCatalogo();

/**
 * Devuelve solo los productos activos (los inactivos quedan ocultos al bot).
 */
function getCatalogoActivo() {
  return CATALOGO.filter(p => p.activo === true);
}

/**
 * Busca un producto por SKU exacto. Devuelve null si no existe o está inactivo.
 */
function getProductoPorSku(sku) {
  if (typeof sku !== "string") return null;
  const skuNormalizado = sku.trim();
  const producto = CATALOGO.find(p => p.sku === skuNormalizado);
  if (!producto || !producto.activo) return null;
  return producto;
}

module.exports = {
  CATALOGO,
  getCatalogoActivo,
  getProductoPorSku
};
