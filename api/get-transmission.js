const DATA_URL = 'https://raw.githubusercontent.com/manuelnamarupa-wq/transmision-api/main/api/transmissions.json';

let transmissionData = [];
let dataLoaded = false;

async function loadData() {
    if (!dataLoaded) {
        try {
            const response = await fetch(DATA_URL);
            if (!response.ok) throw new Error('La base de datos JSON no se pudo descargar.');
            transmissionData = await response.json();
            dataLoaded = true;
            console.log(`Base de datos cargada: ${transmissionData.length} registros.`);
        } catch (error) {
            console.error('Error crítico al cargar transmissions.json:', error);
        }
    }
}

export default async function handler(request, response) {
    // 1. Configuración CORS
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (request.method === 'OPTIONS') {
        return response.status(200).end();
    }
    
    // 2. Carga de Datos
    await loadData();
    if (!dataLoaded || transmissionData.length === 0) {
        return response.status(500).json({ reply: "Error: La plantilla de datos no está disponible en este momento." });
    }

    const userQuery = request.body.query;
    if (!userQuery) {
        return response.status(400).json({ reply: "Por favor, ingresa un vehículo para buscar." });
    }
    
    // 3. Lógica de 2 Dígitos
    const expandedQuery = userQuery.replace(/\b(\d{2})\b/g, (match) => {
        const n = parseInt(match, 10);
        if (n >= 80 && n <= 99) return `19${match}`;
        if (n >= 0 && n <= 30) return `20${match}`;
        return match;
    });

    const lowerCaseQuery = expandedQuery.toLowerCase().trim();
    const queryParts = lowerCaseQuery.split(' ').filter(part => part.length > 1);

    // --- FILTRO HÍBRIDO (ESTRICTO EN NOMBRE, FLEXIBLE EN AÑO) ---
    const textParts = queryParts.filter(part => isNaN(part)); 
    
    const candidates = transmissionData.filter(item => {
        const itemText = `${item.Make} ${item.Model} ${item.Years} ${item['Trans Type']} ${item['Engine Type / Size']}`.toLowerCase();
        
        // Regla: Debe contener las palabras escritas (Ej: Cherokee)
        if (textParts.length > 0) {
            const matchesWords = textParts.every(word => itemText.includes(word));
            if (!matchesWords) return false;
        }

        // Regla: Dejamos pasar los años para que la IA los analice
        return true;
    }).slice(0, 20); // Mantenemos la lista corta (20) para máxima velocidad

    if (candidates.length === 0) {
        return response.status(200).json({ reply: `No se encontraron coincidencias para "${userQuery}". Verifica el nombre del modelo.` });
    }

    // 4. ANÁLISIS INTELIGENTE CON IA
    const API_KEY = process.env.GEMINI_API_KEY;
    
    // --- CAMBIO DE MODELO: USAMOS EL MÁS RÁPIDO DE TU LISTA ---
    // gemini-2.5-flash: Velocidad extrema, ideal para tu plan.
    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`;

    const contextForAI = JSON.stringify(candidates);

    // --- PROMPT COMPLETO (MANTENIDO EXACTAMENTE IGUAL) ---
    const prompt = `
        ROL: Motor de búsqueda estricto de autopartes.
        DATOS DISPONIBLES (JSON):
        ---
        ${contextForAI}
        ---
        INPUT USUARIO: "${expandedQuery}"

        REGLAS DE FORMATO (IMPORTANTE):
        1. CÓDIGO TRANSMISIÓN: Debe ir OBLIGATORIAMENTE entre etiquetas <b> y </b>. (Ejemplo: <b>6F35</b>).
        2. Si el modelo es "AVO" o "TBD", NO uses negritas.

        REGLAS DE LÓGICA:
        1. SOLO usa los vehículos listados en DATOS DISPONIBLES.
        2. Revisa los rangos de años en el JSON (Ej: "98-02" incluye el 2000). Si el año coincide, inclúyelo.
        3. Si buscas "Cherokee" y también aparece "Grand Cherokee" que coincida en año, muestra AMBOS diferenciándolos por nombre completo.

        REGLAS TÉCNICAS:
        1. NO uses la palabra "Estándar".
        2. TRACCIÓN: Indica SIEMPRE (FWD), (RWD) o (AWD/4WD).
        3. TECNOLOGÍA: Clasifica (CVT), (DSG / Doble Embrague) o (Automática Convencional).

        Ejemplo de Respuesta Perfecta:
        "Resultados para Jeep Cherokee 2000:
        - Jeep Cherokee Classic: <b>AW4</b> (Automática Convencional, 4 Vel, RWD) - Motor 4.0L
        - Jeep Grand Cherokee Laredo: <b>42RE</b> (Automática Convencional, 4 Vel, AWD) - Motor 4.0L"
    `;

    try {
        const geminiResponse = await fetch(GEMINI_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        });

        if (geminiResponse.status === 429) {
            console.warn("Cuota de API excedida (429).");
            return response.status(200).json({ 
                reply: "⚠️ <b>Alta demanda.</b><br>Estamos procesando muchas solicitudes. Por favor intenta en unos segundos." 
            });
        }

        if (!geminiResponse.ok) {
            const errText = await geminiResponse.text();
            throw new Error(`Error IA (${geminiResponse.status}): ${errText}`);
        }

        const data = await geminiResponse.json();

        if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
             return response.status(200).json({ reply: "No se pudo generar una respuesta clara." });
        }

        const textResponse = data.candidates[0].content.parts[0].text;
        
        return response.status(200).json({ reply: textResponse });

    } catch (error) {
        console.error("Error en la fase de IA:", error);
        return response.status(200).json({ 
            reply: "Ocurrió un problema técnico temporal. Por favor intenta buscar de nuevo." 
        });
    }
}
