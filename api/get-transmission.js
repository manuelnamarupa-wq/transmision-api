const DATA_URL = 'https://raw.githubusercontent.com/manuelnamarupa-wq/transmision-api/main/api/transmissions.json';

// Cache en memoria del servidor (para que no descargue GitHub cada vez)
let transmissionData = [];
let dataLoaded = false;
let lastLoadTime = 0;

async function loadData() {
    const now = Date.now();
    // Recargamos solo si no hay datos o si pasaron más de 1 hora (3600000 ms)
    if (!dataLoaded || (now - lastLoadTime > 3600000)) {
        try {
            console.time("DescargaGitHub");
            const response = await fetch(DATA_URL);
            if (!response.ok) throw new Error('Error al conectar con GitHub Raw.');
            transmissionData = await response.json();
            dataLoaded = true;
            lastLoadTime = now;
            console.timeEnd("DescargaGitHub");
            console.log(`Base de datos actualizada: ${transmissionData.length} registros.`);
        } catch (error) {
            console.error('Error crítico cargando JSON:', error);
            // Si falla y ya teníamos datos, no rompemos el flujo, usamos los viejos
            if (!dataLoaded) throw error; 
        }
    }
}

export default async function handler(request, response) {
    const tStart = Date.now(); // Cronómetro inicio

    // 1. CORS
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (request.method === 'OPTIONS') return response.status(200).end();
    
    // 2. Carga de Datos (Con caché inteligente)
    try {
        await loadData();
    } catch (e) {
        return response.status(500).json({ reply: "Error de servidor: No se pudo conectar con la base de datos." });
    }

    const userQuery = request.body.query;
    if (!userQuery) return response.status(400).json({ reply: "Ingresa un vehículo." });
    
    // 3. Lógica de 2 Dígitos
    const expandedQuery = userQuery.replace(/\b(\d{2})\b/g, (match) => {
        const n = parseInt(match, 10);
        if (n >= 80 && n <= 99) return `19${match}`;
        if (n >= 0 && n <= 30) return `20${match}`;
        return match;
    });

    const lowerCaseQuery = expandedQuery.toLowerCase().trim();
    const queryParts = lowerCaseQuery.split(' ').filter(part => part.length > 1);

    // --- FILTRO HÍBRIDO (Nombre estricto, Año flexible) ---
    const textParts = queryParts.filter(part => isNaN(part)); 
    
    const candidates = transmissionData.filter(item => {
        const itemText = `${item.Make} ${item.Model} ${item.Years} ${item['Trans Type']} ${item['Engine Type / Size']}`.toLowerCase();
        if (textParts.length > 0) {
            if (!textParts.every(word => itemText.includes(word))) return false;
        }
        return true;
    }).slice(0, 15); // Solo 15 candidatos para máxima velocidad

    if (candidates.length === 0) {
        return response.status(200).json({ reply: `No se encontraron coincidencias para "${userQuery}".` });
    }

    // 4. IA FLASH 2.0 EXPERIMENTAL
    const API_KEY = process.env.GEMINI_API_KEY;
    
    // USAMOS EL MODELO MÁS RÁPIDO DE TU LISTA: gemini-2.0-flash-exp
    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${API_KEY}`;

    const contextForAI = JSON.stringify(candidates);

    const prompt = `
        ROL: Buscador de autopartes.
        DATOS:
        ---
        ${contextForAI}
        ---
        INPUT: "${expandedQuery}"

        FORMATO OBLIGATORIO:
        1. Código transmisión entre <b> y </b>. (Ej: <b>6F35</b>).
        2. Si es "AVO"/"TBD", escribe "Modelo por confirmar" (sin negritas).

        LÓGICA:
        1. Solo usa los datos provistos.
        2. Valida años matemáticamente (rangos).
        3. Si buscas "Cherokee", incluye "Grand Cherokee" si coincide el año.

        DETALLES:
        1. No digas "Estándar".
        2. Indica (FWD/RWD/AWD).
        3. Indica (CVT / DSG / Convencional).

        Ejemplo:
        "Resultados para Jeep Cherokee 2000:
        - Jeep Cherokee Classic: <b>AW4</b> (Convencional, 4 Vel, RWD) - Motor 4.0L"
    `;

    try {
        const geminiResponse = await fetch(GEMINI_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        });

        const tEnd = Date.now(); // Fin cronómetro
        const seconds = ((tEnd - tStart) / 1000).toFixed(2);
        console.log(`Tiempo total respuesta: ${seconds}s`);

        if (geminiResponse.status === 429) {
            return response.status(200).json({ 
                reply: "⚠️ <b>Alta demanda.</b> Intenta en unos segundos." 
            });
        }

        if (!geminiResponse.ok) {
            const errText = await geminiResponse.text();
            throw new Error(`Error IA (${geminiResponse.status}): ${errText}`);
        }

        const data = await geminiResponse.json();
        const textResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || "Sin respuesta clara.";
        
        return response.status(200).json({ reply: textResponse });

    } catch (error) {
        console.error("Error backend:", error);
        return response.status(200).json({ 
            reply: "Ocurrió un problema técnico. Intenta de nuevo." 
        });
    }
}
