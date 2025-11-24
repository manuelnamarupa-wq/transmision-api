// --- CÓDIGO FINAL DE RECUPERACIÓN ---
// 1. URL de GitHub (Modo RAW para que no falle la descarga)
const DATA_URL = 'https://raw.githubusercontent.com/manuelnamarupa-wq/transmision-api/main/api/transmissions.json';

let transmissionData = [];
let dataLoaded = false;

async function loadData() {
    if (!dataLoaded) {
        console.log("Iniciando descarga de datos...");
        try {
            const response = await fetch(DATA_URL);
            if (!response.ok) throw new Error(`Error HTTP: ${response.status}`);
            transmissionData = await response.json();
            dataLoaded = true;
            console.log(`Datos cargados exitosamente: ${transmissionData.length} registros.`);
        } catch (error) {
            console.error('Error crítico descargando JSON:', error);
            throw error; // Lanzamos el error para que el handler lo detecte
        }
    }
}

export default async function handler(request, response) {
    // Configuración CORS estándar
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (request.method === 'OPTIONS') {
        return response.status(200).end();
    }

    try {
        await loadData();
        
        if (!dataLoaded || transmissionData.length === 0) {
            throw new Error("La base de datos no se pudo cargar correctamente.");
        }

        const userQuery = request.body.query;
        if (!userQuery) {
            return response.status(400).json({ reply: "Por favor, escribe un vehículo." });
        }

        // Filtro rápido de candidatos
        const lowerCaseQuery = userQuery.toLowerCase().trim();
        const queryParts = lowerCaseQuery.split(' ').filter(part => part.length > 1);

        const candidates = transmissionData.filter(item => {
            const itemText = `${item.Make} ${item.Model} ${item.Years} ${item['Trans Type']} ${item['Engine Type / Size']}`.toLowerCase();
            return queryParts.some(part => itemText.includes(part));
        }).slice(0, 20); // Enviamos 20 candidatos para asegurar contexto

        if (candidates.length === 0) {
            return response.status(200).json({ reply: `No encontré coincidencias para "${userQuery}" en la base de datos.` });
        }

        // --- CONEXIÓN CON IA (MODELO ESTABLE) ---
        const API_KEY = process.env.GEMINI_API_KEY;
        
        // CAMBIO CRUCIAL: Usamos 'gemini-pro' a secas. Es el más compatible.
        const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${API_KEY}`;

        const contextForAI = JSON.stringify(candidates);

        const prompt = `
            Actúa como experto en transmisiones automáticas.
            DATOS (JSON): ${contextForAI}
            BÚSQUEDA USUARIO: "${userQuery}"
            
            DICCIONARIO:
            - "SP" = Velocidades (4 SP = 4 Velocidades).
            - "FWD" = Tracción Delantera. "RWD" = Tracción Trasera.
            - Años: "98-02" significa 1998 a 2002.
            
            OBJETIVO:
            Devuelve una lista HTML limpia con las transmisiones compatibles.
            
            REGLAS DE FORMATO:
            1. NO saludes.
            2. Pon el código de transmisión ("Trans Model") entre etiquetas <b></b>.
            3. Si el usuario pide "X velocidades", filtra estrictamente.
            4. Diferencia las opciones por motor o tracción si hay varias.

            EJEMPLO DE RESPUESTA:
            "Para Honda Accord 2000:
            - <b>BAXA</b> (4 Velocidades, Motor 2.3L)
            - <b>B7XA</b> (4 Velocidades, Motor 3.0L)"
        `;

        const aiResponse = await fetch(GEMINI_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        });

        if (!aiResponse.ok) {
            const errorText = await aiResponse.text();
            throw new Error(`Error de Google AI (${aiResponse.status}): ${errorText}`);
        }

        const data = await aiResponse.json();
        const textResponse = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!textResponse) throw new Error("La IA no devolvió respuesta de texto.");

        return response.status(200).json({ reply: textResponse });

    } catch (error) {
        console.error("ERROR EN EL SERVIDOR:", error);
        // Devolvemos el error real para verlo en pantalla si vuelve a fallar
        return response.status(500).json({ 
            reply: `Error del sistema: ${error.message}` 
        });
    }
}
// --- FIN DEL CÓDIGO ---
