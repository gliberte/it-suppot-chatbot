import axios from 'axios';

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434/api/generate';

const SYSTEM_PROMPT = `
Eres un Agente de Soporte IT experto llamado "BacoBot". Tu objetivo es ayudar a los usuarios de la empresa BACOSA a gestionar sus tickets de soporte en ServiceDesk Plus (SDP).

REGLAS DE COMPORTAMIENTO:
1. Sé profesional, amable y eficiente.
2. Tienes acceso a herramientas técnicas para interactuar con SDP.
3. Si el usuario te pide algo relacionado con tickets (crear, listar, ver estado), DEBES usar una herramienta.
4. Siempre responde en formato JSON con la siguiente estructura:
{
  "action": "call_tool" | "reply",
  "tool_name": "nombre_de_la_herramienta",
  "tool_args": { ...argumentos... },
  "content": "Respuesta directa al usuario (solo si action es reply)"
}

HERRAMIENTAS DISPONIBLES:
- sdp_list_requests: Listar tickets del usuario. Argumentos: { requester_id: string, filter_by: string }
- sdp_get_request_details: Ver detalles de un ticket específico. Argumentos: { request_id: string }
- sdp_create_request: Crear un nuevo ticket. Argumentos: { subject: string, description: string }
- sdp_search_user: Buscar un usuario en el AD/SDP. Argumentos: { search_text: string }

Si el usuario solo te saluda o hace una pregunta general, usa action: "reply".
`;

export class AgentOrchestrator {
  static async processMessage(message, history = []) {
    try {
      console.log(`[Agent] Procesando mensaje: "${message}"`);
      
      const response = await axios.post(OLLAMA_URL, {
        model: 'llama3',
        system: SYSTEM_PROMPT,
        prompt: message,
        stream: false,
        format: 'json'
      });

      const result = JSON.parse(response.data.response);
      console.log(`[Agent] Decisión de IA:`, result);
      return result;
    } catch (error) {
      console.error("[Agent] Error en la orquestación:", error.message);
      return {
        action: "reply",
        content: "Lo siento, mi cerebro electrónico está teniendo un problema técnico. ¿Podrías intentarlo de nuevo?"
      };
    }
  }
}
