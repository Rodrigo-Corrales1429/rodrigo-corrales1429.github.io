/**
 * ============================================================================
 *  VALQUIRIA — BACKEND DEL ASESOR (server.js v3)
 * ============================================================================
 *  Cambios v3:
 *  - El endpoint /api/chat ahora devuelve { reply, products, cotizacion }.
 *    - reply: el texto del bot (como antes).
 *    - products: lista de productos con imagen para que el frontend
 *      renderice tarjetas visuales debajo del mensaje.
 *    - cotizacion: el último cálculo de cotización (si lo hubo) por si el
 *      frontend quiere renderizar un resumen visual estructurado.
 *  - Solo se devuelven productos cuando el bot llamó buscar_productos o
 *    listar_catalogo (no cuando solo cotizó). Esto evita saturar el chat.
 * ============================================================================
 */

const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { GoogleGenAI, FunctionCallingConfigMode } = require("@google/genai");

const { TOOLS, ejecutarHerramienta } = require("./gemini-tools.js");
const { getProductoPorSku } = require("./catalog.js");
const { centavosAPesos } = require("./quote-engine.js");

const app = express();
const port = process.env.PORT || 3000;

// ----------------------------------------------------------------------------
// CONFIGURACIÓN
// ----------------------------------------------------------------------------

const ORIGENES_PERMITIDOS = [
  "https://valquiriainc.com",
  "https://www.valquiriainc.com",
  "https://rodrigo-corrales1429.github.io",
  "http://127.0.0.1:5500",
  "http://localhost:5500",
  "http://localhost:3000"
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      if (ORIGENES_PERMITIDOS.includes(origin)) return callback(null, true);
      return callback(new Error(`Origen no permitido por CORS: ${origin}`));
    }
  })
);
app.use(express.json({ limit: "100kb" }));

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const MODELO = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const MAX_ITERACIONES_FUNCTION_CALL = 5;
const TIMEOUT_GEMINI_MS = 45000;

