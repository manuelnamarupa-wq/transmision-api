// --- CÓDIGO VERCEL: INTELIGENTE, FLEXIBLE Y NORMALIZADO ---
const DATA_URL = 'https://raw.githubusercontent.com/manuelnamarupa-wq/transmision-api/main/api/transmissions.json';

let transmissionData = [];
let dataLoaded = false;

// 1. FUNCIÓN DE DISTANCIA (Para detectar typos: "Focuz" -> "Focus")
// Calcula cuántas letras hay que cambiar para que dos palabras sean iguales.
function levenshteinDistance(a, b) {
    const matrix = [];
    for (let i = 0; i <= b.length; i++) { matrix[i] = [i]; }
    for (let j = 0; j <= a.length; j++) { matrix[0][j] = j; }
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) == a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1));
            }
        }
    }
    return matrix[b.length][a.length];
}

// 2. FUNCIÓN DE NORMALIZACIÓN (Para F-150 vs F150)
// Quita guiones, espacios y símbolos, dejando solo letras y números.
function normalize(str) {
    return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function loadData() {
    if (!dataLoaded) {
        try {
            const response = await fetch(DATA_URL);
            if (!response.ok) throw new Error('Error DB');
            transmissionData = await response.json();
            dataLoaded = true;
            console.log(`Datos cargados: ${transmissionData.length}`);
        } catch (error) {
            console.error('Error carga:', error);
        }
    }
}

export default async function handler(request, response) {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (request.method === 'OPTIONS') return response.status(200).end();
    
    await loadData();
    if (!dataLoaded || transmissionData.length === 0) {
        return response.status(500).json({ reply: "Error: Base de datos no disponible." });
    }

    const userQuery = request.body.query;
    if (!userQuery) return response.status(400).json({ reply: "Por favor, ingresa un vehículo." });
    
    // --- LÓGICA DE BÚSQUEDA AVANZADA ---
    
    const queryParts = userQuery.toLowerCase().split(' ').filter(p => p.length > 1);
    
    // PASO A: Búsqueda Estricta/Parcial (La que ya tenías)
    let candidates = transmissionData.filter(item => {
        const itemText = `${item.Make} ${item.Model} ${item.Years}`.toLowerCase();
        return queryParts.some(part => itemText.includes(part));
    });

    // PASO B: Si falla A, intentamos Búsqueda Normalizada (F-150 vs F150)
    if (candidates.length === 0) {
        const normalizedQuery = normalize(userQuery); // "f150"
        candidates = transmissionData.filter(item => {
            const normalizedModel = normalize(item.Model); // "f150"
            return normalizedModel.includes(normalizedQuery) || normalizedQuery.includes(normalizedModel);
        });
    }

    // PASO C: Si falla B, intentamos Fuzzy Search (Focuz vs Focus)
    // Solo buscamos typos en el NOMBRE DEL MODELO para no ser muy lentos.
    if (candidates.length === 0) {
        candidates = transmissionData.filter(item => {
            // Buscamos si alguna parte de la query se parece al Modelo
            return queryParts.some(part => {
                const modelWord = item.Model.toLowerCase();
                // Permitimos hasta 2 errores de letra para palabras de más de 4 letras
                return part.length > 3 && levenshteinDistance(part, modelWord) <= 2;
            });
        });
    }

    // Limitamos para velocidad
    candidates = candidates.slice(0, 15);

    // --- RESPUESTA SI NO HAY RESULTADOS ---
    if (candidates.length === 0) {
        return response.status(200).json({ 
            reply: `No encontré el vehículo "<b>${userQuery}</b>" en mi base de datos.\n\nEsta búsqueda está restringida a nuestro catálogo interno. ¿Es posible que este vehículo se conozca con otro nombre o sea una versión diferente?` 
        });
    }

    // --- CONEXIÓN CON IA ---
    const API_KEY = process.env.GEMINI_API_KEY;
    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro-latest:generateContent?key=${API_KEY}`;
    const contextForAI = JSON.stringify(candidates);

    const prompt = `
        Experto en transmisiones.
        DATOS ENCONTRADOS: ${contextForAI}
        BÚSQUEDA USUARIO: "${userQuery}"

        INSTRUCCIONES INTELIGENTES:
        1. "SP" = Velocidades. "FWD" = Tracción Delantera. "RWD" = Trasera.
        2. NORMALIZACIÓN: Si el usuario escribió "Focuz" y encontraste "Focus", o "F150" y encontraste "F-150", asume que es lo mismo.
        3. CORRECCIÓN: Si hay una diferencia de escritura evidente (ej: Focuz vs Focus), empieza diciendo: "Quizás quisiste decir <b>[Nombre Correcto]</b>:".
        4. RESTRICCIÓN: Solo automáticos. Si el nombre dice "Standard/Std", ignora esa palabra.
        
        FORMATO:
        - Usa <b></b> para el modelo de transmisión.
        - Sé directo.

        Ejemplo respuesta typo:
        "Quizás quisiste decir <b>Ford Focus</b>:
        - <b>4F27E</b> (4 Velocidades)"
    `;

    try {
        const geminiResponse = await fetch(GEMINI_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        });

        if (!geminiResponse.ok) throw new Error('Error IA');
        const data = await geminiResponse.json();
        const textResponse = data.candidates[0].content.parts[0].text;
        
        return response.status(200).json({ reply: textResponse });

    } catch (error) {
        console.error("Error:", error);
        return response.status(500).json({ reply: `Error del sistema: ${error.message}` });
    }
}
