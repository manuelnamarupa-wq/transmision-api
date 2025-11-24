// --- INICIO DEL CÓDIGO BACKEND ---

// 1. URL de la base de datos (La que confirmamos que funciona en el chat anterior)
const DATA_URL = 'https://raw.githubusercontent.com/manuelnamarupa-wq/transmision-api/main/api/transmissions.json';

// Variable para caché
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
    // Configuración CORS
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (request.method === 'OPTIONS') {
        return response.status(200).end();
    }
    
    await loadData();
    if (!dataLoaded || transmissionData.length === 0) {
        return response.status(500).json({ reply: "Error: La base de datos no está disponible." });
    }

    const userQuery = request.body.query;
    if (!userQuery) {
        return response.status(400).json({ reply: "Por favor, ingresa un vehículo para buscar." });
    }

    // Filtro inicial (Búsqueda amplia en JS para no enviar todo a la IA)
    const lowerCaseQuery = userQuery.toLowerCase().trim();
    const queryParts = lowerCaseQuery.split(' ').filter(part => part.length > 1);

    const candidates = transmissionData.filter(item => {
        // Concatenamos todo para buscar coincidencias parciales
        const itemText = `${item.Make} ${item.Model} ${item.Years} ${item['Trans Type']} ${item['Engine Type / Size']}`.toLowerCase();
        return queryParts.some(part => itemText.includes(part));
    }).slice(0, 30); // Enviamos hasta 30 candidatos a la IA

    if (candidates.length === 0) {
        return response.status(200).json({ reply: `No se encontraron coincidencias en la base de datos para "${userQuery}".` });
    }

    // --- ANÁLISIS INTELIGENTE CON IA (PROMPT REFINADO) ---
    const API_KEY = process.env.GEMINI_API_KEY;
    // Usamos gemini-1.5-flash o gemini-pro, ambos funcionan bien.
    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${API_KEY}`;
    
    const contextForAI = JSON.stringify(candidates);

    // AQUÍ ESTÁ LA LÓGICA EXPERTA QUE PEDISTE:
    const prompt = `
        Actúa como un sistema de inventario experto. Tu fuente de verdad es este JSON:
        ---
        ${contextForAI}
        ---
        Consulta del usuario: "${userQuery}"

        REGLAS DE INTERPRETACIÓN TÉCNICA:
        1. "SP" = Velocidades/Cambios (Ej: "4 SP" son 4 velocidades/cambios).
        2. "FWD" = Tracción Delantera. "RWD" = Tracción Trasera. "4WD/AWD" = Tracción total.
        3. Años: Si el JSON dice "98-02", incluye los años 1998, 1999, 2000, 2001, 2002.
        
        OBJETIVO:
        Responde de forma ESTRICTA y DIRECTA. Sin saludos ("Hola"), sin introducciones ("Encontré esto"). Solo datos.
        
        INSTRUCCIONES DE SALIDA:
        1. Filtra estrictamente por el AÑO y MODELO que pide el usuario.
        2. Si el usuario pide "5 cambios", descarta las que no sean "5 SP".
        3. Devuelve una lista HTML.
        4. El código de la transmisión ("Trans Model") debe estar SIEMPRE dentro de etiquetas <b></b>.
        5. Si hay varias opciones para el mismo coche, explica la diferencia entre paréntesis (Motor, Tracción, etc).

        Ejemplo de formato de respuesta deseada:
        "Para Honda Accord 2000:
        - <b>B7XA</b> (Motor V6, 4 Velocidades)
        - <b>BAXA</b> (Motor L4, 4 Velocidades)"

        Si no hay coincidencia exacta técnica, responde: "No se encontró transmisión compatible exacta para esos datos."
    `;

    try {
        const geminiResponse = await fetch(GEMINI_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        });

        if (!geminiResponse.ok) throw new Error('Error API IA');

        const data = await geminiResponse.json();
        const textResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || "Error procesando respuesta.";
        
        return response.status(200).json({ reply: textResponse });

    } catch (error) {
        console.error("Error IA:", error);
        return response.status(500).json({ reply: "Error interno del servidor." });
    }
}
// --- FIN DEL CÓDIGO ---
