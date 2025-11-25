const DATA_URL = 'https://raw.githubusercontent.com/manuelnamarupa-wq/transmision-api/main/api/transmissions.json';

let transmissionData = [];
let dataLoaded = false;

async function loadData() {
    if (!dataLoaded) {
        try {
            const response = await fetch(DATA_URL);
            if (!response.ok) throw new Error('La base de datos JSON no se pudo descargar.');
            transmissionData = await response.json();
            dataLoaded = true;
            console.log(`Base de datos cargada: ${transmissionData.length} registros.`);
        } catch (error) {
            console.error('Error crítico al cargar transmissions.json:', error);
        }
    }
}

export default async function handler(request, response) {
    // 1. Configuración CORS
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (request.method === 'OPTIONS') {
        return response.status(200).end();
    }
    
    // 2. Carga de Datos
    await loadData();
    if (!dataLoaded || transmissionData.length === 0) {
        return response.status(500).json({ reply: "Error: La plantilla de datos no está disponible en este momento." });
    }

    const userQuery = request.body.query;
    if (!userQuery) {
        return response.status(400).json({ reply: "Por favor, ingresa un vehículo para buscar." });
    }
    
    // 3. Lógica de 2 Dígitos y Filtro Rápido
    const expandedQuery = userQuery.replace(/\b(\d{2})\b/g, (match) => {
        const n = parseInt(match, 10);
        if (n >= 80 && n <= 99) return `19${match}`;
        if (n >= 0 && n <= 30) return `20${match}`;
        return match;
    });

    const lowerCaseQuery = expandedQuery.toLowerCase().trim();
    const queryParts = lowerCaseQuery.split(' ').filter(part => part.length > 1);

    // --- CORRECCIÓN CRÍTICA DE SEGURIDAD (EVERY en lugar de SOME) ---
    // Solo aceptamos candidatos que contengan TODAS las palabras buscadas.
    // Esto permite que "Cherokee" encuentre "Grand Cherokee", pero evita que "Cherokee 2000" traiga "Ford 2000".
    const candidates = transmissionData.filter(item => {
        const itemText = `${item.Make} ${item.Model} ${item.Years} ${item['Trans Type']} ${item['Engine Type / Size']}`.toLowerCase();
        return queryParts.every(part => itemText.includes(part));
    }).slice(0, 30); 

    if (candidates.length === 0) {
        return response.status(200).json({ reply: `No se encontraron coincidencias exactas para "${userQuery}". Intenta verificar el nombre o el año.` });
    }

    // 4. ANÁLISIS INTELIGENTE CON IA
    const API_KEY = process.env.GEMINI_API_KEY;
    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro-latest:generateContent?key=${API_KEY}`;

    const contextForAI = JSON.stringify(candidates);

    // --- PROMPT DE SEGURIDAD MÁXIMA ---
    const prompt = `
        ROL: Motor de búsqueda estricto de autopartes.
        DATOS DISPONIBLES (JSON):
        ---
        ${contextForAI}
        ---
        INPUT USUARIO: "${expandedQuery}"

        REGLAS ANTI-ALUCINACIÓN (CRÍTICAS):
        1. SOLO usa los vehículos listados en DATOS DISPONIBLES. Si no está ahí, no existe.
        2. NO mezcles información. Si hay dos modelos distintos (Ej: Cherokee y Grand Cherokee), sepáralos claramente.
        3. Si el usuario busca un nombre genérico (Ej: "Cherokee"), muestra TODOS los modelos que contengan ese nombre (Ej: Cherokee Sport y Grand Cherokee).

        INSTRUCCIONES DE RESPUESTA:
        1. SILENCIO DE ROL: Empieza directo con "Resultados para [Búsqueda]:".
        2. FORMATO: Lista con viñetas.
        3. NOMBRE EXACTO: Usa el nombre completo del modelo tal cual viene en la base de datos para evitar confusiones.

        REGLAS TÉCNICAS:
        1. NO uses la palabra "Estándar".
        2. SI MODELO ES "AVO" o "TBD": Escribe "Modelo por confirmar" sin negritas.
        3. TRACCIÓN: Indica SIEMPRE (FWD), (RWD) o (AWD/4WD).
        4. TECNOLOGÍA: Clasifica (CVT), (DSG / Doble Embrague) o (Automática Convencional).

        Ejemplo de Salida Segura:
        "Resultados para Jeep Cherokee 2000:
        - Jeep Cherokee Classic: <b>AW4</b> (Automática Convencional, 4 Vel, RWD) - Motor 4.0L
        - Jeep Grand Cherokee Laredo: <b>42RE</b> (Automática Convencional, 4 Vel, AWD) - Motor 4.0L"
    `;

    try {
        const geminiResponse = await fetch(GEMINI_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        });

        if (geminiResponse.status === 429) {
            console.warn("Cuota de API excedida (429).");
            return response.status(200).json({ 
                reply: "⚠️ <b>Alta demanda.</b><br>Estamos procesando muchas solicitudes. Por favor intenta en unos segundos." 
            });
        }

        if (!geminiResponse.ok) {
            const errText = await geminiResponse.text();
            throw new Error(`Error IA (${geminiResponse.status}): ${errText}`);
        }

        const data = await geminiResponse.json();

        if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
             return response.status(200).json({ reply: "No se pudo generar una respuesta clara." });
        }

        const textResponse = data.candidates[0].content.parts[0].text;
        
        return response.status(200).json({ reply: textResponse });

    } catch (error) {
        console.error("Error en la fase de IA:", error);
        return response.status(200).json({ 
            reply: "Ocurrió un problema técnico temporal. Por favor intenta buscar de nuevo." 
        });
    }
}
