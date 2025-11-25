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
    
    // 3. Limpieza de Texto
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

    // --- ESCENARIO 1: CORRECTOR (Si no hubo coincidencias de texto) ---
    if (candidates.length === 0) {
        const yearRegex = /\b(19|20)\d{2}\b/;
        const match = userQuery.match(yearRegex);
        const originalYear = match ? match[0] : null;

        const correctionPrompt = `
            ACTÚA COMO: API JSON de corrección ortográfica.
            LISTA VÁLIDA: [${uniqueModelsStr}]
            BÚSQUEDA USUARIO: "${userQuery}"
            TAREA: Encuentra el NOMBRE del vehículo más parecido (ignora el año).
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

                if (originalYear) {
                    const testQuery = `${finalSuggestion} ${originalYear}`.toLowerCase().split(' ');
                    const yearExists = transmissionData.some(item => {
                        const str = `${item.Make} ${item.Model} ${item.Years}`.toLowerCase();
                        return testQuery.every(word => str.includes(word));
                    });

                    if (yearExists) {
                        finalSuggestion = `${finalSuggestion} ${originalYear}`;
                        replyText = `¿Quisiste decir <b>${finalSuggestion}</b>?`;
                    } else {
                        // Si no existe el año, sugerimos buscar el modelo SIN año para ver todas las opciones
                        replyText = `No encontré el año ${originalYear}. ¿Quisiste decir <b>${finalSuggestion}</b> (Ver todos los años)?`;
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

    // --- ESCENARIO 2: BÚSQUEDA NORMAL (PROMPT CORREGIDO) ---
    const contextForAI = JSON.stringify(candidates);

    const prompt = `
        [SYSTEM INSTRUCTION: STRICT OUTPUT ONLY. NO CONVERSATIONAL FILLER.]
        [RULE: Do NOT say "Okay", "Entendido", "Aquí tienes". Start directly with the results.]

        ROL: Catálogo experto de transmisiones.
        DATOS (JSON):
        ---
        ${contextForAI}
        ---
        INPUT USUARIO: "${expandedQuery}"

        REGLA DE MANEJO DE AÑOS (CRÍTICO - "OPCIONES CERCANAS"):
        1. Si el usuario pide un año (Ej: 2000) y el vehículo SÍ está en la lista pero en otro rango (Ej: 2002-2007):
           - ¡NO LO OCULTES!
           - Muestra el vehículo disponible más cercano.
           - Agrega la nota: "(Año [AñoUsuario] no disponible, mostrando [RangoReal])".
           - NO digas "Modelo por confirmar".

        REGLA DE TECNOLOGÍA (OBLIGATORIO):
        En CADA línea, clasifica explícitamente:
        - (Automática Convencional)
        - (CVT)
        - (DSG / Doble Embrague)

        REGLAS DE FORMATO:
        1. Formato: <b>CODIGO</b> (sin asteriscos). 
        2. "AVO"/"TBD" = "Modelo por confirmar".
        3. Desglose: Muestra Motor y Tracción (FWD/RWD).
        4. Inclusión: Si buscan "Cherokee", muestra "Grand Cherokee" también.

        Ejemplo de Respuesta Perfecta:
        "Resultados para Jeep Liberty 2000:
        - Jeep Liberty: <b>42RLE</b> (Automática Convencional, 4 Vel, RWD) - Motor 3.7L (Año 2000 no disponible, mostrando 2002-2007).
        - Jeep Cherokee: <b>AW4</b> (Automática Convencional, 4 Vel, RWD) - Motor 4.0L"
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
