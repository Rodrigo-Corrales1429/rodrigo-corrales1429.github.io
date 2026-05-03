/**
 * ============================================================================
 *  MOTOR DE COTIZACIÓN — VALQUIRIA  (v2 con búsqueda inteligente)
 * ============================================================================
 *  Cambios v2:
 *  - Búsqueda tolera errores ortográficos (Levenshtein distance ≤ 1)
 *  - Búsqueda tolera palabras parciales ("pulpo" encuentra "pulpotomía")
 *  - Stop-words en español (no contamina el ranking con "hola", "qué", etc.)
 *  - Normalización de acentos ("pediatria" = "pediatría")
 *  - Si no hay match exacto, devuelve top productos (bot nunca se queda sin
 *    nada que ofrecer al usuario).
 *
 *  Reglas de blindaje (sin cambios respecto a v1):
 *  1. Toda aritmética se hace con ENTEROS (centavos), nunca flotantes.
 *  2. Cada cotización se reverifica antes de devolverla (self-check).
 *  3. Los SKUs inválidos NO se ignoran silenciosamente: se reportan.
 *  4. Cantidades negativas, cero, no-enteras o absurdas se rechazan.
 *  5. El catálogo es la única fuente de precios.
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

// ------- STOP-WORDS EN ESPAÑOL -------
// Estas palabras nunca aportan al score de búsqueda.
const STOP_WORDS = new Set([
  "hola", "buenas", "buenos", "buen", "dia", "tardes", "noches",
  "que", "qué", "como", "cómo", "cual", "cuál", "cuales", "cuáles",
  "tiene", "tienen", "tener", "tengo", "haber", "hay",
  "para", "por", "con", "sin", "del", "los", "las", "una", "uno", "unos", "unas",
  "este", "esta", "estos", "estas", "ese", "esa", "esos", "esas",
  "necesito", "quiero", "busco", "buscar", "ver", "saber",
  "puede", "puedo", "podrias", "podrías", "podria", "podría", "puedes",
  "favor", "gracias", "todo", "todos", "todas", "ayuda", "ayudame",
  "soy", "estoy", "estamos", "ando", "estaba",
  "the", "and", "for", "you", "with"
]);

// ------- HELPERS -------

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
  const pesosStr = pesos.toLocaleString("en-US");
  const centsStr = cents.toString().padStart(2, "0");
  return `${negativo ? "-" : ""}$${pesosStr}.${centsStr} MXN`;
}

/**
 * Quita acentos y baja a minúsculas. "Pediatría" → "pediatria".
 */
function normalizarTexto(s) {
  return String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")  // signos de puntuación a espacios
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Distancia de Levenshtein iterativa.
 * Cuántas sustituciones, inserciones o eliminaciones convierten a en b.
 * "nisin" vs "nissin" = 1 (insertar una 's').
 */
function levenshtein(a, b) {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Optimización: solo guardamos dos filas en lugar de la matriz completa.
  let filaPrev = new Array(a.length + 1);
  let filaActual = new Array(a.length + 1);
  for (let j = 0; j <= a.length; j++) filaPrev[j] = j;

  for (let i = 1; i <= b.length; i++) {
    filaActual[0] = i;
    for (let j = 1; j <= a.length; j++) {
      const costo = a.charAt(j - 1) === b.charAt(i - 1) ? 0 : 1;
      filaActual[j] = Math.min(
        filaActual[j - 1] + 1,       // inserción
        filaPrev[j] + 1,             // eliminación
        filaPrev[j - 1] + costo      // sustitución
      );
    }
    [filaPrev, filaActual] = [filaActual, filaPrev];
  }
  return filaPrev[a.length];
}

// ------- VALIDACIÓN DE INPUT (sin cambios) -------

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

// ------- COTIZACIÓN (sin cambios estructurales) -------

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

  const envio_gratis = subtotal_centavos >= ENVIO_GRATIS_DESDE_CENTAVOS;
  const envio_centavos = envio_gratis ? 0 : COSTO_ENVIO_CENTAVOS;
  const total_centavos = subtotal_centavos + envio_centavos;

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

  // Self-check
  let suma_verificacion = 0;
  for (const linea of lineas) {
    suma_verificacion += linea.subtotal_linea_centavos;
  }
  const total_verificacion = suma_verificacion + envio_centavos;
  if (
    suma_verificacion !== subtotal_centavos ||
    total_verificacion !== total_centavos
  ) {
    return {
      ok: false,
      error:
        "Error interno del motor de cotización: la suma no se verificó. " +
        "Por seguridad, no se generó la cotización. Contacta al especialista."
    };
  }

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
    upsell,
    _raw: {
      subtotal_centavos,
      envio_centavos,
      total_centavos
    }
  };
}

