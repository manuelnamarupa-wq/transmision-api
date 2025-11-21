// --- INICIO DEL CÓDIGO DEFINITIVO ---

// 1. URL de nuestra base de datos JSON en GitHub.
//    ¡IMPORTANTE! Verifica que tu usuario y nombre de repo sean correctos.
const DATA_URL = 'https://raw.githubusercontent.com/manuelnamarupa-wq/transmision-api/main/api/transmissions.json';

// Variable para guardar los datos en memoria.
let transmissionData = [];
let dataLoaded = false;
async function loadData() {
    if (!dataLoaded) {
        try {
            const response = await fetch(DATA_URL);
            if (!response.ok) throw new Error('La base de datos JSON no se pudo descargar.');
            transmissionData = await response.json();
            dataLoaded = true; // Marcamos que los datos se cargaron
            console.log(`Base de datos cargada: ${transmissionData.length} registros.`);
        } catch (error) {
            console.error('Error crítico al cargar transmissions.json:', error);
        }
    }
}

export default async function handler(request, response) {
    // Configuración CORS
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (request.method === 'OPTIONS') {
        return response.status(200).end();
    }
    
    await loadData();
    if (!dataLoaded || transmissionData.length === 0) {
        return response.status(500).json({ reply: "Error: La plantilla de datos no está disponible en este momento." });
    }

    const userQuery = request.body.query;
    if (!userQuery) {
        return response.status(400).json({ reply: "Por favor, ingresa un vehículo para buscar." });
    }
    const lowerCaseQuery = userQuery.toLowerCase().trim();
    const queryParts = lowerCaseQuery.split(' ').filter(part => part.length > 1);

    // Filtro inicial para encontrar candidatos relevantes
    const candidates = transmissionData.filter(item => {
        const itemText = `${item.Make.toLowerCase()} ${item.Model.toLowerCase()}`;
        return queryParts.some(part => itemText.includes(part));
    }).slice(0, 25); // Limitar a 25 candidatos

    if (candidates.length === 0) {
        return response.status(200).json({ reply: `No se encontraron coincidencias iniciales para "${userQuery}" en la plantilla.` });
    }

    // --- ANÁLISIS INTELIGENTE CON IA ---
    const API_KEY = process.env.GEMINI_API_KEY;
    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro-latest:generateContent?key=${API_KEY}`;
    
    const contextForAI = JSON.stringify(candidates);

    const prompt = `
        Tú eres un asistente experto en una refaccionaria de transmisiones. Tu ÚNICA fuente de información es la siguiente lista de datos en formato JSON que te proporciono:
        ---
        ${contextForAI}
        ---
        Un vendedor te pide ayuda con la siguiente búsqueda: "${userQuery}".

        Tu tarea es:
        1. Analiza la búsqueda. Entiende la intención, incluso si hay errores de tipeo o si los datos son parciales.
        2. Busca en la lista de datos que te di y encuentra las mejores y más relevantes coincidencias.
        3. Presenta los resultados en un resumen claro, mostrando un renglón por cada opción encontrada.
        4. Si después de analizar, ninguna opción coincide, responde: "No se encontraron resultados precisos para '${userQuery}' en la plantilla."
    `;

    try {
        const geminiResponse = await fetch(GEMINI_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        });

        if (!geminiResponse.ok) throw new Error('La llamada a la IA falló.');

        const data = await geminiResponse.json();
        const textResponse = data.candidates[0].content.parts[0].text;
        
        return response.status(200).json({ reply: textResponse });

    } catch (error) {
        console.error("Error en la fase de IA:", error);
        return response.status(500).json({ reply: "Ocurrió un error durante el análisis de la IA." });
    }
}
// --- FIN DEL CÓDIGO ---
