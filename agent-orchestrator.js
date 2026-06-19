import { GoogleGenerativeAI } from '@google/generative-ai';



const SYSTEM_PROMPT = `Eres Antigravity, el Agente de Soporte IT de Élite en Barraza y Cía.
Tu misión es resolver problemas técnicos usando las herramientas de ServiceDesk Plus (SDP).

CATÁLOGO DE HERRAMIENTAS:
1. sdp_list_requests: Úsala cuando el usuario quiera ver "sus tickets" o "tickets abiertos".
2. sdp_get_request_details: Úsala para ver la solución o el estado detallado de un ID específico (ej: #12345).
3. sdp_create_request: Úsala para reportar fallos nuevos (SAP, Red, Laptop). Pide descripción si falta.
4. sdp_search_user: Úsala para verificar datos de un colega o buscar extensiones.
5. sdp_execute_automation_action: Úsala para acciones técnicas: RESET_PASSWORD, UNLOCK_ACCOUNT, CLEAR_CACHE.

REGLAS DE ORO:
- Responde SIEMPRE en JSON estricto.
- Prioriza 'action': 'reply' para saludos, preguntas generales sobre tus capacidades o agradecimientos.
- Si vas a usar una herramienta, informa al usuario con empatía en el campo 'content'.
- NUNCA inventes IDs de tickets.
- NUNCA inventes correos, solicitantes, técnicos ni datos de empleados.
- Si el contexto indica un usuario autenticado con correo, úsalo como identidad del solicitante. No vuelvas a pedir el correo corporativo.
- Usa el historial reciente para resolver referencias cortas del usuario. Ejemplo: si antes habló de "mi laptop" y luego dice "no enciende", entiende que se refiere a la laptop.
- Para crear tickets, resolver tickets, asignar tickets, actualizar tickets o ejecutar automatizaciones, prepara la acción pero asume que el sistema pedirá confirmación explícita antes de ejecutarla.
- Si falta información crítica para una herramienta, responde con 'action': 'reply' y pide solo el dato faltante.
- Las respuestas directas en el campo 'content' deben ser amigables, bien organizadas y redactadas en formato Markdown claro para un humano.

ESTRUCTURA JSON:
{
  "thought": "Breve nota de tu plan.",
  "action": "call_tool" | "reply",
  "tool_name": "nombre_mcp",
  "tool_args": {},
  "content": "Tu mensaje humano y profesional."
}

EJEMPLO ACCIÓN TÉCNICA:
Usuario: "Me bloquearon mi cuenta de AD"
IA: {
  "thought": "El usuario necesita desbloqueo de cuenta. Usaré sdp_execute_automation_action.",
  "action": "call_tool",
  "tool_name": "sdp_execute_automation_action",
  "tool_args": { "action_type": "UNLOCK_ACCOUNT", "request_id": "ID_REAL_DEL_TICKET", "user_email": "correo_real_confirmado" },
  "content": "Uff, entiendo lo frustrante que es quedarse fuera del sistema. Antes de ejecutar el desbloqueo, voy a dejar la acción preparada para confirmarla de forma segura."
}`;

const DECISION_MODEL = process.env.GEMINI_DECISION_MODEL || 'gemini-2.5-flash';
const FALLBACK_DECISION_MODEL = process.env.GEMINI_FALLBACK_MODEL || 'gemini-2.0-flash';

export class AgentOrchestrator {
  static async processMessage(message, context = {}, history = []) {
    try {
      console.log(`[Agent] Procesando mensaje con Gemini: "${message}"`);
      const contextText = JSON.stringify({
        authenticated_user: context.user ? {
          name: context.user.name,
          email: context.user.email,
          department: context.user.department,
          sdpRequesterId: context.user.sdpRequesterId || context.user.id
        } : null
      });
      const historyText = JSON.stringify(history.slice(-8));
      const userPrompt = `Contexto seguro del sistema: ${contextText}\n\nHistorial reciente: ${historyText}\n\nMensaje actual del usuario: ${message}`;
      
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      let response;
      try {
        const model = genAI.getGenerativeModel({
          model: DECISION_MODEL,
          systemInstruction: SYSTEM_PROMPT
        });

        response = await model.generateContent({
          contents: [
            { role: 'user', parts: [{ text: userPrompt }] }
          ],
          generationConfig: {
            responseMimeType: 'application/json'
          }
        });
      } catch (geminiError) {
        console.warn(`[Agent] ${DECISION_MODEL} fallido, intentando fallback a ${FALLBACK_DECISION_MODEL}:`, geminiError.message);
        const model = genAI.getGenerativeModel({
          model: FALLBACK_DECISION_MODEL,
          systemInstruction: SYSTEM_PROMPT
        });

        response = await model.generateContent({
          contents: [
            { role: 'user', parts: [{ text: userPrompt }] }
          ],
          generationConfig: {
            responseMimeType: 'application/json'
          }
        });
      }

      const resultText = response.response.text();
      console.log(`[Agent] Texto crudo de Gemini:`, resultText);
      const cleanJson = resultText.replace(/```json\n?|```/g, '').trim();
      const result = JSON.parse(cleanJson);
      console.log(`[Agent] Decisión de IA con Gemini:`, result);
      return result;
    } catch (error) {
      console.error("[Agent] Error en la orquestación con Gemini:", error.message);
      return {
        action: "reply",
        content: "Oye, parece que mi sistema de razonamiento ha tenido un pequeño hipo. ¿Podrías repetirme eso? Prometo que ya estoy de vuelta."
      };
    }
  }
}
