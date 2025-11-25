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
    
    // 3. Limpieza y Lógica de Búsqueda
    const expandedQuery = userQuery.replace(/\b(\d{2})\b/g, (match) => {
        const n = parseInt(match, 10);
        if (n >= 80 && n <= 99) return `19${match}`;
        if (n >= 0 && n <= 30) return `20${match}`;
        return match;
    });

    const lowerCaseQuery = expandedQuery.toLowerCase().trim();
    let queryParts = lowerCaseQuery.split(' ').filter(part => part.length > 0);

    // Palabras a ignorar en el filtro estricto (para que la IA las procese después)
    const stopWords = ['cambios', 'cambio', 'velocidades', 'velocidad', 'vel', 'marchas', 'transmision', 'caja', 'automatico', 'automatica'];
    const activeSearchTerms = queryParts.filter(part => !stopWords.includes(part));

    // --- FILTRO HÍBRIDO ---
    const textParts = activeSearchTerms.filter(part => isNaN(part)); 
    
    const candidates = transmissionData.filter(item => {
        const itemText = `${item.Make} ${item.Model} ${item.Years} ${item['Trans Type']} ${item['Engine Type / Size']}`.toLowerCase();
        
        // Regla: Debe contener las palabras clave (Ej: "Accord")
        if (textParts.length > 0) {
            if (!textParts.every(word => itemText.includes(word))) return false;
        }
        return true;
    }).slice(0, 80); // Límite amplio para no perder variantes raras

    if (candidates.length === 0) {
        return response.status(200).json({ reply: `No se encontraron coincidencias para "${userQuery}".` });
    }

    // 4. IA FLASH 2.0
    const API_KEY = process.env.GEMINI_API_KEY;
    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${API_KEY}`;

    const contextForAI = JSON.stringify(candidates);

    // --- PROMPT DE DESAGREGACIÓN TOTAL ---
    const prompt = `
        ROL: Catálogo experto de transmisiones.
        DATOS (JSON):
        ---
        ${contextForAI}
        ---
        INPUT USUARIO: "${expandedQuery}"

        REGLA DE ORO (DESAGREGACIÓN):
        1. MUESTRA TODO: Si un mismo vehículo (Ej: Accord 2000) aparece en el JSON con 3 códigos diferentes (Ej: BAXA, B7XA, MCTA), DEBES GENERAR 3 LÍNEAS DISTINTAS.
        2. NO AGRUPES NI RESUMAS: No decidas por el usuario cuál es la "común". Muestra todas las opciones que coincidan con el año.
        3. DIFERENCIA: Si puedes, indica qué diferencia hay (Motor 2.3L vs 3.0L, o "Versión Híbrida/Especial").

        OTRAS REGLAS:
        1. Búsqueda amplia: Si buscan "Cherokee", incluye "Grand Cherokee".
        2. Velocidades: Si piden "5 cambios", prioriza esas pero muestra las demás con una nota.
        3. Formato: <b>CODIGO</b> (sin asteriscos).
        4. "AVO"/"TBD" = "Modelo por confirmar".

        Ejemplo Esperado (Desagregado):
        "Resultados para Honda Accord 2000:
        - Accord (4 Cil): <b>BAXA / MAXA</b> (Automática Convencional, 4 Vel, FWD) - Motor 2.3L
        - Accord (V6): <b>B7XA</b> (Automática Convencional, 4 Vel, FWD) - Motor 3.0L
        - Accord (Versión Especial): <b>MCTA</b> (Automática Convencional, 5 Vel, FWD) - Motor 2.3L"
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
        
        // --- SEGURO ANTI-MARKDOWN ---
        let safeResponse = textResponse
            .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>') 
            .replace(/\n/g, '<br>');

        return response.status(200).json({ reply: safeResponse });

    } catch (error) {
        console.error("Error backend:", error);
        return response.status(200).json({ 
            reply: "Ocurrió un problema técnico. Intenta de nuevo." 
        });
    }
}
