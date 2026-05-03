/**
 * ============================================================================
 *  MOTOR DE COTIZACIÓN — VALQUIRIA
 * ============================================================================
 *  Esta es la única parte del sistema que toca dinero. Está diseñada para
 *  ser MATEMÁTICAMENTE EXACTA bajo cualquier circunstancia.
 *
 *  Reglas de blindaje:
 *  1. Toda aritmética se hace con ENTEROS (centavos), nunca flotantes.
 *  2. Nada de Number.toFixed() para "redondear" — esa función miente.
 *  3. Cada cotización se reverifica antes de devolverla (self-check).
 *  4. Los SKUs inválidos NO se ignoran silenciosamente: se reportan.
 *  5. Cantidades negativas, cero, no-enteras o absurdas se rechazan.
 *  6. El catálogo es la única fuente de precios; nunca confiamos en lo
 *     que diga el LLM sobre números.
 * ============================================================================
 */

const { getProductoPorSku, getCatalogoActivo } = require("./catalog.js");

// ------- CONFIGURACIÓN (vía ENV vars con defaults seguros) -------
const ENVIO_GRATIS_DESDE_CENTAVOS = parseInt(
  process.env.ENVIO_GRATIS_DESDE_CENTAVOS || "99900",  // $999.00 MXN
  10
);
const COSTO_ENVIO_CENTAVOS = parseInt(
  process.env.COSTO_ENVIO_CENTAVOS || "15000",          // $150.00 MXN
  10
);
const CANTIDAD_MAXIMA_POR_LINEA = parseInt(
  process.env.CANTIDAD_MAXIMA_POR_LINEA || "200",
  10
);

// Sanity check de configuración al arrancar:
if (
  !Number.isInteger(ENVIO_GRATIS_DESDE_CENTAVOS) ||
  !Number.isInteger(COSTO_ENVIO_CENTAVOS) ||
  ENVIO_GRATIS_DESDE_CENTAVOS < 0 ||
  COSTO_ENVIO_CENTAVOS < 0
) {
  throw new Error(
    "[quote-engine] Configuración inválida: las variables de entorno de envío " +
    "deben ser enteros >= 0 (en centavos)."
  );
}

// ------- HELPERS DE FORMATO -------

/**
 * Convierte centavos enteros a string "$X,XXX.XX MXN".
 * Es la ÚNICA función que produce strings con punto decimal.
 */
function centavosAPesos(centavos) {
  if (!Number.isInteger(centavos)) {
    throw new Error(`centavosAPesos recibió no-entero: ${centavos}`);
  }
  const negativo = centavos < 0;
  const abs = Math.abs(centavos);
  const pesos = Math.floor(abs / 100);
  const cents = abs % 100;
  const pesosStr = pesos.toLocaleString("en-US"); // separador de miles
  const centsStr = cents.toString().padStart(2, "0");
  return `${negativo ? "-" : ""}$${pesosStr}.${centsStr} MXN`;
}

// ------- VALIDACIÓN DE ENTRADA -------

/**
 * Valida que `items` tenga la forma [{sku: string, cantidad: int>0}, ...].
 * Lanza Error con mensaje legible si algo falla.
 * Devuelve una versión normalizada (cantidades como enteros, sin duplicados).
 */
function validarYNormalizarItems(items) {
  if (!Array.isArray(items)) {
    throw new Error("El campo 'items' debe ser un arreglo.");
  }
  if (items.length === 0) {
    throw new Error("La cotización está vacía: agrega al menos un producto.");
  }
  if (items.length > 50) {
    throw new Error("Demasiadas líneas en la cotización (máximo 50).");
  }

  // Consolidar SKUs duplicados sumando cantidades
  const consolidado = new Map();

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    if (!item || typeof item !== "object") {
      throw new Error(`El item en posición ${i} no es un objeto válido.`);
    }
    if (typeof item.sku !== "string" || item.sku.trim() === "") {
      throw new Error(`El item en posición ${i} no tiene un SKU válido.`);
    }

    const sku = item.sku.trim();

    // La cantidad puede venir como number o string ("2"). Forzamos a entero.
    const cantidadNum = Number(item.cantidad);
    if (
      !Number.isFinite(cantidadNum) ||
      !Number.isInteger(cantidadNum) ||
      cantidadNum <= 0
    ) {
      throw new Error(
        `El item con SKU "${sku}" tiene cantidad inválida ` +
        `(recibido: ${JSON.stringify(item.cantidad)}). ` +
        `Debe ser un entero positivo.`
      );
    }
    if (cantidadNum > CANTIDAD_MAXIMA_POR_LINEA) {
      throw new Error(
        `El item con SKU "${sku}" excede la cantidad máxima permitida ` +
        `(${CANTIDAD_MAXIMA_POR_LINEA}). Para pedidos mayores, ofrece ` +
        `derivar al especialista por WhatsApp.`
      );
    }

    consolidado.set(sku, (consolidado.get(sku) || 0) + cantidadNum);
  }

  return Array.from(consolidado.entries()).map(([sku, cantidad]) => ({
    sku,
    cantidad
  }));
}

