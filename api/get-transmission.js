const DATA_URL = 'https://raw.githubusercontent.com/manuelnamarupa-wq/transmision-api/main/api/transmissions.json';

// --- CACHÉ SEGURA (Único truco de velocidad que usaremos) ---
let cachedData = null;

async function getData() {
    if (cachedData) return cachedData;
    console.log("Descargando BD...");
    try {
        const response = await fetch(DATA_URL);
        if (!response.ok) throw new Error('Error descarga');
        cachedData = await response.json();
        return cachedData;
    } catch (e) {
        console.error("Error BD:", e);
        return [];
    }
}

// --- FUNCIÓN DE INGENIERÍA: Validador de Años ---
// Esta función revisa si el año que busca el usuario (ej: 2015) 
// cae dentro del rango del texto (ej: "14-16" o "98-05").
function isYearMatch(dbYearString, userYear) {
    if (!dbYearString || !userYear) return false;
    
    // Convertimos usuario a 2 dígitos (2015 -> 15)
    const uYear = parseInt(userYear.toString().slice(-2)); 
    
    // Limpiamos el dato de la BD (ej: "98-02" -> ["98", "02"])
    // Quitamos paréntesis y espacios extra
    const cleanStr = dbYearString.replace(/[()]/g, ''); 
    
    // Caso 1: Rango (ej: 14-16)
    if (cleanStr.includes('-')) {
        const parts = cleanStr.split('-');
        let start = parseInt(parts[0]);
        let end = parseInt(parts[1]);
        
        // Ajuste de siglo (Si start es 90 es 1990, si es 10 es 2010)
        // Asumimos corte en año 50. >50 es 1900, <50 es 2000.
        // Pero para comparar simple:
        // Si el usuario busca 15, y el rango es 14-16, entra.
        // Si el usuario busca 99, y el rango es 98-02, entra.
        
        // Lógica simple de cruce de siglo:
        if (start > end) { // Caso 98-02
            return uYear >= start || uYear <= end;
        } else { // Caso 14-16
            return uYear >= start && uYear <= end;
        }
    }
    
    // Caso 2: Año único o lista
    return cleanStr.includes(uYear.toString());
}

export default async function handler(request, response) {
    // CORS
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (request.method === 'OPTIONS') return response.status(200).end();

    try {
        const transmissionData = await getData();
        if (!transmissionData || transmissionData.length === 0) {
            cachedData = null; // Reset si falló
            return response.status(500).json({ reply: "Error: Base de datos no disponible." });
        }

        const userQuery = request.body.query;
        if (!userQuery) return response.status(400).json({ reply: "Ingresa un vehículo." });

        const lowerCaseQuery = userQuery.toLowerCase().trim();
        const queryParts = lowerCaseQuery.split(' ').filter(part => part.length > 1);

        // Detectar si el usuario escribió un año (4 dígitos)
        const userYear = queryParts.find(p => !isNaN(p) && p.length === 4);
        // Las partes de texto (sin el año)
        const textParts = queryParts.filter(p => isNaN(p) || p.length !== 4);

        // --- FILTRO ESTRICTO ---
        const candidates = transmissionData.filter(item => {
            const itemText = `${item.Make} ${item.Model} ${item.Years} ${item['Trans Type']} ${item['Engine Type / Size']}`.toLowerCase();
            
            // 1. Filtro Anti-Manual
            if (itemText.includes('standard') || itemText.includes('manual')) return false;

            // 2. Coincidencia de TEXTO (Marca/Modelo)
            // Todas las palabras (menos el año) deben estar
            const textMatch = textParts.every(part => itemText.includes(part));
            if (!textMatch) return false;

            // 3. Coincidencia de AÑO (Matemática)
            // Si el usuario puso año, verificamos el rango
            if (userYear) {
                return isYearMatch(item.Years, userYear);
            }

            return true;
        }).slice(0, 10); // Enviamos máx 10 a la IA

        if (candidates.length === 0) {
            return response.status(200).json({ 
                reply: "No encontrado en la base de datos para ese año y modelo específico." 
            });
        }

        // --- IA ---
        const API_KEY = process.env.GEMINI_API_KEY;
        const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro-latest:generateContent?key=${API_KEY}`;
        
        const simplifiedContext = candidates.map(c => 
            `Auto: ${c.Make} ${c.Model} (${c.Years}) | Trans: ${c['Trans Model']} | Info: ${c['Engine Type / Size']} ${c['Trans Type']}`
        ).join('\n');

        const prompt = `
            Actúa como experto en transmisiones.
            DATOS ENCONTRADOS:
            ${simplifiedContext}
            
            BÚSQUEDA: "${userQuery}"

            TAREA:
            Genera una lista HTML simple.
            
            REGLAS:
            1. Muestra el nombre de la transmisión en negritas <b></b>.
            2. Incluye el motor y la tracción (FWD/RWD).
            3. NO inventes datos. Usa solo lo que te doy.
            4. Si hay varias opciones, lístalas.

            EJEMPLO:
            - <b>09G</b> (2.5L - 6 SP FWD)
        `;

        const geminiResponse = await fetch(GEMINI_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });

        const data = await geminiResponse.json();
        
        if (!data.candidates || data.candidates.length === 0) {
             throw new Error("Sin respuesta IA");
        }

        const textResponse = data.candidates[0].content.parts[0].text;
        return response.status(200).json({ reply: textResponse });

    } catch (error) {
        console.error("Error:", error);
        // Si falla, mensaje genérico seguro en lugar de datos incorrectos
        return response.status(500).json({ reply: "El sistema está ocupado. Por favor intenta de nuevo en unos segundos." });
    }
}
