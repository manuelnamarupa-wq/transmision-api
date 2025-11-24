// --- CÓDIGO TURBO (LECTURA LOCAL) ---
import { readFileSync } from 'fs';
import { join } from 'path';

// NOTA: Esto asume que 'transmissions.json' está en la misma carpeta 'api'
// Si Vercel se queja de que no encuentra el archivo, avísame.

let transmissionData = [];

function loadDataLocal() {
    if (transmissionData.length === 0) {
        try {
            // Buscamos el archivo en el directorio actual del proceso
            const file = join(process.cwd(), 'api', 'transmissions.json');
            const data = readFileSync(file, 'utf8');
            transmissionData = JSON.parse(data);
            console.log(`Carga Local Exitosa: ${transmissionData.length} registros.`);
        } catch (error) {
            console.error('Error leyendo archivo local:', error);
            // Fallback: Si falla local, intentamos la URL de GitHub como respaldo
            console.log('Intentando respaldo remoto...');
            return false; 
        }
    }
    return true;
}

export default async function handler(request, response) {
    // Configuración CORS
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (request.method === 'OPTIONS') return response.status(200).end();

    // 1. INTENTO DE CARGA LOCAL (INSTANTÁNEO)
    let loaded = loadDataLocal();

    // 2. RESPALDO: Si no funcionó local (por ruta), usamos FETCH
    if (!loaded || transmissionData.length === 0) {
         try {
            const DATA_URL = 'https://raw.githubusercontent.com/manuelnamarupa-wq/transmision-api/main/api/transmissions.json';
            const resp = await fetch(DATA_URL);
            if (resp.ok) {
                transmissionData = await resp.json();
                loaded = true;
            }
         } catch (e) {
             console.error("Error total de base de datos");
         }
    }
    
    if (!loaded || transmissionData.length === 0) {
        return response.status(500).json({ reply: "Error: El sistema se está reiniciando. Intenta en 5 segundos." });
    }

    const userQuery = request.body.query;
    if (!userQuery) return response.status(400).json({ reply: "Ingresa un vehículo." });
    
    const lowerCaseQuery = userQuery.toLowerCase().trim();
    const queryParts = lowerCaseQuery.split(' ').filter(part => part.length > 1);

    // FILTRO
    const candidates = transmissionData.filter(item => {
        const itemText = `${item.Make} ${item.Model} ${item.Years} ${item['Trans Type']} ${item['Engine Type / Size']}`.toLowerCase();
        return queryParts.some(part => itemText.includes(part));
    }).slice(0, 15);

    if (candidates.length === 0) {
        return response.status(200).json({ 
            reply: "No encontrado en mi base de datos, ¿Hay otra manera de nombrar a este vehículo?" 
        });
    }

    // IA
    const API_KEY = process.env.GEMINI_API_KEY;
    const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro-latest:generateContent?key=${API_KEY}`;
    const contextForAI = JSON.stringify(candidates);

    const prompt = `
        Experto en transmisiones.
        DATOS: ${contextForAI}
        BUSCAN: "${userQuery}"

        REGLAS:
        1. "SP" = Velocidades.
        2. "FWD" = Tracción Delantera. "RWD" = Trasera.
        3. Solo automáticos (Ignora "Standard/Std").
        4. Si te doy candidatos de otro modelo (ej: buscan Accord y te doy Civic), DESCÁRTALOS.

        FORMATO:
        - Sin saludos.
        - Modelo en <b></b>.

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

        if (!geminiResponse.ok) throw new Error('Conexión IA');
        const data = await geminiResponse.json();
        const textResponse = data.candidates[0].content.parts[0].text;
        
        return response.status(200).json({ reply: textResponse });

    } catch (error) {
        console.error("Error IA:", error);
        return response.status(500).json({ reply: "Error momentáneo del experto virtual." });
    }
}
