/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Plus, 
  FileText, 
  Search, 
  ChevronRight, 
  ChevronLeft, 
  Check, 
  Mic, 
  StopCircle, 
  Trash2, 
  Download, 
  ArrowLeft,
  X,
  Play,
  Square,
  Edit2,
  LogOut,
  LogIn
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { CAR_PIECES } from './constants';
import { NoteData, ServicePiece } from './types';
import { format } from 'date-fns';
import { jsPDF } from 'jspdf';
import confetti from 'canvas-confetti';
import { auth, db, signInWithGoogle } from './lib/firebase';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { 
  collection, 
  onSnapshot, 
  query, 
  where, 
  setDoc, 
  deleteDoc, 
  doc, 
  orderBy,
  getDocFromServer
} from 'firebase/firestore';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Initialize Note
const initialNote = (userId: string = ''): NoteData => ({
  id: crypto.randomUUID(),
  userId,
  customerName: '',
  vehicleNameColor: '',
  plate: '',
  cpfCnpj: '',
  whatsapp: '',
  pieces: CAR_PIECES.map(p => ({ ...p, selected: false, description: '' })),
  includePartsValue: false,
  partsValue: 0,
  includeLaborValue: false,
  laborValue: 0,
  includeMaterialsValue: false,
  materialsValue: 0,
  totalValue: 0,
  observations: '',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'list' | 'editor' | 'details'>('list');
  const [notes, setNotes] = useState<NoteData[]>([]);
  const [currentNote, setCurrentNote] = useState<NoteData>(initialNote());
  const [step, setStep] = useState(1);
  const [isRecording, setIsRecording] = useState<string | null>(null);
  const [isListening, setIsListening] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showInstallBtn, setShowInstallBtn] = useState(false);
  const [isIframe, setIsIframe] = useState(false);

  // PWA Install Logic
  useEffect(() => {
    setIsIframe(window.self !== window.top);
    
    // Check if app is already installed
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true;
    
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;

    if (isStandalone) {
      setShowInstallBtn(false);
      return;
    }

    // On iOS, we show the button but with instructions because beforeinstallprompt doesn't fire
    if (isIOS) {
      setShowInstallBtn(true);
    }

    const handleBeforeInstallPrompt = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowInstallBtn(true);
    };

    const handleAppInstalled = () => {
      setDeferredPrompt(null);
      setShowInstallBtn(false);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleInstallClick = async () => {
    if (isIframe) {
      window.open(window.location.href, '_blank');
      return;
    }

    if (!deferredPrompt) {
      // iOS or browser that doesn't support beforeinstallprompt yet
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
      if (isIOS) {
        alert('Para instalar no seu iPhone/iPad:\n1. Toque no botão de Compartilhar (aquele quadrado com uma seta para cima).\n2. Role para baixo e selecione "Adicionar à Tela de Início".');
      } else {
        alert('Para instalar:\nAbra o menu do seu navegador (três pontinhos no Chrome) e selecione "Instalar aplicativo" ou "Adicionar à tela inicial".');
      }
      return;
    }
    
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
      setShowInstallBtn(false);
    }
  };

  // Test Connection
  useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    }
    testConnection();
  }, []);

  // Auth state
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
      if (u) {
        setCurrentNote(initialNote(u.uid));
      }
    });
    return unsubscribe;
  }, []);

  // Load notes from Firestore
  useEffect(() => {
    if (!user) {
      setNotes([]);
      return;
    }

    const path = 'notes';
    const q = query(
      collection(db, path),
      where('userId', '==', user.uid),
      orderBy('updatedAt', 'desc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedNotes = snapshot.docs.map(doc => doc.data() as NoteData);
      setNotes(fetchedNotes);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, path);
    });

    return unsubscribe;
  }, [user]);

  const handleCreateNote = () => {
    setCurrentNote(initialNote(user?.uid || ''));
    setStep(1);
    setView('editor');
  };

  const handleEditNote = (note: NoteData) => {
    setCurrentNote({ ...note });
    setView('details');
  };

  const handleDeleteNote = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Tem certeza que deseja excluir esta nota?')) {
      const path = `notes/${id}`;
      try {
        await deleteDoc(doc(db, 'notes', id));
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, path);
      }
    }
  };

  const saveCurrentNote = async () => {
    if (!user) return;
    const now = new Date().toISOString();
    
    // Calculate total
    let total = 0;
    if (currentNote.includePartsValue) total += Number(currentNote.partsValue);
    if (currentNote.includeLaborValue) total += Number(currentNote.laborValue);
    if (currentNote.includeMaterialsValue) total += Number(currentNote.materialsValue);
    
    const noteToSave: NoteData = { 
      ...currentNote, 
      totalValue: total,
      updatedAt: now,
      userId: user.uid 
    };
    
    const path = `notes/${noteToSave.id}`;
    try {
      await setDoc(doc(db, 'notes', noteToSave.id), noteToSave);
      setView('list');
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
        colors: ['#22c55e', '#ffffff']
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  };

  // Audio Recording
  const startRecording = async (pieceId: string) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        audioChunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = () => {
          const base64Audio = reader.result as string;
          updatePiece(pieceId, { audioBlob: base64Audio });
        };
      };

      mediaRecorder.start();
      setIsRecording(pieceId);
    } catch (err) {
      console.error('Error recording audio:', err);
      alert('Permissão de microfone negada ou não suportada.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      setIsRecording(null);
    }
  };

  const [searchTerm, setSearchTerm] = useState('');

  const filteredNotes = notes.filter(n => 
    n.customerName.toLowerCase().includes(searchTerm.toLowerCase()) || 
    n.plate.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const exportJSON = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(currentNote));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", `oficina_note_${currentNote.plate || 'export'}.json`);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  const importJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        setCurrentNote({ ...json, id: crypto.randomUUID(), updatedAt: new Date().toISOString() });
        setStep(1);
        setView('editor');
      } catch (err) {
        alert('Erro ao importar arquivo JSON.');
      }
    };
    reader.readAsText(file);
  };

  const playAudio = (blob: string) => {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current.currentTime = 0;
    }
    const audio = new Audio(blob);
    currentAudioRef.current = audio;
    audio.play();
  };

  const startDictation = (pieceId: string) => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('Seu navegador não suporta reconhecimento de voz.');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'pt-BR';
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => setIsListening(pieceId);
    recognition.onend = () => setIsListening(null);
    recognition.onerror = () => setIsListening(null);

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      const piece = currentNote.pieces.find(p => p.id === pieceId);
      const currentDesc = piece?.description || '';
      updatePiece(pieceId, { description: currentDesc + (currentDesc ? ' ' : '') + transcript });
    };

    recognition.start();
  };

  const updatePiece = (id: string, updates: Partial<ServicePiece>) => {
    setCurrentNote(prev => ({
      ...prev,
      pieces: prev.pieces.map(p => p.id === id ? { ...p, ...updates } : p)
    }));
  };

  const generatePDF = () => {
    const doc = new jsPDF();
    const margin = 20;
    let y = 20;

    doc.setFontSize(22);
    doc.text('Oficina Notes - Ordem de Serviço', margin, y);
    y += 10;
    doc.setFontSize(10);
    doc.text(`Gerado em: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, margin, y);
    y += 15;

    doc.setFontSize(14);
    doc.text('Dados do Cliente e Veículo', margin, y);
    y += 10;
    doc.setFontSize(11);
    doc.text(`Cliente: ${currentNote.customerName}`, margin, y); y += 7;
    doc.text(`CPF/CNPJ: ${currentNote.cpfCnpj}`, margin, y); y += 7;
    doc.text(`WhatsApp: ${currentNote.whatsapp}`, margin, y); y += 7;
    doc.text(`Veículo: ${currentNote.vehicleNameColor}`, margin, y); y += 7;
    doc.text(`Placa: ${currentNote.plate}`, margin, y); y += 15;

    const selectedPieces = currentNote.pieces.filter(p => p.selected);
    if (selectedPieces.length > 0) {
      doc.setFontSize(14);
      doc.text('Serviços por Peça', margin, y);
      y += 10;
      doc.setFontSize(11);
      selectedPieces.forEach(p => {
        if (y > 270) { doc.addPage(); y = 20; }
        doc.setFont('helvetica', 'bold');
        doc.text(`- ${p.label}:`, margin, y);
        y += 6;
        doc.setFont('helvetica', 'normal');
        const desc = doc.splitTextToSize(p.description || '(Sem descrição textual)', 170);
        doc.text(desc, margin + 5, y);
        y += desc.length * 6 + 4;
      });
    }

    y += 10;
    doc.setFontSize(14);
    doc.text('Financeiro', margin, y);
    y += 10;
    doc.setFontSize(11);
    if (currentNote.includePartsValue) { doc.text(`Valor das Peças: R$ ${currentNote.partsValue}`, margin, y); y += 7; }
    if (currentNote.includeLaborValue) { doc.text(`Mão de Obra: R$ ${currentNote.laborValue}`, margin, y); y += 7; }
    if (currentNote.includeMaterialsValue) { doc.text(`Materiais: R$ ${currentNote.materialsValue}`, margin, y); y += 7; }
    
    y += 5;
    doc.setFontSize(16);
    doc.text(`VALOR TOTAL: R$ ${currentNote.totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, margin, y);

    if (currentNote.observations) {
      y += 15;
      if (y > 270) { doc.addPage(); y = 20; }
      doc.setFontSize(14);
      doc.text('Observações Gerais', margin, y);
      y += 8;
      doc.setFontSize(10);
      const obs = doc.splitTextToSize(currentNote.observations, 170);
      doc.text(obs, margin, y);
    }

    doc.save(`os_${currentNote.plate || 'nota'}_${format(new Date(), 'yyyyMMdd')}.pdf`);
  };

  const totalValue = (
    (currentNote.includePartsValue ? Number(currentNote.partsValue) : 0) +
    (currentNote.includeLaborValue ? Number(currentNote.laborValue) : 0) +
    (currentNote.includeMaterialsValue ? Number(currentNote.materialsValue) : 0)
  );

  const handleLogin = async () => {
    try {
      await signInWithGoogle();
    } catch (error: any) {
      if (error.code === 'auth/popup-closed-by-user' || error.code === 'auth/cancelled-popup-request') {
        return;
      }
      console.error('Erro ao fazer login:', error);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <div className="w-12 h-12 border-4 border-brand border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-black">
        <div className="w-20 h-20 bg-brand rounded-2xl flex items-center justify-center mb-8 shadow-[0_0_30px_rgba(34,197,94,0.3)]">
          <FileText className="text-black" size={40} strokeWidth={3} />
        </div>
        <h1 className="text-4xl font-black italic tracking-tighter mb-2 text-center">
          OFICINA<span className="text-brand">NOTES</span>
        </h1>
        <p className="text-zinc-500 text-center mb-12 uppercase tracking-widest text-[10px] font-bold">
          Gestão Profissional para sua Oficina
        </p>
        
        <button 
          onClick={handleLogin}
          className="w-full max-w-sm flex items-center justify-center gap-4 bg-white text-black font-black uppercase tracking-widest text-xs py-4 rounded-xl hover:bg-zinc-200 transition-all active:scale-95"
        >
          <LogIn size={20} />
          Entrar com Google
        </button>
        
        <p className="mt-8 text-zinc-700 text-[9px] uppercase tracking-[0.2em]">
          Powered by Antigravity
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-20 max-w-lg mx-auto">
      {view === 'list' ? (
        <div className="p-4 space-y-6">
          <header className="flex justify-between items-center py-6 border-b border-zinc-900">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-brand rounded flex items-center justify-center">
                <FileText className="text-black" size={20} strokeWidth={3} />
              </div>
              <h1 className="text-2xl font-black italic tracking-tighter">
                OFICINA<span className="text-brand">NOTES</span>
              </h1>
            </div>
            <div className="flex items-center gap-4">
              <button 
                onClick={handleCreateNote}
                className="bg-brand text-black p-3 rounded shadow-lg hover:rotate-90 transition-transform"
              >
                <Plus size={24} strokeWidth={3} />
              </button>
              <button 
                onClick={() => signOut(auth)}
                className="bg-zinc-900 text-zinc-500 p-3 rounded hover:text-red-500 transition-colors"
                title="Sair"
              >
                <LogOut size={24} />
              </button>
            </div>
          </header>

          {showInstallBtn && (
            <motion.div 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              className="px-4 pb-4"
            >
              <button 
                onClick={handleInstallClick}
                className="w-full bg-brand text-black font-black uppercase tracking-widest text-[10px] py-4 rounded-xl flex items-center justify-center gap-3 shadow-[0_0_20px_rgba(34,197,94,0.3)] animate-pulse"
              >
                <div className="bg-black text-brand p-1 rounded-md">
                  {isIframe ? <Download size={14} strokeWidth={3} /> : <Plus size={14} strokeWidth={3} />}
                </div>
                {isIframe ? '🌐 Abrir em nova aba para instalar' : '📲 Instalar Aplicativo no Celular'}
              </button>
            </motion.div>
          )}

          <div className="relative flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-700" size={18} />
              <input 
                type="text" 
                placeholder="PROCURAR POR PLACA OU CLIENTE" 
                className="input-field pl-10 font-black tracking-widest text-[11px]"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
            </div>
            <label className="bg-zinc-900 border border-zinc-800 text-brand p-3 rounded cursor-pointer hover:bg-zinc-800 transition-colors">
              <Download size={20} className="rotate-180" />
              <input type="file" accept=".json" onChange={importJSON} className="hidden" />
            </label>
          </div>

          <div className="space-y-4">
            {filteredNotes.length === 0 ? (
              <div className="text-center py-20 text-zinc-600">
                <FileText size={48} className="mx-auto mb-4 opacity-20" />
                <p>{searchTerm ? 'Nenhum resultado encontrado.' : 'Nenhuma nota cadastrada ainda.'}</p>
              </div>
            ) : (
              filteredNotes.map(note => (
                <div 
                  key={note.id}
                  onClick={() => handleEditNote(note)}
                  className="card group cursor-pointer hover:border-brand border-zinc-800 active:scale-[0.98] transition-all"
                >
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-3">
                      <div className="w-1.5 h-8 bg-brand rounded-full"></div>
                      <div>
                        <h3 className="font-black text-xl italic tracking-tighter uppercase">{note.plate || 'SEM PLACA'}</h3>
                        <p className="text-zinc-500 text-[10px] uppercase font-bold tracking-widest">{note.customerName}</p>
                        <p className="text-brand text-xs font-mono font-bold mt-1">R$ {note.totalValue?.toFixed(2)}</p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                       <span className="text-[9px] bg-zinc-800 px-2 py-0.5 rounded text-zinc-400 font-black tracking-widest">
                        {format(new Date(note.updatedAt), 'dd/MM/yy')}
                      </span>
                      <button 
                        onClick={(e) => handleDeleteNote(note.id, e)}
                        className="text-zinc-700 hover:text-red-500 p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      ) : view === 'details' ? (
        <div className="p-4 space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <header className="flex items-center justify-between py-4 border-b border-zinc-900 sticky top-0 bg-black/80 backdrop-blur-md z-10">
            <div className="flex items-center gap-4">
              <button onClick={() => setView('list')} className="p-2 hover:bg-zinc-800 rounded-full">
                <ArrowLeft size={24} />
              </button>
              <h2 className="text-xl font-black italic tracking-tighter uppercase">Detalhes da Nota</h2>
            </div>
            <button 
              onClick={() => {
                setStep(1);
                setView('editor');
              }}
              className="p-3 bg-zinc-800 text-brand rounded hover:bg-zinc-700 transition-colors"
            >
              <Edit2 size={20} strokeWidth={3} />
            </button>
          </header>

          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4">
              <div className="card">
                <h3 className="label-tech text-brand">Cliente</h3>
                <p className="text-2xl font-black italic tracking-tighter uppercase">{currentNote.customerName || 'NÃO INFORMADO'}</p>
                <div className="flex gap-4 mt-2">
                  <div>
                    <label className="text-[9px] text-zinc-600 uppercase font-bold">CPF/CNPJ</label>
                    <p className="text-sm font-mono">{currentNote.cpfCnpj || '---'}</p>
                  </div>
                  <div>
                    <label className="text-[9px] text-zinc-600 uppercase font-bold">WhatsApp</label>
                    <p className="text-sm font-mono">{currentNote.whatsapp || '---'}</p>
                  </div>
                </div>
              </div>

              <div className="card">
                <h3 className="label-tech text-brand">Veículo</h3>
                <p className="text-xl font-bold uppercase opacity-80">{currentNote.vehicleNameColor || 'NÃO INFORMADO'}</p>
                <p className="text-3xl font-black font-mono tracking-widest text-white mt-1">{currentNote.plate || '---'}</p>
              </div>
            </div>

            <div className="card">
              <h3 className="label-tech text-brand mb-4">Serviços e Peças</h3>
              <div className="space-y-4">
                {currentNote.pieces.filter(p => p.selected).length === 0 ? (
                  <p className="text-zinc-600 italic text-sm">Nenhuma peça selecionada.</p>
                ) : (
                  currentNote.pieces.filter(p => p.selected).map(piece => (
                    <div key={piece.id} className="border-l-2 border-brand pl-4 py-1 space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="font-black text-[11px] uppercase tracking-widest">{piece.label}</span>
                        {piece.audioBlob && (
                          <button 
                            onClick={() => {
                              const audio = new Audio(piece.audioBlob);
                              audio.play();
                            }}
                            className="bg-brand/10 text-brand p-1.5 rounded"
                          >
                            <Play size={14} className="fill-current" />
                          </button>
                        )}
                      </div>
                      <p className="text-xs text-zinc-400">{piece.description || '(Sem descrição textual)'}</p>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="bg-brand p-6 rounded-xl text-black">
              <h3 className="text-[10px] font-black uppercase tracking-widest mb-4">Resumo Financeiro</h3>
              <div className="space-y-2 text-xs font-bold uppercase opacity-80 mb-4">
                {currentNote.includePartsValue && (
                  <div className="flex justify-between">
                    <span>Peças</span>
                    <span>R$ {currentNote.partsValue.toFixed(2)}</span>
                  </div>
                )}
                {currentNote.includeLaborValue && (
                  <div className="flex justify-between">
                    <span>Mão de Obra</span>
                    <span>R$ {currentNote.laborValue.toFixed(2)}</span>
                  </div>
                )}
                {currentNote.includeMaterialsValue && (
                  <div className="flex justify-between">
                    <span>Materiais</span>
                    <span>R$ {currentNote.materialsValue.toFixed(2)}</span>
                  </div>
                )}
              </div>
              <div className="pt-4 border-t border-black/20 flex justify-between items-end">
                <span className="text-[10px] font-black uppercase opacity-60">Total</span>
                <span className="text-3xl font-black italic tracking-tighter">
                  R$ {currentNote.totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>

            {currentNote.observations && (
              <div className="card">
                <h3 className="label-tech text-brand mb-2">Observações Gerais</h3>
                <p className="text-xs text-zinc-400 whitespace-pre-wrap">{currentNote.observations}</p>
              </div>
            )}

            <div className="grid grid-cols-1 gap-2 pt-4">
              <button onClick={generatePDF} className="btn-primary flex items-center justify-center gap-2">
                <FileText size={18} strokeWidth={3} /> GERAR PDF
              </button>
              <button 
                onClick={() => {
                  const message = `*OFICINA NOTES - ORDEM DE SERVIÇO*\n\n*CLIENTE:* ${currentNote.customerName}\n*VEÍCULO:* ${currentNote.vehicleNameColor}\n*PLACA:* ${currentNote.plate}\n*TOTAL:* R$ ${currentNote.totalValue.toFixed(2)}`;
                  window.open(`https://wa.me/${currentNote.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`, '_blank');
                }}
                className="bg-[#25D366] text-black font-black uppercase tracking-widest text-[10px] py-4 rounded flex items-center justify-center gap-2"
              >
                <Play size={18} className="fill-current" /> SHARE WHATSAPP
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="p-4 space-y-6">
          <header className="flex items-center gap-4 py-2">
            <button onClick={() => setView('list')} className="p-2 hover:bg-zinc-800 rounded-full">
              <ArrowLeft size={24} />
            </button>
            <h2 className="text-2xl font-bold">
              {step === 1 ? 'Dados Básicos' : 
               step === 2 ? 'Peças' : 
               step === 3 ? 'Detalhes' : 
               step === 4 ? 'Financeiro' : 'Resumo'}
            </h2>
          </header>

          <div className="flex gap-1 mb-8">
            {[1, 2, 3, 4, 5].map(s => (
              <div 
                key={s} 
                className={`h-1.5 flex-1 rounded-full ${step >= s ? 'bg-brand' : 'bg-zinc-800'}`}
              />
            ))}
          </div>

          <AnimatePresence mode="wait">
            {step === 1 && (
              <motion.div 
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                <div className="card">
                  <h2 className="text-xs font-black text-brand uppercase mb-4 flex items-center gap-2">
                    <span className="w-1 h-3 bg-brand rounded-full"></span>DADOS DO CLIENTE
                  </h2>
                  <div className="space-y-4">
                    <div>
                      <label className="label-tech">Nome Completo</label>
                      <input 
                        type="text" 
                        value={currentNote.customerName}
                        onChange={e => setCurrentNote({ ...currentNote, customerName: e.target.value })}
                        className="input-field" 
                        placeholder="NOME DO CLIENTE"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="label-tech">CPF / CNPJ</label>
                        <input 
                          type="text" 
                          value={currentNote.cpfCnpj}
                          onChange={e => setCurrentNote({ ...currentNote, cpfCnpj: e.target.value })}
                          className="input-field" 
                          placeholder="000.000.000-00"
                        />
                      </div>
                      <div>
                        <label className="label-tech">WhatsApp</label>
                        <input 
                          type="tel" 
                          value={currentNote.whatsapp}
                          onChange={e => setCurrentNote({ ...currentNote, whatsapp: e.target.value })}
                          className="input-field" 
                          placeholder="(00) 00000-0000"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="card">
                  <h2 className="text-xs font-black text-brand uppercase mb-4 flex items-center gap-2">
                    <span className="w-1 h-3 bg-brand rounded-full"></span>DETALHES DO VEÍCULO
                  </h2>
                  <div className="space-y-4">
                    <div>
                      <label className="label-tech">Modelo - Cor</label>
                      <input 
                        type="text" 
                        value={currentNote.vehicleNameColor}
                        onChange={e => setCurrentNote({ ...currentNote, vehicleNameColor: e.target.value })}
                        className="input-field" 
                        placeholder="EX: GOLF - CINZA"
                      />
                    </div>
                    <div>
                      <label className="label-tech">Placa do Veículo</label>
                      <input 
                        type="text" 
                        value={currentNote.plate}
                        onChange={e => setCurrentNote({ ...currentNote, plate: e.target.value.toUpperCase() })}
                        className="input-field font-mono" 
                        placeholder="ABC-1E23"
                      />
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {step === 2 && (
              <motion.div 
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-4"
              >
                <h2 className="text-xs font-black text-brand uppercase mb-4 flex items-center gap-2">
                  <span className="w-1 h-3 bg-brand rounded-full"></span>CHECKLIST DE LATARIA
                </h2>
                <div className="grid grid-cols-1 gap-2">
                  {currentNote.pieces.map(piece => (
                    <div 
                      key={piece.id}
                      onClick={() => updatePiece(piece.id, { selected: !piece.selected })}
                      className={`flex items-center gap-3 p-3 rounded border transition-all cursor-pointer ${
                        piece.selected ? 'bg-brand/10 border-brand text-white shadow-[0_0_10px_var(--color-brand-glow)]' : 'bg-black/40 border-zinc-900 text-zinc-500'
                      }`}
                    >
                      <input 
                        type="checkbox" 
                        checked={piece.selected} 
                        readOnly 
                        className="w-4 h-4 accent-brand bg-black"
                      />
                      <span className="text-[11px] font-black uppercase tracking-widest">{piece.label}</span>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {step === 3 && (
              <motion.div 
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                <h2 className="text-xs font-black text-brand uppercase mb-4 flex items-center gap-2">
                  <span className="w-1 h-3 bg-brand rounded-full"></span>NOTAS DE SERVIÇO
                </h2>
                {currentNote.pieces.filter(p => p.selected).length === 0 ? (
                  <div className="text-center py-10 text-zinc-600 italic">
                    Nenhuma peça selecionada na etapa anterior.
                  </div>
                ) : (
                  currentNote.pieces.filter(p => p.selected).map(piece => (
                    <div key={piece.id} className="card space-y-3">
                      <div className="flex justify-between items-center bg-black/40 -mx-4 -mt-4 p-3 mb-3 border-b border-zinc-800 rounded-t-xl">
                        <h3 className="font-black text-brand text-[11px] tracking-widest uppercase">{piece.label}</h3>
                        <div className="flex gap-2">
                           {isRecording === piece.id ? (
                            <button 
                              onClick={stopRecording}
                              className="bg-red-600 text-white p-1.5 rounded animate-pulse shadow-[0_0_10px_rgba(220,38,38,0.5)]"
                            >
                              <StopCircle size={16} strokeWidth={3} />
                            </button>
                           ) : (
                            <div className="flex gap-1">
                              <button 
                                onClick={() => startRecording(piece.id)}
                                className="bg-zinc-800 text-brand p-1.5 rounded hover:bg-zinc-700 transition-colors"
                                title="Gravar Áudio"
                              >
                                <Mic size={16} strokeWidth={3} />
                              </button>
                              <button 
                                onClick={() => startDictation(piece.id)}
                                className={`p-1.5 rounded transition-colors ${isListening === piece.id ? 'bg-brand text-black' : 'bg-zinc-800 text-brand hover:bg-zinc-700'}`}
                                title="Falar para escrever"
                              >
                                <FileText size={16} strokeWidth={3} />
                              </button>
                            </div>
                           )}
                           {piece.audioBlob && (
                             <div className="flex gap-1">
                               <button 
                                onClick={() => playAudio(piece.audioBlob!)}
                                className="bg-brand/20 text-brand p-1.5 rounded"
                               >
                                 <Play size={16} className="fill-current" />
                               </button>
                               <button 
                                onClick={() => updatePiece(piece.id, { audioBlob: undefined })}
                                className="bg-red-500/10 text-red-500 p-1.5 rounded"
                               >
                                 <Trash2 size={16} />
                               </button>
                             </div>
                           )}
                        </div>
                      </div>
                      <textarea 
                        className="bg-transparent border border-zinc-800 p-3 text-xs text-zinc-300 rounded focus:border-brand outline-none resize-none w-full min-h-[100px]"
                        placeholder="DESCREVA O REPARO OU GRAVE ÁUDIO..."
                        value={piece.description}
                        onChange={e => updatePiece(piece.id, { description: e.target.value })}
                      />
                    </div>
                  ))
                )}
              </motion.div>
            )}

            {step === 4 && (
              <motion.div 
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                <div className="bg-brand border border-brand/50 p-6 rounded-xl text-black">
                  <h2 className="text-xs font-black uppercase mb-4 tracking-widest italic flex items-center gap-2">
                    ORÇAMENTO FINAL
                  </h2>
                  <div className="space-y-3 mb-6">
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <input 
                            type="checkbox" 
                            id="incParts"
                            checked={currentNote.includePartsValue}
                            onChange={e => setCurrentNote({ ...currentNote, includePartsValue: e.target.checked })}
                            className="w-4 h-4 accent-black"
                          />
                          <label htmlFor="incParts" className="text-[10px] font-black uppercase">Peças</label>
                        </div>
                        {currentNote.includePartsValue && (
                          <div className="w-24">
                            <input 
                              type="number" 
                              step="0.01"
                              value={currentNote.partsValue || ''}
                              onChange={e => setCurrentNote({ ...currentNote, partsValue: e.target.value === '' ? 0 : Number(e.target.value) })}
                              className="w-full bg-transparent border-b border-black/30 text-xs font-bold font-mono py-1 rounded-none outline-none focus:border-black"
                            />
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <input 
                          type="checkbox" 
                          id="incLabor"
                          checked={currentNote.includeLaborValue}
                          onChange={e => setCurrentNote({ ...currentNote, includeLaborValue: e.target.checked })}
                          className="w-4 h-4 accent-black"
                        />
                        <label htmlFor="incLabor" className="text-[10px] font-black uppercase">Mão de Obra</label>
                      </div>
                      {currentNote.includeLaborValue && (
                        <div className="w-24">
                          <input 
                            type="number" 
                            step="0.01"
                            value={currentNote.laborValue || ''}
                            onChange={e => setCurrentNote({ ...currentNote, laborValue: e.target.value === '' ? 0 : Number(e.target.value) })}
                            className="w-full bg-transparent border-b border-black/30 text-xs font-bold font-mono py-1 rounded-none outline-none focus:border-black"
                          />
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <input 
                          type="checkbox" 
                          id="incMat"
                          checked={currentNote.includeMaterialsValue}
                          onChange={e => setCurrentNote({ ...currentNote, includeMaterialsValue: e.target.checked })}
                          className="w-4 h-4 accent-black"
                        />
                        <label htmlFor="incMat" className="text-[10px] font-black uppercase">Materiais</label>
                      </div>
                      {currentNote.includeMaterialsValue && (
                        <div className="w-24">
                          <input 
                            type="number" 
                            step="0.01"
                            value={currentNote.materialsValue || ''}
                            onChange={e => setCurrentNote({ ...currentNote, materialsValue: e.target.value === '' ? 0 : Number(e.target.value) })}
                            className="w-full bg-transparent border-b border-black/30 text-xs font-bold font-mono py-1 rounded-none outline-none focus:border-black"
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="pt-4 border-t border-black/20">
                    <div className="flex justify-between items-end">
                      <span className="text-[10px] font-black uppercase opacity-60">Valor total</span>
                      <span className="text-3xl font-black italic tracking-tighter">
                        R$ {totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="card">
                  <h2 className="text-xs font-black text-brand uppercase mb-4 flex items-center gap-2">
                    <span className="w-1 h-3 bg-brand rounded-full"></span>OBSERVAÇÕES GERAIS
                  </h2>
                  <textarea 
                    className="bg-black border border-zinc-800 p-3 text-xs text-zinc-300 rounded focus:border-brand outline-none resize-none w-full min-h-[100px] mt-2"
                    placeholder="OUTROS ITENS OU OBSERVAÇÕES..."
                    value={currentNote.observations}
                    onChange={e => setCurrentNote({ ...currentNote, observations: e.target.value })}
                  />
                </div>
              </motion.div>
            )}

            {step === 5 && (
              <motion.div 
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-6"
              >
                <div className="card space-y-4">
                  <div className="border-b border-zinc-800 pb-4">
                    <h2 className="text-[10px] font-black text-brand uppercase mb-3 flex items-center gap-2">
                       <span className="w-1 h-3 bg-brand rounded-full"></span>CLIENTE
                    </h2>
                    <p className="font-black text-xl italic tracking-tighter uppercase">{currentNote.customerName || 'NÃO INFORMADO'}</p>
                    <p className="text-zinc-500 font-mono text-xs mt-1">{currentNote.whatsapp}</p>
                  </div>
                  <div className="border-b border-zinc-800 pb-4">
                    <h2 className="text-[10px] font-black text-brand uppercase mb-3 flex items-center gap-2">
                       <span className="w-1 h-3 bg-brand rounded-full"></span>VEÍCULO
                    </h2>
                    <p className="font-bold opacity-80 uppercase">{currentNote.vehicleNameColor}</p>
                    <p className="font-black text-2xl font-mono text-white tracking-widest mt-1">{currentNote.plate}</p>
                  </div>
                  <div>
                    <h2 className="text-[10px] font-black text-brand uppercase mb-3 flex items-center gap-2">
                       <span className="w-1 h-3 bg-brand rounded-full"></span>VALOR FINAL
                    </h2>
                    <div className="flex flex-col gap-1">
                      <div className="flex justify-between font-mono text-[10px] opacity-60 uppercase">
                        <span>Serviços & Peças:</span>
                        <span>R$ {totalValue.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between items-end">
                        <span className="text-3xl font-black italic tracking-tighter text-brand">
                          R$ {totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                    </div>
                  </div>
                  {currentNote.observations && (
                    <div className="pt-4 border-t border-zinc-800">
                      <h2 className="text-[10px] font-black text-brand uppercase mb-2 flex items-center gap-2">
                         <span className="w-1 h-3 bg-brand rounded-full"></span>OBSERVAÇÕES
                      </h2>
                      <p className="text-[11px] text-zinc-400 whitespace-pre-wrap">{currentNote.observations}</p>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-2">
                  <button 
                    onClick={generatePDF}
                    className="w-full flex items-center justify-center gap-2 btn-primary"
                  >
                    <FileText size={18} strokeWidth={3} />
                    GERAR PDF FINAL
                  </button>

                  <button 
                    onClick={() => {
                      const message = `*OFICINA NOTES - ORDEM DE SERVIÇO*\n\n*CLIENTE:* ${currentNote.customerName}\n*VEÍCULO:* ${currentNote.vehicleNameColor}\n*PLACA:* ${currentNote.plate}\n*TOTAL:* R$ ${totalValue.toFixed(2)}`;
                      window.open(`https://wa.me/${currentNote.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`, '_blank');
                    }}
                    className="w-full flex items-center justify-center gap-2 bg-[#25D366] text-black font-black uppercase tracking-widest text-[10px] py-4 rounded transition-all active:scale-95"
                  >
                    <Play size={18} className="fill-current" />
                    SHARE WHATSAPP
                  </button>

                  <button 
                    onClick={exportJSON}
                    className="w-full flex items-center justify-center gap-2 btn-secondary"
                  >
                    <Download size={18} strokeWidth={3} />
                    EXPORTAR (.JSON)
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <footer className="fixed bottom-0 left-0 right-0 p-4 bg-black/90 backdrop-blur-xl border-t border-zinc-900 flex gap-4 max-w-lg mx-auto z-50">
            {step > 1 && (
              <button 
                onClick={() => setStep(s => s - 1)}
                className="flex-1 btn-secondary flex items-center justify-center gap-2"
              >
                <ChevronLeft size={16} strokeWidth={3} /> VOLTAR
              </button>
            )}
            {step < 5 ? (
              <button 
                onClick={() => setStep(s => s + 1)}
                className="flex-[2] btn-primary flex items-center justify-center gap-2"
              >
                PRÓXIMO <ChevronRight size={16} strokeWidth={3} />
              </button>
            ) : (
              <button 
                onClick={saveCurrentNote}
                className="flex-[2] btn-primary flex items-center justify-center gap-2"
              >
                FINALIZAR <Check size={16} strokeWidth={3} />
              </button>
            )}
          </footer>
        </div>
      )}
    </div>
  );
}
