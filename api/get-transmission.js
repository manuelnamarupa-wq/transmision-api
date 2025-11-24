// --- CÓDIGO OPTIMIZADO PARA VELOCIDAD Y SEMÁNTICA ---
const DATA_URL = 'https://raw.githubusercontent.com/manuelnamarupa-wq/transmision-api/main/api/transmissions.json';

let transmissionData = [];
let dataLoaded = false;

async function loadData() {
    if (!dataLoaded) {
        try {
            const response = await fetch(DATA_URL);
            if (!response.ok) throw new Error('Error descargando BD.');
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
    
    const lowerCaseQuery = userQuery.toLowerCase().trim();
    const queryParts = lowerCaseQuery.split(' ').filter(part => part.length > 1);

    // OPTIMIZACIÓN DE VELOCIDAD:
    // Bajamos a 15 candidatos. Menos datos para leer = IA más rápida.
    const candidates = transmissionData.filter(item => {
        const itemText = `${item.Make} ${item.Model} ${item.Years} ${item['Trans Type']} ${item['Engine Type / Size']}`.toLowerCase();
        return queryParts.some(part => itemText.includes(part));
    }).slice(0, 15); 

    if (candidates.length === 0) {
        return response.status(200).json({ reply: `No encontré coincidencias para "${userQuery}".` });
    }

    const API_KEY = process.env.GEMINI_API_KEY;
    // Mantenemos el modelo que te funciona
    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro-latest:generateContent?key=${API_KEY}`;

    const contextForAI = JSON.stringify(candidates);

    // NUEVO PROMPT CON REGLA ANTI-ESTÁNDAR
    const prompt = `
        Experto en transmisiones AUTOMÁTICAS.
        DATOS: ${contextForAI}
        BUSCAN: "${userQuery}"

        REGLAS TÉCNICAS OBLIGATORIAS:
        1. "SP" = Velocidades (Ej: 4 SP = 4 Cambios).
        2. "FWD" = Tracción Delantera. "RWD" = Tracción Trasera.
        3. Años: "98-02" incluye el rango completo.

        REGLA DE SEMÁNTICA (CRÍTICA):
        - Solo vendemos automáticos.
        - Si el nombre del modelo en los datos dice "Standard", "Std" o "Estandar", ELIMINA esa palabra del nombre del auto. Causa confusión con transmisión manual.
        - Ejemplo: Si dice "Golf Standard", tú escribe solo "Golf".
        - Ejemplo: Si dice "Golf Sportwagen", ese déjalo igual.

        FORMATO DE SALIDA:
        1. Sin saludos.
        2. Modelo de transmisión ("Trans Model") entre <b></b>.
        3. Filtra estrictamente por año.

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
