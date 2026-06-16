import React, { useState, useEffect, useRef } from 'react';
import { Send, Bot, User, CheckCircle, AlertCircle, Loader2, Paperclip, ChevronRight, PlusCircle, LogOut } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import Login from './Login';
import { marked } from 'marked';

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
      text: '¡Hola! Soy Antigravity, tu asistente técnico avanzado de BACOSA. Estoy aquí para ayudarte a resolver cualquier inconveniente técnico o gestionar tus tickets en ServiceDesk Plus. Para comenzar y brindarte un servicio personalizado, ¿podrías indicarme tu correo electrónico?',
      sender: 'ai'
    }
  ]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [flowState, setFlowState] = useState<'INITIAL' | 'AWAITING_DESCRIPTION' | 'AWAITING_TICKET_ID' | 'TRIAGE' | 'CONFIRMING' | 'DONE'>('INITIAL');
  const [ticketDraft, setTicketDraft] = useState<any>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping]);

  const handleLoginSuccess = (user: any) => {
    setCurrentUser(user);
    setIsAuthenticated(true);
    setMessages(prev => [
      ...prev,
      {
        id: Date.now().toString(),
        text: `¡Hola **${user.name}**! He verificado tus credenciales de AD correctamente. ¿En qué puedo apoyarte hoy con los servicios de IT de Barraza y Cía?`,
        sender: 'ai'
      }
    ]);
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    setCurrentUser(null);
    setFlowState('INITIAL');
    setMessages([]);
  };

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
    
    // Crear un ID único para el mensaje de la IA que vamos a ir llenando
    const aiMessageId = Date.now().toString();
    
    try {
      const response = await fetch('http://localhost:3001/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          message: userInput,
          userContext: currentUser
        })
      });

      if (!response.body) throw new Error('No se pudo establecer el flujo de datos.');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let accumulatedText = "";

      // Añadir el mensaje inicial vacío para la IA
      setMessages(prev => [...prev, {
        id: aiMessageId,
        text: "",
        sender: 'ai'
      }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          
          try {
            const data = JSON.parse(line.slice(6));
            
            if (data.type === 'status') {
              setStatusMessage(data.message);
            } else if (data.type === 'text') {
              setStatusMessage(null); // Limpiar status al recibir texto real
              accumulatedText = data.content;
              updateAiMessage(aiMessageId, accumulatedText);
            } else if (data.type === 'text_chunk') {
              setStatusMessage(null);
              accumulatedText += data.content;
              updateAiMessage(aiMessageId, accumulatedText);
            } else if (data.type === 'done') {
              setStatusMessage(null);
            }
          } catch (e) {
            console.error("Error parseando chunk de SSE:", e);
          }
        }
      }
    } catch (error) {
      console.error("Error en streaming:", error);
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        text: '⚠️ Oye, parece que perdí la conexión con mi base de conocimientos. ¿Podrías intentar de nuevo?',
        sender: 'ai'
      }]);
    }
  };

  const updateAiMessage = (id: string, text: string) => {
    setMessages(prev => prev.map(msg => 
      msg.id === id ? { ...msg, text } : msg
    ));
  };

  const handleToolResult = (result: any) => {
    const { tool, data, ai_suggestion } = result;

    if (tool === 'sdp_list_requests') {
      if (data.requests && data.requests.length > 0) {
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          text: result.content || `He encontrado **${data.requests.length}** tickets para ti:`,
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
        setMessages(prev => [...prev, { id: Date.now().toString(), text: result.content || `Detalles del ticket **#${req.id}**:`, sender: 'ai' }]);
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
       setMessages(prev => [...prev, { id: Date.now().toString(), text: result.content || `✅ Ticket creado exitosamente con ID: **#${data.request?.id}**.`, sender: 'ai' }]);
    }
  };

  if (!isAuthenticated) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className="flex h-screen bg-slate-900 text-slate-300">
      {/* Sidebar */}
      <aside className="w-80 bg-slate-900 border-r flex flex-col relative overflow-hidden">
        <div className="p-6 border-b relative z-10">
          <div className="flex items-center space-x-3 mb-8">
            <div className="w-10 h-10 bg-gradient-blue rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/20">
              <Bot className="text-white" size={24} />
            </div>
            <div>
              <h1 className="font-bold text-xl text-white">Antigravity</h1>
              <div className="flex items-center text-xs uppercase tracking-widest font-bold text-blue-400">
                <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" style={{ marginRight: '6px' }} />
                AI Support Agent
              </div>
            </div>
          </div>
          
          <button 
            className="w-full bg-slate-800 border px-4 py-3 rounded-xl flex items-center justify-center space-x-2 transition-all cursor-pointer text-white"
            style={{ border: '1px solid rgba(255,255,255,0.1)' }}
          >
            <PlusCircle size={18} className="text-blue-400" />
            <span className="font-medium">Nuevo Ticket</span>
          </button>
        </div>
        
        <nav className="flex-1 overflow-y-auto p-4 space-y-2 relative z-10 scrollbar-hide">
          <div className="px-2 mb-4">
            <h3 className="text-xs uppercase tracking-widest font-bold text-slate-500">Recientes</h3>
          </div>
          
          {[1, 2, 3].map((i) => (
            <button 
              key={i}
              className="w-full p-3 rounded-xl text-left flex items-center space-x-3 transition-all cursor-pointer"
              style={{ background: 'transparent', border: '1px solid transparent' }}
            >
              <div className="w-2 h-2 bg-slate-700 rounded-full" />
              <div className="flex-1 truncate">
                <p className="text-sm font-medium text-slate-300">Consulta técnica sobre SAP</p>
                <p className="text-xs text-slate-500">Ticket #72{i}1 • Hace {i}h</p>
              </div>
              <ChevronRight size={14} className="text-slate-600" />
            </button>
          ))}
        </nav>
        
        <div className="p-4 border-t bg-slate-900 relative z-10">
          <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-800 border">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-slate-700 rounded-full flex items-center justify-center text-sm font-bold border text-white">
                {currentUser?.name?.split(' ').map((n: string) => n[0]).join('')}
              </div>
              <div className="truncate" style={{ maxWidth: '120px' }}>
                <p className="text-sm font-bold truncate text-white">{currentUser?.name}</p>
                <p className="text-xs text-slate-500 truncate uppercase font-semibold">{currentUser?.department || 'User'}</p>
              </div>
            </div>
            <button 
              onClick={handleLogout}
              className="p-2 text-slate-500 cursor-pointer"
              style={{ background: 'transparent', border: 'none' }}
              title="Cerrar Sesión"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Chat Area */}
      <main className="flex-1 flex flex-col relative bg-slate-900 overflow-hidden">
        <header className="h-20 border-b flex items-center justify-between px-8 backdrop-blur-md sticky top-0 z-20" style={{ background: 'rgba(15, 23, 42, 0.5)' }}>
          <div className="flex items-center space-x-4">
            <div>
              <h2 className="font-bold text-white">Soporte IT Barraza</h2>
              <p className="text-xs text-blue-400 font-bold uppercase tracking-widest">Agente IA Autónomo</p>
            </div>
          </div>
          <div className="flex items-center">
            <div className="bg-slate-800 border px-3 py-1.5 rounded-lg flex items-center space-x-2">
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
              <span className="text-xs font-bold text-slate-300 uppercase">Llama 3 Online</span>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-6 space-y-8 scrollbar-hide">
          <AnimatePresence>
            {messages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex"
                style={{ justifyContent: msg.sender === 'user' ? 'flex-end' : 'flex-start' }}
              >
                <div className={`flex ${msg.sender === 'user' ? 'user-bubble' : 'ai-bubble'} message-bubble`}>
                  {msg.type === 'card' ? (
                    <TicketCard data={msg.data} />
                  ) : (
                    <div 
                      className="leading-relaxed markdown-content"
                      dangerouslySetInnerHTML={{ __html: marked.parse(msg.text) as string }} 
                    />
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
          
          {statusMessage && (
            <div className="flex items-center space-x-2 text-xs text-blue-400 font-medium px-4 mb-4 animate-pulse">
              <Loader2 size={12} className="animate-spin" />
              <span>{statusMessage}</span>
            </div>
          )}
          
          {isTyping && (
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="flex">
              <div className="typing-bubble">
                <div className="dot" />
                <div className="dot" />
                <div className="dot" />
              </div>
            </motion.div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="chat-input-area">
          <div className="chat-input-wrapper">
            <button className="p-3 text-slate-500 hover:text-blue-400 transition-colors" style={{ background: 'transparent', border: 'none' }}>
              <Paperclip size={20} />
            </button>
            <input 
              type="text" 
              className="chat-input-field" 
              placeholder="Explícame tu problema técnico..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSend()}
            />
            <button 
              onClick={handleSend}
              disabled={!input.trim() || isTyping}
              className="chat-send-btn"
            >
              {isTyping ? <Loader2 size={20} className="animate-spin" /> : <Send size={20} />}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
};

export default App;
