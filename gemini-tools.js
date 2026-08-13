/**
 * ============================================================================
 *  DECLARACIONES DE HERRAMIENTAS PARA GEMINI  (gemini-tools.js v2)
 * ============================================================================
 *  Aquí le decimos a Gemini qué funciones tiene disponibles.
 *  IMPORTANTE: Las descripciones son lo que el modelo "lee" para decidir
 *  cuándo llamar a cada función. Son prompt engineering, no documentación.
 *
 *  NUEVO EN v2 — las dos herramientas que faltaban para que el asesor deje
 *  de ser un vendedor de dientes y se vuelva el asesor de todo el holding:
 *
 *    5. consultar_division(tema)   → la capa de CONOCIMIENTO.
 *       Sin esto, el modelo improvisa lo que sabe de "impresión 3D" en
 *       general y lo presenta como si fuera capacidad de Valquiria. Con
 *       esto, cada afirmación sobre la empresa sale de conocimiento.js.
 *
 *    6. registrar_interes(...)     → la capa de ACCIÓN para las divisiones
 *       que aún no venden en línea. Antes, una conversación sobre un
 *       proyecto de IA o de empaque terminaba en "escríbenos por WhatsApp"
 *       y se perdía. Ahora queda registrada con su contexto.
 * ============================================================================
 */

const {
  calcularCotizacion,
  buscarProductos,
  listarCatalogo
} = require("./quote-engine.js");

const { consultarConocimiento, normalizarClave } = require("./conocimiento.js");
const { estimarImpresion3D } = require("./impresion3d.js");

// ----------------------------------------------------------------------------
// 1. Declaraciones (lo que Gemini ve)
// ----------------------------------------------------------------------------

const consultarDivisionDeclaration = {
  name: "consultar_division",
  description:
    "Consulta el conocimiento oficial de Valquiria sobre una división, sobre " +
    "la empresa en general, o sobre los procesos de manufactura aditiva. " +
    "OBLIGATORIA antes de afirmar cualquier cosa sobre lo que Valquiria hace, " +
    "puede o no puede hacer. Úsala cuando el usuario pregunte por una división " +
    "('¿qué es Valquiria IA?', '¿hacen empaques?', '¿qué imprimen?'), cuando " +
    "describa un proyecto que podría caer en alguna división, o cuando pregunte " +
    "algo técnico sobre impresión 3D, materiales, FDM o resina. Devuelve " +
    "capacidades reales, preguntas de calificación y —crítico— la lista de lo " +
    "que NO se debe prometer. Nunca inventes capacidades que esta función no " +
    "haya devuelto.",
  parametersJsonSchema: {
    type: "object",
    properties: {
      tema: {
        type: "string",
        description:
          "Uno de: 'empresa' (visión general del holding), 'dental' (material " +
          "pedagógico, la única división que vende en línea), '3d' (manufactura " +
          "aditiva), 'pack' (empaque termoformado), 'lux' (iluminación), 'ia' " +
          "(consultoría y automatización con inteligencia artificial), " +
          "'procesos' (conocimiento técnico: FDM vs resina, materiales, capas, " +
          "soportes, post-procesado)."
      }
    },
    required: ["tema"]
  }
};

