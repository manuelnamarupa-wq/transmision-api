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
    
    // 3. Lógica de 2 Dígitos y Filtro Rápido
    // Convierte "04" -> "2004", "98" -> "1998"
    const expandedQuery = userQuery.replace(/\b(\d{2})\b/g, (match) => {
        const n = parseInt(match, 10);
        if (n >= 80 && n <= 99) return `19${match}`;
        if (n >= 0 && n <= 30) return `20${match}`;
        return match;
    });

    const lowerCaseQuery = expandedQuery.toLowerCase().trim();
    const queryParts = lowerCaseQuery.split(' ').filter(part => part.length > 1);

    // Filtramos buscando coincidencias de texto
    const candidates = transmissionData.filter(item => {
        const itemText = `${item.Make} ${item.Model} ${item.Years} ${item['Trans Type']} ${item['Engine Type / Size']}`.toLowerCase();
        return queryParts.some(part => itemText.includes(part));
    }).slice(0, 25); 

    if (candidates.length === 0) {
        return response.status(200).json({ reply: `No se encontraron coincidencias iniciales para "${userQuery}" en la plantilla.` });
    }

    // 4. ANÁLISIS INTELIGENTE CON IA
    const API_KEY = process.env.GEMINI_API_KEY;
    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro-latest:generateContent?key=${API_KEY}`;

    const contextForAI = JSON.stringify(candidates);

    // --- PROMPT DE NEGOCIO ---
    const prompt = `
        Actúa como un experto en transmisiones automáticas.
        DATOS DISPONIBLES (JSON):
        ---
        ${contextForAI}
        ---
        USUARIO BUSCA: "${expandedQuery}" (Original: "${userQuery}")

        REGLAS DE NEGOCIO (ESTRICTAS):
        1. PROHIBIDO usar la palabra "Estándar" o "Standard". En este contexto eso significa transmisión manual y aquí SOLO vendemos automáticas.
        2. Si te refieres al modelo normal (no sport, no turbo), llámalo "Versión Base" o solo por su nombre (Ej: "Golf" a secas).
        3. Clasifica la tecnología de la transmisión explícitamente:
           - Si es CVT, indícalo: "(Tipo: CVT)".
           - Si es DSG / DCT / Doble Embrague, indícalo: "(Tipo: DSG / Doble Embrague)".
           - Si es convencional (convertidor de par), indícalo: "(Tipo: Automática Convencional)".

        REGLAS TÉCNICAS:
        1. "SP" = Velocidades (Ej: 6 SP = 6 Velocidades).
        2. Filtra por Año y Modelo.
        3. Escribe el modelo de transmisión ("Trans Model") entre etiquetas <b></b>.

        Ejemplo de respuesta ideal:
        "Para Volkswagen Golf 2015:
        - <b>09G</b> (Automática Convencional 6 Vel, Motor 1.8L) - Para versión Base.
        - <b>02E</b> (DSG / Doble Embrague 6 Vel, Motor 2.0L TDI) - Para versión Diesel.
        - <b>0AM</b> (DSG / Doble Embrague 7 Vel, Motor 1.4L)"
    `;

    try {
        const geminiResponse = await fetch(GEMINI_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        });

        // MANEJO DE ERROR 429 (CUOTA) - MENSAJE PROFESIONAL
        if (geminiResponse.status === 429) {
            console.warn("Cuota de API excedida (429).");
            return response.status(200).json({ 
                reply: "⚠️ <b>Alta demanda de consultas.</b><br>Nuestros servidores están procesando muchas búsquedas en este momento.<br>Por favor, espera <b>30 segundos</b> e inténtalo de nuevo." 
            });
        }

        if (!geminiResponse.ok) {
            const errText = await geminiResponse.text();
            throw new Error(`Error IA (${geminiResponse.status}): ${errText}`);
        }

        const data = await geminiResponse.json();

        if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
             return response.status(200).json({ reply: "No se pudo generar una respuesta clara. Intenta especificar el año completo." });
        }

        const textResponse = data.candidates[0].content.parts[0].text;
        
        return response.status(200).json({ reply: textResponse });

    } catch (error) {
        console.error("Error en la fase de IA:", error);
        // Mensaje genérico profesional
        return response.status(200).json({ 
            reply: "Ocurrió un problema técnico temporal en nuestros servidores. Por favor intenta buscar de nuevo." 
        });
    }
}
