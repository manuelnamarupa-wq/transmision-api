const DATA_URL = 'https://raw.githubusercontent.com/manuelnamarupa-wq/transmision-api/main/api/transmissions.json';

let transmissionData = [];
let uniqueModelsStr = ""; 
let dataLoaded = false;
let lastLoadTime = 0;

// --- FUNCIÓN MATEMÁTICA DE AÑOS (EL CEREBRO NUEVO) ---
// Convierte "98-02", "99-UP", "04" en rangos numéricos y verifica si el año del usuario entra.
function isYearInRange(rangeStr, targetYearStr) {
    if (!rangeStr || !targetYearStr) return false;
    const target = parseInt(targetYearStr, 10);
    
    // Limpieza básica
    let cleanRange = rangeStr.replace(/\s/g, '').toUpperCase();
    
    // Caso 1: Rango "98-02"
    if (cleanRange.includes('-') && !cleanRange.includes('UP')) {
        const parts = cleanRange.split('-');
        let start = parseInt(parts[0], 10);
        let end = parseInt(parts[1], 10);
        
        // Convertir 2 dígitos a 4 (98->1998, 02->2002)
        if (start < 100) start += (start > 50 ? 1900 : 2000);
        if (end < 100) end += (end > 50 ? 1900 : 2000);
        
        return target >= start && target <= end;
    }
    
    // Caso 2: "99-UP" o "99+"
    if (cleanRange.includes('UP') || cleanRange.includes('+')) {
        let start = parseInt(cleanRange.replace('UP','').replace('+','').replace('-',''), 10);
        if (start < 100) start += (start > 50 ? 1900 : 2000);
        return target >= start;
    }

    // Caso 3: Año único "2004" o "04"
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
    
    // Detectar año en la búsqueda del usuario (Ej: 2000)
    const yearRegex = /\b(19|20)\d{2}\b/;
    const yearMatch = userQuery.match(yearRegex);
    const userYear = yearMatch ? yearMatch[0] : null;

    // Limpieza de Texto (Quitar año del texto para filtrar mejor nombres)
    let textQuery = userQuery;
    if (userYear) textQuery = textQuery.replace(userYear, '').trim();
    
    const stopWords = ['cambios', 'cambio', 'velocidades', 'velocidad', 'vel', 'marchas', 'transmision', 'caja', 'automatico', 'automatica'];
    let queryParts = textQuery.toLowerCase().split(' ').filter(part => part.length > 0 && !stopWords.includes(part));

    // --- FILTRO: TEXTO ESTRICTO ---
    const candidates = transmissionData.filter(item => {
        const itemText = `${item.Make} ${item.Model} ${item['Trans Type']} ${item['Engine Type / Size']}`.toLowerCase();
        // Todas las palabras (menos el año) deben coincidir
        return queryParts.every(word => itemText.includes(word));
    }).slice(0, 300); // Límite masivo para no perder MCTA

    const API_KEY = process.env.GEMINI_API_KEY;
    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${API_KEY}`;

    // --- ESCENARIO 1: CORRECTOR (USANDO LÓGICA MATEMÁTICA) ---
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

                // VERIFICACIÓN MATEMÁTICA REAL
                if (userYear) {
                    // Buscamos en TODA la base de datos si existe ese modelo + ese año matemáticamente
                    const cleanSuggestion = finalSuggestion.toLowerCase().split(' ');
                    
                    const existsMath = transmissionData.some(item => {
                        const str = `${item.Make} ${item.Model}`.toLowerCase();
                        // Coincide nombre Y coincide rango matemático
                        return cleanSuggestion.every(w => str.includes(w)) && isYearInRange(item.Years, userYear);
                    });

                    if (existsMath) {
                        finalSuggestion = `${finalSuggestion} ${userYear}`;
                        replyText = `¿Quisiste decir <b>${finalSuggestion}</b>?`;
                    } else {
                        // Existe el modelo, pero NO el año
                        replyText = `El modelo <b>${finalSuggestion}</b> existe, pero no encontré registros compatibles con el año <b>${userYear}</b>.`;
                        // Quitamos el año de la sugerencia del botón para que busque todos
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

    // --- ESCENARIO 2: BÚSQUEDA NORMAL (PARA QUE SALGA MCTA) ---
    const contextForAI = JSON.stringify(candidates);

    const prompt = `
        [SYSTEM: RAW DATA EXTRACTION. NO GROUPING.]
        ROL: Extractor de datos.
        DATOS (JSON):
        ---
        ${contextForAI}
        ---
        INPUT USUARIO: "${userQuery}" (Año: ${userYear || "Todos"})

        INSTRUCCIONES CRÍTICAS:
        1. REVISA CADA FILA DEL JSON: Si hay 10 filas que coinciden, genera 10 líneas de texto.
        2. PROHIBIDO AGRUPAR: No escribas "MAXA, BAXA". Escribe una línea para MAXA y otra para BAXA.
        3. EXHAUSTIVIDAD: Busca códigos raros (MCTA, B7XA, etc.). Si están en el JSON y coinciden con el año, PONLOS.
        
        LÓGICA DE AÑO:
        - Si el usuario especificó un año (Ej: 2000), usa la lógica matemática: ¿El 2000 está dentro del rango "Years" (Ej: 98-02)? Si sí, inclúyelo.
        - Si el año no coincide, descártalo o pon una nota.

        FORMATO VISUAL:
        - [Vehículo]: <b>[CODIGO]</b> ([Tipo], [Vel], [Tracción]) - [Motor]

        Ejemplo Desagregado:
        - Honda Accord: <b>BAXA</b> (...) - Motor 2.3L
        - Honda Accord: <b>MAXA</b> (...) - Motor 2.3L
        - Honda Accord: <b>MCTA</b> (...) - Motor 2.3L
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