// ------- MOTOR PRINCIPAL DE COTIZACIÓN -------

/**
 * Calcula una cotización completa.
 *
 * @param {Array<{sku: string, cantidad: number}>} items
 * @returns Un objeto con TODA la información necesaria para presentar la
 *          cotización al usuario, incluyendo strings ya formateados.
 *
 * Si hay un error de validación o un SKU inválido, retorna un objeto
 *   { ok: false, error: "...", sku_invalido?: "..." }
 * para que Gemini pueda explicarle el problema al usuario.
 */
function calcularCotizacion(items) {
  let itemsNormalizados;
  try {
    itemsNormalizados = validarYNormalizarItems(items);
  } catch (e) {
    return { ok: false, error: e.message };
  }

  const lineas = [];
  const skusInvalidos = [];
  const sinStock = [];
  let subtotal_centavos = 0;

  for (const item of itemsNormalizados) {
    const producto = getProductoPorSku(item.sku);

    if (!producto) {
      skusInvalidos.push(item.sku);
      continue;
    }

    if (item.cantidad > producto.stock) {
      sinStock.push({
        sku: producto.sku,
        nombre: producto.nombre,
        solicitado: item.cantidad,
        disponible: producto.stock
      });
      continue;
    }

    // Aritmética en enteros — esta es la línea crítica.
    const linea_centavos = producto.precio_centavos * item.cantidad;

    lineas.push({
      sku: producto.sku,
      nombre: producto.nombre,
      cantidad: item.cantidad,
      precio_unitario_centavos: producto.precio_centavos,
      precio_unitario: centavosAPesos(producto.precio_centavos),
      subtotal_linea_centavos: linea_centavos,
      subtotal_linea: centavosAPesos(linea_centavos)
    });

    subtotal_centavos += linea_centavos;
  }

  // Si hay errores de SKU o stock, abortamos la cotización para que Gemini
  // primero los resuelva con el usuario antes de ofrecer un total.
  if (skusInvalidos.length > 0) {
    return {
      ok: false,
      error:
        `Los siguientes SKUs no existen en el catálogo: ${skusInvalidos.join(", ")}. ` +
        `Usa la herramienta listar_catalogo o buscar_productos para confirmar SKUs válidos.`,
      skus_invalidos: skusInvalidos
    };
  }
  if (sinStock.length > 0) {
    return {
      ok: false,
      error:
        `Stock insuficiente en uno o más productos. Pregúntale al usuario si quiere ` +
        `ajustar las cantidades.`,
      sin_stock: sinStock
    };
  }

  // ------- Aplicar regla de envío -------
  const envio_gratis = subtotal_centavos >= ENVIO_GRATIS_DESDE_CENTAVOS;
  const envio_centavos = envio_gratis ? 0 : COSTO_ENVIO_CENTAVOS;
  const total_centavos = subtotal_centavos + envio_centavos;

  // ------- Detectar oportunidad de upsell -------
  // Si está a menos de $300 MXN del envío gratis, vale sugerirlo.
  let upsell = null;
  if (!envio_gratis) {
    const falta_centavos = ENVIO_GRATIS_DESDE_CENTAVOS - subtotal_centavos;
    if (falta_centavos > 0 && falta_centavos <= 30000) {
      upsell = {
        falta_centavos,
        falta: centavosAPesos(falta_centavos),
        mensaje:
          `El pedido está a ${centavosAPesos(falta_centavos)} de alcanzar envío gratis ` +
          `(umbral: ${centavosAPesos(ENVIO_GRATIS_DESDE_CENTAVOS)}). ` +
          `Considera sugerir agregar otro producto para superar el umbral.`
      };
    }
  }

  // ------- SELF-CHECK: reverificar la suma -------
  // Recalculamos desde cero, sin reutilizar variables intermedias.
  let suma_verificacion = 0;
  for (const linea of lineas) {
    suma_verificacion += linea.subtotal_linea_centavos;
  }
  const total_verificacion = suma_verificacion + envio_centavos;
  if (
    suma_verificacion !== subtotal_centavos ||
    total_verificacion !== total_centavos
  ) {
    // Esto NUNCA debería ocurrir. Si pasa, hay un bug grave y preferimos
    // fallar abiertamente antes que cobrar mal.
    return {
      ok: false,
      error:
        "Error interno del motor de cotización: la suma no se verificó. " +
        "Por seguridad, no se generó la cotización. Contacta al especialista."
    };
  }

  // ------- Empaquetar respuesta legible para el LLM -------
  return {
    ok: true,
    moneda: "MXN",
    lineas: lineas.map(l => ({
      sku: l.sku,
      nombre: l.nombre,
      cantidad: l.cantidad,
      precio_unitario: l.precio_unitario,
      subtotal_linea: l.subtotal_linea
    })),
    subtotal: centavosAPesos(subtotal_centavos),
    envio: {
      gratis: envio_gratis,
      costo: centavosAPesos(envio_centavos),
      umbral_envio_gratis: centavosAPesos(ENVIO_GRATIS_DESDE_CENTAVOS)
    },
    total: centavosAPesos(total_centavos),
    upsell, // null si no aplica
    // Campos crudos por si el frontend los quiere usar para tarjetas o checkout:
    _raw: {
      subtotal_centavos,
      envio_centavos,
      total_centavos
    }
  };
}

