// --- CÓDIGO FINAL CORREGIDO (MODELO LATEST) ---

const DATA_URL = 'https://raw.githubusercontent.com/manuelnamarupa-wq/transmision-api/main/api/transmissions.json';

// Variable de Caché para velocidad
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
        // 1. OBTENCIÓN DE DATOS
        const transmissionData = await getData();

        if (!transmissionData || transmissionData.length === 0) {
            cachedData = null; // Reset de caché por si acaso
            return response.status(500).json({ reply: "Error: Base de datos no disponible. Reintenta." });
        }

        const userQuery = request.body.query;
        if (!userQuery) return response.status(400).json({ reply: "Escribe un vehículo." });

        // 2. FILTRADO RÁPIDO
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

        // 4. IA CON EL MODELO QUE TE FUNCIONA (gemini-pro-latest)
        const API_KEY = process.env.GEMINI_API_KEY;
        
        // --- CAMBIO AQUÍ: Volvemos a 'gemini-pro-latest' ---
        const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro-latest:generateContent?key=${API_KEY}`;

        const prompt = `
            Experto en transmisiones.
            DATOS:
            ${simplifiedContext}
            BUSCAN: "${userQuery}"

            REGLAS:
            1. Ignora "Standard/Manual". Solo automáticos.
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
                // Filtros de seguridad en "BLOCK_ONLY_HIGH" para que no se asuste con autopartes
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
            throw new Error(`Google Error (${geminiResponse.status}): ${errText}`);
        }

        const data = await geminiResponse.json();

        // Validación de respuesta vacía
        if (!data.candidates || data.candidates.length === 0) {
            return response.status(200).json({ 
                reply: `Posible coincidencia: <b>${candidates[0]['Trans Model']}</b> para ${candidates[0].Model}. (IA sin respuesta detallada).` 
            });
        }

        const textResponse = data.candidates[0].content.parts[0].text;
        return response.status(200).json({ reply: textResponse });

    } catch (error) {
        console.error("Error Handler:", error);
        return response.status(500).json({ reply: `Error del sistema: ${error.message}` });
    }
}
