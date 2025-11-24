const DATA_URL = 'https://raw.githubusercontent.com/manuelnamarupa-wq/transmision-api/main/api/transmissions.json';

let cachedData = null;

async function getData() {
    if (cachedData) return cachedData;
    console.log("Descargando BD...");
    try {
        const response = await fetch(DATA_URL);
        if (!response.ok) throw new Error(`Error GitHub: ${response.statusText}`);
        cachedData = await response.json();
        return cachedData;
    } catch (e) {
        console.error("Error BD:", e);
        throw e;
    }
}

// --- VALIDACIÓN MATEMÁTICA (Para que Golf 2015 no traiga Golf 1990) ---
function isYearMatch(dbYearString, userYear) {
    try {
        if (!dbYearString || !userYear) return false;
        const strDbYear = String(dbYearString); 
        const strUserYear = String(userYear);
        const uYear = parseInt(strUserYear.slice(-2)); 
        const cleanStr = strDbYear.replace(/[()]/g, ''); 
        
        if (cleanStr.includes('-')) {
            const parts = cleanStr.split('-');
            let start = parseInt(parts[0]);
            let end = parseInt(parts[1]);
            if (isNaN(start) || isNaN(end)) return false;

            if (start > end) { // Caso 98-02
                return uYear >= start || uYear <= end;
            } else { // Caso 14-16
                return uYear >= start && uYear <= end;
            }
        }
        return cleanStr.includes(uYear.toString());
    } catch (err) {
        return false;
    }
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
            throw new Error("Base de datos vacía.");
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

            const textMatch = textParts.every(part => itemText.includes(part));
            if (!textMatch) return false;

            if (userYear) {
                return isYearMatch(item.Years, userYear);
            }
            return true;
        }).slice(0, 10); 

        if (candidates.length === 0) {
            return response.status(200).json({ 
                reply: "No encontrado para ese año y modelo específico (Filtro estricto)." 
            });
        }

        // --- IA CON EL MODELO CORRECTO ---
        const API_KEY = process.env.GEMINI_API_KEY;
        
        // CORRECCIÓN AQUÍ: Usamos 'gemini-pro-latest' que es el que te funcionaba
        const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro-latest:generateContent?key=${API_KEY}`;
        
        const simplifiedContext = candidates.map(c => 
            `Auto: ${c.Make} ${c.Model} | Años: ${c.Years} | Trans: ${c['Trans Model']} | Info: ${c['Engine Type / Size']}`
        ).join('\n');

        const prompt = `
            Actúa como experto en inventario.
            DATOS:
            ${simplifiedContext}
            
            BÚSQUEDA: "${userQuery}"

            TAREA: Genera lista HTML.
            REGLAS:
            1. NO SALUDAR.
            2. Transmisión en <b></b>.
            3. Muestra el rango de años original.
            
            FORMATO:
            - <b>[CODIGO]</b> (Años: [Rango] | [Info])
        `;

        const geminiResponse = await fetch(GEMINI_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.0 }
            })
        });

        if (!geminiResponse.ok) {
            const errData = await geminiResponse.text();
            throw new Error(`Error Google: ${errData}`);
        }

        const data = await geminiResponse.json();
        
        if (!data.candidates || data.candidates.length === 0) {
             let fallback = candidates.map(c => `- <b>${c['Trans Model']}</b> (Años: ${c.Years})`).join('<br>');
             return response.status(200).json({ reply: fallback });
        }

        const textResponse = data.candidates[0].content.parts[0].text;
        return response.status(200).json({ reply: textResponse });

    } catch (error) {
        console.error("Error Real:", error);
        // Mantenemos el reporte de error por si acaso, pero ya no debería salir
        return response.status(500).json({ 
            reply: `ERROR TÉCNICO: ${error.message}` 
        });
    }
}
