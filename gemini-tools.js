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
const { resolverSku } = require("./resolver-productos.js");
const { getProductoPorSku } = require("./catalog.js");

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
    "Calcula la cotización exacta (subtotal, envío, total) Y deja el carrito " +
    "del cliente en el estado que resulte. SIEMPRE usa esta función para " +
    "cualquier cálculo de precios; NUNCA hagas sumas tú mismo.\n\n" +
    "REGLA DE ORO: si el usuario menciona VARIOS productos en un mismo " +
    "mensaje, extráelos TODOS en UNA SOLA llamada, con un elemento de 'items' " +
    "por producto. Ejemplo: «2 endo, 1 pulpo, 3 realistas y 2 nissin» son " +
    "CUATRO elementos en una sola llamada. Nunca partas la lista en varias " +
    "llamadas y nunca omitas un producto que el usuario nombró.\n\n" +
    "No necesitas saber el SKU: escribe en 'producto' lo que dijo el usuario " +
    "('endo', 'pulpo', 'nissin', 'kit completo') y el servidor lo identifica, " +
    "incluso con erratas. NO llames buscar_productos antes de cotizar solo " +
    "para averiguar un SKU: es un viaje innecesario y es donde se pierden " +
    "artículos.\n\n" +
    "Usa 'accion' para editar el carrito sin rehacer la cuenta a mano. Si la " +
    "función devuelve ok=false, explica el motivo al usuario y pide la " +
    "corrección.",
  parametersJsonSchema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        description:
          "TODOS los productos que el usuario mencionó en su mensaje, uno por " +
          "elemento. Con accion='vaciar' se omite o va vacío.",
        items: {
          type: "object",
          properties: {
            producto: {
              type: "string",
              description:
                "Cómo lo nombró el usuario, tal cual: 'endo', 'pulpo', " +
                "'realistas', 'nissin', 'kit completo', 'pediatría'. Se " +
                "toleran erratas ('nisiin' se entiende como 'nissin'). Esta " +
                "es la forma preferida."
            },
            sku: {
              type: "string",
              description:
                "SKU exacto, si ya lo conoces con certeza: 'ValPulpo', " +
                "'ValEnd', 'DientesRealistas', 'Endotnissin'. Alternativa a " +
                "'producto'; basta con uno de los dos."
            },
            cantidad: {
              type: "integer",
              description:
                "Cantidad entera positiva. Con accion='quitar' puede " +
                "omitirse para retirar la línea completa."
            }
          },
          required: ["cantidad"]
        }
      },
      accion: {
        type: "string",
        description:
          "Qué hacer con el carrito actual del cliente (lo ves en el contexto " +
          "de la sesión). Uno de:\n" +
          "· 'reemplazar' (POR DEFECTO) — el carrito queda EXACTAMENTE con " +
          "los items de esta llamada. Úsala para un pedido nuevo y para " +
          "«vacía el carrito y ponme esto».\n" +
          "· 'agregar' — suma estos items a lo que ya había. Para «agrégame " +
          "2 nissin más».\n" +
          "· 'quitar' — resta estos items de lo que había. Para «quita los de " +
          "endodoncia». Sin 'cantidad', retira la línea entera.\n" +
          "· 'fijar' — deja estos productos en la cantidad indicada y NO toca " +
          "el resto del carrito. Para «de los endo ponme 5».\n" +
          "· 'vaciar' — deja el carrito vacío. No requiere items."
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
// 1-bis. COTIZACIÓN CON ESTADO DE CARRITO
// ----------------------------------------------------------------------------
//  El modelo declara una INTENCIÓN («quita los de endodoncia») y aquí se
//  calcula el estado final. Antes le tocaba a él hacer esa aritmética de
//  conjuntos mientras además recordaba el carrito, y es donde fallaba: sumaba
//  en vez de reemplazar, o se dejaba una línea al reescribir el pedido.
//
//  El carrito de verdad no llega del modelo sino de `ctx`, que server.js llena
//  con el carrito del cliente ya saneado contra el catálogo. Si el modelo se
//  equivoca de estado, la cuenta sigue saliendo bien.
// ----------------------------------------------------------------------------

const ACCIONES = ["reemplazar", "agregar", "quitar", "fijar", "vaciar"];

/** Convierte [{sku,cantidad}] en Map(sku → cantidad). */
function aMapa(items) {
  const m = new Map();
  for (const it of items || []) {
    if (!it || typeof it.sku !== "string") continue;
    const n = Number(it.cantidad);
    if (!Number.isInteger(n) || n <= 0) continue;
    m.set(it.sku, (m.get(it.sku) || 0) + n);
  }
  return m;
}

const aLista = (mapa) =>
  [...mapa.entries()].map(([sku, cantidad]) => ({ sku, cantidad }));

/**
 * Resuelve los items que mandó el modelo a SKUs reales.
 * Devuelve { resueltos, fallos, dudosos }.
 */
function resolverItems(items) {
  const resueltos = [];
  const fallos = [];
  const dudosos = [];

  for (const it of items || []) {
    if (!it || typeof it !== "object") continue;
    const texto =
      (typeof it.producto === "string" && it.producto.trim()) ||
      (typeof it.sku === "string" && it.sku.trim()) || "";
    if (!texto) {
      fallos.push({ texto: "(sin nombre)", motivo: "El item no trae 'producto' ni 'sku'." });
      continue;
    }

    const r = resolverSku(texto);
    if (!r.ok) {
      fallos.push({ texto, motivo: r.error });
      continue;
    }
    if (r.confianza === "baja") {
      dudosos.push({ texto, elegido: r.sku, alternativas: r.alternativas || [] });
    }

    /* La cantidad puede faltar a propósito en 'quitar' (= la línea entera).
       Se marca con null y cada acción decide qué significa. */
    const n = it.cantidad == null ? null : Number(it.cantidad);
    resueltos.push({
      sku: r.sku,
      nombre: r.nombre,
      cantidad: n == null ? null : n,
      texto_original: texto,
      confianza: r.confianza
    });
  }
  return { resueltos, fallos, dudosos };
}

/**
 * Cotiza aplicando una acción sobre el carrito actual.
 *
 * @param {object} args              lo que mandó el modelo
 * @param {Array}  carritoActual     [{sku,cantidad}] ya saneado por server.js
 */
function cotizarConCarrito(args, carritoActual) {
  const accion = ACCIONES.includes(String(args?.accion || "").toLowerCase())
    ? String(args.accion).toLowerCase()
    : "reemplazar";

  const carrito = aMapa(carritoActual);

  /* — Vaciar no necesita items ni motor de precios — */
  if (accion === "vaciar") {
    return {
      ok: true,
      accion,
      carrito_vacio: true,
      carrito_final: [],
      lineas: [],
      total: "$0.00 MXN",
      mensaje_para_asesor:
        "El carrito quedó vacío. Confírmaselo al usuario en una línea y " +
        "pregúntale qué quiere poner en su lugar."
    };
  }

  const { resueltos, fallos, dudosos } = resolverItems(args?.items);

  /* Si NADA se pudo identificar, no se toca el carrito: se pregunta. */
  if (!resueltos.length) {
    return {
      ok: false,
      error:
        fallos.length
          ? `No pude identificar estos productos: ${fallos.map(f => `"${f.texto}"`).join(", ")}. ` +
            `Pregúntale al usuario a cuál se refiere, o llama listar_catalogo ` +
            `y ofrécele las opciones.`
          : "No recibí ningún producto que cotizar.",
      no_identificados: fallos
    };
  }

  /* — Estado final según la acción — */
  let final;
  if (accion === "reemplazar") {
    final = new Map();
    for (const r of resueltos) {
      const n = r.cantidad == null ? 1 : r.cantidad;
      final.set(r.sku, (final.get(r.sku) || 0) + n);
    }
  } else if (accion === "agregar") {
    final = new Map(carrito);
    for (const r of resueltos) {
      const n = r.cantidad == null ? 1 : r.cantidad;
      final.set(r.sku, (final.get(r.sku) || 0) + n);
    }
  } else if (accion === "fijar") {
    final = new Map(carrito);
    for (const r of resueltos) {
      const n = r.cantidad == null ? 1 : r.cantidad;
      if (n <= 0) final.delete(r.sku);
      else final.set(r.sku, n);
    }
  } else { // quitar
    final = new Map(carrito);
    for (const r of resueltos) {
      if (r.cantidad == null) { final.delete(r.sku); continue; }
      const queda = (final.get(r.sku) || 0) - r.cantidad;
      if (queda > 0) final.set(r.sku, queda);
      else final.delete(r.sku);
    }
  }

  /* Quitar puede dejar el carrito en cero, y eso es un éxito, no un error:
     el motor de precios rechaza las listas vacías, así que se responde aquí. */
  if (final.size === 0) {
    return {
      ok: true,
      accion,
      carrito_vacio: true,
      carrito_final: [],
      lineas: [],
      total: "$0.00 MXN",
      mensaje_para_asesor:
        "Al aplicar los cambios el carrito quedó vacío. Díselo al usuario y " +
        "pregúntale si quiere agregar algo más."
    };
  }

  const cot = calcularCotizacion(aLista(final));
  if (!cot.ok) return { ...cot, accion };

  /* Avisos para que el asesor confirme en su respuesta, sin inventarlos. */
  const avisos = [];
  if (fallos.length) {
    avisos.push(
      `No identifiqué ${fallos.map(f => `"${f.texto}"`).join(", ")}; ` +
      `el resto sí se cotizó. Pregúntale al usuario por esos.`
    );
  }
  for (const d of dudosos) {
    avisos.push(
      `"${d.texto}" es ambiguo: elegí ${d.elegido}, pero también podría ser ` +
      `${d.alternativas.filter(a => a.sku !== d.elegido).map(a => a.sku).join(" o ")}. ` +
      `Confírmalo con el usuario en una línea.`
    );
  }
  /* Cuando el usuario escribió con erratas, el asesor debe reflejar el nombre
     BUENO — así el cliente ve que se le entendió y de paso aprende el nombre. */
  const corregidos = resueltos
    .filter(r => r.confianza === "alta" &&
                 r.texto_original.toLowerCase() !== r.sku.toLowerCase())
    .map(r => `"${r.texto_original}" → ${r.nombre}`);
  if (corregidos.length) {
    avisos.push(
      `Interpreté ${corregidos.join(", ")}. Usa el nombre correcto del ` +
      `producto en tu respuesta.`
    );
  }

  return {
    ...cot,
    accion,
    carrito_final: aLista(final),
    avisos: avisos.length ? avisos : undefined
  };
}

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

  /* El log estructurado es la última red: aunque el webhook no exista y el
     proceso se reinicie, el lead queda en los logs de Render y se puede
     rescatar buscando "[LEAD]". */
  console.log(`[LEAD] ${JSON.stringify(lead)}`);

  const webhook = process.env.LEADS_WEBHOOK_URL;
  if (!webhook) {
    /* Render reinicia el proceso al desplegar y cuando el plan gratuito
       duerme el servicio. Sin webhook, este prospecto vive solo en memoria y
       en el log: es exactamente así como se pierde un cliente. */
    console.warn(
      `[LEAD] ⚠️  ${lead.id} solo existe en memoria y en este log: falta ` +
      `LEADS_WEBHOOK_URL. Al reiniciarse Render se pierde el registro ` +
      `consultable. Ver SEGURIDAD.md.`
    );
    return respuestaLead(lead);
  }

  /* Sin await: el usuario no espera por esto. Con reintentos, porque un lead
     perdido por un hipo de red es dinero perdido. */
  enviarConReintento(webhook, lead, 3);

  return respuestaLead(lead);
}

