import React, { useState } from 'react';
import { motion } from 'motion/react';
import { X, Delete } from 'lucide-react';

export default function CalculatorModal({ onClose }: { onClose: () => void }) {
  const [display, setDisplay] = useState('0');
  const [equation, setEquation] = useState('');
  const [newNumberExpected, setNewNumberExpected] = useState(false);

  const handleNumber = (num: string) => {
    if (display === '0' || newNumberExpected) {
      setDisplay(num);
      setNewNumberExpected(false);
    } else {
      setDisplay(display + num);
    }
  };

  const handleOperator = (op: string) => {
    // If the last character of equation is an operator and we haven't typed a new number, replace operator
    if (newNumberExpected && equation) {
      setEquation(equation.slice(0, -1) + op);
      return;
    }
    
    const newEquation = equation + display + op;
    setEquation(newEquation);
    setNewNumberExpected(true);
    
    // Evaluate intermediate
    try {
      // Safe to use eval here as we only construct it with our buttons
      const currentVal = eval(equation + display);
      setDisplay(String(currentVal));
    } catch {
      // ignore
    }
  };

  const calculate = () => {
    if (!equation) return;
    try {
      const result = eval(equation + display);
      setDisplay(String(result));
      setEquation('');
      setNewNumberExpected(true);
    } catch {
      setDisplay('Erro');
    }
  };

  const handleClear = () => {
    setDisplay('0');
    setEquation('');
    setNewNumberExpected(false);
  };

  const handleBackspace = () => {
    if (newNumberExpected) return;
    if (display.length > 1) {
      setDisplay(display.slice(0, -1));
    } else {
      setDisplay('0');
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="w-full max-w-xs bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
      >
        <div className="p-4 flex items-center justify-between border-b border-zinc-800">
          <h2 className="font-semibold text-zinc-100">Calculadora</h2>
          <button 
            onClick={onClose}
            className="p-2 -mr-2 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition-colors"
          >
            <X size={20} />
          </button>
        </div>
        
        <div className="p-5 flex-1 flex flex-col gap-4">
          <div className="bg-zinc-950 p-4 rounded-xl flex flex-col items-end gap-1 overflow-hidden">
            <div className="text-zinc-500 h-6 text-sm font-mono truncate w-full text-right">
              {equation}
            </div>
            <div className="text-4xl text-zinc-100 font-mono font-light tracking-tight truncate w-full text-right">
              {display}
            </div>
          </div>
          
          <div className="grid grid-cols-4 gap-2 h-full">
            <button onClick={handleClear} className="col-span-2 p-4 text-center rounded-xl bg-zinc-800 text-red-400 font-medium active:scale-95 transition-transform">C</button>
            <button onClick={handleBackspace} className="p-4 flex items-center justify-center rounded-xl bg-zinc-800 text-zinc-100 font-medium active:scale-95 transition-transform"><Delete size={20} /></button>
            <button onClick={() => handleOperator('/')} className="p-4 text-center rounded-xl bg-brand text-zinc-950 font-bold text-xl active:scale-95 transition-transform">÷</button>
            
            <button onClick={() => handleNumber('7')} className="p-4 text-center rounded-xl bg-zinc-800/50 text-zinc-100 font-medium text-xl active:scale-95 transition-transform">7</button>
            <button onClick={() => handleNumber('8')} className="p-4 text-center rounded-xl bg-zinc-800/50 text-zinc-100 font-medium text-xl active:scale-95 transition-transform">8</button>
            <button onClick={() => handleNumber('9')} className="p-4 text-center rounded-xl bg-zinc-800/50 text-zinc-100 font-medium text-xl active:scale-95 transition-transform">9</button>
            <button onClick={() => handleOperator('*')} className="p-4 text-center rounded-xl bg-brand text-zinc-950 font-bold text-xl active:scale-95 transition-transform">×</button>
            
            <button onClick={() => handleNumber('4')} className="p-4 text-center rounded-xl bg-zinc-800/50 text-zinc-100 font-medium text-xl active:scale-95 transition-transform">4</button>
            <button onClick={() => handleNumber('5')} className="p-4 text-center rounded-xl bg-zinc-800/50 text-zinc-100 font-medium text-xl active:scale-95 transition-transform">5</button>
            <button onClick={() => handleNumber('6')} className="p-4 text-center rounded-xl bg-zinc-800/50 text-zinc-100 font-medium text-xl active:scale-95 transition-transform">6</button>
            <button onClick={() => handleOperator('-')} className="p-4 text-center rounded-xl bg-brand text-zinc-950 font-bold text-xl active:scale-95 transition-transform">−</button>
            
            <button onClick={() => handleNumber('1')} className="p-4 text-center rounded-xl bg-zinc-800/50 text-zinc-100 font-medium text-xl active:scale-95 transition-transform">1</button>
            <button onClick={() => handleNumber('2')} className="p-4 text-center rounded-xl bg-zinc-800/50 text-zinc-100 font-medium text-xl active:scale-95 transition-transform">2</button>
            <button onClick={() => handleNumber('3')} className="p-4 text-center rounded-xl bg-zinc-800/50 text-zinc-100 font-medium text-xl active:scale-95 transition-transform">3</button>
            <button onClick={() => handleOperator('+')} className="p-4 text-center rounded-xl bg-brand text-zinc-950 font-bold text-xl active:scale-95 transition-transform">+</button>
            
            <button onClick={() => handleNumber('0')} className="col-span-2 p-4 text-center rounded-xl bg-zinc-800/50 text-zinc-100 font-medium text-xl active:scale-95 transition-transform">0</button>
            <button onClick={() => handleNumber('.')} className="p-4 text-center rounded-xl bg-zinc-800/50 text-zinc-100 font-medium text-xl active:scale-95 transition-transform">.</button>
            <button onClick={calculate} className="p-4 text-center rounded-xl bg-brand text-zinc-950 font-bold text-xl active:scale-95 transition-transform">=</button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
