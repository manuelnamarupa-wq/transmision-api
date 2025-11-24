// --- CÓDIGO FINAL: URL SEGURA + CACHÉ EN MEMORIA ---

const DATA_URL = 'https://raw.githubusercontent.com/manuelnamarupa-wq/transmision-api/main/api/transmissions.json';

// --- EL SECRETO DE LA VELOCIDAD ---
// Al declarar esta variable AFUERA de la función 'handler',
// Vercel la mantiene viva en la memoria RAM entre búsquedas.
// Así no tenemos que descargar el archivo cada vez.
let cachedData = null;

async function getData() {
    // Si ya tenemos datos en memoria, ¡los usamos al instante!
    if (cachedData) {
        return cachedData;
    }
    
    // Si no, los descargamos por única vez
    console.log("Descargando base de datos de GitHub...");
    const response = await fetch(DATA_URL);
    if (!response.ok) throw new Error('Error descargando JSON');
    cachedData = await response.json();
    return cachedData;
}

export default async function handler(request, response) {
    // Configuración CORS
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (request.method === 'OPTIONS') return response.status(200).end();

    try {
        // 1. OBTENER DATOS (RÁPIDO)
        const transmissionData = await getData();

        if (!transmissionData || transmissionData.length === 0) {
            return response.status(500).json({ reply: "Error: Base de datos vacía." });
        }

        const userQuery = request.body.query;
        if (!userQuery) return response.status(400).json({ reply: "Ingresa un vehículo." });

        // 2. FILTRO (OPTIMIZADO)
        const lowerCaseQuery = userQuery.toLowerCase().trim();
        const queryParts = lowerCaseQuery.split(' ').filter(part => part.length > 1);

        // Filtramos a 10 candidatos para que la IA lea menos
        const candidates = transmissionData.filter(item => {
            const itemText = `${item.Make} ${item.Model} ${item.Years} ${item['Trans Type']} ${item['Engine Type / Size']}`.toLowerCase();
            return queryParts.some(part => itemText.includes(part));
        }).slice(0, 10); 

        if (candidates.length === 0) {
            return response.status(200).json({ 
                reply: "No encontrado en mi base de datos, ¿Hay otra manera de nombrar a este vehículo?" 
            });
        }

        // 3. PREPARAR TEXTO COMPACTO PARA LA IA (MENOS DATOS = MÁS VELOCIDAD)
        const simplifiedContext = candidates.map(c => 
            `${c.Make} ${c.Model} (${c.Years}) | Motor:${c['Engine Type / Size']} | Trans:${c['Trans Model']} (${c['Trans Type']})`
        ).join('\n');

        // 4. CONEXIÓN IA
        const API_KEY = process.env.GEMINI_API_KEY;
        // Usamos el modelo ESTABLE
        const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro-latest:generateContent?key=${API_KEY}`;

        const prompt = `
            Experto en transmisiones.
            DATOS:
            ${simplifiedContext}
            BUSCAN: "${userQuery}"

            REGLAS:
            1. FWD=Delantera, RWD=Trasera, SP=Velocidades.
            2. Ignora "Standard/Manual". Solo automáticos.
            3. Filtra estrictamente por Año.

            FORMATO:
            - <b>MODELO</b> (Detalles)

            Ejemplo:
            "Para Honda Accord 2000:
            - <b>BAXA</b> (4 Velocidades, 2.3L)"
        `;

        const geminiResponse = await fetch(GEMINI_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                contents: [{ parts: [{ text: prompt }] }],
                // Configuración para respuesta rápida (menos creativa)
                generationConfig: {
                    temperature: 0.1, // Muy robótico y rápido
                    maxOutputTokens: 150 // Respuesta corta obligatoria
                }
            }),
        });

        if (!geminiResponse.ok) throw new Error('Error al conectar con el Experto Virtual.');
        
        const data = await geminiResponse.json();
        const textResponse = data.candidates[0].content.parts[0].text;
        
        return response.status(200).json({ reply: textResponse });

    } catch (error) {
        console.error("Error General:", error);
        // Si hay error, limpiamos la caché por si acaso estaba corrupta
        cachedData = null;
        return response.status(500).json({ reply: `Error del sistema: ${error.message}` });
    }
}
