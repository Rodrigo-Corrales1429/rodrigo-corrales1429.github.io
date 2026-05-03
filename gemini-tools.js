/**
 * ============================================================================
 *  DECLARACIONES DE HERRAMIENTAS PARA GEMINI
 * ============================================================================
 *  Aquí le decimos a Gemini qué funciones tiene disponibles.
 *  IMPORTANTE: Las descripciones aquí son lo que el modelo "lee" para decidir
 *  cuándo llamar a cada función. Deben ser claras y explícitas — son
 *  prompt engineering, no documentación técnica para humanos.
 *
 *  La sintaxis usa `parametersJsonSchema` que es la forma vigente en el
 *  SDK @google/genai >= 1.x.
 * ============================================================================
 */

const {
  calcularCotizacion,
  buscarProductos,
  listarCatalogo
} = require("./quote-engine.js");

// ----------------------------------------------------------------------------
// 1. Declaraciones (lo que Gemini ve)
// ----------------------------------------------------------------------------

const buscarProductosDeclaration = {
  name: "buscar_productos",
  description:
    "Busca productos del catálogo Valquiria Dental por palabras clave. " +
    "Úsala cuando el usuario describe lo que necesita en lenguaje natural " +
    "(por ejemplo: 'algo para endodoncia', 'tienen dientes para Nissin', " +
    "'busco material para pediatría'). Devuelve hasta 5 resultados con SKU, " +
    "nombre, precio y stock. NO inventes precios ni SKUs: usa solo lo que " +
    "esta función devuelva.",
  parametersJsonSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Texto descriptivo de lo que busca el usuario. Ejemplo: 'endodoncia', " +
          "'kit completo de dientes', 'nissin', 'pediatría'."
      }
    },
    required: ["query"]
  }
};

const listarCatalogoDeclaration = {
  name: "listar_catalogo",
  description:
    "Devuelve el catálogo completo de productos disponibles de Valquiria " +
    "Dental con SKU, nombre, precio y stock. Úsala cuando el usuario pregunta " +
    "de forma general 'qué tienen', 'muéstrame el catálogo', 'qué venden', " +
    "o cuando necesitas confirmar SKUs antes de cotizar. No requiere parámetros.",
  parametersJsonSchema: {
    type: "object",
    properties: {}
  }
};

const calcularCotizacionDeclaration = {
  name: "calcular_cotizacion",
  description:
    "Calcula la cotización exacta (subtotal, envío, total) para una lista " +
    "de productos. SIEMPRE usa esta función para cualquier cálculo de precios; " +
    "NUNCA hagas sumas tú mismo. La función aplica automáticamente la regla " +
    "de envío gratis y detecta oportunidades de upsell. Si la función " +
    "devuelve ok=false, explícale al usuario el motivo (SKU inválido, sin " +
    "stock, cantidad inválida) y pídele que corrija.",
  parametersJsonSchema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        description:
          "Lista de productos a cotizar. Cada elemento debe tener un SKU " +
          "exacto del catálogo y una cantidad entera positiva.",
        items: {
          type: "object",
          properties: {
            sku: {
              type: "string",
              description:
                "SKU exacto del catálogo (case-sensitive). Ejemplos válidos: " +
                "'ValPulpo', 'ValEnd', 'DientesRealistas', 'Endotnissin'. " +
                "Si no estás seguro, llama primero a listar_catalogo o buscar_productos."
            },
            cantidad: {
              type: "integer",
              description: "Cantidad entera positiva, mayor o igual a 1."
            }
          },
          required: ["sku", "cantidad"]
        }
      }
    },
    required: ["items"]
  }
};

// El bloque que se le pasa a Gemini en el config.tools:
const TOOLS = [
  {
    functionDeclarations: [
      buscarProductosDeclaration,
      listarCatalogoDeclaration,
      calcularCotizacionDeclaration
    ]
  }
];

// ----------------------------------------------------------------------------
// 2. Dispatcher: ejecuta el function call que Gemini pidió
// ----------------------------------------------------------------------------

/**
 * Recibe `{ name, args }` (lo que viene en functionCall) y ejecuta la
 * función real, devolviendo siempre un objeto serializable como respuesta.
 *
 * Nunca lanza excepciones hacia arriba: cualquier error lo empaca como
 * `{ ok: false, error: "..." }` para que Gemini pueda explicárselo al
 * usuario en su siguiente turno.
 */
function ejecutarHerramienta({ name, args }) {
  try {
    switch (name) {
      case "buscar_productos": {
        const query = args?.query;
        return buscarProductos(query);
      }

      case "listar_catalogo": {
        return listarCatalogo();
      }

      case "calcular_cotizacion": {
        const items = args?.items;
        return calcularCotizacion(items);
      }

      default:
        return {
          ok: false,
          error: `La herramienta "${name}" no existe. Herramientas válidas: ` +
                 `buscar_productos, listar_catalogo, calcular_cotizacion.`
        };
    }
  } catch (e) {
    // Cualquier excepción inesperada (no debería ocurrir, pero blindamos)
    console.error(`[gemini-tools] Error ejecutando ${name}:`, e);
    return {
      ok: false,
      error:
        "Error interno al ejecutar la herramienta. Pídele al usuario que " +
        "reformule su solicitud o que contacte al especialista por WhatsApp."
    };
  }
}

module.exports = {
  TOOLS,
  ejecutarHerramienta
};
