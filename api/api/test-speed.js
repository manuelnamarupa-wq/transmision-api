// NOMBRE DEL ARCHIVO: api/test-speed.js

export default async function handler(request, response) {
    const API_KEY = process.env.GEMINI_API_KEY;

    // INTENTO 1: Usar el modelo ULTRA RÁPIDO (Flash)
    // Nota la URL: v1beta y el nombre exacto 'gemini-1.5-flash'
    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${API_KEY}`;

    const prompt = "Solo responde con la palabra: FUNCIONA.";

    try {
        console.log("Iniciando prueba de velocidad con Flash...");
        const startTime = Date.now();

        const geminiResponse = await fetch(GEMINI_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        });

        const endTime = Date.now();
        const duration = (endTime - startTime) / 1000; // Segundos

        if (!geminiResponse.ok) {
            const errText = await geminiResponse.text();
            return response.status(500).json({ 
                test: "FALLIDO", 
                model: "gemini-1.5-flash", 
                error: errText 
            });
        }

        const data = await geminiResponse.json();
        
        return response.status(200).json({ 
            test: "EXITOSO", 
            model: "gemini-1.5-flash",
            tiempo_segundos: duration, // ¡Aquí veremos la velocidad real!
            respuesta_ia: data.candidates[0].content.parts[0].text
        });

    } catch (error) {
        return response.status(500).json({ error: error.message });
    }
}