// ----------------------------------------------------------------------------
// SYSTEM PROMPT (v3 — con instrucciones sobre tarjetas visuales)
// ----------------------------------------------------------------------------
const SYSTEM_PROMPT = `Eres el "Asesor Valquiria", el conserje digital premium de Valquiria Inc.

# IDENTIDAD
Tono sofisticado, profesional, cortés y servicial — como un consultor de gama
alta. Hablas claro, breve, sin tecnicismos innecesarios. Eres MUY proactivo:
nunca dejas al usuario sin opciones ni próximos pasos.

# SOBRE LA EMPRESA
Valquiria Inc. es un holding latinoamericano con cuatro divisiones:
1. Valquiria 3D — Manufactura aditiva (FDM y resina de alta resolución).
2. Valquiria Dental — Material pedagógico para odontología (catálogo activo).
3. Valquiria Pack — Empaques termoformados premium.
4. Valquiria Lux — Iluminación con manufactura aditiva.

Filosofía: "Innovación · Precisión · Diseño". No fabricamos productos:
diseñamos soluciones.

# REGLA INVIOLABLE — NUNCA HAGAS MATEMÁTICA
Tú NO calculas precios, sumas, descuentos ni costos de envío. Para cualquier
número que aparezca en tu respuesta usa SIEMPRE las herramientas:

- buscar_productos(query): cuando el usuario describe lo que necesita.
- listar_catalogo(): cuando pide ver todo, o cuando NO entiendes su intención.
- calcular_cotizacion(items): cuando hay que dar un total parcial o final.

Si no usaste la herramienta, NO menciones precios.

# IMÁGENES Y TARJETAS — IMPORTANTE
Cuando llames buscar_productos o listar_catalogo, el sistema mostrará
automáticamente al usuario tarjetas visuales con foto, nombre, precio y un
botón "Cotizar este" debajo de tu mensaje. Por eso:

- NUNCA incluyas URLs de imágenes en tu respuesta.
- NO repitas demasiados detalles que ya están en la tarjeta.
- Sé BREVE en la introducción ("Tenemos estas opciones para tu práctica:")
  y deja que las tarjetas hagan el trabajo visual.
- Termina con una pregunta concreta.

# DETECTAR INTENCIÓN — REGLA CRÍTICA
Lee el mensaje del usuario y clasifícalo en UNA de tres intenciones antes
de actuar:

## Intención A — DESCUBRIMIENTO ("¿qué tienen?", "busco algo para X")
El usuario explora. Usa buscar_productos o listar_catalogo y deja que las
tarjetas hagan el trabajo. Termina con una pregunta concreta.

## Intención B — COMPRA DIRECTA ("comprar 2 endos", "quiero 1 kit nissin",
"dame 3 de pulpotomía")
El usuario YA decidió. Acción inmediata:
1. Identifica el SKU más probable (un solo producto, el principal de esa
   palabra clave: "endo" → ValEnd, "nissin" → Endotnissin, "pulpotomía"
   o "pulpo" → ValPulpo, "kit completo" o "32 dientes" → DientesRealistas).
2. Llama calcular_cotizacion DIRECTAMENTE con ese SKU y la cantidad pedida.
   NO llames buscar_productos. NO ofrezcas alternativas. NO preguntes
   "cuál de los tres".
3. Presenta el total e invita al cierre: "¿Confirmas para generar tu link
   de pago?".

Si tienes duda razonable entre 2 SKUs (raro), elige el más popular y di
algo como: "Te cotizo el Dientes Valquiria Para Endodoncia que es el más
solicitado. Si preferías el Tipo Nissin, dímelo y lo cambio." Pero
siempre cotiza algo de inmediato — nunca regreses al usuario sin total.

## Intención C — CONFIRMACIÓN / CIERRE ("sí", "confirmo", "lo quiero",
"procede", "comprar")
El usuario ya vio una cotización y quiere pagar. Por ahora, pídele un
momento para procesar el cobro y dile que en breve recibirá su link de
pago. (En la próxima versión esta acción generará el link automáticamente.)

# REGLAS POST-COTIZACIÓN — CRÍTICAS
DESPUÉS de llamar calcular_cotizacion exitosamente NUNCA hagas estas cosas
en el mismo turno:
- NO llames buscar_productos para "sugerir alternativas".
- NO llames listar_catalogo "por si quiere ver más".
- NO sugieras productos extra para hacer upsell con tarjetas.

El upsell de envío gratis se hace SOLO con texto, mencionando una sola
sugerencia natural. Ejemplo correcto: "Tu pedido está a $195 MXN del envío
gratis. Si agregas un Kit de Pulpotomía superas el umbral. ¿Lo agrego?"
Ejemplo INCORRECTO: llamar buscar_productos otra vez para mostrar tarjetas.

# REGLA DE ORO — NUNCA TE RINDAS
JAMÁS respondas "no entendí" o "reformula tu solicitud". Tolera typos:
- "endo" → endodoncia (ValEnd)
- "pulpo" → pulpotomía (ValPulpo)
- "nisin" / "nicin" / "nissim" → nissin (Endotnissin)
- "pediatria" → odontopediatría (ValPulpo)
- "boca completa" / "32 dientes" / "kit avanzado" → DientesRealistas

Si solo saluda ("hola", "ayúdame"), llama listar_catalogo.

# CÓMO PRESENTAR UNA COTIZACIÓN
Cuando calcular_cotizacion devuelva ok=true:
- Lista breve con cada producto, cantidad y subtotal.
- Subtotal, envío (indicando si es gratis), y **TOTAL FINAL en negritas**.
- Si el campo "upsell" no es null, sugiere agregar otro producto para
  superar el umbral de envío gratis. Solo una vez, sin presionar.

Si calcular_cotizacion devuelve ok=false, explícale el problema al usuario
con tus propias palabras (SKU no existe, sin stock, cantidad inválida) y
pídele que corrija.

# DERIVACIÓN A ESPECIALISTA
Deriva a WhatsApp (+52 55 5467 5821) o ventas@valquiriadental.com SOLO cuando:
- Pide mayoreo / volumen (más de 20 piezas en una línea).
- Necesita factura, datos fiscales o condiciones de pago especiales.
- Su pregunta técnica es muy específica (compatibilidad puntual,
  personalizaciones, tiempos exactos de entrega).

NO derives cuando el usuario solo quiere comprar uno o pocos productos
estándar — eso lo cotizas tú directamente.

# FORMATO
Respuestas breves: 2-3 párrafos cortos máximo. El widget de chat es pequeño.
Usa **negritas** Markdown solo para nombres de productos y para totales.
No uses emojis salvo cuando el usuario los use primero.`;

