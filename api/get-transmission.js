const DATA_URL = 'https://raw.githubusercontent.com/manuelnamarupa-wq/transmision-api/main/api/transmissions.json';

// Cache en memoria
let transmissionData = [];
let uniqueModelsStr = ""; // Lista de modelos únicos para el corrector
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
            
            // --- PRE-PROCESO PARA EL CORRECTOR ---
            // Creamos una lista de texto con todos los modelos únicos (Ej: "Honda Accord, VW Jetta, Jeep Liberty...")
            // Esto se lo pasaremos a la IA solo cuando no encuentre nada.
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

    const stopWords = ['cambios', 'cambio', 'velocidades', 'velocidad', 'vel', 'marchas', 'transmision', 'caja', 'automatico', 'automatica'];
    const activeSearchTerms = queryParts.filter(part => !stopWords.includes(part));

    // --- FILTRO HÍBRIDO ---
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

    // --- ESCENARIO 1: NO HAY RESULTADOS (CORRECTOR DE ERRORES) ---
    if (candidates.length === 0) {
        // En lugar de dar error, llamamos a la IA para que sugiera una corrección
        // usando la lista 'uniqueModelsStr' que preparamos al inicio.
        
        const correctionPrompt = `
            ACTÚA COMO: Corrector ortográfico de vehículos.
            LISTA VÁLIDA DE VEHÍCULOS EN BD: [${uniqueModelsStr}]
            BÚSQUEDA DEL USUARIO: "${userQuery}"

            TAREA:
            1. Compara la búsqueda del usuario con la LISTA VÁLIDA.
            2. Si hay un error ortográfico obvio (Ej: "Liberti" vs "Liberty", "Jeta" vs "Jetta", "Cheyene" vs "Cheyenne"), sugiere el correcto.
            3. Intenta preservar el AÑO si el usuario lo escribió.

            SALIDA (Solo una de estas dos opciones):
            - Opción A (Si encontraste corrección): "¿Quisiste decir <b>[Nombre Correcto] [Año]</b>?"
            - Opción B (Si no se parece a nada): "No se encontraron coincidencias para ${userQuery}. Verifica el nombre."
        `;

        try {
            const geminiResponse = await fetch(GEMINI_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: correctionPrompt }] }] }),
            });

            if (!geminiResponse.ok) throw new Error("Error IA Corrector");
            const data = await geminiResponse.json();
            const suggestion = data.candidates?.[0]?.content?.parts?.[0]?.text || `No se encontraron resultados para "${userQuery}".`;
            
            return response.status(200).json({ reply: suggestion });

        } catch (error) {
            // Si falla el corrector, damos el mensaje estándar
            return response.status(200).json({ reply: `No se encontraron coincidencias para "${userQuery}".` });
        }
    }

    // --- ESCENARIO 2: SÍ HAY RESULTADOS (FLUJO NORMAL) ---
    const contextForAI = JSON.stringify(candidates);

    const prompt = `
        ROL: Catálogo experto de transmisiones.
        DATOS (JSON):
        ---
        ${contextForAI}
        ---
        INPUT USUARIO: "${expandedQuery}"

        REGLAS DE NEGOCIO:
        1. MUESTRA TODO: Si hay códigos distintos (Ej: BAXA, B7XA), genera líneas distintas.
        2. Búsqueda amplia: Si buscan "Cherokee", incluye "Grand Cherokee".
        3. Formato: <b>CODIGO</b> (sin asteriscos). "AVO"/"TBD" = "Modelo por confirmar".
        4. Desglose: Muestra Motor y Tracción.

        Ejemplo Esperado:
        "Resultados para Honda Accord 2000:
        - Accord (4 Cil): <b>BAXA</b> (Automática Convencional, 4 Vel, FWD) - Motor 2.3L
        - Accord (V6): <b>B7XA</b> (Automática Convencional, 4 Vel, FWD) - Motor 3.0L"
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
