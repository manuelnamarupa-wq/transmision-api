// --- CÓDIGO DEPURADO Y MEJORADO ---
const DATA_URL = 'https://raw.githubusercontent.com/manuelnamarupa-wq/transmision-api/main/api/transmissions.json';

let transmissionData = [];
let dataLoaded = false;

async function loadData() {
    if (!dataLoaded) {
        console.log("Descargando datos de GitHub...");
        const response = await fetch(DATA_URL);
        if (!response.ok) throw new Error(`Error descargando JSON: ${response.status} ${response.statusText}`);
        transmissionData = await response.json();
        dataLoaded = true;
        console.log(`Datos cargados: ${transmissionData.length} registros.`);
    }
}

export default async function handler(request, response) {
    // 1. Configuración CORS
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (request.method === 'OPTIONS') {
        return response.status(200).end();
    }

    try {
        // 2. Carga de datos
        await loadData();
        
        if (!dataLoaded || transmissionData.length === 0) {
            throw new Error("La base de datos está vacía o no se pudo cargar.");
        }

        const userQuery = request.body.query;
        if (!userQuery) {
            return response.status(400).json({ reply: "Por favor, escribe un vehículo." });
        }

        // 3. Filtrado rápido (Reducimos a 15 candidatos para evitar Timeouts de Vercel)
        const lowerCaseQuery = userQuery.toLowerCase().trim();
        const queryParts = lowerCaseQuery.split(' ').filter(part => part.length > 1);

        const candidates = transmissionData.filter(item => {
            const itemText = `${item.Make} ${item.Model} ${item.Years} ${item['Trans Type']} ${item['Engine Type / Size']}`.toLowerCase();
            return queryParts.some(part => itemText.includes(part));
        }).slice(0, 15); // LÍMITE DE SEGURIDAD: 15 items

        if (candidates.length === 0) {
            return response.status(200).json({ reply: `No encontré ese modelo en la base de datos (${userQuery}). Intenta con otro año o modelo.` });
        }

        // 4. Conexión con IA (Usamos el modelo FLASH que es más rápido)
        const API_KEY = process.env.GEMINI_API_KEY;
        if (!API_KEY) throw new Error("Falta la GEMINI_API_KEY en las variables de entorno de Vercel.");

        const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${API_KEY}`;

        const contextForAI = JSON.stringify(candidates);

        const prompt = `
            Actúa como experto en autopartes.
            DATOS (JSON): ${contextForAI}
            BÚSQUEDA: "${userQuery}"
            
            REGLAS:
            - SP = Velocidades (ej: 4 SP = 4 Velocidades).
            - FWD = Tracción Delantera, RWD = Trasera.
            - Años: "98-02" cubre 98, 99, 00, 01, 02.
            
            TAREA:
            1. Devuelve SOLO las transmisiones compatibles con el año y características pedidas.
            2. Usa etiquetas <b></b> para el modelo de transmisión ("Trans Model").
            3. Si hay varias opciones, explica la diferencia entre paréntesis.
            4. Sé directo. Sin saludos.

            EJEMPLO SALIDA:
            "Para Honda Accord 2000:
            - <b>BAXA</b> (4 Velocidades, Motor 2.3L)
            - <b>B7XA</b> (4 Velocidades, Motor 3.0L)"
        `;

        const aiResponse = await fetch(GEMINI_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        });

        if (!aiResponse.ok) {
            const errorDetails = await aiResponse.text();
            throw new Error(`Error de Google AI: ${aiResponse.status} - ${errorDetails}`);
        }

        const data = await aiResponse.json();
        const textResponse = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!textResponse) throw new Error("La IA no devolvió texto.");

        return response.status(200).json({ reply: textResponse });

    } catch (error) {
        console.error("ERROR EN VERCEL:", error);
        // IMPORTANTE: Devolvemos el error exacto al frontend para que sepas qué pasa
        return response.status(500).json({ 
            reply: `Error Técnico: ${error.message}` 
        });
    }
}
