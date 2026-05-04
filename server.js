import express from 'express';
import cors from 'cors';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from 'dotenv';
import { AgentOrchestrator } from './agent-orchestrator.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3001;

// Configuración del transporte para conectar con el servidor MCP de SDP
const transport = new StdioClientTransport({
  command: "node",
  args: [path.join(__dirname, "../sdp-mcp-server/build/index.js")],
  env: process.env
});

const mcpClient = new Client(
  { name: "chatbot-bridge", version: "1.0.0" },
  { capabilities: {} }
);

async function initMCP() {
  try {
    await mcpClient.connect(transport);
    console.log("Chatbot Bridge conectado al servidor MCP de ServiceDesk Plus");
  } catch (error) {
    console.error("Error conectando a MCP:", error);
  }
}

app.post('/api/verify-user', async (req, res) => {
  const { search_text } = req.body;

  try {
    const result = await mcpClient.request(
      {
        method: "tools/call",
        params: {
          name: "sdp_search_user",
          arguments: { search_text }
        },
      },
      CallToolResultSchema
    );

    if (result.isError) {
      return res.json({ success: false, message: "Error del sistema de soporte: " + result.content[0].text });
    }

    let data;
    try {
      data = JSON.parse(result.content[0].text);
    } catch (e) {
      return res.json({ success: false, message: "Error al procesar respuesta del sistema." });
    }

    const users = data.users || [];
    
    if (users.length > 0) {
      res.json({ success: true, user: users[0] });
    } else {
      res.json({ success: false, message: "Usuario no encontrado o no autorizado." });
    }
  } catch (error) {
    console.error("Error verificando usuario:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/get-ticket-status', async (req, res) => {
  const { request_id } = req.body;

  try {
    const result = await mcpClient.request(
      {
        method: "tools/call",
        params: {
          name: "sdp_get_request_details",
          arguments: { request_id }
        },
      },
      CallToolResultSchema
    );

    const data = JSON.parse(result.content[0].text);
    res.json(data);
  } catch (error) {
    console.error("Error consultando ticket via MCP:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/list-requests', async (req, res) => {
  const { filter_by, limit, requester_id } = req.body;

  try {
    const result = await mcpClient.request(
      {
        method: "tools/call",
        params: {
          name: "sdp_list_requests",
          arguments: { 
            filter_by: filter_by || "All_Requests", 
            limit: limit || 20,
            requester_id
          }
        },
      },
      CallToolResultSchema
    );

    const data = JSON.parse(result.content[0].text);
    res.json(data);
  } catch (error) {
    console.error("Error listando tickets via MCP:", error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/create-ticket', async (req, res) => {
  const { subject, description, category, subcategory, priority } = req.body;

  try {
    const result = await mcpClient.request(
      {
        method: "tools/call",
        params: {
          name: "sdp_create_request",
          arguments: {
            subject,
            description,
            category,
            subcategory,
            priority,
            request_type: "Solicitud",
            requester: "Luis Solano"
          }
        },
      },
      CallToolResultSchema
    );

    const data = JSON.parse(result.content[0].text);
    res.json(data);
  } catch (error) {
    console.error("Error creando ticket via MCP:", error);
    res.status(500).json({ error: error.message });
  }
});

// NUEVO: Endpoint de Chat Agéntico
app.post('/api/chat', async (req, res) => {
  const { message, userContext } = req.body;

  try {
    // 1. Preguntar a la IA qué hacer
    const aiDecision = await AgentOrchestrator.processMessage(message);

    if (aiDecision.action === 'reply') {
      return res.json({ type: 'text', content: aiDecision.content });
    }

    if (aiDecision.action === 'call_tool') {
      console.log(`[Bridge] Ejecutando herramienta: ${aiDecision.tool_name}`);
      
      // Inyectar el requester_id si la herramienta lo necesita y lo tenemos en el contexto
      if (aiDecision.tool_name === 'sdp_list_requests' && userContext?.id) {
        aiDecision.tool_args.requester_id = userContext.id;
      }

      const result = await mcpClient.request(
        {
          method: "tools/call",
          params: {
            name: aiDecision.tool_name,
            arguments: aiDecision.tool_args
          },
        },
        CallToolResultSchema
      );

      if (result.isError) {
        return res.json({ type: 'text', content: "Hubo un error al ejecutar la herramienta: " + result.content[0].text });
      }

      const data = JSON.parse(result.content[0].text);
      
      // Devolvemos el resultado a la IA para que lo explique, o directamente al frontend con un tipo especial
      // Por ahora, devolvemos un objeto enriquecido para que el frontend use sus Cards
      return res.json({ 
        type: 'tool_result', 
        tool: aiDecision.tool_name, 
        data,
        ai_suggestion: `He ejecutado la herramienta ${aiDecision.tool_name} para ti.`
      });
    }

  } catch (error) {
    console.error("Error en endpoint de chat:", error);
    res.status(500).json({ error: "Error interno en el agente." });
  }
});

app.listen(PORT, () => {
  console.log(`Chatbot Backend Bridge corriendo en http://localhost:${PORT}`);
  initMCP();
});
