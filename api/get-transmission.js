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
    // Convierte "04" -> "2004", "98" -> "1998" para la búsqueda
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

    // --- PROMPT DE EXPERTO SILENCIOSO ---
    const prompt = `
        ROL INTERNO: Ingeniero experto en transmisiones automáticas.
        OBJETIVO: Identificar la transmisión exacta para el vehículo del cliente.
        DATOS (JSON):
        ---
        ${contextForAI}
        ---
        INPUT USUARIO: "${expandedQuery}"

        INSTRUCCIONES DE RESPUESTA (ESTRICTAS):
        1. SILENCIO DE ROL: NO menciones "soy un experto", "basado en la información" ni "hola".
        2. INICIO DIRECTO: Empieza la frase directamente con: "Para [Vehículo] [Año]:".
        3. FORMATO: Usa una lista con viñetas clara y técnica.

        REGLAS TÉCNICAS:
        1. NUNCA uses la palabra "Estándar" (eso es manual). Solo "Automática".
        2. CLASIFICACIÓN OBLIGATORIA: Debes indicar el tipo exacto:
           - "(Automática Convencional)"
           - "(CVT)"
           - "(DSG / Doble Embrague)"
        3. HTML: Pon el CÓDIGO/MODELO de la transmisión entre <b> y </b>.
        4. VARIANTES: Si hay varias opciones (ej. Motor 2.0 vs 2.5), especifica cuál es cuál.

        Ejemplo de Salida Deseada:
        "Para Volkswagen Jetta 2014:
        - <b>09G</b> (Automática Convencional, 6 Vel) - Motor 2.5L
        - <b>0AM</b> (DSG / Doble Embrague, 7 Vel) - Motor 1.4L Turbo"
    `;

    try {
        const geminiResponse = await fetch(GEMINI_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        });

        // Manejo de Error 429 (Seguridad adicional)
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
