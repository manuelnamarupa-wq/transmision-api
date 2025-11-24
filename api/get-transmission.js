const DATA_URL = 'https://raw.githubusercontent.com/manuelnamarupa-wq/transmision-api/main/api/transmissions.json';

let cachedData = null;

async function getData() {
    if (cachedData) return cachedData;
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

        const queryParts = userQuery.toLowerCase().trim().split(' ').filter(part => part.length > 1);

        // FILTRO ESTRICTO (AND)
        const candidates = transmissionData.filter(item => {
            const itemText = `${item.Make} ${item.Model} ${item.Years} ${item['Trans Type']} ${item['Engine Type / Size']}`.toLowerCase();
            
            if (itemText.includes('standard') || itemText.includes('manual')) return false;

            return queryParts.every(part => {
                if (!isNaN(part) && part.length === 4) return true; // Dejar pasar años para validación IA
                return itemText.includes(part);
            });
        }).slice(0, 8); // BAJAMOS A 8 CANDIDATOS para mejorar velocidad

        if (candidates.length === 0) {
            return response.status(200).json({ 
                reply: "No encontrado en la base de datos con esos términos." 
            });
        }

        // Contexto con DATOS COMPLETOS (Agregué explícitamente Trans Type para FWD/RWD)
        const simplifiedContext = candidates.map(c => 
            `Auto: ${c.Make} ${c.Model} (${c.Years}) | CódigoTrans: ${c['Trans Model']} | Info: ${c['Trans Type']} - ${c['Engine Type / Size']}`
        ).join('\n');

        // INTENTO IA
        try {
            const API_KEY = process.env.GEMINI_API_KEY;
            const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro-latest:generateContent?key=${API_KEY}`;
            
            // PROMPT "ROBÓTICO" (Sin saludos, formato forzado)
            const prompt = `
                DATOS:
                ${simplifiedContext}
                
                BUSCAN: "${userQuery}"

                TU TAREA:
                Genera una lista HTML pura.

                REGLAS OBLIGATORIAS:
                1. NO digas "Hola", ni "Aquí están los resultados". EMPIEZA DIRECTO CON LA LISTA.
                2. Pon el CÓDIGO DE TRANSMISIÓN en negritas <b></b>. NO el nombre del auto.
                3. INCLUYE SIEMPRE si es FWD, RWD o 4WD.
                4. Si el auto es "Golf" y el dato es "Golf Sportsvan", IGNÓRALO (son autos distintos).
                
                FORMATO EXACTO A USAR:
                - <b>[CÓDIGO]</b> ([Motor] - [Tracción] - [Año])

                Ejemplo de salida correcta:
                - <b>09G</b> (2.5L - 6 SP FWD - 2015)
            `;

            const aiResponse = await fetch(GEMINI_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: {
                        temperature: 0.1, // Creatividad mínima = Más velocidad
                        maxOutputTokens: 150 // Respuesta corta obligada
                    }
                })
            });

            const aiData = await aiResponse.json();
            const aiText = aiData?.candidates?.[0]?.content?.parts?.[0]?.text;

            if (aiText) {
                return response.status(200).json({ reply: aiText });
            } else {
                throw new Error("Respuesta vacía");
            }

        } catch (aiError) {
            // FALLBACK MANUAL MEJORADO (Por si la IA falla, que se vea bien)
            console.error("Modo Manual activado:", aiError);
            let htmlList = candidates.map(item => {
                let code = item['Trans Model'] || "N/A";
                let info = `${item['Engine Type / Size']} - ${item['Trans Type']}`;
                return `- <b>${code}</b> (${info})`;
            }).join('\n');
            return response.status(200).json({ reply: htmlList });
        }

    } catch (error) {
        return response.status(500).json({ reply: `Error: ${error.message}` });
    }
}
