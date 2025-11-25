const DATA_URL = 'https://raw.githubusercontent.com/manuelnamarupa-wq/transmision-api/main/api/transmissions.json';

// Cache en memoria
let transmissionData = [];
let dataLoaded = false;
let lastLoadTime = 0;

async function loadData() {
    const now = Date.now();
    // Cache de 1 hora
    if (!dataLoaded || (now - lastLoadTime > 3600000)) {
        try {
            const response = await fetch(DATA_URL);
            if (!response.ok) throw new Error('Error GitHub Raw.');
            transmissionData = await response.json();
            dataLoaded = true;
            lastLoadTime = now;
            console.log(`BD Actualizada: ${transmissionData.length} registros.`);
        } catch (error) {
            console.error('Error carga JSON:', error);
            if (!dataLoaded) throw error; 
        }
    }
}

export default async function handler(request, response) {
    // 1. Configuración CORS
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (request.method === 'OPTIONS') return response.status(200).end();
    
    // 2. Carga de Datos
    try {
        await loadData();
    } catch (e) {
        return response.status(500).json({ reply: "Error de conexión con base de datos." });
    }

    const userQuery = request.body.query;
    if (!userQuery) return response.status(400).json({ reply: "Ingresa un vehículo." });
    
    // 3. Lógica de 2 Dígitos
    const expandedQuery = userQuery.replace(/\b(\d{2})\b/g, (match) => {
        const n = parseInt(match, 10);
        if (n >= 80 && n <= 99) return `19${match}`;
        if (n >= 0 && n <= 30) return `20${match}`;
        return match;
    });

    const lowerCaseQuery = expandedQuery.toLowerCase().trim();
    const queryParts = lowerCaseQuery.split(' ').filter(part => part.length > 1);

    // --- FILTRO HÍBRIDO ---
    const textParts = queryParts.filter(part => isNaN(part)); 
    
    const candidates = transmissionData.filter(item => {
        const itemText = `${item.Make} ${item.Model} ${item.Years} ${item['Trans Type']} ${item['Engine Type / Size']}`.toLowerCase();
        if (textParts.length > 0) {
            if (!textParts.every(word => itemText.includes(word))) return false;
        }
        return true;
    }).slice(0, 60); // <--- CAMBIO CRÍTICO: Aumentamos de 15 a 60 para que quepan TODAS las variantes.

    if (candidates.length === 0) {
        return response.status(200).json({ reply: `No se encontraron coincidencias para "${userQuery}".` });
    }

    // 4. IA FLASH 2.0 (Motor Rápido)
    const API_KEY = process.env.GEMINI_API_KEY;
    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${API_KEY}`;

    const contextForAI = JSON.stringify(candidates);

    const prompt = `
        ROL: Ingeniero de producto de transmisiones.
        DATOS DISPONIBLES (JSON):
        ---
        ${contextForAI}
        ---
        INPUT USUARIO: "${expandedQuery}"

        INSTRUCCIONES DE VOLUMEN (CRÍTICO):
        1. LISTADO EXHAUSTIVO: Si hay muchas variantes (Ej: Golf tiene Base, GTI, TDI, Sportwagen), MUESTRA TODAS.
        2. NO RESUMAS: Prefiero una lista larga y completa a una lista corta incompleta.
        3. Si hay duplicados exactos, agrúpalos, pero si cambia el Motor o la Tracción, sepáralos en otra línea.

        REGLAS DE FORMATO:
        1. CÓDIGO TRANSMISIÓN: OBLIGATORIO entre <b> y </b>. (Ej: <b>09G</b>).
        2. Si el modelo es "AVO" o "TBD", escribe "Modelo por confirmar" sin negritas.

        REGLAS TÉCNICAS:
        1. MENCIONA SIEMPRE: Tracción (FWD/RWD/AWD) y Motor (1.8L, 2.0L, TDI, etc).
        2. NO uses la palabra "Estándar".
        3. CLASIFICA: (CVT), (DSG / Doble Embrague) o (Automática Convencional).

        Ejemplo de Respuesta Perfecta:
        "Resultados para Volkswagen Golf 2015:
        - <b>09G</b> (Automática Convencional, 6 Vel, FWD) - Motor 1.8L Turbo (Versión Hatchback/Sportwagen)
        - <b>02E</b> (DSG / Doble Embrague, 6 Vel, FWD) - Motor 2.0L TDI (Diesel)
        - <b>02E</b> (DSG / Doble Embrague, 6 Vel, FWD) - Motor 2.0L Turbo (GTI)"
    `;

    try {
        const geminiResponse = await fetch(GEMINI_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        });

        if (geminiResponse.status === 429) {
            return response.status(200).json({ 
                reply: "⚠️ <b>Alta demanda.</b> Intenta en unos segundos." 
            });
        }

        if (!geminiResponse.ok) {
            const errText = await geminiResponse.text();
            throw new Error(`Error IA (${geminiResponse.status}): ${errText}`);
        }

        const data = await geminiResponse.json();
        const textResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || "Sin respuesta clara.";
        
        return response.status(200).json({ reply: textResponse });

    } catch (error) {
        console.error("Error backend:", error);
        return response.status(200).json({ 
            reply: "Ocurrió un problema técnico. Intenta de nuevo." 
        });
    }
}
