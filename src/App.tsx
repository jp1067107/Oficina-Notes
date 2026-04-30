/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { GoogleGenAI } from "@google/genai";
import { 
  Plus, 
  FileText, 
  Search, 
  ChevronRight, 
  ChevronLeft, 
  Check, 
  StopCircle, 
  Trash2, 
  Download, 
  ArrowLeft,
  X,
  Play,
  Square,
  Edit2,
  LogOut,
  LogIn,
  Loader2,
  Calendar,
  Clock,
  AudioLines,
  History,
  DollarSign,
  PlusCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { CAR_PIECES, SERVICE_STATUS_LABELS } from './constants';
import { NoteData, ServicePiece, MaterialItem, ServiceStatus } from './types';
import PWAPrompt from './components/PWAPrompt';
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
  getDoc,
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
  status: 'em_espera',
  arrivalDate: new Date().toISOString().split('T')[0],
  pieces: CAR_PIECES.map(p => ({ ...p, selected: false, description: '' })),
  includePartsValue: false,
  partsValue: 0,
  includeLaborValue: false,
  laborValue: 0,
  includeMaterialsValue: false,
  materialsValue: 0,
  onlyTotalValue: false,
  totalValue: 0,
  materialItems: [],
  observations: '',
  isDraft: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

// Main Application Component
// Note: Transcription via AI requires a valid GEMINI_API_KEY set in the environment.
// Deployment Note: If deployment fails with CustomOrgPolicyException, please check Org Policies for run.managed.requireInvokerIam.
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isVerifyingSubscription, setIsVerifyingSubscription] = useState(false);
  const [subscriptionError, setSubscriptionError] = useState<string | null>(null);
  const [view, setView] = useState<'list' | 'editor' | 'details'>('list');
  const [notes, setNotes] = useState<NoteData[]>([]);
  const [currentNote, setCurrentNote] = useState<NoteData>(initialNote());
  const [step, setStep] = useState(1);
  const [isRecording, setIsRecording] = useState<string | null>(null);
  const [isListening, setIsListening] = useState<string | null>(null);
  const [isTranscribing, setIsTranscribing] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const [isIframe, setIsIframe] = useState(false);
  const [activeTab, setActiveTab] = useState<ServiceStatus | 'all'>('em_espera');
  const [statusSelectorId, setStatusSelectorId] = useState<string | null>(null);

  const handleUpdateStatus = async (note: NoteData, newStatus: ServiceStatus) => {
    const updatedNote = { ...note, status: newStatus, updatedAt: new Date().toISOString() };
    try {
      await setDoc(doc(db, 'notes', note.id), updatedNote);
      setStatusSelectorId(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `notes/${note.id}`);
    }
  };

  const transcribeAudio = async (base64Audio: string, mimeType: string = "audio/webm"): Promise<string> => {
    if (!process.env.GEMINI_API_KEY) {
      console.error('Configuração ausente: GEMINI_API_KEY não encontrada no ambiente.');
      return '';
    }
    
    try {
      // Remove base64 prefix if exists
      const base64Data = base64Audio.includes(',') ? base64Audio.split(',')[1] : base64Audio;
      
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          {
            text: "Você é um especialista em transcrição de áudio para oficinas mecânicas. Transcreva o áudio de forma clara, técnica e profissional em português. Retorne apenas o texto transcrito. Se houver apenas ruído ou silêncio, retorne uma string vazia."
          },
          {
            inlineData: {
              mimeType: mimeType,
              data: base64Data
            }
          }
        ]
      });
      
      const text = response.text?.trim() || '';
      console.log('Transcrição concluída:', text);
      return text;
    } catch (error) {
      console.error('Erro na transcrição via Gemini:', error);
      return '';
    }
  };

  const calculateTotal = (note: NoteData) => {
    if (note.onlyTotalValue) return Number(note.totalValue) || 0;
    
    let total = 0;
    if (note.includePartsValue) total += Number(note.partsValue) || 0;
    if (note.includeLaborValue) total += Number(note.laborValue) || 0;
    
    if (note.includeMaterialsValue) {
      const itemsSum = (note.materialItems || []).reduce((acc, item) => acc + (Number(item.price) || 0), 0);
      total += itemsSum > 0 ? itemsSum : (Number(note.materialsValue) || 0);
    }
    
    return total;
  };

  const saveDraft = useCallback(async (note: NoteData) => {
    if (!user) return;
    const now = new Date().toISOString();
    const total = calculateTotal(note);

    const noteToSave: NoteData = { 
      ...note, 
      totalValue: total,
      updatedAt: now,
      userId: user.uid,
      isDraft: true 
    };
    
    try {
      await setDoc(doc(db, 'notes', noteToSave.id), noteToSave);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `notes/${noteToSave.id}`);
    }
  }, [user]);

  // Auto-save draft
  useEffect(() => {
    if (view !== 'editor' || !user) return;

    const timer = setTimeout(() => {
      saveDraft(currentNote);
    }, 1500); // Faster auto-save

    return () => clearTimeout(timer);
  }, [currentNote, user, view, saveDraft]);

  // Auto-save draft on visibility change (close/leave)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && view === 'editor' && user) {
        saveDraft(currentNote);
      }
    };

    window.addEventListener('visibilitychange', handleVisibilityChange);
    return () => window.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [currentNote, user, view, saveDraft]);

  // Environment Check
  useEffect(() => {
    setIsIframe(window.self !== window.top);
  }, []);

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
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      if (u) {
        setIsVerifyingSubscription(true);
        try {
          const emailBusca = (u.email || '').toLowerCase().trim();
          const subDoc = await getDoc(doc(db, 'assinaturas', emailBusca));
          const subData = subDoc.data();
          
          if (!subDoc.exists() || subData?.status !== 'ativo') {
            const errorDetails = `Acesso Negado!\n\nTentamos buscar o e-mail: ${emailBusca}\nEncontrado no Banco: ${subDoc.exists() ? 'Sim' : 'Não'}\nStatus da Assinatura: ${subData?.status || 'N/A'}\n\nVerifique se o e-mail no Firestore está escrito exatamente como acima (em minúsculas).`;
            alert(errorDetails);
            await signOut(auth);
            setSubscriptionError('Acesso Negado: Sua assinatura não está ativa ou não foi encontrada. Contate o suporte.');
            setUser(null);
          } else {
            setUser(u);
            setSubscriptionError(null);
            setCurrentNote(initialNote(u.uid));
          }
        } catch (error) {
          console.error('Error verifying subscription:', error);
          await signOut(auth);
          setSubscriptionError('Erro ao verificar assinatura. Tente novamente.');
          setUser(null);
        } finally {
          setIsVerifyingSubscription(false);
        }
      } else {
        setUser(null);
      }
      setLoading(false);
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
      const fetchedNotes = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          ...data,
          id: doc.id,
          userId: data.userId || user.uid,
          customerName: data.customerName || '',
          vehicleNameColor: data.vehicleNameColor || '',
          plate: data.plate || '',
          cpfCnpj: data.cpfCnpj || '',
          whatsapp: data.whatsapp || '',
          materialItems: data.materialItems || [],
          pieces: data.pieces || [],
          status: data.status || 'em_espera',
          arrivalDate: data.arrivalDate || data.deliveryDate || '',
          includePartsValue: data.includePartsValue ?? false,
          partsValue: data.partsValue ?? 0,
          includeLaborValue: data.includeLaborValue ?? false,
          laborValue: data.laborValue ?? 0,
          includeMaterialsValue: data.includeMaterialsValue ?? false,
          materialsValue: data.materialsValue ?? 0,
          onlyTotalValue: data.onlyTotalValue ?? false,
          totalValue: data.totalValue ?? 0,
          observations: data.observations || '',
          isDraft: data.isDraft ?? false,
          createdAt: data.createdAt || new Date().toISOString(),
          updatedAt: data.updatedAt || new Date().toISOString(),
        } as NoteData;
      });
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
    if (note.isDraft) {
      setStep(1);
      setView('editor');
    } else {
      setView('details');
    }
  };

  const handleDeleteNote = async (id: string, e: React.MouseEvent) => {
    if (e) e.stopPropagation();
    
    if (!id) {
      alert('Erro: ID da nota não encontrado.');
      return;
    }

    if (window.confirm('Tem certeza que deseja excluir esta nota?')) {
      const path = `notes/${id}`;
      try {
        await deleteDoc(doc(db, 'notes', id));
        if (view === 'details') setView('list');
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, path);
      }
    }
  };

  const saveCurrentNote = async () => {
    if (!user) return;
    const now = new Date().toISOString();
    const total = calculateTotal(currentNote);
    
    const noteToSave: NoteData = { 
      ...currentNote, 
      totalValue: total,
      updatedAt: now,
      userId: user.uid,
      isDraft: false
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
  const handleAdjustStatus = async (note: NoteData, direction: number, cycle: boolean = false) => {
    const statuses: ServiceStatus[] = ['em_espera', 'na_oficina', 'finalizado'];
    const currentIndex = statuses.indexOf(note.status);
    let nextIndex = currentIndex + direction;
    
    if (cycle) {
      nextIndex = (currentIndex + direction + statuses.length) % statuses.length;
    }
    
    if (nextIndex >= 0 && nextIndex < statuses.length) {
      const newStatus = statuses[nextIndex];
      const updatedNote = { ...note, status: newStatus, updatedAt: new Date().toISOString() };
      
      try {
        await setDoc(doc(db, 'notes', note.id), updatedNote);
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, `notes/${note.id}`);
      }
    }
  };

  const startRecording = async (pieceId: string) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') 
        ? 'audio/webm' 
        : MediaRecorder.isTypeSupported('audio/mp4') 
          ? 'audio/mp4' 
          : 'audio/aac';
          
      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = async () => {
          try {
            const base64Audio = reader.result as string;
            
            if (pieceId === 'observations') {
              setIsTranscribing('observations');
              const transcription = await transcribeAudio(base64Audio, mimeType);
              if (transcription) {
                setCurrentNote(prev => ({
                  ...prev,
                  observations: prev.observations + (prev.observations ? ' ' : '') + transcription
                }));
              }
            } else {
              updatePiece(pieceId, { audioBlob: base64Audio });
              setIsTranscribing(pieceId);
              const transcription = await transcribeAudio(base64Audio, mimeType);
              if (transcription) {
                setCurrentNote(prev => ({
                  ...prev,
                  pieces: prev.pieces.map(p => {
                    if (p.id === pieceId) {
                      const currentDesc = p.description || '';
                      return {
                        ...p,
                        description: currentDesc + (currentDesc ? ' ' : '') + transcription
                      };
                    }
                    return p;
                  })
                }));
              }
            }
          } catch (error) {
            console.error('Erro ao processar áudio gravado:', error);
          } finally {
            setIsTranscribing(null);
          }
        };
      };

      mediaRecorder.start();
      setIsRecording(pieceId);
    } catch (err) {
      console.error('Error recording audio:', err);
      alert('Não foi possível acessar o microfone ou formato de áudio não suportado.');
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

  const filteredNotes = notes
    .filter(n => {
      const matchesSearch = n.customerName.toLowerCase().includes(searchTerm.toLowerCase()) || 
                           n.plate.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesTab = activeTab === 'all' || n.status === activeTab;
      return matchesSearch && matchesTab;
    })
    .sort((a, b) => {
      if (a.isDraft && !b.isDraft) return -1;
      if (!a.isDraft && b.isDraft) return 1;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

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

    // Header with better styling
    doc.setFillColor(0, 0, 0);
    doc.rect(0, 0, 210, 40, 'F');
    
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(24);
    doc.setFont('helvetica', 'bold');
    doc.text('OFICINA NOTES', margin, 25);
    
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text('ORDEM DE SERVIÇO / ORÇAMENTO', margin, 32);
    
    doc.setTextColor(150, 150, 150);
    doc.text(`EMITIDO EM: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, 190, 25, { align: 'right' });
    
    y = 55;
    doc.setTextColor(0, 0, 0);
    
    // Customer and Vehicle Section
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('DADOS DO CLIENTE E VEÍCULO', margin, y);
    doc.line(margin, y + 2, 190, y + 2);
    y += 10;
    
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`NOME: ${currentNote.customerName || '---'}`, margin, y);
    doc.text(`WHATSAPP: ${currentNote.whatsapp || '---'}`, 120, y);
    y += 7;
    doc.text(`CPF/CNPJ: ${currentNote.cpfCnpj || '---'}`, margin, y);
    y += 10;
    
    doc.setFillColor(245, 245, 245);
    doc.rect(margin, y, 170, 15, 'F');
    y += 10;
    doc.setFont('helvetica', 'bold');
    doc.text(`VEÍCULO: ${currentNote.vehicleNameColor || '---'}`, margin + 5, y);
    doc.text(`PLACA: ${currentNote.plate || '---'}`, 120, y);
    y += 10;

    // Services Section
    const selectedPieces = currentNote.pieces.filter(p => p.selected);
    if (selectedPieces.length > 0) {
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text('SERVIÇOS EXECUTADOS / NOTAS', margin, y);
      doc.line(margin, y + 2, 190, y + 2);
      y += 10;
      
      doc.setFontSize(10);
      selectedPieces.forEach(p => {
        if (y > 270) { doc.addPage(); y = 20; }
        doc.setFont('helvetica', 'bold');
        doc.text(`> ${p.label.toUpperCase()}`, margin, y);
        y += 6;
        doc.setFont('helvetica', 'normal');
        const desc = doc.splitTextToSize(p.description || '(Sem descrição detalhada)', 160);
        doc.text(desc, margin + 5, y);
        y += desc.length * 5 + 5;
      });
    }

    // Material Items Section
    if ((currentNote.materialItems?.length || 0) > 0 && !currentNote.onlyTotalValue) {
      if (y > 240) { doc.addPage(); y = 20; }
      y += 5;
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text('LISTAGEM DE PEÇAS E MATERIAIS', margin, y);
      doc.line(margin, y + 2, 190, y + 2);
      y += 10;
      
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.text('DESCRIÇÃO', margin, y);
      doc.text('VALOR UNIT.', 190, y, { align: 'right' });
      y += 6;
      doc.setFont('helvetica', 'normal');
      
      (currentNote.materialItems || []).forEach(item => {
        if (y > 275) { doc.addPage(); y = 20; }
        doc.text(`${item.name}`, margin, y);
        doc.text(`R$ ${item.price.toFixed(2)}`, 190, y, { align: 'right' });
        y += 5;
        doc.line(margin, y - 1, 190, y - 1, 'S');
        y += 2;
      });
      y += 5;
    }

    // Financial Section
    if (y > 240) { doc.addPage(); y = 20; }
    y += 10;
    doc.setFillColor(0, 0, 0);
    doc.rect(margin, y, 170, 30, 'F');
    y += 10;
    
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    
    if (currentNote.onlyTotalValue) {
      doc.text(`RESUMO: VALOR TOTAL FECHADO`, margin + 5, y);
    } else {
      const parts = currentNote.includePartsValue ? `Peças: R$ ${currentNote.partsValue.toFixed(2)}` : '';
      const labor = currentNote.includeLaborValue ? `Mão de Obra: R$ ${currentNote.laborValue.toFixed(2)}` : '';
      const materials = currentNote.includeMaterialsValue ? `Materiais: R$ ${Number(currentNote.materialsValue).toFixed(2)}` : '';
      doc.text(`${parts} ${parts && labor ? ' | ' : ''} ${labor} ${ (parts || labor) && materials ? ' | ' : ''} ${materials}`, margin + 5, y);
    }
    
    y += 10;
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text(`TOTAL GERAL: R$ ${totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, margin + 5, y);
    
    doc.setTextColor(0, 0, 0);
    if (currentNote.observations) {
      y += 25;
      if (y > 270) { doc.addPage(); y = 20; }
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text('OBSERVAÇÕES ADICIONAIS', margin, y);
      y += 8;
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      const obs = doc.splitTextToSize(currentNote.observations, 170);
      doc.text(obs, margin, y);
    }

    // Footer signature
    doc.setFontSize(8);
    doc.text('Assinatura do Responsável', 50, 285);
    doc.line(20, 283, 80, 283);
    doc.text('Assinatura do Cliente', 140, 285);
    doc.line(110, 283, 170, 283);

    doc.save(`os_${currentNote.plate || 'nota'}_${format(new Date(), 'yyyyMMdd')}.pdf`);
  };

  const totalValue = currentNote.onlyTotalValue 
    ? currentNote.totalValue 
    : (
      (currentNote.includePartsValue ? Number(currentNote.partsValue) : 0) +
      (currentNote.includeLaborValue ? Number(currentNote.laborValue) : 0) +
      (currentNote.includeMaterialsValue ? Number(currentNote.materialsValue) : 0)
    );

  const handleLogin = async () => {
    setSubscriptionError(null);
    try {
      const result = await signInWithGoogle();
      const u = result.user;
      
      setIsVerifyingSubscription(true);
      const emailBusca = (u.email || '').toLowerCase().trim();
      const subDoc = await getDoc(doc(db, 'assinaturas', emailBusca));
      const subData = subDoc.data();
      
      if (!subDoc.exists() || subData?.status !== 'ativo') {
        const errorDetails = `Acesso Negado!\n\nTentamos buscar o e-mail: ${emailBusca}\nEncontrado no Banco: ${subDoc.exists() ? 'Sim' : 'Não'}\nStatus da Assinatura: ${subData?.status || 'N/A'}\n\nVerifique se o e-mail no Firestore está escrito exatamente como acima (em minúsculas).`;
        alert(errorDetails);
        await signOut(auth);
        setSubscriptionError('Acesso Negado: Sua assinatura não está ativa ou não foi encontrada. Contate o suporte.');
      } else {
        setUser(u);
        setCurrentNote(initialNote(u.uid));
      }
    } catch (error: any) {
      if (error.code === 'auth/popup-closed-by-user' || error.code === 'auth/cancelled-popup-request') {
        return;
      }
      console.error('Erro ao fazer login:', error);
      setSubscriptionError('Erro ao realizar login. Tente novamente.');
    } finally {
      setIsVerifyingSubscription(false);
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

        <AnimatePresence>
          {subscriptionError && (
            <motion.div 
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="w-full max-w-sm mb-6 p-4 bg-red-500/10 border border-red-500/50 rounded-xl"
            >
              <p className="text-red-500 text-xs font-bold text-center uppercase tracking-tight">
                {subscriptionError}
              </p>
            </motion.div>
          )}
        </AnimatePresence>
        
        <button 
          onClick={handleLogin}
          disabled={isVerifyingSubscription}
          className="w-full max-w-sm flex items-center justify-center gap-4 bg-white text-black font-black uppercase tracking-widest text-xs py-4 rounded-xl hover:bg-zinc-200 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isVerifyingSubscription ? (
            <>
              <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin"></div>
              <span>Verificando assinatura...</span>
            </>
          ) : (
            <>
              <LogIn size={20} />
              <span>Entrar com Google</span>
            </>
          )}
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

          <div className="flex bg-zinc-900 border border-zinc-800 p-1 rounded-xl overflow-hidden shadow-inner">
            {(['all', 'em_espera', 'na_oficina', 'finalizado'] as (ServiceStatus | 'all')[]).map((status) => {
              const count = status === 'all' ? notes.length : notes.filter(n => n.status === status).length;
              const isActive = activeTab === status;
              return (
                <button
                  key={status}
                  onClick={() => setActiveTab(status)}
                  className={`flex-1 flex flex-col items-center py-2.5 rounded-lg transition-all relative ${
                    isActive 
                      ? 'bg-zinc-800 text-brand shadow-[0_0_15px_rgba(34,197,94,0.1)]' 
                      : 'text-zinc-600 hover:text-zinc-400'
                  }`}
                >
                  <span className={`text-[9px] font-black uppercase tracking-tighter mb-0.5 ${isActive ? 'text-brand' : 'text-zinc-500'}`}>
                    {status === 'all' ? 'Todos' : SERVICE_STATUS_LABELS[status]}
                  </span>
                  <span className={`text-base font-black font-mono leading-none ${isActive ? 'text-white' : 'text-zinc-700'}`}>
                    {count.toString().padStart(2, '0')}
                  </span>
                  {isActive && (
                    <motion.div 
                      layoutId="activeTabIndicator" 
                      className="absolute -bottom-1 w-1 h-1 bg-brand rounded-full shadow-[0_0_5px_#22c55e]" 
                    />
                  )}
                </button>
              );
            })}
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
                  className={`card group cursor-pointer active:scale-[0.98] transition-all relative overflow-hidden
                    ${note.isDraft ? 'border-amber-500/50 bg-amber-500/5 shadow-[0_0_20px_rgba(245,158,11,0.1)]' : 'border-zinc-800 hover:border-brand'}`}
                >
                  {note.isDraft && (
                    <motion.div 
                      className="absolute inset-0 border-2 border-amber-500/20 rounded-xl pointer-events-none"
                      animate={{ opacity: [0.2, 0.5, 0.2] }}
                      transition={{ duration: 2, repeat: Infinity }}
                    />
                  )}
                  <div className="flex justify-between items-start relative z-10">
                    <div className="flex items-center gap-3">
                      <div className={`w-1.5 h-8 rounded-full ${note.isDraft ? 'bg-amber-500 animate-pulse' : 'bg-brand'}`}></div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-black text-xl italic tracking-tighter uppercase">{note.plate || 'SEM PLACA'}</h3>
                          {note.isDraft && (
                            <span className="text-[8px] bg-amber-500 text-black px-1.5 py-0.5 rounded font-black uppercase tracking-tighter">RASCUNHO</span>
                          )}
                        </div>
                        <p className="text-zinc-500 text-[10px] uppercase font-bold tracking-widest">{note.customerName || 'Cliente não identificado'}</p>
                        <div className="flex items-center gap-1 mt-1">
                          <p className={`${note.isDraft ? 'text-amber-500' : 'text-brand'} text-xs font-mono font-bold whitespace-nowrap`}>R$ {note.totalValue?.toFixed(2)}</p>
                          <div className="h-4 w-[1px] bg-zinc-800 mx-1"></div>
                          <div className="relative">
                            <span 
                              onClick={(e) => {
                                e.stopPropagation();
                                setStatusSelectorId(statusSelectorId === note.id ? null : note.id);
                              }}
                              className={`text-[8px] font-black uppercase px-2 py-0.5 rounded cursor-pointer transition-all hover:brightness-110 active:scale-95 flex items-center gap-1 ${
                                note.status === 'finalizado' ? 'bg-green-500 text-black' :
                                note.status === 'na_oficina' ? 'bg-blue-500 text-white' : 'bg-zinc-800 text-zinc-400'
                              }`}
                            >
                              {SERVICE_STATUS_LABELS[note.status]}
                            </span>

                            <AnimatePresence>
                              {statusSelectorId === note.id && (
                                <>
                                  <div 
                                    className="fixed inset-0 z-40" 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setStatusSelectorId(null);
                                    }}
                                  />
                                  <motion.div
                                    initial={{ opacity: 0, scale: 0.9, y: 10 }}
                                    animate={{ opacity: 1, scale: 1, y: 0 }}
                                    exit={{ opacity: 0, scale: 0.9, y: 10 }}
                                    className="absolute left-0 bottom-full mb-2 z-50 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl p-1 min-w-[120px] overflow-hidden"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    {(['em_espera', 'na_oficina', 'finalizado'] as ServiceStatus[]).map((s) => (
                                      <button
                                        key={s}
                                        onClick={() => handleUpdateStatus(note, s)}
                                        className={`w-full text-left px-3 py-2 rounded-lg text-[10px] font-bold uppercase transition-colors flex items-center justify-between ${
                                          note.status === s ? 'bg-zinc-800 text-brand' : 'text-zinc-400 hover:bg-zinc-800 hover:text-white'
                                        }`}
                                      >
                                        {SERVICE_STATUS_LABELS[s]}
                                        {note.status === s && <Check size={10} />}
                                      </button>
                                    ))}
                                  </motion.div>
                                </>
                              )}
                            </AnimatePresence>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                       <span className="text-[9px] bg-zinc-800 px-2 py-0.5 rounded text-zinc-400 font-black tracking-widest">
                        {format(new Date(note.updatedAt), 'dd/MM/yy')}
                      </span>
                      <button 
                        type="button"
                        onClick={(e) => handleDeleteNote(note.id, e)}
                        className="text-zinc-600 hover:text-red-500 p-2 transition-colors relative z-30"
                      >
                        <Trash2 size={18} className="pointer-events-none" />
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
            <div className="flex items-center gap-2">
              <button 
                type="button"
                onClick={(e) => handleDeleteNote(currentNote.id, e)}
                className="p-3 text-zinc-500 hover:text-red-500 transition-colors relative z-30"
                title="Excluir"
              >
                <Trash2 size={20} className="pointer-events-none" />
              </button>
              <button 
                type="button"
                onClick={() => {
                  setStep(1);
                  setView('editor');
                }}
                className="p-3 bg-zinc-800 text-brand rounded hover:bg-zinc-700 transition-colors"
                title="Editar"
              >
                <Edit2 size={20} strokeWidth={3} />
              </button>
            </div>
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
                <div className="flex justify-between items-start mb-2">
                  <h3 className="label-tech text-brand">Veículo</h3>
                  <div className={`px-2 py-1 rounded text-[9px] font-black uppercase ${
                    currentNote.status === 'finalizado' ? 'bg-green-500 text-black' :
                    currentNote.status === 'na_oficina' ? 'bg-blue-500 text-white' : 'bg-zinc-800 text-zinc-400'
                  }`}>
                    {SERVICE_STATUS_LABELS[currentNote.status]}
                  </div>
                </div>
                <p className="text-xl font-bold uppercase opacity-80">{currentNote.vehicleNameColor || 'NÃO INFORMADO'}</p>
                <p className="text-3xl font-black font-mono tracking-widest text-white mt-1">{currentNote.plate || '---'}</p>
                {currentNote.arrivalDate && (
                  <div className="flex items-center gap-2 mt-3 text-zinc-500 text-[10px] uppercase font-bold">
                    <Calendar size={12} className="text-brand" />
                    <span>Chegada: {format(new Date(currentNote.arrivalDate + 'T12:00:00'), 'dd/MM/yyyy')}</span>
                  </div>
                )}
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

            <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-xl relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
                <DollarSign size={80} />
              </div>
              <h3 className="text-[10px] font-black uppercase tracking-widest mb-4 text-zinc-500 flex items-center gap-2">
                <span className="w-1 h-3 bg-brand rounded-full"></span>Resumo Financeiro
              </h3>
              <div className="space-y-2 text-xs font-bold uppercase opacity-80 mb-4 border-b border-zinc-800 pb-4">
                {currentNote.onlyTotalValue ? (
                  <div className="flex justify-between text-brand italic">
                    <span>Valor Fechado</span>
                    <span>R$ {currentNote.totalValue.toFixed(2)}</span>
                  </div>
                ) : (
                  <>
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
                  </>
                )}
              </div>
              
              {(currentNote.materialItems?.length || 0) > 0 && (
                <div className="space-y-1 mb-4 border-b border-zinc-800 pb-4">
                  <p className="text-[8px] text-zinc-600 mb-2 uppercase font-black">Detalhamento de Itens</p>
                  {(currentNote.materialItems || []).map(item => (
                    <div key={item.id} className="flex justify-between text-[10px] text-zinc-400">
                      <span>{item.name}</span>
                      <span className="font-mono">R$ {item.price.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex justify-between items-end">
                <span className="text-[10px] font-black uppercase text-zinc-500">Total Geral</span>
                <span className="text-3xl font-black italic tracking-tighter text-brand drop-shadow-[0_0_15px_rgba(34,197,94,0.3)]">
                  R$ {totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
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
                  const message = `*OFICINA NOTES - ORDEM DE SERVIÇO*\n\n*CLIENTE:* ${currentNote.customerName}\n*VEÍCULO:* ${currentNote.vehicleNameColor}\n*PLACA:* ${currentNote.plate}\n*TOTAL:* R$ ${totalValue.toFixed(2)}`;
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
            <button onClick={() => {
              saveDraft(currentNote);
              setView('list');
            }} className="p-2 hover:bg-zinc-800 rounded-full text-zinc-400">
              <ArrowLeft size={24} />
            </button>
            <div className="flex-1">
              <h2 className="text-xl font-bold">
                {step === 1 ? 'Dados Básicos' : 
                 step === 2 ? 'Peças' : 
                 step === 3 ? 'Detalhes' : 
                 step === 4 ? 'Financeiro' : 'Resumo'}
              </h2>
            </div>
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
                    <div className="grid grid-cols-2 gap-4">
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
                      <div>
                        <label className="label-tech">Data de Chegada</label>
                        <input 
                          type="date" 
                          value={currentNote.arrivalDate}
                          onChange={e => setCurrentNote({ ...currentNote, arrivalDate: e.target.value })}
                          className="input-field text-xs" 
                        />
                      </div>
                    </div>

                    <div>
                      <label className="label-tech">Status do Serviço</label>
                      <div className="flex gap-2 mt-2">
                        {(Object.keys(SERVICE_STATUS_LABELS) as ServiceStatus[]).map(statusKey => (
                          <button
                            key={statusKey}
                            onClick={() => setCurrentNote({ ...currentNote, status: statusKey })}
                            className={`flex-1 py-3 px-1 rounded border text-[9px] font-black uppercase tracking-tighter transition-all ${
                              currentNote.status === statusKey 
                                ? 'bg-brand border-brand text-black shadow-[0_0_10px_var(--color-brand-glow)]' 
                                : 'bg-black/40 border-zinc-800 text-zinc-500'
                            }`}
                          >
                            {SERVICE_STATUS_LABELS[statusKey]}
                          </button>
                        ))}
                      </div>
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
                           {isTranscribing === piece.id ? (
                            <div className="flex items-center gap-1 text-[10px] text-brand">
                              <Loader2 size={12} className="animate-spin" />
                              <span>...</span>
                            </div>
                           ) : isRecording === piece.id ? (
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
                                title="Gravar Áudio e Transcrever"
                              >
                                <AudioLines size={16} strokeWidth={3} />
                              </button>
                              <button 
                                onClick={() => startDictation(piece.id)}
                                className={`p-1.5 rounded transition-colors ${isListening === piece.id ? 'bg-brand text-black' : 'bg-zinc-800 text-brand hover:bg-zinc-700'}`}
                                title="Falar para escrever (Nativo)"
                              >
                                <FileText size={16} strokeWidth={3} />
                              </button>
                            </div>
                           )}
                           {piece.audioBlob && isTranscribing !== piece.id && (
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
                  <h2 className="text-xs font-black uppercase mb-4 tracking-widest italic flex items-center justify-between underline decoration-black/20 underline-offset-4">
                    ORÇAMENTO FINAL
                    <div className="flex items-center gap-2 no-underline">
                      <input 
                        type="checkbox" 
                        id="onlyTotal"
                        checked={currentNote.onlyTotalValue}
                        onChange={e => setCurrentNote({ ...currentNote, onlyTotalValue: e.target.checked })}
                        className="w-4 h-4 accent-black"
                      />
                      <label htmlFor="onlyTotal" className="text-[9px] font-black">APENAS TOTAL</label>
                    </div>
                  </h2>
                  
                  <div className="space-y-3 mb-6">
                    {!currentNote.onlyTotalValue ? (
                      <>
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
                      </>
                    ) : (
                      <div className="flex items-center justify-between bg-black/10 p-4 rounded-xl border border-black/10">
                        <label className="text-[10px] font-black uppercase">Valor Total do Serviço</label>
                        <div className="w-40">
                          <input 
                            type="number" 
                            step="0.01"
                            value={currentNote.totalValue || ''}
                            onChange={e => setCurrentNote({ ...currentNote, totalValue: e.target.value === '' ? 0 : Number(e.target.value) })}
                            className="w-full bg-transparent border-b-2 border-black/30 text-2xl font-black font-mono py-1 rounded-none outline-none focus:border-black text-right"
                            placeholder="0,00"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="pt-4 border-t border-black/20">
                    <div className="flex justify-between items-end">
                      <span className="text-[10px] font-black uppercase opacity-60">Valor total calculado</span>
                      <span className="text-3xl font-black italic tracking-tighter">
                        R$ {totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  </div>
                </div>

                {(currentNote.includePartsValue || currentNote.includeMaterialsValue) && !currentNote.onlyTotalValue && (
                  <div className="card border-t-4 border-t-brand">
                    <h2 className="text-[10px] font-black text-brand uppercase mb-4 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                         <span className="w-1 h-3 bg-brand rounded-full"></span>LISTA DE MATERIAIS / PEÇAS
                      </div>
                      <button 
                        onClick={() => {
                          const newItem: MaterialItem = { id: crypto.randomUUID(), name: '', price: 0 };
                          setCurrentNote({ ...currentNote, materialItems: [...currentNote.materialItems, newItem] });
                        }}
                        className="text-[10px] bg-brand text-black px-3 py-1.5 rounded font-black flex items-center gap-1.5 active:scale-95 transition-all shadow-lg"
                      >
                        <PlusCircle size={14} /> ADICIONAR ITEM
                      </button>
                    </h2>
                    
                    <div className="space-y-3">
                      {(currentNote.materialItems?.length || 0) === 0 ? (
                        <div className="p-8 border border-zinc-900 border-dashed rounded-xl text-center">
                          <p className="text-[10px] text-zinc-600 italic uppercase">Adicione itens para detalhar as peças ou materiais utilizados.</p>
                        </div>
                      ) : (
                        (currentNote.materialItems || []).map((item, idx) => (
                          <div key={item.id} className="flex gap-2 items-end group bg-black/40 p-2 rounded-lg border border-zinc-900 shadow-sm">
                            <div className="flex-1">
                              {idx === 0 && <label className="text-[8px] text-zinc-600 uppercase font-black mb-1 block">Item/Peça</label>}
                              <input 
                                type="text"
                                value={item.name}
                                placeholder="EX: LAMPADA H7"
                                onChange={e => {
                                  const newList = [...currentNote.materialItems];
                                  newList[idx].name = e.target.value.toUpperCase();
                                  setCurrentNote({ ...currentNote, materialItems: newList });
                                }}
                                className="w-full bg-transparent border-b border-zinc-800 text-xs py-2 outline-none focus:border-brand font-medium"
                              />
                            </div>
                            <div className="w-24">
                              {idx === 0 && <label className="text-[8px] text-zinc-600 uppercase font-black mb-1 block">Preço (R$)</label>}
                              <div className="relative">
                                <span className="absolute left-0 bottom-2 text-zinc-600 text-[10px]">R$</span>
                                <input 
                                  type="number"
                                  value={item.price || ''}
                                  placeholder="0,00"
                                  onChange={e => {
                                    const newList = [...currentNote.materialItems];
                                    newList[idx].price = e.target.value === '' ? 0 : Number(e.target.value);
                                    setCurrentNote({ ...currentNote, materialItems: newList });
                                  }}
                                  className="w-full bg-transparent border-b border-zinc-800 text-xs py-2 pl-5 outline-none focus:border-brand font-mono font-bold"
                                />
                              </div>
                            </div>
                            <button 
                              onClick={() => {
                                const newList = (currentNote.materialItems || []).filter(i => i.id !== item.id);
                                setCurrentNote({ ...currentNote, materialItems: newList });
                              }}
                              className="text-zinc-700 hover:text-red-500 p-2 opacity-50 group-hover:opacity-100 transition-all"
                            >
                              <X size={16} />
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}

                <div className="card">
                  <h2 className="text-xs font-black text-brand uppercase mb-4 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                       <span className="w-1 h-3 bg-brand rounded-full"></span>OBSERVAÇÕES GERAIS
                    </div>
                    <div className="flex gap-2">
                      {isTranscribing === 'observations' ? (
                        <div className="flex items-center gap-1 text-[10px] text-brand">
                          <Loader2 size={12} className="animate-spin" />
                          <span>TRANSCREVENDO...</span>
                        </div>
                      ) : isRecording === 'observations' ? (
                        <button 
                          onClick={stopRecording}
                          className="bg-red-600 text-white p-1.5 rounded animate-pulse shadow-[0_0_10px_rgba(220,38,38,0.5)]"
                        >
                          <StopCircle size={14} strokeWidth={3} />
                        </button>
                      ) : (
                        <div className="flex gap-1">
                          <button 
                            onClick={() => startRecording('observations')}
                            className="bg-zinc-800 text-brand p-1.5 rounded hover:bg-zinc-700 transition-colors"
                            title="Gravar Áudio e Transcrever"
                          >
                            <AudioLines size={14} strokeWidth={3} />
                          </button>
                          <button 
                            onClick={() => {
                              const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
                              if (!SpeechRecognition) {
                                alert('Seu navegador não suporta reconhecimento de voz.');
                                return;
                              }
                              const recognition = new SpeechRecognition();
                              recognition.lang = 'pt-BR';
                              recognition.onstart = () => setIsListening('observations');
                              recognition.onend = () => setIsListening(null);
                              recognition.onresult = (event: any) => {
                                const transcript = event.results[0][0].transcript;
                                setCurrentNote(prev => ({
                                  ...prev,
                                  observations: prev.observations + (prev.observations ? ' ' : '') + transcript
                                }));
                              };
                              recognition.start();
                            }}
                            className={`p-1.5 rounded transition-colors ${isListening === 'observations' ? 'bg-brand text-black' : 'bg-zinc-800 text-brand hover:bg-zinc-700'}`}
                            title="Ditado nativo"
                          >
                            <FileText size={14} strokeWidth={3} />
                          </button>
                        </div>
                      )}
                    </div>
                  </h2>
                  <textarea 
                    className="bg-black border border-zinc-800 p-3 text-xs text-zinc-300 rounded focus:border-brand outline-none resize-none w-full min-h-[100px] mt-2 font-medium"
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
                  <div className="border-b border-zinc-800 pb-4 flex justify-between items-start">
                    <div>
                      <h2 className="text-[10px] font-black text-brand uppercase mb-3 flex items-center gap-2">
                        <span className="w-1 h-3 bg-brand rounded-full"></span>VEÍCULO
                      </h2>
                      <p className="font-bold opacity-80 uppercase">{currentNote.vehicleNameColor}</p>
                      <p className="font-black text-2xl font-mono text-white tracking-widest mt-1">{currentNote.plate}</p>
                      {currentNote.arrivalDate && (
                        <p className="text-[10px] text-zinc-500 mt-2 uppercase font-bold flex items-center gap-1">
                          <Calendar size={10} /> Chegada: {format(new Date(currentNote.arrivalDate + 'T12:00:00'), 'dd/MM/yyyy')}
                        </p>
                      )}
                      
                      <div className="mt-4 pt-4 border-t border-zinc-800">
                        <label className="label-tech mb-2 block">Alterar Data de Chegada</label>
                        <input 
                          type="date" 
                          value={currentNote.arrivalDate}
                          onChange={e => setCurrentNote({ ...currentNote, arrivalDate: e.target.value })}
                          className="input-field text-xs bg-black/40" 
                        />
                      </div>
                    </div>
                    <div className={`px-2 py-1 rounded text-[9px] font-black uppercase ${
                      currentNote.status === 'finalizado' ? 'bg-green-500 text-black' :
                      currentNote.status === 'na_oficina' ? 'bg-blue-500 text-white' : 'bg-zinc-800 text-zinc-400'
                    }`}>
                      {SERVICE_STATUS_LABELS[currentNote.status]}
                    </div>
                  </div>
                  <div>
                    <h2 className="text-[10px] font-black text-brand uppercase mb-3 flex items-center gap-2">
                       <span className="w-1 h-3 bg-brand rounded-full"></span>VALOR FINAL
                    </h2>
                    <div className="flex flex-col gap-1">
                      {!currentNote.onlyTotalValue ? (
                        <>
                          {currentNote.includePartsValue && (
                            <div className="flex justify-between font-mono text-[10px] opacity-60 uppercase">
                              <span>Peças:</span>
                              <span>R$ {currentNote.partsValue.toFixed(2)}</span>
                            </div>
                          )}
                          {currentNote.includeLaborValue && (
                            <div className="flex justify-between font-mono text-[10px] opacity-60 uppercase">
                              <span>Mão de Obra:</span>
                              <span>R$ {currentNote.laborValue.toFixed(2)}</span>
                            </div>
                          )}
                          {currentNote.includeMaterialsValue && (
                            <div className="flex justify-between font-mono text-[10px] opacity-60 uppercase">
                              <span>Materiais:</span>
                              <span>R$ {currentNote.materialsValue.toFixed(2)}</span>
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="flex justify-between font-mono text-[10px] opacity-60 uppercase italic">
                          <span>Valor Fechado:</span>
                        </div>
                      )}
                      
                      {(currentNote.materialItems?.length || 0) > 0 && !currentNote.onlyTotalValue && (
                         <div className="mt-2 pt-2 border-t border-zinc-800/50 space-y-1">
                           {(currentNote.materialItems || []).map(item => (
                             <div key={item.id} className="flex justify-between text-[8px] text-zinc-500 uppercase">
                               <span>{item.name}</span>
                               <span className="font-mono">R$ {item.price.toFixed(2)}</span>
                             </div>
                           ))}
                         </div>
                      )}

                      <div className="flex justify-between items-end mt-2">
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
      <PWAPrompt />
    </div>
  );
}