/**
 * POST con reintentos y espera creciente. Tres intentos cubren el fallo
 * transitorio típico —el servicio que despierta, el DNS que tarda— sin
 * convertirse en un martillo si el destino está caído de verdad.
 */
function enviarConReintento(url, cuerpo, intentos, n = 1) {
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(10_000)
  })
    .then(r => {
      if (r.ok) return;
      throw new Error(`HTTP ${r.status}`);
    })
    .catch(e => {
      if (n >= intentos) {
        console.error(
          `[LEAD] ⚠️  Webhook falló ${intentos} veces (${e.message}). El lead ` +
          `${cuerpo.id || ""} SOLO queda en este log. Revísalo a mano.`
        );
        return;
      }
      const espera = 2000 * n;
      console.warn(`[LEAD] Webhook falló (${e.message}); reintento ${n + 1}/${intentos} en ${espera}ms`);
      setTimeout(() => enviarConReintento(url, cuerpo, intentos, n + 1), espera).unref?.();
    });
}

function respuestaLead(lead) {

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
function ejecutarHerramienta({ name, args }, ctx = {}) {
  try {
    switch (name) {
      case "consultar_division":
        return consultarConocimiento(args?.tema);

      case "buscar_productos":
        return buscarProductos(args?.query);

      case "listar_catalogo":
        return listarCatalogo();

      case "calcular_cotizacion":
        /* `ctx.carrito` es el carrito REAL del cliente, saneado en server.js.
           No se toma del historial ni de lo que crea el modelo: si él pierde
           el hilo del estado, la cuenta sigue saliendo bien. */
        return cotizarConCarrito(args, ctx.carrito || []);

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
  obtenerLeads,
  // Exportados para tests:
  cotizarConCarrito,
  resolverItems
};
