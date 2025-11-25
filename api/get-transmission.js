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
    }).slice(0, 80); // <--- LÍMITE AMPLIADO: 80 es suficiente para no perder datos, y Flash lo lee rápido.

    if (candidates.length === 0) {
        return response.status(200).json({ reply: `No se encontraron coincidencias para "${userQuery}".` });
    }

    // 4. IA FLASH 2.0 EXPERIMENTAL
    const API_KEY = process.env.GEMINI_API_KEY;
    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${API_KEY}`;

    const contextForAI = JSON.stringify(candidates);

    // --- PROMPT GENERALIZADO (SIN REGLAS ESPECÍFICAS DE COCHES) ---
    const prompt = `
        ROL: Sistema experto de catálogo de autopartes.
        DATOS (JSON):
        ---
        ${contextForAI}
        ---
        INPUT USUARIO: "${expandedQuery}"

        REGLA LÓGICA DE NOMBRES (CRÍTICO):
        1. NO AGRUPES MODELOS DISTINTOS:
           - Si en la lista ves un nombre corto (Ej: "Golf" o "Focus") y uno largo (Ej: "Golf Sportwagen" o "Focus ST"), trátalos como vehículos separados.
           - Genera una línea para el modelo base y otra para la variante.
        2. NO RESUMAS: Si hay 5 opciones de motor diferentes para un mismo año, lista las 5.

        REGLAS DE FORMATO:
        1. IMPORTANTE: Usa etiquetas HTML <b>codigo</b>. NO uses asteriscos (**codigo**).
        2. Si el código es "AVO" o "TBD", escribe "Modelo por confirmar" sin negritas.

        REGLAS TÉCNICAS:
        1. Filtra estrictamente por AÑO (revisa rangos 98-05).
        2. Indica: Tracción (FWD/RWD/AWD) y Motor/Litros.
        3. Tecnología: (CVT), (DSG / Doble Embrague) o (Automática Convencional).

        Ejemplo de Salida Esperada:
        "Resultados para [Auto] [Año]:
        - [Nombre Modelo Exacto]: <b>[CODIGO]</b> ([Tipo], [Vel], [Tracción]) - Motor [Litros]"
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
        // Si la IA ignora la regla y manda asteriscos (**), esto los convierte a HTML (<b>) automáticamente.
        // Esto garantiza que SIEMPRE se vea azul.
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
