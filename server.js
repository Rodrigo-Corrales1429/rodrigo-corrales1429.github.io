/**
 * ============================================================================
 *  VALQUIRIA — BACKEND DEL ASESOR (server.js)
 * ============================================================================
 *  Orquesta la conversación entre el usuario y Gemini, intermediando con las
 *  herramientas de cotización. La pieza clave es el LOOP DE FUNCTION CALLING:
 *
 *    [usuario]  →  [Gemini]
 *                     ↓
 *           (¿pidió llamar a una función?)
 *                     ↓ sí
 *           [ejecutamos JS con matemática real]
 *                     ↓
 *               [Gemini de nuevo]
 *                     ↓
 *           (¿texto final o más funciones?)
 *
 *  Este loop tiene un tope duro de iteraciones para que NUNCA pueda volverse
 *  un bucle infinito que vacíe los tokens.
 * ============================================================================
 */

const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { GoogleGenAI } = require("@google/genai");

const { TOOLS, ejecutarHerramienta } = require("./gemini-tools.js");

const app = express();
const port = process.env.PORT || 3000;

// ----------------------------------------------------------------------------
// CONFIGURACIÓN
// ----------------------------------------------------------------------------

// CORS: solo dominios permitidos (ajusta esta lista a la URL real de tu sitio).
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
      // Permitir requests sin origin (Postman, scripts internos)
      if (!origin) return callback(null, true);
      if (ORIGENES_PERMITIDOS.includes(origin)) return callback(null, true);
      return callback(new Error(`Origen no permitido por CORS: ${origin}`));
    }
  })
);
app.use(express.json({ limit: "100kb" })); // límite anti-abuso

// Cliente Gemini
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const MODELO = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const MAX_ITERACIONES_FUNCTION_CALL = 5;
const TIMEOUT_GEMINI_MS = 45000;

// ----------------------------------------------------------------------------
// SYSTEM PROMPT
// ----------------------------------------------------------------------------
//
// Reglas IMPORTANTES de diseño del prompt:
// - NO incluye precios. Los precios viven solo en quote-engine.js.
// - NO incluye instrucciones matemáticas. Toda matemática va por tools.
// - SÍ define el tono, la persona y CUÁNDO usar cada herramienta.
//
const SYSTEM_PROMPT = `Eres el "Asesor Valquiria", el conserje digital premium de Valquiria Inc.

# IDENTIDAD
Tu tono es sofisticado, profesional, cortés y servicial. Hablas como un consultor
de gama alta: claro, breve, sin tecnicismos innecesarios.

# SOBRE LA EMPRESA
Valquiria Inc. es un holding de innovación y manufactura latinoamericano con
cuatro divisiones:
1. Valquiria 3D — Manufactura aditiva (FDM y resina de alta resolución).
2. Valquiria Dental — Material pedagógico para odontología (división activa con catálogo).
3. Valquiria Pack — Empaques termoformados premium.
4. Valquiria Lux — Iluminación y diseño con manufactura aditiva.

Filosofía: "Innovación · Precisión · Diseño". No fabricamos productos: diseñamos
soluciones.

# REGLA INVIOLABLE — NUNCA HAGAS MATEMÁTICA
Tú NO calculas precios, sumas, descuentos ni costos de envío. Para cualquier
número que vaya a aparecer en tu respuesta usa SIEMPRE las herramientas:

- buscar_productos(query): cuando el usuario describe lo que necesita.
- listar_catalogo(): cuando pide ver todo lo disponible.
- calcular_cotizacion(items): cuando hay que dar un total, parcial o final.

Si no usaste la herramienta, NO menciones precios. Si la herramienta falla
(ok=false), explícale el problema al usuario con tus propias palabras y pídele
que corrija.

# CÓMO PRESENTAR UNA COTIZACIÓN
Cuando calcular_cotizacion devuelva ok=true, presenta el resultado con:
- Una lista breve con cada producto, cantidad y subtotal.
- El subtotal, el envío (indicando si es gratis), y el total final.
- Si el campo "upsell" no es null, sugiere amablemente al usuario agregar otro
  producto para superar el umbral de envío gratis. Solo una vez, sin presionar.

Usa **negritas** Markdown solo para el TOTAL FINAL y para nombres de productos.

# DERIVACIÓN A ESPECIALISTA
Deriva al usuario a WhatsApp (+52 55 5467 5821) o ventas@valquiriadental.com cuando:
- Pide mayoreo / precios por volumen (más de 20 piezas en una línea).
- Necesita factura, datos fiscales o condiciones de pago especiales.
- Su pregunta técnica es muy específica (compatibilidad con un instrumento
  particular, tiempos de entrega exactos, personalizaciones).

# FORMATO
Respuestas breves: 2-3 párrafos cortos máximo. El widget de chat es pequeño.
No uses emojis salvo cuando el usuario los use primero.`;

// ----------------------------------------------------------------------------
// HELPERS
// ----------------------------------------------------------------------------

/**
 * Envuelve una promesa con timeout. Si tarda más de `ms`, rechaza.
 */
