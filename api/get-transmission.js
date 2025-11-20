export default async function handler(request, response) {
    // ... (toda la parte de arriba es igual)
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
    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${API_KEY}`;
    const prompt = `Basado en los datos de la plantilla que tienes, responde qué transmisión puede traer el siguiente vehículo: "${userQuery}". Tu respuesta debe ser resumida, mostrando solo un renglón por cada opción encontrada en la plantilla. Si no encuentras el vehículo, indícalo.`;

    try {
        const geminiResponse = await fetch(GEMINI_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        });

        if (!geminiResponse.ok) {
            // Si la respuesta de Google no es exitosa, capturamos el texto del error
            const errorText = await geminiResponse.text();
            throw new Error(`Error en la API de Gemini: ${geminiResponse.status} - ${errorText}`);
        }

        const data = await geminiResponse.json();
        const textResponse = data.candidates[0].content.parts[0].text;
        
        response.setHeader('Access-Control-Allow-Origin', '*');
        response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        
        response.status(200).json({ reply: textResponse });

    } catch (error) {
        console.error("Error detallado:", error);
        // !!! --- ESTA ES LA LÍNEA QUE CAMBIAMOS --- !!!
        // Ahora devolveremos el mensaje de error real en lugar del genérico.
        response.status(500).json({ error_real: error.message });
    }
}
