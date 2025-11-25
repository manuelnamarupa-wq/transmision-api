const DATA_URL = 'https://raw.githubusercontent.com/manuelnamarupa-wq/transmision-api/main/api/transmissions.json';

// --- SISTEMA DE CACHÉ ---
let transmissionData = [];
let uniqueModelsStr = ""; 
let dataLoaded = false;
let lastLoadTime = 0;

async function loadData() {
    const now = Date.now();
    if (!dataLoaded || (now - lastLoadTime > 3600000)) {
        try {
            const response = await fetch(DATA_URL);
            if (!response.ok) throw new Error('Error GitHub Raw.');
            transmissionData = await response.json();
            
            const modelSet = new Set(transmissionData.map(item => `${item.Make} ${item.Model}`));
            uniqueModelsStr = Array.from(modelSet).join(", ");

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
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (request.method === 'OPTIONS') return response.status(200).end();
    
    try {
        await loadData();
    } catch (e) {
        return response.status(500).json({ reply: "Error de conexión con base de datos." });
    }

    const userQuery = request.body.query;
    if (!userQuery) return response.status(400).json({ reply: "Ingresa un vehículo." });
    
    // 3. Limpieza
    const expandedQuery = userQuery.replace(/\b(\d{2})\b/g, (match) => {
        const n = parseInt(match, 10);
        if (n >= 80 && n <= 99) return `19${match}`;
        if (n >= 0 && n <= 30) return `20${match}`;
        return match;
    });

    const lowerCaseQuery = expandedQuery.toLowerCase().trim();
    let queryParts = lowerCaseQuery.split(' ').filter(part => part.length > 0);
    const stopWords = ['cambios', 'cambio', 'velocidades', 'velocidad', 'vel', 'marchas', 'transmision', 'caja', 'automatico', 'automatica'];
    const activeSearchTerms = queryParts.filter(part => !stopWords.includes(part));
    const textParts = activeSearchTerms.filter(part => isNaN(part)); 
    
    const candidates = transmissionData.filter(item => {
        const itemText = `${item.Make} ${item.Model} ${item.Years} ${item['Trans Type']} ${item['Engine Type / Size']}`.toLowerCase();
        if (textParts.length > 0) {
            if (!textParts.every(word => itemText.includes(word))) return false;
        }
        return true;
    }).slice(0, 80);

    const API_KEY = process.env.GEMINI_API_KEY;
    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${API_KEY}`;

    // --- ESCENARIO 1: CORRECTOR (Aplica si no hubo coincidencias de texto) ---
    if (candidates.length === 0) {
        const yearRegex = /\b(19|20)\d{2}\b/;
        const match = userQuery.match(yearRegex);
        const originalYear = match ? match[0] : null;

        const correctionPrompt = `
            ACTÚA COMO: API JSON de corrección ortográfica.
            LISTA VÁLIDA: [${uniqueModelsStr}]
            BÚSQUEDA USUARIO: "${userQuery}"

            TAREA: Encuentra el NOMBRE del vehículo válido más parecido.
            FORMATO JSON: { "found": true, "suggestion": "Jeep Liberty" } o { "found": false }
        `;

        try {
            const geminiResponse = await fetch(GEMINI_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: correctionPrompt }] }] }),
            });

            if (!geminiResponse.ok) throw new Error("Error IA");
            const data = await geminiResponse.json();
            
            let rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
            rawText = rawText.replace(/```json|```/g, '').trim();
            const parsed = JSON.parse(rawText);

            if (parsed.found && parsed.suggestion) {
                let finalSuggestion = parsed.suggestion;
                let replyText = "";
                let yearExists = false;

                if (originalYear) {
                    const testQuery = `${finalSuggestion} ${originalYear}`.toLowerCase().split(' ');
                    yearExists = transmissionData.some(item => {
                        const str = `${item.Make} ${item.Model} ${item.Years}`.toLowerCase();
                        return testQuery.every(word => str.includes(word));
                    });

                    if (yearExists) {
                        finalSuggestion = `${finalSuggestion} ${originalYear}`;
                        replyText = `¿Quisiste decir <b>${finalSuggestion}</b>?`;
                    } else {
                        // AQUÍ ENTRA LA LÓGICA SI EL AÑO NO EXISTE
                        replyText = `El modelo existe, pero no encontré año ${originalYear}. ¿Quisiste decir <b>${finalSuggestion}</b> (Ver todos los años)?`;
                    }
                } else {
                    replyText = `¿Quisiste decir <b>${finalSuggestion}</b>?`;
                }

                return response.status(200).json({ reply: replyText, suggestion: finalSuggestion });
            } else {
                return response.status(200).json({ reply: `No se encontraron coincidencias para "${userQuery}".` });
            }

        } catch (error) {
            return response.status(200).json({ reply: `No se encontraron coincidencias para "${userQuery}".` });
        }
    }

    // --- ESCENARIO 2: BÚSQUEDA EXITOSA (PROMPT REFORZADO CON MATEMÁTICA DE AÑOS) ---
    const contextForAI = JSON.stringify(candidates);

    const prompt = `
        [SYSTEM: STRICT OUTPUT.]
        ROL: Catálogo experto de transmisiones.
        DATOS (JSON):
        ---
        ${contextForAI}
        ---
        INPUT USUARIO: "${expandedQuery}"

        REGLA DE MATEMÁTICA DE AÑOS (CRÍTICO):
        1. Identifica el año que pide el usuario (Ej: 2000).
        2. Revisa el rango "Years" en el JSON (Ej: "02-07" significa 2002 a 2007).
        3. SI EL AÑO DEL USUARIO ESTÁ FUERA DEL RANGO:
           - NO INVENTES UN CÓDIGO.
           - Escribe: "- [Vehículo]: No disponible en año [Año Usuario] (Rango disponible: [Rango JSON])".
        4. SI EL AÑO SÍ COINCIDE: Muestra el código normalmente.

        REGLAS DE FORMATO:
        1. Formato: <b>CODIGO</b>.
        2. "AVO"/"TBD" = "Modelo por confirmar".
        3. Muestra Motor y Tracción.
        4. Si buscan "Cherokee", muestra "Grand Cherokee" si el año coincide.

        Ejemplo Correcto (Si piden Liberty 2000 y el rango es 02-07):
        "- Jeep Liberty: No existe registro para el año 2000 (El modelo inicia en 2002)."
    `;

    try {
        const geminiResponse = await fetch(GEMINI_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        });

        if (geminiResponse.status === 429) {
            return response.status(200).json({ reply: "⚠️ <b>Alta demanda.</b> Intenta en unos segundos." });
        }

        if (!geminiResponse.ok) {
            const errText = await geminiResponse.text();
            throw new Error(`Error IA (${geminiResponse.status}): ${errText}`);
        }

        const data = await geminiResponse.json();
        const textResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || "Sin respuesta clara.";
        
        let safeResponse = textResponse
            .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>') 
            .replace(/\n/g, '<br>');

        return response.status(200).json({ reply: safeResponse });

    } catch (error) {
        console.error("Error backend:", error);
        return response.status(200).json({ reply: "Ocurrió un problema técnico. Intenta de nuevo." });
    }
}
