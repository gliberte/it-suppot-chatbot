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
  "tool_args": { "action_type": "UNLOCK_ACCOUNT", "request_id": "AUTO", "user_email": "usuario@bacosa.com" },
  "content": "Uff, entiendo lo frustrante que es quedarse fuera del sistema. No te preocupes, voy a intentar desbloquear tu cuenta de Active Directory ahora mismo. Un momento..."
}`;

export class AgentOrchestrator {
  static async processMessage(message, history = []) {
    try {
      console.log(`[Agent] Procesando mensaje con Gemini: "${message}"`);
      
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      let response;
      try {
        const model = genAI.getGenerativeModel({
          model: 'gemini-3.5-flash',
          systemInstruction: SYSTEM_PROMPT
        });

        response = await model.generateContent({
          contents: [
            { role: 'user', parts: [{ text: message }] }
          ],
          generationConfig: {
            responseMimeType: 'application/json'
          }
        });
      } catch (geminiError) {
        console.warn(`[Agent] gemini-3.5-flash fallido, intentando fallback a gemini-2.5-flash:`, geminiError.message);
        const model = genAI.getGenerativeModel({
          model: 'gemini-2.5-flash',
          systemInstruction: SYSTEM_PROMPT
        });

        response = await model.generateContent({
          contents: [
            { role: 'user', parts: [{ text: message }] }
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
