// --- INICIO DEL CÓDIGO BACKEND (Vercel) ---
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
    // 1. CORS (Permisos para que Shopify pueda consultar)
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (request.method === 'OPTIONS') {
        return response.status(200).end();
    }

    // 2. Cargar datos y validar input
    await loadData();
    if (!dataLoaded || transmissionData.length === 0) {
        return response.status(500).json({ reply: "Error: La base de datos no está disponible." });
    }

    const userQuery = request.body.query;
    if (!userQuery) {
        return response.status(400).json({ reply: "Por favor, ingresa un vehículo para buscar." });
    }

    // 3. Pre-filtrado en JS (Búsqueda amplia)
    // Buscamos coincidencias parciales para reducir los datos enviados a la IA.
    // Usamos 'some' para que si el usuario pone "Accord 2000" y el JSON dice "98-02", 
    // al menos la palabra "Accord" traiga el registro.
    const lowerCaseQuery = userQuery.toLowerCase().trim();
    const queryParts = lowerCaseQuery.split(' ').filter(part => part.length > 1);

    const candidates = transmissionData.filter(item => {
        // Creamos un string gigante con los datos del registro para buscar ahí
        const itemText = `${item.Make} ${item.Model} ${item.Years} ${item['Trans Type']} ${item['Engine Type / Size']}`.toLowerCase();
        // Si ALGUNA parte de la búsqueda (ej: "accord") está en el registro, lo consideramos candidato.
        return queryParts.some(part => itemText.includes(part));
    }).slice(0, 30); // Aumentamos ligeramente el límite a 30 para asegurar cobertura

    if (candidates.length === 0) {
        return response.status(200).json({ reply: `No encontré coincidencias en la base de datos para "${userQuery}".` });
    }

    // 4. Preparar Prompt para Gemini
    const API_KEY = process.env.GEMINI_API_KEY;
    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${API_KEY}`;

    const contextForAI = JSON.stringify(candidates);

    // AQUÍ ESTÁ LA MAGIA: Instrucciones precisas para la IA
    const prompt = `
    Actúa como un experto técnico en transmisiones automáticas.
    
    CONTEXTO DE DATOS:
    Te proporciono una lista de candidatos en JSON:
    ${contextForAI}
    
    GLOSARIO TÉCNICO OBLIGATORIO:
    - "SP" significa "Velocidades" o "Cambios". (Ej: 4 SP = 4 Cambios).
    - "FWD" significa "Tracción Delantera".
    - "RWD" significa "Tracción Trasera".
    - "4WD/AWD" significa "Tracción en las 4 ruedas".
    - Los años en el JSON como "98-02" cubren 1998, 1999, 2000, 2001, 2002.
    
    SOLICITUD DEL USUARIO: "${userQuery}"
    
    TU TAREA:
    1. Identifica el vehículo exacto (Año, Modelo, Motor).
    2. Filtra estrictamente por el año solicitado. Si el usuario pide "2000", el registro "98-02" ES VÁLIDO.
    3. Si el usuario pide "5 cambios" o "5 velocidades", descarta las transmisiones que no sean "5 SP".
    
    FORMATO DE RESPUESTA (ESTRICTO HTML):
    - No saludes. No des explicaciones introductorias.
    - Devuelve una lista donde el nombre de la transmisión (Trans Model) esté dentro de etiquetas <b></b>.
    - Si hay varias opciones compatibles para ese año, explica la diferencia (Cilindraje, Tracción, etc).
    
    Ejemplo de salida deseada:
    "Para Honda Accord 2000 existen estas opciones:
    - <b>B7XA</b> (Motor V6 3.0L, 4 Cambios)
    - <b>BAXA</b> (Motor L4 2.3L, 4 Cambios)"

    Si no hay ninguna coincidencia técnica válida para el año/modelo, responde: "No se encontró la transmisión exacta para este modelo y año."
    `;

    try {
        const geminiResponse = await fetch(GEMINI_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        });

        if (!geminiResponse.ok) throw new Error('Error en la API de IA');

        const data = await geminiResponse.json();
        // Verificación de seguridad por si la IA falla
        const textResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || "Error al procesar la respuesta de la IA.";
        
        return response.status(200).json({ reply: textResponse });

    } catch (error) {
        console.error("Error IA:", error);
        return response.status(500).json({ reply: "Ocurrió un error técnico consultando al experto." });
    }
}
// --- FIN DEL CÓDIGO BACKEND ---
