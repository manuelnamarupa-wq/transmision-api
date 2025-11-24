// --- CÓDIGO BLINDADO (CACHÉ + SEGURIDAD IA) ---

const DATA_URL = 'https://raw.githubusercontent.com/manuelnamarupa-wq/transmision-api/main/api/transmissions.json';

// Variable global para mantener los datos en memoria RAM (Velocidad)
let cachedData = null;

async function getData() {
    if (cachedData) return cachedData;
    
    console.log("Descargando BD de GitHub...");
    try {
        const response = await fetch(DATA_URL);
        if (!response.ok) throw new Error('Error de descarga');
        cachedData = await response.json();
        return cachedData;
    } catch (e) {
        console.error("Error crítico BD:", e);
        return [];
    }
}

export default async function handler(request, response) {
    // Configuración CORS
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (request.method === 'OPTIONS') return response.status(200).end();

    try {
        // 1. CARGA DE DATOS
        const transmissionData = await getData();

        if (!transmissionData || transmissionData.length === 0) {
            // Intento desesperado de recarga si la caché falló
            cachedData = null; 
            return response.status(500).json({ reply: "Error: Base de datos no disponible. Reintenta." });
        }

        const userQuery = request.body.query;
        if (!userQuery) return response.status(400).json({ reply: "Escribe un vehículo." });

        // 2. FILTRO (Limitado a 10 para velocidad)
        const lowerCaseQuery = userQuery.toLowerCase().trim();
        const queryParts = lowerCaseQuery.split(' ').filter(part => part.length > 1);

        const candidates = transmissionData.filter(item => {
            const itemText = `${item.Make} ${item.Model} ${item.Years} ${item['Trans Type']} ${item['Engine Type / Size']}`.toLowerCase();
            return queryParts.some(part => itemText.includes(part));
        }).slice(0, 10); 

        if (candidates.length === 0) {
            return response.status(200).json({ 
                reply: "No encontrado en mi base de datos, ¿Hay otra manera de nombrar a este vehículo?" 
            });
        }

        // 3. CONTEXTO SIMPLIFICADO
        const simplifiedContext = candidates.map(c => 
            `${c.Make} ${c.Model} (${c.Years}) | ${c['Trans Model']} | ${c['Engine Type / Size']}`
        ).join('\n');

        // 4. IA CON CONFIGURACIÓN DE SEGURIDAD
        const API_KEY = process.env.GEMINI_API_KEY;
        // Usamos 'gemini-pro' estándar para máxima estabilidad
        const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${API_KEY}`;

        const prompt = `
            Experto en transmisiones.
            DATOS:
            ${simplifiedContext}
            BUSCAN: "${userQuery}"

            REGLAS:
            1. Solo automáticos (Ignora "Standard").
            2. Filtra estrictamente por Año y Modelo.
            
            FORMATO:
            - <b>MODELO</b> (Detalles)

            Ejemplo:
            "Para Accord 2000:
            - <b>BAXA</b> (4 Vel, 2.3L)"
        `;

        const geminiResponse = await fetch(GEMINI_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                contents: [{ parts: [{ text: prompt }] }],
                // Configuración para que responda rápido y NO BLOQUEE NADA
                safetySettings: [
                    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
                    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
                    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
                    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" }
                ],
                generationConfig: {
                    temperature: 0.1,
                    maxOutputTokens: 200
                }
            }),
        });

        if (!geminiResponse.ok) {
            const errText = await geminiResponse.text();
            throw new Error(`Google Error: ${errText}`);
        }

        const data = await geminiResponse.json();

        // --- AQUÍ OCURRÍA EL ERROR ANTERIOR ---
        // Verificamos si realmente hay candidatos antes de leer la posición [0]
        if (!data.candidates || data.candidates.length === 0) {
            console.error("Respuesta vacía de IA:", JSON.stringify(data));
            // Si la IA no quiso responder, damos una respuesta genérica basada en los datos crudos
            return response.status(200).json({ 
                reply: `Encontré posibles coincidencias como: <b>${candidates[0]['Trans Model']}</b> para ${candidates[0].Model}. Por favor especifica más el año o motor.` 
            });
        }

        const textResponse = data.candidates[0].content.parts[0].text;
        return response.status(200).json({ reply: textResponse });

    } catch (error) {
        console.error("Error Handler:", error);
        return response.status(500).json({ reply: `Error del sistema: ${error.message}` });
    }
}
