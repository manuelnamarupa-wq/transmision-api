const DATA_URL = 'https://raw.githubusercontent.com/manuelnamarupa-wq/transmision-api/main/api/transmissions.json';

// --- CACHÉ (Velocidad) ---
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

// --- VALIDACIÓN MATEMÁTICA DE AÑOS (El motor de la precisión) ---
function isYearMatch(dbYearString, userYear) {
    if (!dbYearString || !userYear) return false;
    const uYear = parseInt(userYear.toString().slice(-2)); 
    const cleanStr = dbYearString.replace(/[()]/g, ''); 
    
    if (cleanStr.includes('-')) {
        const parts = cleanStr.split('-');
        let start = parseInt(parts[0]);
        let end = parseInt(parts[1]);
        if (start > end) { // Caso cruce de siglo (98-02)
            return uYear >= start || uYear <= end;
        } else { // Caso normal (14-16)
            return uYear >= start && uYear <= end;
        }
    }
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
            cachedData = null; 
            return response.status(500).json({ reply: "Error: Base de datos no disponible." });
        }

        const userQuery = request.body.query;
        if (!userQuery) return response.status(400).json({ reply: "Ingresa un vehículo." });

        const lowerCaseQuery = userQuery.toLowerCase().trim();
        const queryParts = lowerCaseQuery.split(' ').filter(part => part.length > 1);
        const userYear = queryParts.find(p => !isNaN(p) && p.length === 4);
        const textParts = queryParts.filter(p => isNaN(p) || p.length !== 4);

        // --- FILTRO ESTRICTO ---
        const candidates = transmissionData.filter(item => {
            const itemText = `${item.Make} ${item.Model} ${item.Years} ${item['Trans Type']} ${item['Engine Type / Size']}`.toLowerCase();
            
            if (itemText.includes('standard') || itemText.includes('manual')) return false;

            // 1. Coincidencia de Texto (Marca/Modelo)
            const textMatch = textParts.every(part => itemText.includes(part));
            if (!textMatch) return false;

            // 2. Coincidencia de Año (Matemática)
            if (userYear) {
                return isYearMatch(item.Years, userYear);
            }
            return true;
        }).slice(0, 10); 

        if (candidates.length === 0) {
            return response.status(200).json({ 
                reply: "No encontrado para ese año y modelo específico." 
            });
        }

        // --- PREPARACIÓN PARA IA ---
        const API_KEY = process.env.GEMINI_API_KEY;
        const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro-latest:generateContent?key=${API_KEY}`;
        
        const simplifiedContext = candidates.map(c => 
            `Auto: ${c.Make} ${c.Model} | Años: ${c.Years} | Trans: ${c['Trans Model']} | Info: ${c['Engine Type / Size']} ${c['Trans Type']}`
        ).join('\n');

        const prompt = `
            Actúa como experto en inventario.
            DATOS ENCONTRADOS:
            ${simplifiedContext}
            
            BÚSQUEDA: "${userQuery}"

            TAREA:
            Genera una lista HTML pura.

            REGLAS ESTRICTAS:
            1. PROHIBIDO SALUDAR. No digas "Claro", "Hola" o "Aquí tienes".
            2. Empieza directamente con el primer item de la lista.
            3. Pon el nombre de la transmisión en negritas <b></b>.
            4. OBLIGATORIO: Muestra el rango de años del dato original.
            
            FORMATO REQUERIDO:
            - <b>[CODIGO_TRANS]</b> (Años: [Rango] | [Motor] - [Tracción])

            Ejemplo:
            - <b>09G</b> (Años: 14-16 | 2.5L - 6 SP FWD)
        `;

        const geminiResponse = await fetch(GEMINI_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                contents: [{ parts: [{ text: prompt }] }],
                // Configuración "Temperatura 0" para máxima obediencia y seriedad
                generationConfig: {
                    temperature: 0.0, 
                    maxOutputTokens: 250
                }
            })
        });

        const data = await geminiResponse.json();
        
        if (!data.candidates || data.candidates.length === 0) {
             // Fallback por si la IA falla (Modo Manual)
             let fallback = candidates.map(c => `- <b>${c['Trans Model']}</b> (Años: ${c.Years} | ${c['Engine Type / Size']})`).join('<br>');
             return response.status(200).json({ reply: fallback });
        }

        const textResponse = data.candidates[0].content.parts[0].text;
        return response.status(200).json({ reply: textResponse });

    } catch (error) {
        console.error("Error:", error);
        return response.status(500).json({ reply: "Sistema reiniciando. Intenta en 5 segundos." });
    }
}
