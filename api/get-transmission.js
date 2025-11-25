const DATA_URL = 'https://raw.githubusercontent.com/manuelnamarupa-wq/transmision-api/main/api/transmissions.json';

let transmissionData = [];
let uniqueModelsStr = ""; 
let dataLoaded = false;
let lastLoadTime = 0;

// --- FUNCIÓN MATEMÁTICA DE AÑOS ---
function isYearInRange(rangeStr, targetYearStr) {
    if (!rangeStr || !targetYearStr) return false;
    const target = parseInt(targetYearStr, 10);
    let cleanRange = rangeStr.replace(/\s/g, '').toUpperCase();
    
    // Rango "98-02"
    if (cleanRange.includes('-') && !cleanRange.includes('UP')) {
        const parts = cleanRange.split('-');
        let start = parseInt(parts[0], 10);
        let end = parseInt(parts[1], 10);
        if (start < 100) start += (start > 50 ? 1900 : 2000);
        if (end < 100) end += (end > 50 ? 1900 : 2000);
        return target >= start && target <= end;
    }
    // Rango "99-UP"
    if (cleanRange.includes('UP') || cleanRange.includes('+')) {
        let start = parseInt(cleanRange.replace('UP','').replace('+','').replace('-',''), 10);
        if (start < 100) start += (start > 50 ? 1900 : 2000);
        return target >= start;
    }
    // Año único
    let single = parseInt(cleanRange, 10);
    if (single < 100) single += (single > 50 ? 1900 : 2000);
    return target === single;
}

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
    
    const yearRegex = /\b(19|20)\d{2}\b/;
    const yearMatch = userQuery.match(yearRegex);
    const userYear = yearMatch ? yearMatch[0] : null;

    let textQuery = userQuery;
    if (userYear) textQuery = textQuery.replace(userYear, '').trim();
    
    const stopWords = ['cambios', 'cambio', 'velocidades', 'velocidad', 'vel', 'marchas', 'transmision', 'caja', 'automatico', 'automatica'];
    let queryParts = textQuery.toLowerCase().split(' ').filter(part => part.length > 0 && !stopWords.includes(part));

    const candidates = transmissionData.filter(item => {
        const itemText = `${item.Make} ${item.Model} ${item['Trans Type']} ${item['Engine Type / Size']}`.toLowerCase();
        return queryParts.every(word => itemText.includes(word));
    }).slice(0, 300); 

    const API_KEY = process.env.GEMINI_API_KEY;
    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${API_KEY}`;

    // --- ESCENARIO 1: CORRECTOR ---
    if (candidates.length === 0) {
        const correctionPrompt = `
            ACTÚA COMO: API JSON de corrección.
            LISTA VÁLIDA: [${uniqueModelsStr}]
            BÚSQUEDA USUARIO: "${textQuery}"
            TAREA: Encuentra el nombre más parecido (ignora años).
            FORMATO JSON: { "found": true, "suggestion": "Jeep Liberty" }
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
                if (userYear) {
                    const cleanSuggestion = finalSuggestion.toLowerCase().split(' ');
                    const existsMath = transmissionData.some(item => {
                        const str = `${item.Make} ${item.Model}`.toLowerCase();
                        return cleanSuggestion.every(w => str.includes(w)) && isYearInRange(item.Years, userYear);
                    });
                    if (existsMath) {
                        finalSuggestion = `${finalSuggestion} ${userYear}`;
                        replyText = `¿Quisiste decir <b>${finalSuggestion}</b>?`;
                    } else {
                        replyText = `El modelo <b>${finalSuggestion}</b> existe, pero no encontré registros compatibles con el año <b>${userYear}</b>.`;
                    }
                } else {
                    replyText = `¿Quisiste decir <b>${finalSuggestion}</b>?`;
                }
                return response.status(200).json({ reply: replyText, suggestion: finalSuggestion });
            } else {
                return response.status(200).json({ reply: `No se encontraron coincidencias para "${userQuery}".` });
            }
        } catch (error) {
            return response.status(200).json({ reply: `No se encontraron coincidencias.` });
        }
    }

    // --- ESCENARIO 2: BÚSQUEDA NORMAL ---
    const contextForAI = JSON.stringify(candidates);

    const prompt = `
        [SYSTEM: RAW DATA EXTRACTION. NO FILTERING.]
        ROL: Lector de base de datos (No eres mecánico, eres un lector de datos).
        DATOS (JSON):
        ---
        ${contextForAI}
        ---
        INPUT USUARIO: "${userQuery}" (Año detectado: ${userYear || "N/A"})

        REGLA DE FIDELIDAD ABSOLUTA (CRÍTICO):
        1. Tu trabajo es MOSTRAR lo que hay en el JSON, no corregirlo.
        2. Si el JSON dice que el "Honda Accord" tiene una transmisión "MCTA", IMPRÍMELA. No importa si tú "sabes" que eso es de Acura. ¡Confía en el JSON!
        3. NO FILTRES NADA. Muestra todas las variantes encontradas.

        REGLA DE TECNOLOGÍA (OBLIGATORIO):
        En cada línea, al final, debes clasificar el tipo de caja:
        - (Tipo: Automática Convencional)
        - (Tipo: CVT)
        - (Tipo: DSG / Doble Embrague)

        REGLA DE FORMATO:
        - [Vehículo]: <b>[CODIGO]</b> ([Velocidades] Vel, [Tracción]) - [Motor] [Tecnología]

        LÓGICA DE AÑO:
        - Si el usuario dio año (Ej: 2000), usa la lógica matemática. Si el JSON dice "98-02", el 2000 SÍ entra.

        Ejemplo de Salida Fiel:
        - Honda Accord: <b>BAXA</b> (4 Vel, FWD) - Motor 2.3L (Tipo: Automática Convencional)
        - Honda Accord: <b>MCTA</b> (5 Vel, FWD) - Motor 2.3L (Tipo: Automática Convencional) <--- Muestra esto aunque parezca raro si está en el JSON.
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
        let textResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || "Sin respuesta.";
        
        textResponse = textResponse.replace(/```json/g, '').replace(/```/g, '');
        let safeResponse = textResponse.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');

        return response.status(200).json({ reply: safeResponse });

    } catch (error) {
        console.error("Error backend:", error);
        return response.status(200).json({ reply: "Ocurrió un problema técnico." });
    }
}
