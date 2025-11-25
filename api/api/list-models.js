// NOMBRE DEL ARCHIVO: api/list-models.js

export default async function handler(request, response) {
    const API_KEY = process.env.GEMINI_API_KEY;
    
    // Endpoint oficial para listar modelos
    const URL = `https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`;

    try {
        const res = await fetch(URL);
        const data = await res.json();

        if (!res.ok) {
            return response.status(500).json(data);
        }

        // Filtramos solo los que sirven para generar texto (generateContent)
        const chatModels = data.models
            .filter(m => m.supportedGenerationMethods.includes("generateContent"))
            .map(m => m.name); // Solo queremos los nombres

        return response.status(200).json({ 
            mensaje: "Modelos disponibles para tu API Key",
            modelos: chatModels 
        });

    } catch (error) {
        return response.status(500).json({ error: error.message });
    }
}
