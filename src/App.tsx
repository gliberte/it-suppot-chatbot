import React, { useState, useEffect, useRef } from 'react';
import { Send, Bot, User, CheckCircle, AlertCircle, Loader2, Paperclip, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface Message {
  id: string;
  text: string;
  sender: 'ai' | 'user';
  type?: 'text' | 'card';
  data?: any;
}

const TicketCard = ({ data }: { data: any }) => (
  <motion.div 
    initial={{ opacity: 0, y: 10 }}
    animate={{ opacity: 1, y: 0 }}
    className="bg-white/10 backdrop-blur-md border border-white/20 rounded-xl p-4 my-2 shadow-xl w-full"
  >
    <div className="flex justify-between items-start mb-3">
      <h3 className="text-xs font-semibold text-white/70 uppercase tracking-wider">Detalles del Ticket</h3>
      {data.status ? (
        <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
          data.status === 'Cerrado' || data.status === 'Resuelto' ? 'bg-green-500/20 text-green-400' : 'bg-blue-500/20 text-blue-400'
        }`}>
          {data.status}
        </span>
      ) : (
        <span className="px-2 py-0.5 bg-cyan-500/20 rounded text-cyan-400 text-[10px] font-bold uppercase">Borrador</span>
      )}
    </div>
    
    <div className="space-y-3">
      <div>
        <p className="text-[10px] text-white/50 uppercase">Asunto</p>
        <p className="text-sm text-white font-medium">{data.subject}</p>
      </div>
      
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-[10px] text-white/50 uppercase">Categoría</p>
          <p className="text-xs text-white">{data.category}</p>
        </div>
        <div>
          <p className="text-[10px] text-white/50 uppercase">Prioridad</p>
          <div className="flex items-center gap-1">
            <div className={`w-2 h-2 rounded-full ${data.priority === 'Alta' ? 'bg-red-500' : 'bg-yellow-500'}`} />
            <p className="text-xs text-white">{data.priority}</p>
          </div>
        </div>
      </div>

      {data.technician && (
        <div className="pt-2 border-t border-white/10">
          <p className="text-[10px] text-white/50 uppercase">Técnico Asignado</p>
          <p className="text-xs text-white font-medium">{data.technician}</p>
        </div>
      )}
    </div>
  </motion.div>
);

const App: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([
    { 
      id: '1', 
      text: '¡Hola! Soy tu asistente inteligente de Soporte IT de Barraza y Cía. 👋 ¿En qué puedo ayudarte hoy?', 
      sender: 'ai' 
    }
  ]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [flowState, setFlowState] = useState<'IDLE' | 'IDENTIFYING' | 'AWAITING_DESCRIPTION' | 'AWAITING_TICKET_ID' | 'TRIAGE' | 'CONFIRMING' | 'DONE'>('IDLE');
  const [ticketDraft, setTicketDraft] = useState<any>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping]);

  const handleSend = async () => {
    if (!input.trim()) return;

    const userMessage: Message = { id: Date.now().toString(), text: input, sender: 'user' };
    setMessages(prev => [...prev, userMessage]);
    const currentInput = input;
    setInput('');
    setIsTyping(true);

    // AI Logic Simulation
    setTimeout(() => {
      processAIMessage(currentInput);
    }, 1500);
  };

  const processAIMessage = async (userInput: string) => {
    setIsTyping(false);
    const lowInput = userInput.toLowerCase().trim();

    // 1. Initial Greeting -> Start Identity Check
    if (flowState === 'IDLE') {
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        text: '¡Hola! Soy tu asistente inteligente de Soporte IT de Barraza y Cía. 🛡️\\n\\nPor seguridad, antes de comenzar, por favor indícame tu **correo corporativo** o **ID de empleado** para verificar tu autorización.',
        sender: 'ai'
      }]);
      setFlowState('IDENTIFYING');
      return;
    }

    // 2. Identity Verification
    if (flowState === 'IDENTIFYING') {
      // Fast-track for testing
      if (userInput.toLowerCase() === 'luis.solano@bacosa.com') {
        const mockUser = { name: "Luis Solano", email_id: "luis.solano@bacosa.com", id: "7210" };
        setCurrentUser(mockUser);
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          text: `✅ **Modo Test**: Identidad verificada automáticamente para **${mockUser.name}**.\\n\\nAutorización concedida. ¿En qué puedo ayudarte? (Puedes reportar un problema o consultar el estado de un ticket).`,
          sender: 'ai'
        }]);
        setFlowState('AWAITING_DESCRIPTION');
        return;
      }

      try {
        const response = await fetch('http://localhost:3001/api/verify-user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ search_text: userInput })
        });
        const data = await response.json();

        if (data.success) {
          const user = data.user;
          setCurrentUser(user);
          setMessages(prev => [...prev, {
            id: Date.now().toString(),
            text: `✅ Identidad confirmada. Bienvenido(a), **${user.name}**. Tienes autorización para usar este recurso.\\n\\n¿En qué puedo ayudarte hoy?`,
            sender: 'ai'
          }]);
          setFlowState('AWAITING_DESCRIPTION');
        } else {
          setMessages(prev => [...prev, {
            id: Date.now().toString(),
            text: '❌ No he podido verificar tu identidad en el sistema. Por favor, asegúrate de escribir tu correo correctamente o contacta a soporte por otro canal.',
            sender: 'ai'
          }]);
        }
      } catch (error) {
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          text: '⚠️ Hubo un error al conectar con el sistema de seguridad. Intenta de nuevo.',
          sender: 'ai'
        }]);
      }
      return;
    }

    // 3. Autonomous AI Orchestration
    if (flowState === 'AWAITING_DESCRIPTION' || flowState === 'AWAITING_TICKET_ID' || flowState === 'TRIAGE' || flowState === 'CONFIRMING') {
      try {
        const response = await fetch('http://localhost:3001/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            message: userInput,
            userContext: currentUser
          })
        });
        const data = await response.json();

        if (data.type === 'text') {
          setMessages(prev => [...prev, {
            id: Date.now().toString(),
            text: data.content,
            sender: 'ai'
          }]);
        } else if (data.type === 'tool_result') {
          // Manejar diferentes resultados de herramientas
          handleToolResult(data);
        }
      } catch (error) {
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          text: '⚠️ El orquestador de IA no responde. Por favor, verifica que Ollama esté corriendo.',
          sender: 'ai'
        }]);
      }
      return;
    }
  };

  const handleToolResult = (result: any) => {
    const { tool, data, ai_suggestion } = result;

    if (tool === 'sdp_list_requests') {
      if (data.requests && data.requests.length > 0) {
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          text: `He encontrado **${data.requests.length}** tickets para ti:`,
          sender: 'ai'
        }]);

        data.requests.forEach((req: any, index: number) => {
          setMessages(prev => [...prev, {
            id: (Date.now() + index).toString(),
            text: '',
            sender: 'ai',
            type: 'card',
            data: { 
              category: req.category?.name || 'N/A', 
              subject: req.subject,
              status: req.status?.name || 'N/A',
              priority: req.priority?.name || 'N/A',
              technician: req.technician?.name || 'No asignado'
            }
          }]);
        });
      } else {
        setMessages(prev => [...prev, { id: Date.now().toString(), text: 'No encontré tickets abiertos.', sender: 'ai' }]);
      }
    } else if (tool === 'sdp_get_request_details') {
      const req = data.request;
      if (req) {
        setMessages(prev => [...prev, { id: Date.now().toString(), text: `Detalles del ticket **#${req.id}**:`, sender: 'ai' }]);
        setMessages(prev => [...prev, {
          id: (Date.now() + 1).toString(),
          text: '',
          sender: 'ai',
          type: 'card',
          data: { 
            category: req.category?.name || 'N/A', 
            subject: req.subject,
            status: req.status?.name || 'N/A',
            priority: req.priority?.name || 'N/A',
            technician: req.technician?.name || 'No asignado'
          }
        }]);
      }
    } else if (tool === 'sdp_create_request') {
       setMessages(prev => [...prev, { id: Date.now().toString(), text: `✅ Ticket creado exitosamente con ID: **#${data.request?.id}**.`, sender: 'ai' }]);
    }
  };

  const listMyTickets = async () => {
    setIsTyping(true);
    try {
      const response = await fetch('http://localhost:3001/api/list-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          requester_id: currentUser?.id,
          filter_by: 'Open_Requests',
          limit: 3
        })
      });
      const data = await response.json();
      setIsTyping(false);

      if (data.requests && data.requests.length > 0) {
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          text: `He encontrado **${data.requests.length}** tickets abiertos a tu nombre:`,
          sender: 'ai'
        }]);

        data.requests.forEach((req: any, index: number) => {
          setMessages(prev => [...prev, {
            id: (Date.now() + 10 + index).toString(),
            text: '',
            sender: 'ai',
            type: 'card',
            data: { 
              category: req.category?.name || 'N/A', 
              subcategory: req.subcategory?.name || 'N/A', 
              priority: req.priority?.name || 'N/A', 
              subject: req.subject,
              status: req.status?.name || 'N/A',
              technician: req.technician?.name || 'No asignado'
            }
          }]);
        });
      } else {
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          text: 'No he encontrado tickets abiertos a tu nombre en este momento. ¿Deseas crear uno nuevo?',
          sender: 'ai'
        }]);
      }
    } catch (error) {
      setIsTyping(false);
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        text: '⚠️ Hubo un error al recuperar tus tickets. Intenta más tarde.',
        sender: 'ai'
      }]);
    }
  };

  const fetchTicketStatus = async (ticketId: string) => {
    setIsTyping(true);
    try {
      const response = await fetch('http://localhost:3001/api/get-ticket-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: ticketId })
      });
      const data = await response.json();
      setIsTyping(false);

      if (data.request) {
        const req = data.request;
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          text: `He encontrado la información del ticket **#${ticketId}**:`,
          sender: 'ai'
        }]);

        setMessages(prev => [...prev, {
          id: (Date.now() + 1).toString(),
          text: '',
          sender: 'ai',
          type: 'card',
          data: { 
            category: req.category?.name || 'N/A', 
            subcategory: req.subcategory?.name || 'N/A', 
            priority: req.priority?.name || 'N/A', 
            subject: req.subject,
            status: req.status?.name || 'N/A',
            technician: req.technician?.name || 'No asignado'
          }
        }]);

        setMessages(prev => [...prev, {
          id: (Date.now() + 2).toString(),
          text: `El estado actual es **${req.status?.name}**. ¿Hay algo más en lo que pueda ayudarte?`,
          sender: 'ai'
        }]);
        setFlowState('AWAITING_DESCRIPTION');
      } else {
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          text: `Lo siento, no he podido encontrar información para el ticket **#${ticketId}**. Por favor verifica el número.`,
          sender: 'ai'
        }]);
        setFlowState('AWAITING_DESCRIPTION');
      }
    } catch (error) {
      setIsTyping(false);
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        text: '⚠️ Hubo un error al consultar el estado del ticket. Intenta más tarde.',
        sender: 'ai'
      }]);
    }
  };

  const createTicket = async () => {
    setIsTyping(true);
    try {
      const response = await fetch('http://localhost:3001/api/create-ticket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ticketDraft)
      });
      
      const data = await response.json();
      const ticketId = data.request?.id || 'ERR';

      setIsTyping(false);
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        text: '✅ ¡Listo! Tu ticket ha sido creado exitosamente en ServiceDesk Plus.',
        sender: 'ai'
      }]);
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        text: `Número de referencia: **#${ticketId}**. El equipo de IT se pondrá en contacto contigo pronto.`,
        sender: 'ai'
      }]);
      setFlowState('DONE');
    } catch (error) {
      setIsTyping(false);
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        text: '❌ Hubo un error al crear el ticket. Por favor, intenta de nuevo más tarde.',
        sender: 'ai'
      }]);
    }
  };

  return (
    <div className="chat-container">
      <header className="chat-header">
        <div className="status-dot"></div>
        <div style={{ flex: 1 }}>
          <h2 style={{ fontSize: '18px', fontWeight: 700 }}>Soporte IT Inteligente</h2>
          <p style={{ fontSize: '12px', color: 'var(--text-dim)' }}>Conectado a ServiceDesk Plus</p>
        </div>
        <Bot size={24} color="var(--primary-accent)" />
      </header>

      <main className="messages-area">
        <AnimatePresence>
          {messages.map((msg) => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              className={`message-row ${msg.sender}`}
            >
              <div className="bubble">
                {msg.type === 'card' ? (
                  <TicketCard data={msg.data} />
                ) : (
                  <div dangerouslySetInnerHTML={{ __html: msg.text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') }} />
                )}
              </div>
            </motion.div>
          ))}
          {isTyping && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="message-row ai"
            >
              <div className="bubble" style={{ padding: '12px 16px' }}>
                <Loader2 size={20} className="animate-spin" color="var(--text-dim)" />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <div ref={messagesEndRef} />
      </main>

      <footer className="input-area">
        <button className="send-btn" style={{ background: 'transparent', border: '1px solid var(--glass-border)' }}>
          <Paperclip size={20} color="var(--text-dim)" />
        </button>
        <input 
          type="text" 
          className="chat-input" 
          placeholder="Describe tu problema aquí..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && handleSend()}
          disabled={flowState === 'DONE'}
        />
        <button className="send-btn" onClick={handleSend} disabled={flowState === 'DONE'}>
          <Send size={20} />
        </button>
      </footer>
    </div>
  );
};

export default App;
