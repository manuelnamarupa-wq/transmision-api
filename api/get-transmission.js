const DATA_URL = 'https://raw.githubusercontent.com/manuelnamarupa-wq/transmision-api/main/api/transmissions.json';

let transmissionData = [];
let uniqueModelsStr = ""; 
let dataLoaded = false;
let lastLoadTime = 0;

// --- MOTOR MATEMÁTICO DE AÑOS ---
function isYearInRange(rangeStr, targetYearStr) {
    if (!rangeStr || !targetYearStr) return false;
    const target = parseInt(targetYearStr, 10);
    let cleanRange = rangeStr.replace(/\s/g, '').toUpperCase();
    
    if (cleanRange.includes('-') && !cleanRange.includes('UP')) {
        const parts = cleanRange.split('-');
        let start = parseInt(parts[0], 10);
        let end = parseInt(parts[1], 10);
        if (start < 100) start += (start > 50 ? 1900 : 2000);
        if (end < 100) end += (end > 50 ? 1900 : 2000);
        return target >= start && target <= end;
    }
    if (cleanRange.includes('UP') || cleanRange.includes('+')) {
        let start = parseInt(cleanRange.replace('UP','').replace('+','').replace('-',''), 10);
        if (start < 100) start += (start > 50 ? 1900 : 2000);
        return target >= start;
    }
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
    
    // 1. DETECCIÓN DE VELOCIDAD (Prioridad Alta)
    // Busca números 3-10 seguidos de "cambios/vel" O números 3-9 sueltos.
    let userSpeed = null;
    let queryWithoutSpeed = userQuery;

    const explicitSpeedRegex = /\b(\d{1,2})\s*(cambios|cambio|velocidades|velocidad|vel|marchas|sp|speed)\b/i;
    const explicitMatch = userQuery.match(explicitSpeedRegex);

    if (explicitMatch) {
        userSpeed = explicitMatch[1]; 
        queryWithoutSpeed = userQuery.replace(explicitMatch[0], ' ').trim();
    } else {
        const singleDigitRegex = /\b([3-9])\b/;
        const singleMatch = userQuery.match(singleDigitRegex);
        if (singleMatch) {
            userSpeed = singleMatch[1];
            queryWithoutSpeed = userQuery.replace(singleMatch[0], ' ').trim();
        }
    }

    // 2. EXPANSIÓN DE AÑOS
    const expandedQuery = queryWithoutSpeed.replace(/\b(\d{2})\b/g, (match) => {
        const n = parseInt(match, 10);
        if (n >= 80 && n <= 99) return `19${match}`;
        if (n >= 0 && n <= 30) return `20${match}`;
        return match;
    });

    // 3. DETECCIÓN DE AÑO
    const yearRegex = /\b(19|20)\d{2}\b/;
    const yearMatch = expandedQuery.match(yearRegex);
    const userYear = yearMatch ? yearMatch[0] : null;

    // 4. LIMPIEZA FINAL DE TEXTO
    let textQuery = expandedQuery;
    if (userYear) textQuery = textQuery.replace(userYear, '').trim();
    
    const stopWords = ['cambios', 'cambio', 'velocidades', 'velocidad', 'vel', 'marchas', 'transmision', 'caja', 'automatico', 'automatica'];
    let queryParts = textQuery.toLowerCase().split(' ').filter(part => part.length > 0 && !stopWords.includes(part));

    let candidates = [];
    let searchMode = ""; 

    // Función auxiliar de velocidad
    const matchesSpeed = (item) => {
        if (!userSpeed) return true;
        const type = (item['Trans Type'] || "").toUpperCase();
        return type.includes(`${userSpeed} SP`) || type.includes(`${userSpeed}SP`) || type.includes(`${userSpeed} SPEED`);
    };

    // NIVEL A: Exacto
    if (userYear) {
        candidates = transmissionData.filter(item => {
            const itemText = `${item.Make} ${item.Model} ${item['Trans Type']} ${item['Engine Type / Size']}`.toLowerCase();
            return queryParts.every(word => itemText.includes(word)) && 
                   isYearInRange(item.Years, userYear) &&
                   matchesSpeed(item);
        });
        if (candidates.length > 0) searchMode = "EXACT_YEAR";
    }

    // NIVEL B: General
    if (candidates.length === 0) {
        candidates = transmissionData.filter(item => {
            const itemText = `${item.Make} ${item.Model} ${item.Years} ${item['Trans Type']} ${item['Engine Type / Size']}`.toLowerCase();
            return queryParts.every(word => itemText.includes(word)) &&
                   matchesSpeed(item);
        });
        if (candidates.length > 0) searchMode = "ALL_YEARS";
    }

    // NIVEL C: Corrector
    if (candidates.length === 0) searchMode = "SPELL_CHECK";

    const API_KEY = process.env.GEMINI_API_KEY;
    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${API_KEY}`;

    // --- 1. CORRECTOR ---
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
                
                if (userYear) cleanSugg += ` ${userYear}`;
                if (userSpeed) cleanSugg += ` ${userSpeed} cambios`;

                return response.status(200).json({ reply: replyText, suggestion: cleanSugg });
            } else {
                return response.status(200).json({ reply: `No se encontraron coincidencias.` });
            }
        } catch (e) { return response.status(200).json({ reply: "Sin resultados." }); }
    }

    // --- 2. BÚSQUEDA NORMAL ---
    const finalCandidates = candidates.slice(0, 300); 
    const contextForAI = JSON.stringify(finalCandidates);
    let prompt = "";

    // --- REGLAS BASE ACTUALIZADAS (DOBLE CLUTCH) ---
    const baseRules = `
        REGLAS DE AGRUPACIÓN (INTELIGENTE):
        1. SI EL CÓDIGO ES IDÉNTICO: FUSIÓNALOS en una línea y lista sus motores.
        2. SI EL CÓDIGO ES DIFERENTE: SEPÁRALOS en líneas propias.
        
        REGLAS DE ETIQUETADO (CRÍTICO):
        1. Al final de la línea, indica el TIPO DE CAJA.
        2. Si la caja es DSG, DCT, Powershift o Doble Embrague -> Escribe ÚNICAMENTE: "(Tipo: Doble Clutch)".
        3. Si es CVT -> "(Tipo: CVT)".
        4. Si es normal -> "(Tipo: Automática Convencional)".
        
        OTRAS REGLAS:
        - "AVO"/"TBD" = "Por Definir".
        - Si el usuario pidió ${userSpeed ? userSpeed + " Velocidades" : ""}, prioriza esos resultados.
    `;

    if (searchMode === "EXACT_YEAR") {
        prompt = `
            [SYSTEM: STRICT FORMATTER. OUTPUT TEXT ONLY. NO JSON.]
            DATOS (JSON):
            ---
            ${contextForAI}
            ---
            ${baseRules}
            CONTEXTO: Datos filtrados para año ${userYear}.
            Formato: [Modelo]: <b>[CODIGO]</b> ([#] Vel, [Tracción]) - [Motores] [Tipo]
        `;
    } else { 
        prompt = `
            [SYSTEM: STRICT FORMATTER. OUTPUT TEXT ONLY. NO JSON.]
            CONTEXTO: Catálogo general para "${userQuery}".
            DATOS (JSON):
            ---
            ${contextForAI}
            ---
            ${baseRules}
            REGLAS VISUALES:
            1. ¡SOLO pon en negritas <b> el CÓDIGO!
            2. Nota de Año: Si el usuario pidió año ${userYear || "N/A"} y no está, pon nota al inicio.
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
        
        let safeResponse = textResponse
            .replace(/<b>\s*(AVO|TBD|N\/A)\s*<\/b>/gi, 'Por Definir') 
            .replace(/\b(AVO|TBD)\b/g, 'Por Definir')
            .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>') 
            .replace(/\n/g, '<br>');

        return response.status(200).json({ reply: safeResponse });

    } catch (error) {
        console.error("Error backend:", error);
        return response.status(200).json({ reply: "Error técnico momentáneo." });
    }
}
