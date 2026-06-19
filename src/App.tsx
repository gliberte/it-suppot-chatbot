import React, { useState, useEffect, useRef } from 'react';
import { Send, Bot, Loader2, Paperclip, ChevronRight, PlusCircle, LogOut, Check, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import Login from './Login';
import { marked } from 'marked';

interface Message {
  id: string;
  text: string;
  sender: 'ai' | 'user';
  type?: 'text' | 'card';
  data?: TicketCardData;
}

interface TicketCardData {
  subject?: string;
  category?: string;
  priority?: string;
  status?: string;
  technician?: string;
}

interface AuthenticatedUser {
  id?: string;
  sdpRequesterId?: string;
  name: string;
  email?: string;
  department?: string;
}

interface PendingConfirmation {
  actionId: string;
  toolName: string;
  expiresInMinutes: number;
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

const sanitizeHtml = (html: string) => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const blockedTags = ['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta'];

  blockedTags.forEach((tag) => {
    doc.querySelectorAll(tag).forEach((node) => node.remove());
  });

  doc.body.querySelectorAll('*').forEach((element) => {
    Array.from(element.attributes).forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();

      if (name.startsWith('on') || value.startsWith('javascript:') || value.startsWith('data:text/html')) {
        element.removeAttribute(attribute.name);
      }
    });
  });

  return doc.body.innerHTML;
};

const renderMarkdown = (text: string) => {
  const html = marked.parse(text, { async: false }) as string;
  return sanitizeHtml(html);
};

const TicketCard = ({ data }: { data: TicketCardData }) => (
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
  const messageIdRef = useRef(1);
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
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [currentUser, setCurrentUser] = useState<AuthenticatedUser | null>(() => {
    const savedUser = localStorage.getItem('it_support_user');
    return savedUser ? JSON.parse(savedUser) as AuthenticatedUser : null;
  });
  const [authToken, setAuthToken] = useState<string | null>(() => localStorage.getItem('it_support_token'));
  const [isAuthenticated, setIsAuthenticated] = useState(() => Boolean(localStorage.getItem('it_support_token')));
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const nextMessageId = () => {
    messageIdRef.current += 1;
    return `msg-${messageIdRef.current}`;
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping]);

  const handleLoginSuccess = (user: AuthenticatedUser, token: string) => {
    setCurrentUser(user);
    setAuthToken(token);
    localStorage.setItem('it_support_token', token);
    localStorage.setItem('it_support_user', JSON.stringify(user));
    setIsAuthenticated(true);
    setMessages(prev => [
      ...prev,
      {
        id: nextMessageId(),
        text: `¡Hola **${user.name}**! He verificado tus credenciales de AD correctamente. ¿En qué puedo apoyarte hoy con los servicios de IT de Barraza y Cía?`,
        sender: 'ai'
      }
    ]);
  };

  const handleLogout = async () => {
    if (authToken) {
      try {
        await fetch(`${API_BASE_URL}/api/logout`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken}` }
        });
      } catch {
        // Local logout should still succeed if the server is unreachable.
      }
    }

    setIsAuthenticated(false);
    setCurrentUser(null);
    setAuthToken(null);
    localStorage.removeItem('it_support_token');
    localStorage.removeItem('it_support_user');
    setMessages([]);
  };

  const clearLocalSession = () => {
    setIsAuthenticated(false);
    setCurrentUser(null);
    setAuthToken(null);
    setPendingConfirmation(null);
    localStorage.removeItem('it_support_token');
    localStorage.removeItem('it_support_user');
  };

  const handleSessionExpired = () => {
    clearLocalSession();
    setMessages([]);
  };

  const handleSend = async () => {
    if (!input.trim()) return;

    const userMessage: Message = { id: nextMessageId(), text: input, sender: 'user' };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    const currentInput = input;
    setInput('');
    setIsTyping(true);

    // AI Logic Simulation
    setTimeout(() => {
      processAIMessage(currentInput, nextMessages);
    }, 1500);
  };

  const getConversationHistory = (sourceMessages: Message[]) => {
    return sourceMessages
      .filter((msg) => msg.type !== 'card' && msg.text.trim())
      .slice(-8)
      .map((msg) => ({
        role: msg.sender === 'user' ? 'user' : 'assistant',
        content: msg.text.slice(0, 1200)
      }));
  };

  const processAIMessage = async (userInput: string, sourceMessages: Message[]) => {
    setIsTyping(false);
    
    // Crear un ID único para el mensaje de la IA que vamos a ir llenando
    const aiMessageId = nextMessageId();
    
    try {
      const response = await fetch(`${API_BASE_URL}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
        },
        body: JSON.stringify({ 
          message: userInput,
          history: getConversationHistory(sourceMessages)
        })
      });

      if (response.status === 401) {
        handleSessionExpired();
        return;
      }

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
            } else if (data.type === 'confirmation_required') {
              setPendingConfirmation({
                actionId: data.actionId,
                toolName: data.toolName,
                expiresInMinutes: Math.max(1, Math.ceil(data.expiresInMs / 60000))
              });
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
        id: nextMessageId(),
        text: '⚠️ Oye, parece que perdí la conexión con mi base de conocimientos. ¿Podrías intentar de nuevo?',
        sender: 'ai'
      }]);
    }
  };

  const handleConfirmAction = async () => {
    if (!pendingConfirmation || !authToken) return;

    setIsConfirming(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/confirm-action`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({ actionId: pendingConfirmation.actionId })
      });

      if (response.status === 401) {
        handleSessionExpired();
        return;
      }

      const data = await response.json() as { success: boolean; message?: string };
      setMessages(prev => [...prev, {
        id: nextMessageId(),
        text: data.message || (data.success ? 'Acción ejecutada correctamente.' : 'No pude ejecutar la acción confirmada.'),
        sender: 'ai'
      }]);
      setPendingConfirmation(null);
    } catch {
      setMessages(prev => [...prev, {
        id: nextMessageId(),
        text: 'No pude confirmar la acción por un problema de conexión.',
        sender: 'ai'
      }]);
    } finally {
      setIsConfirming(false);
    }
  };

  const handleCancelConfirmation = () => {
    setPendingConfirmation(null);
    setMessages(prev => [...prev, {
      id: nextMessageId(),
      text: 'Acción cancelada. No ejecuté ningún cambio.',
      sender: 'ai'
    }]);
  };

  const updateAiMessage = (id: string, text: string) => {
    setMessages(prev => prev.map(msg => 
      msg.id === id ? { ...msg, text } : msg
    ));
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
              <span className="text-xs font-bold text-slate-300 uppercase">Gemini Online</span>
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
                  {msg.type === 'card' && msg.data ? (
                    <TicketCard data={msg.data} />
                  ) : (
                    <div 
                      className="leading-relaxed markdown-content"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.text) }} 
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
          {pendingConfirmation && (
            <div className="confirm-action-bar">
              <div>
                <p className="confirm-action-title">Confirmación requerida</p>
                <p className="confirm-action-copy">
                  {pendingConfirmation.toolName} vence en {pendingConfirmation.expiresInMinutes} min.
                </p>
              </div>
              <div className="confirm-action-buttons">
                <button
                  className="confirm-action-secondary"
                  onClick={handleCancelConfirmation}
                  disabled={isConfirming}
                  title="Cancelar acción"
                >
                  <X size={16} />
                </button>
                <button
                  className="confirm-action-primary"
                  onClick={handleConfirmAction}
                  disabled={isConfirming}
                  title="Confirmar acción"
                >
                  {isConfirming ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                  <span>Confirmar</span>
                </button>
              </div>
            </div>
          )}
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
