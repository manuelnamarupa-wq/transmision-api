// --- CÓDIGO ULTRA RÁPIDO (CARGA EN RAM) ---

// 1. IMPORTACIÓN ESTÁTICA
// Esto obliga a Vercel a cargar el JSON en la memoria RAM.
// El acceso es instantáneo, sin lectura de disco.
import transmissionData from './transmissions.json';

export default async function handler(request, response) {
    // Configuración CORS
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (request.method === 'OPTIONS') return response.status(200).end();

    const userQuery = request.body.query;
    if (!userQuery) return response.status(400).json({ reply: "Ingresa un vehículo." });

    // 2. FILTRO RÁPIDO EN MEMORIA
    const lowerCaseQuery = userQuery.toLowerCase().trim();
    const queryParts = lowerCaseQuery.split(' ').filter(part => part.length > 1);

    // Limitamos a 10 candidatos para que la IA lea menos y responda rápido
    const candidates = transmissionData.filter(item => {
        const itemText = `${item.Make} ${item.Model} ${item.Years} ${item['Trans Type']} ${item['Engine Type / Size']}`.toLowerCase();
        return queryParts.some(part => itemText.includes(part));
    }).slice(0, 10); 

    if (candidates.length === 0) {
        return response.status(200).json({ 
            reply: "No encontrado en mi base de datos, ¿Hay otra manera de nombrar a este vehículo?" 
        });
    }

    // 3. OPTIMIZACIÓN DE DATOS PARA LA IA
    // En lugar de enviar todo el JSON sucio, enviamos solo un resumen de texto.
    // Menos texto = IA más rápida y menos tokens.
    const simplifiedContext = candidates.map(c => 
        `Auto: ${c.Make} ${c.Model} (${c.Years}) | Motor: ${c['Engine Type / Size']} | Transmisión: ${c['Trans Model']} (${c['Trans Type']})`
    ).join('\n');

    // 4. CONFIGURACIÓN IA
    const API_KEY = process.env.GEMINI_API_KEY;
    // Usamos 'gemini-pro' (sin latest) que suele ser más estable en latencia
    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${API_KEY}`;

    const prompt = `
        Experto en transmisiones.
        DATOS:
        ${simplifiedContext}
        
        USUARIO BUSCA: "${userQuery}"

        REGLAS:
        1. Responde rápido y directo.
        2. SP = Velocidades.
        3. FWD=Delantera, RWD=Trasera.
        4. Solo automáticos (Ignora "Standard").
        5. Filtra estrictamente por Año y Modelo.

        FORMATO:
        - <b>MODELO_TRANS</b> (Detalles)

        Ejemplo:
        "Para Honda Accord 2000:
        - <b>BAXA</b> (4 Velocidades, 2.3L)"
    `;

    try {
        const geminiResponse = await fetch(GEMINI_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                contents: [{ parts: [{ text: prompt }] }],
                // Configuración para respuesta más rápida (menos creativa)
                generationConfig: {
                    temperature: 0.2,
                    maxOutputTokens: 150
                }
            }),
        });

        if (!geminiResponse.ok) throw new Error('Error IA');
        const data = await geminiResponse.json();
        const textResponse = data.candidates[0].content.parts[0].text;
        
        return response.status(200).json({ reply: textResponse });

    } catch (error) {
        console.error("Error:", error);
        return response.status(500).json({ reply: "Error del sistema. Intenta de nuevo." });
    }
}
