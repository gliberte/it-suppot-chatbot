import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Shield, Cpu, MessageSquare, ArrowRight, Lock, User } from 'lucide-react';

interface LoginProps {
  onLoginSuccess: (user: any) => void;
}

const Login: React.FC<LoginProps> = ({ onLoginSuccess }) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await fetch('http://localhost:3001/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const data = await response.json();

      if (data.success) {
        onLoginSuccess(data.user);
      } else {
        setError(data.message || 'Credenciales inválidas. Por favor intente de nuevo.');
      }
    } catch (err) {
      setError('Error al conectar con el servidor de autenticación.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center p-4 relative overflow-hidden">
      {/* Elementos Decorativos de Fondo */}
      <div className="absolute rounded-full" style={{ top: '-10%', left: '-10%', width: '40%', height: '40%', background: 'rgba(30, 58, 138, 0.2)', filter: 'blur(120px)' }} />
      <div className="absolute rounded-full" style={{ bottom: '-10%', right: '-10%', width: '40%', height: '40%', background: 'rgba(49, 46, 129, 0.2)', filter: 'blur(120px)' }} />

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
        className="max-w-4xl w-full grid grid-cols-1 md-grid-cols-2 gap-8 items-center z-10"
      >
        {/* Lado Izquierdo: Mensaje de Bienvenida */}
        <div className="space-y-6">
          <motion.div 
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 }}
            className="inline-flex items-center space-x-2 bg-slate-800 border px-3 py-1 rounded-full text-blue-400 text-sm font-medium"
          >
            <Cpu size={14} />
            <span>AI-Powered Support Platform</span>
          </motion.div>
          
          <h1 className="text-5xl font-bold leading-tight">
            Soporte en Línea <br />
            <span className="text-gradient">
              Barraza y Cía
            </span>
          </h1>
          
          <p className="text-slate-400 text-lg max-w-md leading-relaxed">
            Bienvenido al portal de asistencia inteligente del departamento de IT. 
            Resuelve tus dudas técnicas de forma instantánea con nuestro agente autónomo.
          </p>

          <div className="grid grid-cols-1 gap-4 pt-4">
            <div className="flex items-center space-x-3 text-slate-300">
              <div className="bg-slate-800 p-2 rounded-lg"><MessageSquare size={18} className="text-blue-400" /></div>
              <span className="font-medium">Resolución de dudas en lenguaje natural</span>
            </div>
            <div className="flex items-center space-x-3 text-slate-300">
              <div className="bg-slate-800 p-2 rounded-lg"><Shield size={18} className="text-red-400" /></div>
              <span className="font-medium">Acceso seguro vía Active Directory</span>
            </div>
          </div>
        </div>

        {/* Lado Derecho: Formulario de Login */}
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.4 }}
          className="bg-slate-900 border backdrop-blur-xl p-8 rounded-3xl shadow-2xl"
          style={{ background: 'rgba(15, 23, 42, 0.5)' }}
        >
          <div className="mb-8">
            <h2 className="text-2xl font-bold">Iniciar Sesión</h2>
            <p className="text-slate-500 text-sm">Ingresa tus credenciales corporativas</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-5">
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-widest text-slate-500">Usuario o Correo</label>
              <div className="relative" style={{ position: 'relative' }}>
                <User className="text-slate-500" size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }} />
                <input 
                  type="text" 
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="ej: luis.solano@bacosa.com"
                  className="w-full bg-slate-800 border rounded-xl py-3 pr-4 transition-all outline-none text-white"
                  style={{ paddingLeft: '40px', background: 'rgba(30, 41, 59, 0.5)' }}
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-bold uppercase tracking-widest text-slate-500">Contraseña</label>
              <div className="relative" style={{ position: 'relative' }}>
                <Lock className="text-slate-500" size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)' }} />
                <input 
                  type="password" 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-slate-800 border rounded-xl py-3 pr-4 transition-all outline-none text-white"
                  style={{ paddingLeft: '40px', background: 'rgba(30, 41, 59, 0.5)' }}
                  required
                />
              </div>
            </div>

            <AnimatePresence>
              {error && (
                <motion.div 
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="bg-red-500 border text-red-400 px-4 py-2 rounded-xl text-xs"
                  style={{ background: 'rgba(239, 68, 68, 0.1)', borderColor: 'rgba(239, 68, 68, 0.2)' }}
                >
                  {error}
                </motion.div>
              )}
            </AnimatePresence>

            <button 
              type="submit" 
              disabled={loading}
              className="w-full bg-gradient-blue py-3 rounded-xl font-bold flex items-center justify-center space-x-2 transition-all cursor-pointer"
              style={{ border: 'none', color: 'white' }}
            >
              {loading ? (
                <div className="w-5 h-5 border-2 animate-spin rounded-full" style={{ borderTopColor: 'white', borderRightColor: 'rgba(255,255,255,0.2)', borderBottomColor: 'rgba(255,255,255,0.2)', borderLeftColor: 'rgba(255,255,255,0.2)' }} />
              ) : (
                <>
                  <span>Ingresar al Soporte</span>
                  <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>

          <p className="mt-8 text-center text-slate-600 text-xs uppercase tracking-widest font-semibold">
            &copy; 2026 Barraza y Cía - IT Division
          </p>
        </motion.div>
      </motion.div>
    </div>
  );
};

export default Login;
