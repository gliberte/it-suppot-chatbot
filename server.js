import express from 'express';
import cors from 'cors';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from 'dotenv';
import { AgentOrchestrator } from './agent-orchestrator.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

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

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const result = await mcpClient.request(
      {
        method: "tools/call",
        params: {
          name: "sdp_authenticate_user",
          arguments: { username, password }
        },
      },
      CallToolResultSchema
    );

    if (result.isError) {
      return res.status(401).json({ success: false, message: "Error de autenticación: " + result.content[0].text });
    }

    const data = JSON.parse(result.content[0].text);
    res.json(data);
  } catch (error) {
    console.error("Error en login:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

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

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (type, data) => {
    res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
  };

  try {
    // 0. Informar que estamos pensando
    sendEvent('status', { message: 'Antigravity está analizando tu solicitud...' });

    // 1. Orquestación agéntica (Primera llamada: Decisión)
    const aiDecision = await AgentOrchestrator.processMessage(message);
    console.log(`[Bridge] IA decidió:`, JSON.stringify(aiDecision, null, 2));
    
    if (aiDecision.action === 'call_tool') {
      console.log(`[Bridge] Ejecutando: ${aiDecision.tool_name} con args:`, JSON.stringify(aiDecision.tool_args));
      sendEvent('status', { message: `Consultando herramienta: ${aiDecision.tool_name}...` });
      
      // Enviamos el mensaje inicial de la IA mientras procesamos la herramienta
      sendEvent('text', { content: aiDecision.content + "\n\n" });

      // Inyectar el requester_id si la herramienta lo necesita y lo tenemos en el contexto
      if (aiDecision.tool_name === 'sdp_list_requests' && userContext?.id) {
        aiDecision.tool_args = aiDecision.tool_args || {};
        aiDecision.tool_args.requester_id = userContext.id;
      }

      try {
        const toolResult = await mcpClient.request(
          {
            method: "tools/call",
            params: {
              name: aiDecision.tool_name,
              arguments: aiDecision.tool_args || {}
            },
          },
          CallToolResultSchema
        );

        const toolOutput = toolResult.content[0].text;
        console.log(`[Bridge] Resultado técnico obtenido.`);
        
        // Segunda llamada: Resumen humano (CON STREAMING usando Gemini)
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        try {
          const model = genAI.getGenerativeModel({
            model: "gemini-3.5-flash",
            systemInstruction: "Eres Antigravity, el agente de soporte IT de Barraza y Cía. Resume este resultado técnico de forma muy humana, clara y organizada en Markdown. Si hay varios tickets o elementos estructurados, preséntalos SIEMPRE en una TABLA Markdown con columnas claras (como ID, Asunto, Estado, Prioridad, Técnico, etc.). Usa emojis de forma profesional para destacar estados (ej: 🔴 Alta, 🟢 Cerrado, 🔵 Abierto). No uses frases introductorias genéricas como 'Aquí tienes el resumen'."
          });
          const result = await model.generateContentStream({
            contents: [{ role: 'user', parts: [{ text: `Resultado técnico: ${toolOutput}` }] }]
          });
          for await (const chunk of result.stream) {
            const chunkText = chunk.text();
            if (chunkText) {
              sendEvent('text_chunk', { content: chunkText });
            }
          }
        } catch (geminiError) {
          console.warn(`[Bridge] gemini-3.5-flash fallido en streaming, ejecutando fallback a gemini-2.5-flash:`, geminiError.message);
          const model = genAI.getGenerativeModel({
            model: "gemini-2.5-flash",
            systemInstruction: "Eres Antigravity, el agente de soporte IT de Barraza y Cía. Resume este resultado técnico de forma muy humana, clara y organizada en Markdown. Si hay varios tickets o elementos estructurados, preséntalos SIEMPRE en una TABLA Markdown con columnas claras (como ID, Asunto, Estado, Prioridad, Técnico, etc.). Usa emojis de forma profesional para destacar estados (ej: 🔴 Alta, 🟢 Cerrado, 🔵 Abierto). No uses frases introductorias genéricas como 'Aquí tienes el resumen'."
          });
          const result = await model.generateContentStream({
            contents: [{ role: 'user', parts: [{ text: `Resultado técnico: ${toolOutput}` }] }]
          });
          for await (const chunk of result.stream) {
            const chunkText = chunk.text();
            if (chunkText) {
              sendEvent('text_chunk', { content: chunkText });
            }
          }
        }

        sendEvent('done', {});
        res.end();

      } catch (error) {
        console.error(`[Bridge] Error crítico ejecutando herramienta ${aiDecision.tool_name}:`, error.message);
        sendEvent('text', { content: `⚠️ Oye, parece que tuve un problema técnico al intentar usar **${aiDecision.tool_name}**. Déjame revisar mis circuitos e intenta de nuevo.` });
        res.end();
      }
    } else {
      // Respuesta directa sin herramienta
      sendEvent('text', { content: aiDecision.content });
      sendEvent('done', {});
      res.end();
    }

  } catch (error) {
    sendEvent('error', { message: error.message });
    res.end();
  }
});

app.listen(PORT, () => {
  console.log(`Chatbot Backend Bridge corriendo en http://localhost:${PORT}`);
  initMCP();
});
