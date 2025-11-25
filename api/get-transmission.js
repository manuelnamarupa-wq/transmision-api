const DATA_URL = 'https://raw.githubusercontent.com/manuelnamarupa-wq/transmision-api/main/api/transmissions.json';

let transmissionData = [];
let uniqueModelsStr = ""; 
let dataLoaded = false;
let lastLoadTime = 0;

// --- MOTOR MATEMÁTICO DE AÑOS (CEREBRO LÓGICO) ---
function isYearInRange(rangeStr, targetYearStr) {
    if (!rangeStr || !targetYearStr) return false;
    const target = parseInt(targetYearStr, 10);
    let cleanRange = rangeStr.replace(/\s/g, '').toUpperCase();
    
    // Caso: "98-02"
    if (cleanRange.includes('-') && !cleanRange.includes('UP')) {
        const parts = cleanRange.split('-');
        let start = parseInt(parts[0], 10);
        let end = parseInt(parts[1], 10);
        if (start < 100) start += (start > 50 ? 1900 : 2000);
        if (end < 100) end += (end > 50 ? 1900 : 2000);
        return target >= start && target <= end;
    }
    // Caso: "99-UP"
    if (cleanRange.includes('UP') || cleanRange.includes('+')) {
        let start = parseInt(cleanRange.replace('UP','').replace('+','').replace('-',''), 10);
        if (start < 100) start += (start > 50 ? 1900 : 2000);
        return target >= start;
    }
    // Caso: Año único "2004"
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
    
    // 1. Detectar Año y Texto
    const yearRegex = /\b(19|20)\d{2}\b/;
    const yearMatch = userQuery.match(yearRegex);
    const userYear = yearMatch ? yearMatch[0] : null;

    // Limpiar query quitando el año
    let textQuery = userQuery;
    if (userYear) textQuery = textQuery.replace(userYear, '').trim();
    
    const stopWords = ['cambios', 'cambio', 'velocidades', 'velocidad', 'vel', 'marchas', 'transmision', 'caja', 'automatico', 'automatica'];
    let queryParts = textQuery.toLowerCase().split(' ').filter(part => part.length > 0 && !stopWords.includes(part));

    // --- ESTRATEGIA DE 3 NIVELES ---

    let candidates = [];
    let searchMode = ""; // "EXACT_YEAR", "ALL_YEARS", "SPELL_CHECK"

    // NIVEL A: Búsqueda por Nombre + Año Exacto (Matemático)
    if (userYear) {
        candidates = transmissionData.filter(item => {
            const itemText = `${item.Make} ${item.Model} ${item['Trans Type']} ${item['Engine Type / Size']}`.toLowerCase();
            // Debe coincidir el nombre Y el año matemático
            return queryParts.every(word => itemText.includes(word)) && isYearInRange(item.Years, userYear);
        });
        
        if (candidates.length > 0) {
            searchMode = "EXACT_YEAR";
        }
    }

    // NIVEL B: Si falló Nivel A (o no puso año), buscar solo por Nombre
    if (candidates.length === 0) {
        candidates = transmissionData.filter(item => {
            const itemText = `${item.Make} ${item.Model} ${item.Years} ${item['Trans Type']} ${item['Engine Type / Size']}`.toLowerCase();
            return queryParts.every(word => itemText.includes(word));
        });
        
        if (candidates.length > 0) {
            searchMode = "ALL_YEARS"; // Encontramos el modelo, pero no el año (o no puso año)
        }
    }

    // NIVEL C: Corrector Ortográfico (Si todo falló)
    if (candidates.length === 0) {
        searchMode = "SPELL_CHECK";
    }

    // --- PROCESAMIENTO ---
    const API_KEY = process.env.GEMINI_API_KEY;
    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${API_KEY}`;

    // CASO: CORRECTOR (SPELL CHECK)
    if (searchMode === "SPELL_CHECK") {
        const correctionPrompt = `
            ACTÚA COMO: API JSON de corrección.
            LISTA VÁLIDA: [${uniqueModelsStr}]
            BÚSQUEDA USUARIO: "${textQuery}"
            TAREA: Encuentra el nombre más parecido.
            FORMATO JSON: { "found": true, "suggestion": "Jeep Liberty" }
        `;
        try {
            const geminiResponse = await fetch(GEMINI_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: correctionPrompt }] }] }),
            });
            const data = await geminiResponse.json();
            let rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
            rawText = rawText.replace(/```json|```/g, '').trim();
            const parsed = JSON.parse(rawText);

            if (parsed.found && parsed.suggestion) {
                let replyText = `No encontré coincidencias. ¿Quisiste decir <b>${parsed.suggestion}</b>?`;
                let cleanSugg = parsed.suggestion;
                // Si el usuario había puesto año, lo agregamos a la sugerencia para reintentar
                if (userYear) cleanSugg += ` ${userYear}`; 
                
                return response.status(200).json({ reply: replyText, suggestion: cleanSugg });
            } else {
                return response.status(200).json({ reply: `No se encontraron coincidencias para "${userQuery}".` });
            }
        } catch (e) { return response.status(200).json({ reply: "Sin resultados." }); }
    }

    // CASO: RESULTADOS ENCONTRADOS (EXACTOS O GENERALES)
    // Limitamos a 200 para asegurar que entre todo (incluso si son muchos Accords)
    const finalCandidates = candidates.slice(0, 200);
    const contextForAI = JSON.stringify(finalCandidates);

    let prompt = "";

    if (searchMode === "EXACT_YEAR") {
        prompt = `
            [SYSTEM: STRICT DATA FORMATTER. NO FILTERING ALLOWED.]
            CONTEXTO: El sistema ya filtró matemáticamente. Todos los datos recibidos SON VÁLIDOS para el año ${userYear}.
            TU TAREA: Formatear la lista.
            
            DATOS (JSON):
            ---
            ${contextForAI}
            ---
            
            REGLAS OBLIGATORIAS:
            1. MUESTRA CADA CÓDIGO ENCONTRADO. Si el JSON tiene 5 códigos diferentes (MAXA, BAXA, B7XA, MCTA...), genera 5 líneas.
            2. NO AGRUPES. NO RESUMAS.
            3. FORMATO: <b>CODIGO</b> ([Tipo], [Vel], [Tracción]) - [Motor]
            4. TECNOLOGÍA: Indica (Automática Convencional / CVT / DSG).
        `;
    } else { // ALL_YEARS (El año no coincidió o no puso año)
        prompt = `
            [SYSTEM: STRICT DATA FORMATTER.]
            CONTEXTO: El usuario buscó "${userQuery}". No encontré coincidencias exactas de año (o no puso año), así que muestro todos los rangos.
            
            DATOS (JSON):
            ---
            ${contextForAI}
            ---
            
            REGLAS:
            1. Si el usuario pidió año ${userYear} y no está en la lista, pon una nota general al principio: "No encontré año ${userYear}, mostrando modelos cercanos:".
            2. Lista los modelos disponibles con sus rangos de años.
            3. MUESTRA TODO (Códigos, Motores, Tracción).
            4. Formato: [Modelo] ([Años]): <b>[CODIGO]</b>...
        `;
    }

    try {
        const geminiResponse = await fetch(GEMINI_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        });

        if (geminiResponse.status === 429) return response.status(200).json({ reply: "⚠️ Alta demanda. Reintenta." });
        if (!geminiResponse.ok) throw new Error("Error IA");

        const data = await geminiResponse.json();
        let textResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || "Sin datos.";
        
        textResponse = textResponse.replace(/```json/g, '').replace(/```/g, '');
        let safeResponse = textResponse.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');

        return response.status(200).json({ reply: safeResponse });

    } catch (error) {
        console.error("Error backend:", error);
        return response.status(200).json({ reply: "Error técnico momentáneo." });
    }
}