// ----------------------------------------------------------------------------
// HELPERS
// ----------------------------------------------------------------------------

function conTimeout(promise, ms, msg = "Timeout") {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))
  ]);
}

function limpiarHistorial(messages) {
  const idxPrimerUser = messages.findIndex(m => m.role === "user");
  if (idxPrimerUser === -1) {
    throw new Error("No hay ningún mensaje del usuario en el historial.");
  }
  return messages.slice(idxPrimerUser);
}

function validarHistorial(messages) {
  if (!Array.isArray(messages)) {
    throw new Error("El campo 'messages' debe ser un arreglo.");
  }
  if (messages.length === 0) {
    throw new Error("El historial está vacío.");
  }
  if (messages.length > 60) {
    throw new Error("El historial es demasiado largo. Reinicia la conversación.");
  }
  for (const m of messages) {
    if (!m || (m.role !== "user" && m.role !== "model")) {
      throw new Error("Cada mensaje debe tener role 'user' o 'model'.");
    }
    if (!Array.isArray(m.parts)) {
      throw new Error("Cada mensaje debe tener un arreglo 'parts'.");
    }
  }
  return messages;
}

function extraerTexto(response) {
  if (typeof response?.text === "string" && response.text.trim() !== "") {
    return response.text;
  }
  const partes = response?.candidates?.[0]?.content?.parts || [];
  return partes.map(p => p.text || "").join("").trim();
}

function extraerFunctionCalls(response) {
  if (Array.isArray(response?.functionCalls) && response.functionCalls.length > 0) {
    return response.functionCalls;
  }
  const partes = response?.candidates?.[0]?.content?.parts || [];
  return partes
    .filter(p => p.functionCall)
    .map(p => p.functionCall);
}

/**
 * Construye una "tarjeta de producto" lista para que el frontend la renderice.
 * Incluye solo lo necesario para la tarjeta visual (no la descripción larga).
 */
function tarjetaProducto(sku) {
  const p = getProductoPorSku(sku);
  if (!p) return null;
  return {
    sku: p.sku,
    nombre: p.nombre,
    imagen: p.imagen,
    precio: centavosAPesos(p.precio_centavos),
    precio_regular: centavosAPesos(p.precio_regular_centavos),
    descripcion: p.descripcion_corta
  };
}

// ----------------------------------------------------------------------------
// LOOP DE FUNCTION CALLING
// ----------------------------------------------------------------------------

/**
 * Devuelve { reply, products, cotizacion } donde:
 * - reply: el texto que dirá el bot.
 * - products: array de tarjetas a mostrar (puede estar vacío).
 * - cotizacion: la última cotización exitosa (puede ser null).
 */
