const DATA_URL = 'https://raw.githubusercontent.com/manuelnamarupa-wq/transmision-api/main/api/transmissions.json';

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

        // FILTRO
        const lowerCaseQuery = userQuery.toLowerCase().trim();
        const queryParts = lowerCaseQuery.split(' ').filter(part => part.length > 1);

        const candidates = transmissionData.filter(item => {
            const itemText = `${item.Make} ${item.Model} ${item.Years} ${item['Trans Type']} ${item['Engine Type / Size']}`.toLowerCase();
            return queryParts.some(part => itemText.includes(part));
        }).slice(0, 10);

        if (candidates.length === 0) {
            return response.status(200).json({ 
                reply: "No encontrado en mi base de datos, ¿Hay otra manera de nombrar a este vehículo?" 
            });
        }

        // --- AQUÍ EMPIEZA LA MAGIA DEL RESPALDO ---
        let finalReply = "";

        try {
            // INTENTO 1: Usar Inteligencia Artificial
            const API_KEY = process.env.GEMINI_API_KEY;
            
            // Usamos 'gemini-pro' (sin latest, suele ser más estable)
            const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${API_KEY}`;
            
            const simplifiedContext = candidates.map(c => 
                `${c.Make} ${c.Model} (${c.Years}) | Trans:${c['Trans Model']} | Motor:${c['Engine Type / Size']}`
            ).join('\n');

            const prompt = `
                Experto en transmisiones. DATOS: ${simplifiedContext}. BUSCAN: "${userQuery}".
                REGLAS: Ignora "Standard". Solo automáticos. Filtra por año.
                FORMATO: - <b>MODELO</b> (Detalles)
            `;

            const aiResponse = await fetch(GEMINI_API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
            });

            const aiData = await aiResponse.json();

            // VALIDACIÓN CON "?" (Para que no truene si viene vacío)
            const aiText = aiData?.candidates?.[0]?.content?.parts?.[0]?.text;

            if (aiText) {
                finalReply = aiText; // ¡Éxito! Usamos la IA
            } else {
                throw new Error("IA devolvió respuesta vacía"); // Forzamos el modo manual
            }

        } catch (aiError) {
            console.error("Fallo IA, activando Modo Manual:", aiError.message);
            
            // INTENTO 2: MODO MANUAL (JavaScript construye la respuesta)
            // Esto se ejecuta si la IA falla, asegurando que el cliente SIEMPRE reciba datos.
            
            let htmlList = candidates.map(item => {
                // Lógica simple para simular al experto
                let transCode = item['Trans Model'] || "N/A";
                let details = `${item['Engine Type / Size']}, ${item['Trans Type']}`;
                return `- <b>${transCode}</b> (${details})`;
            }).join('\n');

            finalReply = `Resultados para ${candidates[0].Model} (Modo Rápido):\n${htmlList}`;
        }

        return response.status(200).json({ reply: finalReply });

    } catch (error) {
        console.error("Error Fatal:", error);
        return response.status(500).json({ reply: `Error del sistema: ${error.message}` });
    }
}