const registrarInteresDeclaration = {
  name: "registrar_interes",
  description:
    "Registra el interés de un prospecto en una división que todavía NO vende " +
    "en línea (3D, Pack, Lux, IA) o en una compra de mayoreo. Llámala SOLO " +
    "después de haber entendido el proyecto: primero haz 2-3 preguntas de " +
    "calificación, luego registra. El resumen que escribas es lo que leerá el " +
    "especialista antes de llamar al prospecto, así que escríbelo con detalle " +
    "técnico y en tercera persona. Si el usuario no ha dado datos de contacto, " +
    "pídeselos antes de llamar esta función — sin contacto el registro sirve de " +
    "poco. NO la uses para pedidos normales de Valquiria Dental: esos se " +
    "cotizan y se cierran con calcular_cotizacion.",
  parametersJsonSchema: {
    type: "object",
    properties: {
      division: {
        type: "string",
        description:
          "División a la que corresponde el interés: '3d', 'pack', 'lux', " +
          "'ia', o 'dental' si se trata específicamente de mayoreo o " +
          "distribución."
      },
      resumen: {
        type: "string",
        description:
          "Resumen técnico del proyecto o necesidad, en tercera persona y con " +
          "el detalle que ya obtuviste. Ejemplo: 'Clínica dental de 4 " +
          "consultorios en Pachuca. Hoy agendan por WhatsApp de forma manual, " +
          "aproximadamente 15 h/semana de una recepcionista. Quieren " +
          "automatizar confirmación de citas y recordatorios. Información vive " +
          "en WhatsApp Business y una hoja de cálculo.'"
      },
      nombre: {
        type: "string",
        description: "Nombre de la persona o de la empresa, si lo proporcionó."
      },
      contacto: {
        type: "string",
        description:
          "Correo o teléfono que el usuario haya dado explícitamente en el " +
          "chat. Nunca lo inventes ni lo deduzcas."
      },
      urgencia: {
        type: "string",
        description:
          "Una de: 'exploratoria' (apenas está investigando), 'definida' " +
          "(tiene el proyecto claro), 'inmediata' (quiere arrancar ya)."
      }
    },
    required: ["division", "resumen"]
  }
};