async function correrConversacion(historialInicial) {
  const contents = [...historialInicial];

  // SKUs que el bot mencionó en su última operación de búsqueda/listado.
  // Estos son los que el frontend renderizará como tarjetas.
  let skusParaTarjetas = [];
  let ultimaCotizacion = null;

  for (let iter = 0; iter < MAX_ITERACIONES_FUNCTION_CALL; iter++) {
    const response = await conTimeout(
      ai.models.generateContent({
        model: MODELO,
        contents,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          tools: TOOLS,
          temperature: 0.5
        }
      }),
      TIMEOUT_GEMINI_MS,
      "Gemini no respondió a tiempo (45s). Por favor reintenta."
    );

    const functionCalls = extraerFunctionCalls(response);

    if (functionCalls.length > 0) {
      const partesModelo = functionCalls.map(fc => ({ functionCall: fc }));
      contents.push({ role: "model", parts: partesModelo });

      const partesRespuesta = [];
      for (const fc of functionCalls) {
        const resultado = ejecutarHerramienta({
          name: fc.name,
          args: fc.args || {}
        });

        const argsStr = JSON.stringify(fc.args || {});
        const okStr = resultado.ok ? "OK" : "ERR";
        console.log(
          `[fn-call] iter=${iter} ${fc.name}(${argsStr}) -> ${okStr}` +
          (resultado.cantidad_resultados !== undefined
            ? ` (${resultado.cantidad_resultados} resultados, exacto=${resultado.coincidencia_exacta})`
            : "") +
          (resultado.error ? ` error="${resultado.error.slice(0, 80)}"` : "")
        );

        // ---- Recolectar SKUs para tarjetas visuales ----
        // Solo de buscar_productos y listar_catalogo. NO de calcular_cotizacion
        // (cuando se cotiza, el bot ya da los totales en texto y no queremos
        // duplicar tarjetas visuales).
        if (resultado.ok) {
          if (fc.name === "buscar_productos" && Array.isArray(resultado.resultados)) {
            skusParaTarjetas = resultado.resultados.map(p => p.sku);
          } else if (fc.name === "listar_catalogo" && Array.isArray(resultado.productos)) {
            skusParaTarjetas = resultado.productos.map(p => p.sku);
          } else if (fc.name === "calcular_cotizacion" && Array.isArray(resultado.lineas)) {
            ultimaCotizacion = resultado;
          }
        }

        partesRespuesta.push({
          functionResponse: {
            name: fc.name,
            response: resultado
          }
        });
      }

      contents.push({ role: "user", parts: partesRespuesta });
      continue;
    }

    const texto = extraerTexto(response);
    if (texto && texto.trim() !== "") {
      // Si en este turno hubo una cotización exitosa, las tarjetas son ruido:
      // la cotización es la respuesta principal y duplicar productos confunde.
      const productosFinales = ultimaCotizacion
        ? []
        : skusParaTarjetas
            .map(sku => tarjetaProducto(sku))
            .filter(Boolean)
            .slice(0, 4);

      return {
        reply: texto,
        products: productosFinales,
        cotizacion: ultimaCotizacion
      };
    }

    // Caso: respuesta vacía → rescate forzando listar_catalogo
    console.warn(
      `[fallback] iter=${iter}: respuesta vacía sin function calls. ` +
      `Lanzando rescate con listar_catalogo forzada.`
    );

    const ultimoMensajeUsuario =
      historialInicial[historialInicial.length - 1]?.parts
        ?.map(p => p.text || "")
        .join(" ")
        .trim() || "";

    const rescatePrompt = [
      ...contents,
      {
        role: "user",
        parts: [{
          text:
            "[Sistema] Tu respuesta anterior vino vacía. Llama listar_catalogo " +
            "y, con sus resultados, redacta una respuesta proactiva que ofrezca " +
            "opciones al usuario y haga una pregunta concreta para avanzar. " +
            `El usuario originalmente escribió: "${ultimoMensajeUsuario}".`
        }]
      }
    ];

    const responseRescate = await conTimeout(
      ai.models.generateContent({
        model: MODELO,
        contents: rescatePrompt,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          tools: TOOLS,
          toolConfig: {
            functionCallingConfig: {
              mode: FunctionCallingConfigMode.ANY,
              allowedFunctionNames: ["listar_catalogo"]
            }
          },
          temperature: 0.5
        }
      }),
      TIMEOUT_GEMINI_MS,
      "Timeout en intento de rescate."
    );

    const rescateFcs = extraerFunctionCalls(responseRescate);
    if (rescateFcs.length > 0) {
      const partesRescateModel = rescateFcs.map(fc => ({ functionCall: fc }));
      const partesRescateResp = [];

      for (const fc of rescateFcs) {
        const resultado = ejecutarHerramienta({ name: fc.name, args: fc.args || {} });
        if (
          resultado.ok &&
          fc.name === "listar_catalogo" &&
          Array.isArray(resultado.productos)
        ) {
          skusParaTarjetas = resultado.productos.map(p => p.sku);
        }
        partesRescateResp.push({
          functionResponse: { name: fc.name, response: resultado }
        });
      }

      const responseFinal = await conTimeout(
        ai.models.generateContent({
          model: MODELO,
          contents: [
            ...contents,
            { role: "model", parts: partesRescateModel },
            { role: "user", parts: partesRescateResp }
          ],
          config: {
            systemInstruction: SYSTEM_PROMPT,
            tools: TOOLS,
            temperature: 0.5
          }
        }),
        TIMEOUT_GEMINI_MS,
        "Timeout en respuesta final del rescate."
      );

      const textoFinal = extraerTexto(responseFinal);
      if (textoFinal && textoFinal.trim() !== "") {
        console.log(`[fallback] Rescate exitoso.`);
        const productosFinales = ultimaCotizacion
          ? []
          : skusParaTarjetas
              .map(sku => tarjetaProducto(sku))
              .filter(Boolean)
              .slice(0, 4);
        return {
          reply: textoFinal,
          products: productosFinales,
          cotizacion: ultimaCotizacion
        };
      }
    }

    console.warn(`[fallback] Rescate también vino vacío. Usando mensaje fijo.`);
    return {
      reply:
        "Cuéntame un poco más sobre lo que necesitas. Por ejemplo, ¿buscas " +
        "material para **endodoncia**, **pulpotomía**, un **kit completo de " +
        "32 dientes**, o algo compatible con **tipodonto Nissin**? También " +
        "puedo mostrarte el catálogo completo si gustas.",
      products: [],
      cotizacion: null
    };
  }

  console.warn(
    `[loop] Se alcanzó el tope de ${MAX_ITERACIONES_FUNCTION_CALL} iteraciones.`
  );
  return {
    reply:
      "Estoy teniendo dificultad para procesar esta solicitud. ¿Podrías " +
      "escribirla de otra forma, o prefieres que un especialista te atienda " +
      "directamente por WhatsApp?",
    products: [],
    cotizacion: null
  };
}

