// --- CÓDIGO FINAL (MODELO gemini-pro-latest) ---
const DATA_URL = 'https://raw.githubusercontent.com/manuelnamarupa-wq/transmision-api/main/api/transmissions.json';

let transmissionData = [];
let dataLoaded = false;

async function loadData() {
    if (!dataLoaded) {
        try {
            const response = await fetch(DATA_URL);
            if (!response.ok) throw new Error('La base de datos JSON no se pudo descargar.');
            transmissionData = await response.json();
            dataLoaded = true;
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
    
    // Filtro rápido (Javascript)
    const lowerCaseQuery = userQuery.toLowerCase().trim();
    const queryParts = lowerCaseQuery.split(' ').filter(part => part.length > 1);

    const candidates = transmissionData.filter(item => {
        const itemText = `${item.Make} ${item.Model} ${item.Years} ${item['Trans Type']} ${item['Engine Type / Size']}`.toLowerCase();
        return queryParts.some(part => itemText.includes(part));
    }).slice(0, 25); 

    if (candidates.length === 0) {
        return response.status(200).json({ reply: `No se encontraron coincidencias iniciales para "${userQuery}" en la plantilla.` });
    }

    // --- ANÁLISIS INTELIGENTE CON IA ---
    const API_KEY = process.env.GEMINI_API_KEY;
    
    // VOLVEMOS EXACTAMENTE AL MODELO QUE TE FUNCIONÓ: gemini-pro-latest
    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro-latest:generateContent?key=${API_KEY}`;

    const contextForAI = JSON.stringify(candidates);

    // Prompt con las instrucciones de SP, FWD y Negritas
    const prompt = `
        Actúa como un experto en transmisiones.
        DATOS (JSON):
        ---
        ${contextForAI}
        ---
        USUARIO BUSCA: "${userQuery}"

        REGLAS TÉCNICAS:
        1. "SP" = Velocidades/Cambios (Ej: 4 SP = 4 Cambios).
        2. "FWD" = Tracción Delantera. "RWD" = Tracción Trasera.
        3. Años: "98-02" incluye 1998, 1999, 2000, 2001, 2002.

        INSTRUCCIONES DE RESPUESTA:
        1. NO saludes. Sé directo.
        2. Filtra estrictamente por Año y Modelo.
        3. Si pide "5 cambios", descarta las que no sean "5 SP".
        4. Escribe el modelo de transmisión ("Trans Model") entre etiquetas <b></b> (negritas HTML).
        5. Explica diferencias si hay varias opciones.

        Ejemplo de respuesta:
        "Para Honda Accord 2000:
        - <b>BAXA</b> (4 Cambios, Motor 2.3L)
        - <b>B7XA</b> (4 Cambios, Motor 3.0L)"
    `;

    try {
        const geminiResponse = await fetch(GEMINI_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        });

        if (!geminiResponse.ok) {
            // Capturamos el error exacto si vuelve a fallar el modelo
            const errText = await geminiResponse.text();
            throw new Error(`Error IA (${geminiResponse.status}): ${errText}`);
        }

        const data = await geminiResponse.json();
        const textResponse = data.candidates[0].content.parts[0].text;
        
        return response.status(200).json({ reply: textResponse });

    } catch (error) {
        console.error("Error en la fase de IA:", error);
        // Mostramos el error técnico en pantalla para no estar a ciegas
        return response.status(500).json({ reply: `Error del sistema: ${error.message}` });
    }
}
// --- FIN DEL CÓDIGO ---
