// --- CÓDIGO ESTABLE (REVERTIDO A LO SEGURO) ---
const DATA_URL = 'https://raw.githubusercontent.com/manuelnamarupa-wq/transmision-api/main/api/transmissions.json';

let transmissionData = [];
let dataLoaded = false;

async function loadData() {
    if (!dataLoaded) {
        try {
            const response = await fetch(DATA_URL);
            if (!response.ok) throw new Error('Error descargando BD.');
            transmissionData = await response.json();
            dataLoaded = true;
            console.log(`Datos cargados: ${transmissionData.length}`);
        } catch (error) {
            console.error('Error BD:', error);
        }
    }
}

export default async function handler(request, response) {
    // Configuración CORS estándar
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (request.method === 'OPTIONS') return response.status(200).end();
    
    await loadData();
    
    // Verificación de seguridad de datos
    if (!dataLoaded || transmissionData.length === 0) {
        // Intento de recarga de emergencia
        await loadData();
        if (!dataLoaded) return response.status(500).json({ reply: "Error temporal: La base de datos se está reiniciando." });
    }

    const userQuery = request.body.query;
    if (!userQuery) return response.status(400).json({ reply: "Por favor, ingresa un vehículo." });
    
    const lowerCaseQuery = userQuery.toLowerCase().trim();
    const queryParts = lowerCaseQuery.split(' ').filter(part => part.length > 1);

    // --- FILTRO ESTRICTO (El que funcionaba bien) ---
    // Solo busca coincidencias literales. Sin matemáticas raras.
    const candidates = transmissionData.filter(item => {
        const itemText = `${item.Make} ${item.Model} ${item.Years} ${item['Trans Type']} ${item['Engine Type / Size']}`.toLowerCase();
        // Si el usuario pone "Accord 2000", buscamos que esas palabras existan en el registro.
        return queryParts.some(part => itemText.includes(part));
    }).slice(0, 15); // Límite de 15 para velocidad

    // --- MANEJO DE "NO ENCONTRADO" (Tu nuevo mensaje) ---
    if (candidates.length === 0) {
        return response.status(200).json({ 
            reply: "No encontrado en mi base de datos, ¿Hay otra manera de nombrar a este vehículo?" 
        });
    }

    // --- INTELIGENCIA ARTIFICIAL (Manteniendo lo que sí servía) ---
    const API_KEY = process.env.GEMINI_API_KEY;
    // Usamos el modelo PROBADO
    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro-latest:generateContent?key=${API_KEY}`;

    const contextForAI = JSON.stringify(candidates);

    // PROMPT PULIDO (Sin instrucciones de typos, solo negocio)
    const prompt = `
        Experto en transmisiones.
        DATOS DISPONIBLES: ${contextForAI}
        BÚSQUEDA USUARIO: "${userQuery}"

        REGLAS TÉCNICAS:
        1. "SP" = Velocidades (Ej: 4 SP = 4 Velocidades).
        2. "FWD" = Tracción Delantera. "RWD" = Tracción Trasera.
        3. Años: "98-02" cubre todo el rango intermedio.

        REGLA DE LIMPIEZA:
        - Si el nombre del modelo dice "Standard", "Std" o "Estandar", ELIMINA esa palabra. Solo vendemos automáticos.
        - Ejemplo: "Jetta Standard" -> Escribe solo "Jetta".

        OBJETIVO:
        1. Filtra los candidatos para encontrar SOLO lo que coincida con el Año y Modelo exacto que pide el usuario.
        2. Si los candidatos que te di son solo del mismo año pero OTRO modelo (Ej: Usuario busca "Accord" y yo te di "Civic" solo porque coinciden en año), DESCÁRTALOS.
        3. Si después de filtrar no queda nada válido, responde exactamente: "No encontrado en mi base de datos, ¿Hay otra manera de nombrar a este vehículo?".

        FORMATO DE SALIDA:
        - Sin saludos.
        - Modelo de transmisión entre <b></b>.
        
        Ejemplo:
        "Para Honda Accord 2000:
        - <b>BAXA</b> (4 Velocidades, Motor 2.3L)"
    `;

    try {
        const geminiResponse = await fetch(GEMINI_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        });

        if (!geminiResponse.ok) {
            // Si falla el modelo latest, usamos un fallback simple en el error
            throw new Error('Error de conexión IA');
        }

        const data = await geminiResponse.json();
        const textResponse = data.candidates[0].content.parts[0].text;
        
        return response.status(200).json({ reply: textResponse });

    } catch (error) {
        console.error("Error IA:", error);
        // Mensaje amigable si falla el servidor
        return response.status(500).json({ reply: "Hubo un error momentáneo consultando al experto. Por favor intenta de nuevo." });
    }
}