// ----------------------------------------------------------------------------
// ENDPOINTS
// ----------------------------------------------------------------------------

app.get("/", (req, res) => {
  res.json({ status: "ok", service: "Valquiria Asesor Backend v3" });
});

app.get("/health", (req, res) => {
  res.json({ ok: true, modelo: MODELO });
});

app.post("/api/chat", async (req, res) => {
  try {
    if (
      !process.env.GEMINI_API_KEY ||
      process.env.GEMINI_API_KEY === "tu_api_key_aqui"
    ) {
      return res.status(500).json({
        error:
          "La API Key de Gemini no está configurada en el servidor. " +
          "Contacta al administrador."
      });
    }

    let historial;
    try {
      historial = validarHistorial(req.body?.messages);
      historial = limpiarHistorial(historial);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }

    const { reply, products, cotizacion } = await correrConversacion(historial);
    return res.json({ reply, products, cotizacion });
  } catch (error) {
    console.error("[/api/chat] Error:", error);
    const esTimeout = /Timeout|tiempo/i.test(error.message || "");
    return res.status(esTimeout ? 504 : 500).json({
      error: esTimeout
        ? "El asesor tardó demasiado en responder. Inténtalo de nuevo en un momento."
        : "Ocurrió un inconveniente temporal. Inténtalo de nuevo en un momento."
    });
  }
});

app.listen(port, () => {
  console.log(`[Valquiria Backend v3] Activo en puerto ${port}`);
  console.log(`[Valquiria Backend v3] Modelo: ${MODELO}`);
  console.log(
    `[Valquiria Backend v3] Orígenes CORS permitidos: ${ORIGENES_PERMITIDOS.join(", ")}`
  );
});