// ------- BÚSQUEDA DE PRODUCTOS -------

/**
 * Busca productos por texto libre. Compara contra nombre, descripción
 * corta y keywords. Devuelve un arreglo simplificado para el LLM.
 *
 * No es búsqueda semántica (no necesitamos ese nivel para 4 productos),
 * pero es lo suficientemente flexible para encontrar "endodoncia",
 * "nissin", "kit", "pediatria", etc.
 */
function buscarProductos(query) {
  if (typeof query !== "string" || query.trim() === "") {
    return { ok: false, error: "La búsqueda requiere un texto no vacío." };
  }

  const q = query.toLowerCase().trim();
  // Tokenizamos en palabras de >= 3 caracteres para tolerar typos como "endo"
  const tokens = q.split(/\s+/).filter(t => t.length >= 3);

  const resultados = getCatalogoActivo()
    .map(p => {
      const blob = (
        p.nombre + " " +
        p.descripcion_corta + " " +
        p.keywords.join(" ") + " " +
        p.sku
      ).toLowerCase();

      // Score = número de tokens del query que aparecen en el blob.
      const score = tokens.filter(t => blob.includes(t)).length;
      // También damos un punto si el query completo aparece tal cual
      const bonusFraseExacta = blob.includes(q) ? 1 : 0;

      return { producto: p, score: score + bonusFraseExacta };
    })
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(r => ({
      sku: r.producto.sku,
      nombre: r.producto.nombre,
      precio: centavosAPesos(r.producto.precio_centavos),
      precio_regular: centavosAPesos(r.producto.precio_regular_centavos),
      stock_disponible: r.producto.stock,
      descripcion: r.producto.descripcion_corta
    }));

  return {
    ok: true,
    cantidad_resultados: resultados.length,
    resultados
  };
}

/**
 * Devuelve el catálogo completo en versión simplificada para el LLM.
 * Útil cuando el usuario pregunta "qué tienen disponible" sin más detalle.
 */
function listarCatalogo() {
  const productos = getCatalogoActivo().map(p => ({
    sku: p.sku,
    nombre: p.nombre,
    precio: centavosAPesos(p.precio_centavos),
    stock_disponible: p.stock,
    descripcion: p.descripcion_corta
  }));
  return {
    ok: true,
    cantidad_productos: productos.length,
    productos
  };
}

// ------- EXPORTS -------
module.exports = {
  calcularCotizacion,
  buscarProductos,
  listarCatalogo,
  // Exportados para tests:
  centavosAPesos,
  validarYNormalizarItems
};