// ------- BÚSQUEDA INTELIGENTE (v2) -------

function productoAFichaCorta(p) {
  return {
    sku: p.sku,
    nombre: p.nombre,
    precio: centavosAPesos(p.precio_centavos),
    precio_regular: centavosAPesos(p.precio_regular_centavos),
    stock_disponible: p.stock,
    descripcion: p.descripcion_corta
  };
}

/**
 * Busca productos con tolerancia a:
 *  - Palabras parciales: "pulpo" encuentra "pulpotomía".
 *  - Errores ortográficos: "nisin" encuentra "nissin" (Levenshtein ≤ 1).
 *  - Acentos: "pediatria" encuentra "pediatría".
 *  - Stop-words: "hola que tienen para endo" → solo el token "endo" puntúa.
 *
 * Si no hay matches reales, devuelve igualmente el top del catálogo con
 * `coincidencia_exacta: false` para que el bot pueda guiar al usuario.
 */
function buscarProductos(query) {
  if (typeof query !== "string" || query.trim() === "") {
    return { ok: false, error: "La búsqueda requiere un texto no vacío." };
  }

  const qNormalizado = normalizarTexto(query);

  // Tokens significativos: longitud >= 3 y NO sean stop-words.
  const tokens = qNormalizado
    .split(/\s+/)
    .filter(t => t.length >= 3 && !STOP_WORDS.has(t));

  // Caso A: el query no tenía palabras útiles ("hola", "ayuda")
  // → devolvemos el catálogo completo para que el bot pregunte.
  if (tokens.length === 0) {
    const top = getCatalogoActivo().slice(0, 5).map(productoAFichaCorta);
    return {
      ok: true,
      cantidad_resultados: top.length,
      coincidencia_exacta: false,
      mensaje_para_asesor:
        "El usuario no especificó qué busca. Muéstrale opciones y pregúntale " +
        "qué tipo de práctica realiza (endodoncia, pulpotomía, kit completo, " +
        "compatibilidad con Nissin).",
      resultados: top
    };
  }

  // Caso B: hay tokens significativos, hacemos scoring.
  const resultados = getCatalogoActivo()
    .map(p => {
      const blob = normalizarTexto(
        p.nombre + " " +
        p.descripcion_corta + " " +
        p.keywords.join(" ") + " " +
        p.sku
      );
      const palabrasBlob = blob.split(/\s+/).filter(w => w.length >= 3);

      let score = 0;
      const matchesTokens = [];

      for (const token of tokens) {
        // 1. Substring match (peso 3): "endo" en "endodoncia"
        if (blob.includes(token)) {
          score += 3;
          matchesTokens.push({ token, tipo: "substring" });
          continue;
        }
        // 2. Fuzzy match con palabras del blob (peso 1): "nisin" ~ "nissin"
        // Solo aplicamos fuzzy a tokens y palabras con longitud >= 4
        // (evita falsos positivos en tokens cortos).
        if (token.length >= 4) {
          const matchFuzzy = palabrasBlob.some(
            w => w.length >= 4 && levenshtein(token, w) <= 1
          );
          if (matchFuzzy) {
            score += 1;
            matchesTokens.push({ token, tipo: "fuzzy" });
          }
        }
      }

      return { producto: p, score, matchesTokens };
    })
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  if (resultados.length === 0) {
    // Caso C: ningún producto matchó. NO nos rendimos: devolvemos top
    // y le decimos al asesor que guíe.
    const top = getCatalogoActivo().slice(0, 3).map(productoAFichaCorta);
    return {
      ok: true,
      cantidad_resultados: top.length,
      coincidencia_exacta: false,
      mensaje_para_asesor:
        `No hubo coincidencias para los términos: ${tokens.join(", ")}. ` +
        `Estos son los productos más populares. Sugiérelos al usuario y ` +
        `pídele que aclare qué tipo de práctica necesita.`,
      resultados: top
    };
  }

  return {
    ok: true,
    cantidad_resultados: resultados.length,
    coincidencia_exacta: true,
    resultados: resultados.map(r => productoAFichaCorta(r.producto))
  };
}

function listarCatalogo() {
  const productos = getCatalogoActivo().map(productoAFichaCorta);
  return {
    ok: true,
    cantidad_productos: productos.length,
    productos
  };
}

module.exports = {
  calcularCotizacion,
  buscarProductos,
  listarCatalogo,
  // Exportados para tests:
  centavosAPesos,
  validarYNormalizarItems,
  normalizarTexto,
  levenshtein
};