function conTimeout(promise, ms, msg = "Timeout") {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))
  ]);
}

/**
 * Valida y normaliza el historial que llega del frontend.
 * Forma esperada: [{ role: 'user'|'model', parts: [{ text: '...' }] }, ...]
 */
function validarHistorial(messages) {
  if (!Array.isArray(messages)) {
    throw new Error("El campo 'messages' debe ser un arreglo.");
  }
  if (messages.length === 0) {
    throw new Error("El historial está vacío.");
  }
  if (messages.length > 60) {
    // Tope para evitar context bombs
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

/**
 * Extrae el texto final de una respuesta de Gemini.
 * Compatible con el SDK @google/genai (response.text es un getter).
 */
function extraerTexto(response) {
  if (typeof response?.text === "string") return response.text;
  // Fallback: recorrer candidates manualmente
  const partes = response?.candidates?.[0]?.content?.parts || [];
  return partes.map(p => p.text || "").join("").trim();
}

/**
 * Extrae las llamadas a función de la respuesta.
 */
function extraerFunctionCalls(response) {
  // El SDK expone response.functionCalls como array si hubo function calls.
  if (Array.isArray(response?.functionCalls) && response.functionCalls.length > 0) {
    return response.functionCalls;
  }
  // Fallback manual:
  const partes = response?.candidates?.[0]?.content?.parts || [];
  return partes
    .filter(p => p.functionCall)
    .map(p => p.functionCall);
}

// ----------------------------------------------------------------------------
// LOOP DE FUNCTION CALLING (el corazón)
// ----------------------------------------------------------------------------

/**
 * Conduce la conversación con Gemini hasta obtener una respuesta de texto
 * final, ejecutando cualquier function call intermedio.
 *
 * @param {Array} historialInicial - el historial validado del frontend.
 * @returns {Promise<string>} - el texto final que se mostrará al usuario.
 */
async function correrConversacion(historialInicial) {
  // Trabajamos sobre una copia mutable del historial
  const contents = [...historialInicial];

  for (let iter = 0; iter < MAX_ITERACIONES_FUNCTION_CALL; iter++) {
    const response = await conTimeout(
      ai.models.generateContent({
        model: MODELO,
        contents,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          tools: TOOLS,
          temperature: 0.3
        }
      }),
      TIMEOUT_GEMINI_MS,
      "Gemini no respondió a tiempo (45s). Por favor reintenta."
    );

    const functionCalls = extraerFunctionCalls(response);

    // Caso 1: Gemini quiere llamar una o más funciones
    if (functionCalls.length > 0) {
      // Agregamos el turno del modelo que contiene los functionCall
      const partesModelo = functionCalls.map(fc => ({ functionCall: fc }));
      contents.push({ role: "model", parts: partesModelo });

      // Ejecutamos cada función y empaquetamos los resultados
      const partesRespuesta = [];
      for (const fc of functionCalls) {
        const resultado = ejecutarHerramienta({
          name: fc.name,
          args: fc.args || {}
        });

        console.log(
          `[fn-call] iter=${iter} ${fc.name}(${JSON.stringify(fc.args)}) ` +
          `-> ok=${resultado.ok}`
        );

        partesRespuesta.push({
          functionResponse: {
            name: fc.name,
            response: resultado
          }
        });
      }

      // Las functionResponses van como turno del usuario para el siguiente
      // round-trip con Gemini.
      contents.push({ role: "user", parts: partesRespuesta });
      continue; // siguiente iteración
    }

    // Caso 2: Gemini devolvió texto final → terminamos
    const texto = extraerTexto(response);
    if (texto && texto.trim() !== "") {
      return texto;
    }

    // Caso 3: respuesta vacía sin function calls → algo extraño, abortamos
    return (
      "Lo siento, no pude generar una respuesta. ¿Podrías reformular " +
      "tu solicitud? Si el problema persiste, escríbenos por WhatsApp."
    );
  }

  // Si llegamos aquí, Gemini se quedó pidiendo funciones indefinidamente.
  // Devolvemos un mensaje de fallback en lugar de seguir gastando tokens.
  console.warn(
    `[loop] Se alcanzó el tope de ${MAX_ITERACIONES_FUNCTION_CALL} iteraciones.`
  );
  return (
    "Estoy teniendo dificultad para procesar esta solicitud. " +
    "¿Podrías escribirla de otra forma, o prefieres que un especialista te " +
    "atienda directamente por WhatsApp?"
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
    // Validación de la API key
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

    // Validación del historial
    let historial;
    try {
      historial = validarHistorial(req.body?.messages);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }

    // Correr la conversación
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

// ----------------------------------------------------------------------------
// ARRANQUE
// ----------------------------------------------------------------------------

app.listen(port, () => {
  console.log(`[Valquiria Backend] Activo en puerto ${port}`);
  console.log(`[Valquiria Backend] Modelo: ${MODELO}`);
  console.log(
    `[Valquiria Backend] Orígenes CORS permitidos: ${ORIGENES_PERMITIDOS.join(", ")}`
  );
});