const buscarProductosDeclaration = {
  name: "buscar_productos",
  description:
    "Busca productos del catálogo Valquiria Dental por palabras clave. " +
    "Úsala cuando el usuario describe lo que necesita en lenguaje natural " +
    "(por ejemplo: 'algo para endodoncia', 'tienen dientes para Nissin', " +
    "'busco material para pediatría'). Devuelve hasta 5 resultados con SKU, " +
    "nombre, precio y stock. NO inventes precios ni SKUs: usa solo lo que " +
    "esta función devuelva. Solo aplica a Valquiria Dental — las demás " +
    "divisiones no tienen catálogo en línea.",
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

const estimarImpresion3dDeclaration = {
  name: "estimar_impresion_3d",
  description:
    "Calcula la estimación PRELIMINAR de un trabajo de impresión 3D de " +
    "Valquiria 3D. Es la ÚNICA fuente de números para impresión 3D: NUNCA " +
    "calcules tú un precio por gramo ni por hora. La regla comercial es que " +
    "se cobra por gramo O por hora de impresión, lo que más convenga al " +
    "cliente — la función aplica esa regla sola si le das ambos datos. " +
    "Úsala en cuanto el usuario tenga un peso aproximado en gramos; si no lo " +
    "sabe, ayúdale a estimarlo (un llavero pesa 5-15 g, una taza ~100 g, un " +
    "casco 400-800 g) o pídele el archivo por WhatsApp. Presenta el " +
    "resultado SIEMPRE como estimación preliminar: la cifra final la " +
    "confirma un especialista con el archivo STL/STEP en la mano. NO la uses " +
    "para productos del catálogo Dental (esos van con calcular_cotizacion) " +
    "ni para empaque termoformado (Pack no da precios por chat).",
  parametersJsonSchema: {
    type: "object",
    properties: {
      material: {
        type: "string",
        description:
          "Material de impresión: 'pla', 'petg', 'abs' (o ASA), 'tpu' " +
          "(flexible) o 'resina'. Si el usuario no sabe cuál, sugiérelo por " +
          "el uso: aguantar → PETG/ABS, verse con detalle → resina, uso " +
          "general → PLA."
      },
      gramos: {
        type: "number",
        description: "Peso estimado de UNA pieza, en gramos. Mayor a 0."
      },
      horas: {
        type: "number",
        description:
          "Horas de impresión estimadas de UNA pieza. Opcional: si se " +
          "incluye, la función cobra por gramo o por hora, lo que salga más " +
          "barato para el cliente."
      },
      cantidad: {
        type: "integer",
        description: "Número de piezas idénticas. Por defecto 1. Máximo 500."
      },
      postprocesado: {
        type: "string",
        description:
          "Acabado: 'ninguno' (default), 'lijado' (+20%) o 'pintura' " +
          "(+50%, incluye lijado)."
      }
    },
    required: ["material", "gramos"]
  }
};

// El bloque que se le pasa a Gemini en el config.tools:
const TOOLS = [
  {
    functionDeclarations: [
      consultarDivisionDeclaration,
      buscarProductosDeclaration,
      listarCatalogoDeclaration,
      calcularCotizacionDeclaration,
      estimarImpresion3dDeclaration,
      registrarInteresDeclaration
    ]
  }
];

// ----------------------------------------------------------------------------
// 2. Registro de interés (leads)
// ----------------------------------------------------------------------------
//  Render tiene sistema de archivos efímero: escribir a disco NO sirve, se
//  borra en cada deploy. Así que hacemos tres cosas:
//    a) Log estructurado a consola  → queda en los logs de Render, buscable.
//    b) Buffer en memoria           → consultable en /api/leads mientras viva
//                                     el proceso.
//    c) Webhook opcional            → si defines LEADS_WEBHOOK_URL, se manda
//                                     ahí (Zapier, Make, un Apps Script que
//                                     escriba en Google Sheets, lo que sea).
//                                     Esta es la que debes activar en cuanto
//                                     el sitio reciba tráfico real.
// ----------------------------------------------------------------------------

const LEADS_EN_MEMORIA = [];
const MAX_LEADS_MEMORIA = 200;

function registrarInteres(args) {
  const division = normalizarClave(args?.division) || "sin_clasificar";
  const resumen = typeof args?.resumen === "string" ? args.resumen.trim() : "";

  if (resumen.length < 20) {
    return {
      ok: false,
      error:
        "El resumen es demasiado breve para que un especialista pueda dar " +
        "seguimiento. Haz una o dos preguntas más al usuario sobre su " +
        "proyecto y vuelve a registrar con más detalle."
    };
  }

  const lead = {
    id: `VQ-${Date.now().toString(36).toUpperCase()}`,
    fecha: new Date().toISOString(),
    division,
    resumen: resumen.slice(0, 1500),
    nombre: typeof args?.nombre === "string" ? args.nombre.slice(0, 120) : null,
    contacto: typeof args?.contacto === "string" ? args.contacto.slice(0, 160) : null,
    urgencia: ["exploratoria", "definida", "inmediata"].includes(args?.urgencia)
      ? args.urgencia
      : "exploratoria"
  };

  LEADS_EN_MEMORIA.push(lead);
  if (LEADS_EN_MEMORIA.length > MAX_LEADS_MEMORIA) LEADS_EN_MEMORIA.shift();

  console.log(`[LEAD] ${JSON.stringify(lead)}`);

  // Webhook opcional, sin await: si tarda o falla, el usuario no lo sufre.
  const webhook = process.env.LEADS_WEBHOOK_URL;
  if (webhook) {
    fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(lead)
    }).catch(e => console.error("[LEAD] Webhook falló:", e.message));
  }

  return {
    ok: true,
    folio: lead.id,
    division: lead.division,
    tiene_contacto: Boolean(lead.contacto),
    mensaje_para_asesor:
      lead.contacto
        ? `Interés registrado con folio ${lead.id}. Confírmale al usuario que ` +
          `un especialista lo contactará, menciona el folio, y ofrécele el ` +
          `WhatsApp por si prefiere adelantarse.`
        : `Interés registrado con folio ${lead.id}, PERO sin datos de contacto. ` +
          `Pídele al usuario un correo o teléfono, o dale el WhatsApp para que ` +
          `él inicie la conversación.`
  };
}

function obtenerLeads() {
  return LEADS_EN_MEMORIA.slice().reverse();
}

// ----------------------------------------------------------------------------
// 3. Dispatcher: ejecuta el function call que Gemini pidió
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
      case "consultar_division":
        return consultarConocimiento(args?.tema);

      case "buscar_productos":
        return buscarProductos(args?.query);

      case "listar_catalogo":
        return listarCatalogo();

      case "calcular_cotizacion":
        return calcularCotizacion(args?.items);

      case "estimar_impresion_3d":
        return estimarImpresion3D(args);

      case "registrar_interes":
        return registrarInteres(args);

      default:
        return {
          ok: false,
          error:
            `La herramienta "${name}" no existe. Herramientas válidas: ` +
            `consultar_division, buscar_productos, listar_catalogo, ` +
            `calcular_cotizacion, estimar_impresion_3d, registrar_interes.`
        };
    }
  } catch (e) {
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
  ejecutarHerramienta,
  obtenerLeads
};
