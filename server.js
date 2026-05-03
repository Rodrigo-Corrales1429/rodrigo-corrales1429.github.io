/**
 * ============================================================================
 *  VALQUIRIA — BACKEND DEL ASESOR (server.js v2)
 * ============================================================================
 *  Cambios v2:
 *  - System prompt proactivo: el bot deduce intenciones, tolera typos,
 *    nunca se rinde, y siempre ofrece próximo paso.
 *  - Limpieza de historial: descarta mensajes "model" iniciales antes de
 *    que llegue el primero del usuario (la bienvenida del frontend).
 *  - Fallback inteligente: cuando Gemini regresa vacío, hacemos UN segundo
 *    intento forzando que llame a listar_catalogo.
 *  - Logs detallados de function calls (visibles en Render Logs).
 * ============================================================================
 */

const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { GoogleGenAI, FunctionCallingConfigMode } = require("@google/genai");

const { TOOLS, ejecutarHerramienta } = require("./gemini-tools.js");

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
// SYSTEM PROMPT (v2 — proactivo y resistente a errores ortográficos)
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

# REGLA DE ORO — NUNCA TE RINDAS
JAMÁS respondas "no entendí", "no puedo ayudarte" o "reformula tu solicitud".
Eres proactivo:

1. **Tolera errores ortográficos.** Cuando un usuario escriba palabras
   incompletas o mal escritas, deduce la intención y llama a buscar_productos.
   Ejemplos:
   - "endo" → "endodoncia"
   - "pulpo" → "pulpotomía"
   - "nisin" / "nicin" / "nissim" → "nissin"
   - "pediatria" → odontopediatría
   - "boca completa" / "32 dientes" / "kit avanzado" → kit ultrarealista

2. **Si no estás seguro de la intención, llama a buscar_productos con la
   palabra clave que más te suene.** La función ya tolera typos por dentro.

3. **Si buscar_productos devuelve coincidencia_exacta=false, NO digas que no
   encontraste.** Presenta los productos que vinieron y pregunta:
   "Tenemos esto disponible en Valquiria Dental: [lista corta]. ¿Cuál se
   acerca a lo que buscas, o prefieres que te describa alguno en detalle?"

4. **Si el usuario solo saluda o pide ayuda en general** ("hola", "qué tienen",
   "ayúdame"), llama a listar_catalogo y muéstrale las 4 áreas, preguntando
   sobre qué tipo de práctica necesita.

# CÓMO PRESENTAR PRODUCTOS
Cuando muestres resultados de buscar_productos o listar_catalogo:
- Lista breve, máximo 4 productos.
- Para cada uno: nombre en **negritas**, precio, y una línea descriptiva.
- Termina con una pregunta concreta que avance la conversación
  ("¿Quieres que te cotice alguno?" / "¿Para qué tipo de práctica es?").

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
Deriva a WhatsApp (+52 55 5467 5821) o ventas@valquiriadental.com cuando:
- Pide mayoreo / volumen (más de 20 piezas en una línea).
- Necesita factura, datos fiscales o condiciones de pago especiales.
- Su pregunta técnica es muy específica (compatibilidad puntual,
  personalizaciones, tiempos exactos de entrega).

# FORMATO
Respuestas breves: 2-3 párrafos cortos máximo. El widget de chat es pequeño.
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

/**
 * Limpia el historial: descarta mensajes 'model' al inicio (antes del primer
 * 'user'). Es defensa para cuando el frontend agrega una bienvenida sintética.
 */
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

// ----------------------------------------------------------------------------
// LOOP DE FUNCTION CALLING
// ----------------------------------------------------------------------------

async function correrConversacion(historialInicial) {
  const contents = [...historialInicial];

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

    // Caso 1: Gemini quiere llamar funciones
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

    // Caso 2: texto final
    const texto = extraerTexto(response);
    if (texto && texto.trim() !== "") {
      return texto;
    }

    // Caso 3: respuesta vacía. Hacemos UN intento de rescate forzando
    // que el modelo llame a listar_catalogo, así garantizamos que al
    // menos vea opciones del catálogo.
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

    // Si el rescate forzó listar_catalogo, ejecutamos y hacemos una llamada
    // final SIN tool config para que redacte texto natural.
    const rescateFcs = extraerFunctionCalls(responseRescate);
    if (rescateFcs.length > 0) {
      const partesRescateModel = rescateFcs.map(fc => ({ functionCall: fc }));
      const partesRescateResp = rescateFcs.map(fc => ({
        functionResponse: {
          name: fc.name,
          response: ejecutarHerramienta({ name: fc.name, args: fc.args || {} })
        }
      }));

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
        return textoFinal;
      }
    }

    // Si hasta el rescate falló, devolvemos un fallback proactivo (no genérico)
    console.warn(`[fallback] Rescate también vino vacío. Usando mensaje fijo.`);
    return (
      "Cuéntame un poco más sobre lo que necesitas. Por ejemplo, ¿buscas " +
      "material para **endodoncia**, **pulpotomía**, un **kit completo de " +
      "32 dientes**, o algo compatible con **tipodonto Nissin**? También " +
      "puedo mostrarte el catálogo completo si gustas."
    );
  }

  console.warn(
    `[loop] Se alcanzó el tope de ${MAX_ITERACIONES_FUNCTION_CALL} iteraciones.`
  );
  return (
    "Estoy teniendo dificultad para procesar esta solicitud. ¿Podrías " +
    "escribirla de otra forma, o prefieres que un especialista te atienda " +
    "directamente por WhatsApp?"
  );
}

// ----------------------------------------------------------------------------
// ENDPOINTS
// ----------------------------------------------------------------------------

app.get("/", (req, res) => {
  res.json({ status: "ok", service: "Valquiria Asesor Backend" });
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

    const reply = await correrConversacion(historial);
    return res.json({ reply });
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
  console.log(`[Valquiria Backend v2] Activo en puerto ${port}`);
  console.log(`[Valquiria Backend v2] Modelo: ${MODELO}`);
  console.log(
    `[Valquiria Backend v2] Orígenes CORS permitidos: ${ORIGENES_PERMITIDOS.join(", ")}`
  );
});
