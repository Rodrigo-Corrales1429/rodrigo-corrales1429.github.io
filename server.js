const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');

const app = express();
const port = process.env.PORT || 3000;

// Configuración de middlewares
app.use(cors());
app.use(express.json());

// Inicializar cliente de Gemini
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const SYSTEM_PROMPT = `Eres el "Asesor Valquiria", el conserje digital premium de Valquiria Inc.
Tu objetivo es asistir a los visitantes del sitio web con un tono sofisticado, profesional, cortés y muy servicial.

SOBRE LA EMPRESA:
Valquiria Inc. es un holding de innovación y manufactura en Latinoamérica.
Nuestras divisiones principales son:
1. Valquiria 3D (Manufactura Aditiva: impresión profesional FDM y resina de alta resolución para prototipado y piezas finales).
2. Valquiria Dental (Material Pedagógico: Modelos anatómicos, Kit de endodoncia, Kit de pulpotomía, Dientes tipo Nissin estándar y para endodoncia, Simulador dental Carodonto).
3. Valquiria Pack (Empaques termoformados personalizados premium).
4. Valquiria Lux (Iluminación y diseño de lámparas artesanales e impresión 3D, obras funcionales).

FILOSOFÍA: 
"Innovación · Precisión · Diseño". No fabricamos productos, diseñamos soluciones.

REGLAS DE CONVERSACIÓN:
- Sé conciso pero sumamente educado y elegante.
- Limita tus respuestas a un máximo de 2 a 3 párrafos breves (el chat es un widget pequeño).
- Usa formato Markdown de forma sutil: usa **negritas** para resaltar nombres de divisiones o productos.
- Si el usuario muestra interés de compra, requiere una cotización, o su pregunta es muy técnica y específica, invítalo a hablar directamente con un especialista por WhatsApp. 
`;

// Endpoint principal del chat
app.post('/api/chat', async (req, res) => {
    try {
        const { messages } = req.body;
        
        if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'tu_api_key_aqui') {
             return res.status(500).json({ 
                 error: "La API Key de Gemini no está configurada. Por favor asigna tu clave real en el archivo .env antes de iniciar."
             });
        }

        if (!messages || !Array.isArray(messages)) {
            return res.status(400).json({ error: "El formato de mensajes es inválido." });
        }

        // Llamada a la API de Gemini
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: messages,
            config: {
                systemInstruction: SYSTEM_PROMPT,
                temperature: 0.7,
            }
        });

        res.json({ reply: response.text });
        
    } catch (error) {
        console.error("Error al procesar la solicitud al chatbot:", error);
        res.status(500).json({ error: "Lo lamento, mis sistemas neuronales experimentaron un inconveniente temporal. Inténtalo de nuevo en unos momentos." });
    }
});

// Iniciar el servidor
app.listen(port, () => {
    console.log(`[Valquiria Backend] Servidor de IA activo en http://localhost:${port}`);
    console.log('--- Asegúrate de haber configurado tu archivo .env con tu GEMINI_API_KEY ---');
});
