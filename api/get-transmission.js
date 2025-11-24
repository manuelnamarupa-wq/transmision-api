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

        const lowerCaseQuery = userQuery.toLowerCase().trim();
        const queryParts = lowerCaseQuery.split(' ').filter(part => part.length > 1);

        // --- FILTRO ESTRICTO (LOGICA "AND") ---
        const candidates = transmissionData.filter(item => {
            const itemText = `${item.Make} ${item.Model} ${item.Years} ${item['Trans Type']} ${item['Engine Type / Size']}`.toLowerCase();
            
            // 1. Eliminar Manuales/Standard inmediatamente
            if (itemText.includes('standard') || itemText.includes('manual')) return false;

            // 2. REGLA DE ORO: TODAS las palabras del usuario deben coincidir (AND)
            return queryParts.every(part => {
                // EXCEPCIÓN INTELIGENTE PARA AÑOS:
                // Si el usuario escribe un año (ej: "2000"), NO lo buscamos como texto exacto
                // porque rompería los rangos (ej: "98-02"). Dejamos pasar el candidato 
                // y dejamos que la IA verifique si el año encaja en el rango.
                if (!isNaN(part) && part.length === 4) {
                    return true; 
                }
                
                // Para todo lo demás (Accord, Honda, Jetta), TIENE QUE ESTAR EN EL TEXTO.
                return itemText.includes(part);
            });
        }).slice(0, 15);

        if (candidates.length === 0) {
            return response.status(200).json({ 
                reply: "No encontrado. Verifique que el modelo esté bien escrito." 
            });
        }

        // --- MODO HÍBRIDO (IA + RESPALDO MANUAL) ---
        let finalReply = "";

        try {
            // INTENTO 1: IA (gemini-pro-latest)
            const API_KEY = process.env.GEMINI_API_KEY;
            const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro-latest:generateContent?key=${API_KEY}`;
            
            const simplifiedContext = candidates.map(c => 
                `${c.Make} ${c.Model} (${c.Years}) | Trans:${c['Trans Model']} | Motor:${c['Engine Type / Size']}`
            ).join('\n');

            const prompt = `
                Actúa como experto en transmisiones. 
                DATOS ENCONTRADOS (Candidatos):
                ${simplifiedContext}
                
                BÚSQUEDA DEL USUARIO: "${userQuery}"

                TU TAREA (FILTRADO FINAL):
                1. El usuario busca un AÑO específico (ej: 2000). Revisa los rangos de años de los datos (ej: 98-02).
                2. Si el año del usuario NO entra en el rango del dato, ELIMÍNALO.
                3. Devuelve SOLO los que coincidan perfectamente en Modelo y Año.
                
                FORMATO: - <b>MODELO</b> (Detalles)
            `;

            const aiResponse = await fetch(GEMINI_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
            });

            const aiData = await aiResponse.json();
            const aiText = aiData?.candidates?.[0]?.content?.parts?.[0]?.text;

            if (aiText) {
                finalReply = aiText;
            } else {
                throw new Error("Respuesta IA vacía");
            }

        } catch (aiError) {
            console.error("Fallo IA, activando Modo Manual:", aiError);
            
            // INTENTO 2: MODO MANUAL
            // Si la IA falla, mostramos los candidatos que pasaron el filtro de texto estricto
            let htmlList = candidates.map(item => {
                let transCode = item['Trans Model'] || "N/A";
                let details = `${item['Engine Type / Size']}, ${item['Trans Type']}`;
                return `- <b>${transCode}</b> <span style="font-size:0.9em; color:#555">(${item.Model} ${item.Years} - ${details})</span>`;
            }).join('\n');

            finalReply = `Resultados (Base de Datos Local):\n${htmlList}`;
        }

        return response.status(200).json({ reply: finalReply });

    } catch (error) {
        console.error("Error Fatal:", error);
        return response.status(500).json({ reply: `Error del sistema: ${error.message}` });
    }
}
