// --- INICIO DEL CÓDIGO (ESTRUCTURA ORIGINAL) ---
// 1. URL de nuestra base de datos JSON en GitHub (CORREGIDA A RAW)
const DATA_URL = 'https://raw.githubusercontent.com/manuelnamarupa-wq/transmision-api/main/api/transmissions.json';

// Variable para guardar los datos en memoria.
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
        return response.status(500).json({ reply: "Error: La plantilla de datos no está disponible en este momento." });
    }

    const userQuery = request.body.query;
    if (!userQuery) {
        return response.status(400).json({ reply: "Por favor, ingresa un vehículo para buscar." });
    }
    
    const lowerCaseQuery = userQuery.toLowerCase().trim();
    const queryParts = lowerCaseQuery.split(' ').filter(part => part.length > 1);

    // Filtro inicial para encontrar candidatos relevantes
    const candidates = transmissionData.filter(item => {
        const itemText = `${item.Make} ${item.Model} ${item.Years} ${item['Trans Type']} ${item['Engine Type / Size']}`.toLowerCase();
        return queryParts.some(part => itemText.includes(part));
    }).slice(0, 30); // Subimos un poco el límite a 30

    if (candidates.length === 0) {
        return response.status(200).json({ reply: `No se encontraron coincidencias iniciales para "${userQuery}" en la plantilla.` });
    }

    // --- ANÁLISIS INTELIGENTE CON IA (AQUÍ ESTÁ EL CAMBIO DE LÓGICA) ---
    const API_KEY = process.env.GEMINI_API_KEY;
    // Usamos el endpoint estándar que tenías
    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${API_KEY}`;

    const contextForAI = JSON.stringify(candidates);

    // EL PROMPT NUEVO Y ESTRICTO:
    const prompt = `
        Actúa como un experto en transmisiones.
        DATOS DISPONIBLES (JSON):
        ---
        ${contextForAI}
        ---
        USUARIO BUSCA: "${userQuery}"

        GLOSARIO TÉCNICO:
        - "SP" = Velocidades/Cambios (Ej: "4 SP" son 4 Velocidades).
        - "FWD" = Tracción Delantera. "RWD" = Tracción Trasera.
        - Años "98-02" incluye 1998, 99, 00, 01, 02.

        INSTRUCCIONES DE RESPUESTA:
        1. NO saludes. NO digas "Hola". Ve directo al grano.
        2. Filtra estrictamente por AÑO y MODELO.
        3. Si el usuario pide "5 cambios", descarta las que no sean "5 SP".
        4. Escribe el modelo de transmisión (Trans Model) dentro de etiquetas <b></b> para que salga en negrita.
        5. Usa formato de lista HTML simple.
        
        Ejemplo de respuesta esperada:
        "Para Accord 2000:
        - <b>BAXA</b> (4 Velocidades, Motor 2.3L)
        - <b>B7XA</b> (4 Velocidades, Motor 3.0L)"

        Si no hay coincidencia técnica exacta para el año, di: "No se encontró transmisión compatible exacta."
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
        console.error("Error en la fase de IA:", error);
        return response.status(500).json({ reply: "Ocurrió un error durante el análisis de la IA." });
    }
}
// --- FIN DEL CÓDIGO ---
