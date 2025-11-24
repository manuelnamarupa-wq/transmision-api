// --- INICIO DEL CÓDIGO DEFINITIVO (VERCEL) ---

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
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (request.method === 'OPTIONS') {
        return response.status(200).end();
    }
    
    await loadData();
    if (!dataLoaded || transmissionData.length === 0) {
        return response.status(500).json({ reply: "Error: La plantilla de datos no está disponible en este momento." });
    }

    const userQuery = request.body.query;
    if (!userQuery) {
        return response.status(400).json({ reply: "Por favor, ingresa un vehículo para buscar." });
    }
    
    // Filtro inicial básico (Keyword matching)
    const lowerCaseQuery = userQuery.toLowerCase().trim();
    const queryParts = lowerCaseQuery.split(' ').filter(part => part.length > 1);

    const candidates = transmissionData.filter(item => {
        const itemText = `${item.Make} ${item.Model} ${item.Years} ${item['Trans Type']} ${item['Engine Type / Size']}`.toLowerCase();
        return queryParts.some(part => itemText.includes(part));
    }).slice(0, 30); // Aumenté un poco el límite para dar contexto a la IA

    if (candidates.length === 0) {
        return response.status(200).json({ reply: `No se encontraron coincidencias en la base de datos para "${userQuery}".` });
    }

    // --- ANÁLISIS INTELIGENTE CON IA (Prompt Mejorado) ---
    const API_KEY = process.env.GEMINI_API_KEY;
    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro-latest:generateContent?key=${API_KEY}`;
    
    const contextForAI = JSON.stringify(candidates);

    // Prompt con Ingeniería de Datos
    const prompt = `
        Actúa como un motor de búsqueda técnico estricto para transmisiones automáticas.
        
        CONTEXTO (Base de datos):
        ${contextForAI}

        CONSULTA DEL USUARIO: "${userQuery}"

        GLOSARIO TÉCNICO OBLIGATORIO:
        - "SP" significa "Velocidades" o "Cambios". (Ej: "4 SP" = 4 velocidades/cambios).
        - "FWD" significa "Tracción Delantera".
        - "RWD" significa "Tracción Trasera".
        - "4WD/AWD" significa "Tracción en las 4 ruedas".
        - "L4" = 4 Cilindros, "V6" = 6 Cilindros.

        INSTRUCCIONES DE RESPUESTA:
        1. Analiza la consulta y filtra los datos JSON proporcionados arriba.
        2. Si el usuario especifica "5 cambios", descarta las opciones que no sean "5 SP".
        3. Si hay múltiples resultados para el mismo auto, DIFERÉNCIALOS por Motor (Litros/Cilindros) o Años.
        4. FORMATO DE SALIDA (Estricto):
           - Usa **negritas** (doble asterisco) SOLO para el nombre de la transmisión (campo 'Trans Model').
           - Estructura: Auto + Año + Motor -> **Transmisión**
           - Ejemplo de salida deseada: "Honda Accord 2000 (motor V6) lleva transmisión **B7XA**."
        5. Sé directo. Elimina saludos ("Hola", "Aquí tienes"). Ve directo al dato.
        6. Si no hay coincidencia exacta técnica, di "No encontrado".
    `;

    try {
        const geminiResponse = await fetch(GEMINI_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        });

        if (!geminiResponse.ok) throw new Error('La llamada a la IA falló.');

        const data = await geminiResponse.json();
        const textResponse = data.candidates[0].content.parts[0].text;
        
        return response.status(200).json({ reply: textResponse });

    } catch (error) {
        console.error("Error en IA:", error);
        return response.status(500).json({ reply: "Error procesando la búsqueda." });
    }
}
// --- FIN DEL CÓDIGO DE VERCEL ---
