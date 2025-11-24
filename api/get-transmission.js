const DATA_URL = 'https://raw.githubusercontent.com/manuelnamarupa-wq/transmision-api/main/api/transmissions.json';

let transmissionData = [];
let dataLoaded = false;

async function loadData() {
    if (!dataLoaded) {
        try {
            const response = await fetch(DATA_URL);
            if (!response.ok) throw new Error('Error descargando JSON.');
            transmissionData = await response.json();
            dataLoaded = true;
            console.log(`Datos cargados: ${transmissionData.length}`);
        } catch (error) {
            console.error('Error BD:', error);
        }
    }
}

export default async function handler(request, response) {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (request.method === 'OPTIONS') return response.status(200).end();
    
    await loadData();
    if (!dataLoaded || transmissionData.length === 0) {
        return response.status(500).json({ reply: "Error: Base de datos no disponible." });
    }

    const userQuery = request.body.query;
    if (!userQuery) return response.status(400).json({ reply: "Ingresa un vehículo." });
    
    // Filtro rápido
    const lowerCaseQuery = userQuery.toLowerCase().trim();
    const queryParts = lowerCaseQuery.split(' ').filter(part => part.length > 1);

    // OPTIMIZACIÓN DE VELOCIDAD: Limitamos a 15 candidatos
    const candidates = transmissionData.filter(item => {
        const itemText = `${item.Make} ${item.Model} ${item.Years} ${item['Trans Type']} ${item['Engine Type / Size']}`.toLowerCase();
        return queryParts.some(part => itemText.includes(part));
    }).slice(0, 15); 

    if (candidates.length === 0) {
        return response.status(200).json({ reply: `No encontré coincidencias para "${userQuery}".` });
    }

    const API_KEY = process.env.GEMINI_API_KEY;
    // Usamos el modelo ESTABLE que te funcionó
    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro-latest:generateContent?key=${API_KEY}`;

    const contextForAI = JSON.stringify(candidates);

    // PROMPT CON REGLA ANTI-ESTÁNDAR
    const prompt = `
        Experto en transmisiones AUTOMÁTICAS.
        DATOS: ${contextForAI}
        BUSCAN: "${userQuery}"

        REGLAS TÉCNICAS:
        1. "SP" = Velocidades (Ej: 4 SP = 4 Cambios).
        2. "FWD" = Tracción Delantera. "RWD" = Tracción Trasera.
        3. Años: "98-02" incluye el rango.

        REGLA DE SEMÁNTICA (CRÍTICA):
        - Solo vendemos automáticos.
        - Si en los datos el modelo dice "Standard", "Std" o "Estandar", IGNORA esa palabra o descarta si es transmisión manual pura. NO muestres "Golf Standard" en el título, solo "Golf".
        - Ejemplo: Si el dato es "Golf Standard", escribe "Golf".

        FORMATO:
        1. Sin saludos. Directo al grano.
        2. Modelo de transmisión ("Trans Model") entre <b></b>.
        
        Ejemplo:
        "Para VW Golf 2015:
        - <b>09G</b> (6 Cambios, Motor 2.5L)"
    `;

    try {
        const geminiResponse = await fetch(GEMINI_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        });

        if (!geminiResponse.ok) {
            const errText = await geminiResponse.text();
            throw new Error(`Error IA: ${errText}`);
        }

        const data = await geminiResponse.json();
        const textResponse = data.candidates[0].content.parts[0].text;
        
        return response.status(200).json({ reply: textResponse });

    } catch (error) {
        console.error("Error:", error);
        return response.status(500).json({ reply: `Error del sistema: ${error.message}` });
    }
}
