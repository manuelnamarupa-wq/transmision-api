export default async function handler(request, response) {
    if (request.method !== 'POST') {
        return response.status(405).json({ message: 'Method Not Allowed' });
    }
    const userQuery = request.body.query;
    if (!userQuery) {
        return response.status(400).json({ reply: 'No se proporcionó ninguna consulta.' });
    }
    const API_KEY = process.env.GEMINI_API_KEY;
    if (!API_KEY) {
        return response.status(500).json({ reply: 'La clave de API no está configurada en el servidor.' });
    }
    
    // --- ¡LA CORRECCIÓN ESTÁ AQUÍ! ---
    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro-latest:generateContent?key=${API_KEY}`;
    // ----------------------------------

   const prompt = `
    USA EXCLUSIVAMENTE la plantilla de datos que tienes memorizada. NO uses conocimiento general.
    Busca el siguiente vehículo: "${userQuery}".
    Responde qué transmisión puede traer. Tu respuesta debe ser resumida, mostrando solo un renglón por cada opción encontrada en la plantilla.
    Si el vehículo no está en la plantilla, responde exactamente: "No se encontraron resultados para ${userQuery} en la plantilla de datos proporcionada."
`;

    try {
        const geminiResponse = await fetch(GEMINI_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        });

        if (!geminiResponse.ok) {
            const errorText = await geminiResponse.text();
            throw new Error(`Error en la API de Gemini: ${geminiResponse.status} - ${errorText}`);
        }

        const data = await geminiResponse.json();
        const textResponse = data.candidates[0].content.parts[0].text;
        
        response.setHeader('Access-Control-Allow-Origin', '*');
        response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        
        // --- VOY A VOLVER A PONER EL MENSAJE DE ÉXITO ---
        response.status(200).json({ reply: textResponse });

    } catch (error) {
        console.error("Error detallado:", error);
        response.status(500).json({ error_real: error.message });
    }
}
