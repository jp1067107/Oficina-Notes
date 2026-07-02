/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
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
  PlusCircle,
  Menu,
  Calculator,
  Sun,
  Moon,
  MessageCircle,
  Copy,
  Home,
  MapPin,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import {
  CAR_PIECES,
  MECHANIC_PIECES,
  SERVICE_STATUS_LABELS,
  FUNILARIA_MATERIALS_LIST,
} from "./constants";
import {
  NoteData,
  ServicePiece,
  MaterialItem,
  ServiceStatus,
  ExportLog,
} from "./types";
import InstallButton from "./components/InstallButton";
import CalculatorModal from "./components/CalculatorModal";
import { format } from "date-fns";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import confetti from "canvas-confetti";
import { auth, db, signInWithGoogle } from "./lib/firebase";
import { onAuthStateChanged, signOut, User } from "firebase/auth";
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
  getDocFromServer,
  writeBatch,
} from "firebase/firestore";

enum OperationType {
  CREATE = "create",
  UPDATE = "update",
  DELETE = "delete",
  LIST = "list",
  GET = "get",
  WRITE = "write",
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
  };
}

function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null,
) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error("Firestore Error: ", JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

const generateUUID = () => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
};

// Initialize Note
const initialNote = (
  userId: string = "",
  workshopType: "funilaria" | "mecanica" = "funilaria",
): NoteData => {
  const piecesList = workshopType === "mecanica" ? MECHANIC_PIECES : CAR_PIECES;
  const initialMaterials: MaterialItem[] = [];

  return {
    id: generateUUID(),
    userId,
    customerName: "",
    vehicleNameColor: "",
    plate: "",
    cpfCnpj: "",
    whatsapp: "",
    status: "em_espera",
    arrivalDate: new Date().toISOString().split("T")[0],
    pieces: piecesList.map((p) => ({ ...p, selected: false, description: "" })),
    includePartsValue: false,
    partsValue: 0,
    includeLaborValue: false,
    laborValue: 0,
    includeMaterialsValue: false,
    materialsValue: 0,
    onlyTotalValue: false,
    totalValue: 0,
    materialItems: initialMaterials,
    observations: "",
    isDraft: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
};

// Main Application Component
// Note: Transcription via AI requires a valid GEMINI_API_KEY set in the environment.
// Deployment Note: If deployment fails with CustomOrgPolicyException, please check Org Policies for run.managed.requireInvokerIam.

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [workshopType, setWorkshopType] = useState<
    "funilaria" | "mecanica" | null
  >(() => {
    try {
      return localStorage.getItem("workshopType") as
        | "funilaria"
        | "mecanica"
        | null;
    } catch {
      return null;
    }
  });

  const [workshopData, setWorkshopData] = useState<{
    name: string;
    cnpj: string;
    location: string;
  } | null>(() => {
    try {
      const data = localStorage.getItem("workshopData");
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  });

  const [isWorkshopDataModalOpen, setIsWorkshopDataModalOpen] = useState(false);
  const [draftWorkshopData, setDraftWorkshopData] = useState<{
    name: string;
    cnpj: string;
    location: string;
  }>({ name: "", cnpj: "", location: "" });

  const [isLightMode, setIsLightMode] = useState(() => {
    try {
      return localStorage.getItem("theme") === "light";
    } catch {
      return false;
    }
  });
  const [loading, setLoading] = useState(true);
  const [isVerifyingSubscription, setIsVerifyingSubscription] = useState(false);
  const [subscriptionError, setSubscriptionError] = useState<string | null>(
    null,
  );
  const [view, setView] = useState<"list" | "editor" | "details">("list");
  const [notes, setNotes] = useState<NoteData[]>([]);
  const [currentNote, setCurrentNote] = useState<NoteData>(
    initialNote("", workshopType || "funilaria"),
  );
  const [step, setStep] = useState(1);
  const [isRecording, setIsRecording] = useState<string | null>(null);
  const [isListening, setIsListening] = useState<string | null>(null);
  const [isTranscribing, setIsTranscribing] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const [isIframe, setIsIframe] = useState(false);
  const [activeTab, setActiveTab] = useState<ServiceStatus | "all">(
    "em_espera",
  );
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isCalculatorOpen, setIsCalculatorOpen] = useState(false);
  const [isMaterialModalOpen, setIsMaterialModalOpen] = useState(false);
  const [materialSearchTerm, setMaterialSearchTerm] = useState("");
  const [pieceSearchTerm, setPieceSearchTerm] = useState("");
  const [noteToDelete, setNoteToDelete] = useState<string | null>(null);
  const [readyModalNote, setReadyModalNote] = useState<NoteData | null>(null);
  const [readyFromTime, setReadyFromTime] = useState("");
  const [readyUntilTime, setReadyUntilTime] = useState("");
  const [readyIncludeValue, setReadyIncludeValue] = useState(true);
  const [readyModalError, setReadyModalError] = useState<string | null>(null);
  const [isExportsModalOpen, setIsExportsModalOpen] = useState(false);
  const [isConfirmExportOpen, setIsConfirmExportOpen] = useState(false);
  const [exportsList, setExportsList] = useState<ExportLog[]>([]);
  const [pixPaymentEmail, setPixPaymentEmail] = useState<string | null>(null);

  useEffect(() => {
    try {
      if (isLightMode) {
        document.body.classList.add("light");
        localStorage.setItem("theme", "light");
      } else {
        document.body.classList.remove("light");
        localStorage.setItem("theme", "dark");
      }
    } catch {
      // Ignora erro de localStorage
    }
  }, [isLightMode]);

  const transcribeAudio = async (
    base64Audio: string,
    mimeType: string = "audio/webm",
  ): Promise<string> => {
    try {
      const res = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base64Audio, mimeType }),
      });

      if (!res.ok) {
        const err = await res.json();
        console.error("Transcription error from server:", err);
        return "";
      }
      
      const data = await res.json();
      return data.text || "";
    } catch (error) {
      console.error("Erro na transcrição:", error);
      return "";
    }
  };

  const calculateTotal = (note: NoteData) => {
    if (note.onlyTotalValue) return Number(note.totalValue) || 0;

    let total = 0;
    if (note.includePartsValue) total += Number(note.partsValue) || 0;
    if (note.includeLaborValue) total += Number(note.laborValue) || 0;

    if (note.includeMaterialsValue) {
      const itemsSum = (note.materialItems || []).reduce(
        (acc, item) => {
          // If it's a predefined item with 0 price and 0 quantity, it adds 0.
          // If user inputs price but no quantity, quantity defaults to 1.
          const qty = item.quantity && item.quantity > 0 ? item.quantity : 1;
          const price = Number(item.price) || 0;
          // But if it's from predefined and they didn't touch it, price is 0 so it's fine.
          return acc + (qty * price);
        },
        0,
      );
      total += itemsSum > 0 ? itemsSum : Number(note.materialsValue) || 0;
    }

    return total;
  };

  const saveDraft = useCallback(
    async (note: NoteData) => {
      if (!user) return;
      const now = new Date().toISOString();
      const total = calculateTotal(note);

      const noteToSave: NoteData = {
        ...note,
        totalValue: total,
        updatedAt: now,
        userId: user.uid,
        isDraft: true,
      };

      try {
        await setDoc(doc(db, "notes", noteToSave.id), noteToSave);
      } catch (error) {
        handleFirestoreError(
          error,
          OperationType.WRITE,
          `notes/${noteToSave.id}`,
        );
      }
    },
    [user],
  );

  // Auto-save draft
  useEffect(() => {
    if (view !== "editor" || !user) return;

    const timer = setTimeout(() => {
      saveDraft(currentNote);
    }, 1500); // Faster auto-save

    return () => clearTimeout(timer);
  }, [currentNote, user, view, saveDraft]);

  // Auto-save draft on visibility change (close/leave)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden" && view === "editor" && user) {
        saveDraft(currentNote);
      }
    };

    window.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      window.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [currentNote, user, view, saveDraft]);

  // Environment Check
  useEffect(() => {
    try {
      setIsIframe(window.self !== window.top);
    } catch {
      setIsIframe(true);
    }
  }, []);

  // Test Connection
  useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, "test", "connection"));
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes("the client is offline")
        ) {
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
          const emailBusca = (u.email || "").toLowerCase().trim();
          const subDoc = await getDoc(doc(db, "assinaturas", emailBusca));
          const subData = subDoc.data();

          if (!subDoc.exists() || subData?.status !== "ativo") {
            if (subDoc.exists() && subData?.status === "inativo") {
              await signOut(auth);
              setPixPaymentEmail(emailBusca);
              setUser(null);
            } else {
              const errorDetails = `Acesso Negado!\n\nTentamos buscar o e-mail: ${emailBusca}\nEncontrado no Banco: ${subDoc.exists() ? "Sim" : "Não"}\nStatus da Assinatura: ${subData?.status || "N/A"}\n\nVerifique se o e-mail no Firestore está escrito exatamente como acima (em minúsculas).`;
              alert(errorDetails);
              await signOut(auth);
              setSubscriptionError(
                "Acesso Negado: Sua assinatura não está ativa ou não foi encontrada. Contate o suporte.",
              );
              setUser(null);
            }
          } else {
            setUser(u);
            setSubscriptionError(null);
            setCurrentNote(initialNote(u.uid, workshopType || "funilaria"));
          }
        } catch (error) {
          console.error("Error verifying subscription:", error);
          await signOut(auth);
          setSubscriptionError(
            "Erro ao verificar assinatura. Tente novamente.",
          );
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

    const path = "notes";
    const q = query(
      collection(db, path),
      where("userId", "==", user.uid),
      orderBy("updatedAt", "desc"),
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const fetchedNotes = snapshot.docs.map((doc) => {
          const data = doc.data();
          return {
            ...data,
            id: doc.id,
            userId: data.userId || user.uid,
            customerName: data.customerName || "",
            vehicleNameColor: data.vehicleNameColor || "",
            plate: data.plate || "",
            cpfCnpj: data.cpfCnpj || "",
            whatsapp: data.whatsapp || "",
            materialItems: data.materialItems || [],
            pieces: data.pieces || [],
            status: data.status || "em_espera",
            arrivalDate: data.arrivalDate || data.deliveryDate || "",
            includePartsValue: data.includePartsValue ?? false,
            partsValue: data.partsValue ?? 0,
            includeLaborValue: data.includeLaborValue ?? false,
            laborValue: data.laborValue ?? 0,
            includeMaterialsValue: data.includeMaterialsValue ?? false,
            materialsValue: data.materialsValue ?? 0,
            onlyTotalValue: data.onlyTotalValue ?? false,
            totalValue: data.totalValue ?? 0,
            observations: data.observations || "",
            isDraft: data.isDraft ?? false,
            createdAt: data.createdAt || new Date().toISOString(),
            updatedAt: data.updatedAt || new Date().toISOString(),
          } as NoteData;
        });
        setNotes(fetchedNotes);
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, path);
      },
    );

    return unsubscribe;
  }, [user]);

  useEffect(() => {
    if (!user) {
      setExportsList([]);
      return;
    }

    const path = "exports";
    const collectionRef = collection(db, path);
    // order by createdAt desc
    const q = query(
      collectionRef,
      where("userId", "==", user.uid),
      orderBy("createdAt", "desc"),
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const fetchedExports = snapshot.docs.map((doc) => {
          return {
            ...doc.data(),
            id: doc.id,
          } as ExportLog;
        });
        setExportsList(fetchedExports);
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, path);
      },
    );

    return unsubscribe;
  }, [user]);

  const handleCreateNote = () => {
    setCurrentNote(initialNote(user?.uid || "", workshopType || "funilaria"));
    setStep(1);
    setView("editor");
  };

  const handleEditNote = (note: NoteData) => {
    setCurrentNote({ ...note });
    if (note.isDraft) {
      setStep(1);
      setView("editor");
    } else {
      setView("details");
    }
  };

  const handleDeleteNote = async (id: string, e: React.MouseEvent) => {
    if (e) e.stopPropagation();

    if (!id) {
      alert("Erro: ID da nota não encontrado.");
      return;
    }

    setNoteToDelete(id);
  };

  const confirmDeleteNote = async () => {
    if (!noteToDelete) return;
    const path = `notes/${noteToDelete}`;
    try {
      await deleteDoc(doc(db, "notes", noteToDelete));
      if (view === "details") setView("list");
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    } finally {
      setNoteToDelete(null);
    }
  };

  const handleDeleteExport = async (exportId: string) => {
    if (!window.confirm("Deseja realmente excluir esta planilha exportada?")) {
      return;
    }
    const path = `exports/${exportId}`;
    try {
      await deleteDoc(doc(db, "exports", exportId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  };

  const generateAndDownloadPdf = (fileName: string, notesJsonOrArray: any) => {
    let rawData: NoteData[] = [];
    if (typeof notesJsonOrArray === "string") {
      try {
        rawData = JSON.parse(notesJsonOrArray);
      } catch (e) {
        console.error("Invalid export JSON", e);
        return;
      }
    } else {
      rawData = notesJsonOrArray;
    }

    const doc = new jsPDF();
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text(`${workshopData?.name || "OFICINA NOTES"} - Relatórios`, 14, 20);

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(
      `CNPJ: ${workshopData?.cnpj || "N/A"}\nLocalização: ${workshopData?.location || "N/A"}\nData de geração: ${format(new Date(), "dd/MM/yyyy HH:mm")}`,
      14,
      28,
    );

    const tableBody = rawData.map((note) => {
      const total = note.onlyTotalValue
        ? note.totalValue
        : note.partsValue + note.laborValue + note.materialsValue;
      return [
        note.customerName || "-",
        note.vehicleNameColor || "-",
        note.plate || "-",
        `R$ ${total.toFixed(2)}`,
      ];
    });

    autoTable(doc, {
      startY: 45,
      head: [["Cliente", "Veículo", "Placa", "Total"]],
      body: tableBody,
      theme: "striped",
      headStyles: { fillColor: [37, 211, 102] },
    });

    doc.save(fileName);
  };

  const handleExportFinished = async () => {
    if (!user) return;
    const finishedNotes = notes.filter((n) => n.status === "finalizado");
    if (finishedNotes.length === 0) return;

    const exportDataJson = JSON.stringify(finishedNotes);
    const fileName = `export_finalizadas_${new Date().toISOString().split("T")[0]}.pdf`;

    // Trigger download
    generateAndDownloadPdf(fileName, finishedNotes);

    // Save export log & delete notes in batch (or sequentially if batch full, max 500)
    try {
      const exportId = doc(collection(db, "exports")).id;
      const exportPath = `exports/${exportId}`;
      const exportData = {
        id: exportId,
        userId: user.uid,
        createdAt: new Date().toISOString(),
        fileName,
        notesCount: finishedNotes.length,
        exportDataJson,
      };
      await setDoc(doc(db, "exports", exportId), exportData);

      // Delete exported notes using batch (chunked to 500)
      for (let i = 0; i < finishedNotes.length; i += 500) {
        const chunk = finishedNotes.slice(i, i + 500);
        const batch = writeBatch(db);
        chunk.forEach((note) => {
          batch.delete(doc(db, "notes", note.id));
        });
        await batch.commit();
      }
    } catch (err) {
      console.error(err);
      handleFirestoreError(err, OperationType.WRITE, "exports/...");
    } finally {
      setIsConfirmExportOpen(false);
    }
  };

  const confirmReadyMessage = () => {
    if (!readyModalNote) return;
    const totalValue = readyModalNote.onlyTotalValue
      ? readyModalNote.totalValue
      : readyModalNote.partsValue +
        readyModalNote.laborValue +
        readyModalNote.materialsValue;

    let timeText = "";
    if (readyFromTime && readyUntilTime) {
      timeText = ` Pode buscar a partir das ${readyFromTime} até as ${readyUntilTime}.`;
    } else if (readyFromTime) {
      timeText = ` Pode buscar a partir das ${readyFromTime}.`;
    } else if (readyUntilTime) {
      timeText = ` Pode buscar até as ${readyUntilTime}.`;
    } else {
      timeText = ` Pode vir buscar na oficina.`;
    }

    const valueText = readyIncludeValue
      ? ` O valor total ficou em R$ ${totalValue.toFixed(2)}`
      : "";
    const message = `*OFICINA NOTES - ORDEM DE SERVIÇO*\n\nOlá ${readyModalNote.customerName}, o seu veículo ${readyModalNote.vehicleNameColor} já está pronto!${timeText}${valueText}`;
    if (readyModalNote.whatsapp) {
      window.open(
        `https://wa.me/${readyModalNote.whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`,
        "_blank",
      );
      setReadyModalNote(null);
      setReadyFromTime("");
      setReadyUntilTime("");
      setReadyIncludeValue(true);
      setReadyModalError(null);
    } else {
      setReadyModalError("WhatsApp não informado na nota.");
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
      isDraft: false,
    };

    const path = `notes/${noteToSave.id}`;
    try {
      await setDoc(doc(db, "notes", noteToSave.id), noteToSave);
      setView("list");
      setPieceSearchTerm("");
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
        colors: ["#22c55e", "#ffffff"],
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  };

  // Audio Recording
  const handleAdjustStatus = async (
    note: NoteData,
    direction: number,
    cycle: boolean = false,
  ) => {
    const statuses: ServiceStatus[] = ["em_espera", "na_oficina", "finalizado"];
    const currentIndex = statuses.indexOf(note.status);
    let nextIndex = currentIndex + direction;

    if (cycle) {
      nextIndex =
        (currentIndex + direction + statuses.length) % statuses.length;
    }

    if (nextIndex >= 0 && nextIndex < statuses.length) {
      const newStatus = statuses[nextIndex];
      const updatedNote = {
        ...note,
        status: newStatus,
        updatedAt: new Date().toISOString(),
      };

      try {
        await setDoc(doc(db, "notes", note.id), updatedNote);
        return newStatus;
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, `notes/${note.id}`);
      }
    }
    return null;
  };

  const startRecording = async (pieceId: string) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const mimeType = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : "audio/aac";

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

            if (pieceId === "observations") {
              setIsTranscribing("observations");
              const transcription = await transcribeAudio(
                base64Audio,
                mimeType,
              );
              if (transcription) {
                setCurrentNote((prev) => ({
                  ...prev,
                  observations:
                    prev.observations +
                    (prev.observations ? " " : "") +
                    transcription,
                }));
              }
            } else {
              updatePiece(pieceId, { audioBlob: base64Audio });
              setIsTranscribing(pieceId);
              const transcription = await transcribeAudio(
                base64Audio,
                mimeType,
              );
              if (transcription) {
                setCurrentNote((prev) => ({
                  ...prev,
                  pieces: prev.pieces.map((p) => {
                    if (p.id === pieceId) {
                      const currentDesc = p.description || "";
                      return {
                        ...p,
                        description:
                          currentDesc +
                          (currentDesc ? " " : "") +
                          transcription,
                      };
                    }
                    return p;
                  }),
                }));
              }
            }
          } catch (error) {
            console.error("Erro ao processar áudio gravado:", error);
          } finally {
            setIsTranscribing(null);
          }
        };
      };

      mediaRecorder.start();
      setIsRecording(pieceId);
    } catch (err) {
      console.error("Error recording audio:", err);
      alert(
        "Não foi possível acessar o microfone ou formato de áudio não suportado.",
      );
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream
        .getTracks()
        .forEach((track) => track.stop());
      setIsRecording(null);
    }
  };

  const [searchTerm, setSearchTerm] = useState("");

  const filteredNotes = notes
    .filter((n) => {
      const matchesSearch =
        n.customerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        n.plate.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesTab = activeTab === "all" || n.status === activeTab;
      return matchesSearch && matchesTab;
    })
    .sort((a, b) => {
      if (a.isDraft && !b.isDraft) return -1;
      if (!a.isDraft && b.isDraft) return 1;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

  const exportJSON = () => {
    const dataStr =
      "data:text/json;charset=utf-8," +
      encodeURIComponent(JSON.stringify(currentNote));
    const downloadAnchorNode = document.createElement("a");
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute(
      "download",
      `oficina_note_${currentNote.plate || "export"}.json`,
    );
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
        setCurrentNote({
          ...json,
          id: generateUUID(),
          updatedAt: new Date().toISOString(),
        });
        setStep(1);
        setView("editor");
      } catch (err) {
        alert("Erro ao importar arquivo JSON.");
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
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Seu navegador não suporta reconhecimento de voz.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "pt-BR";
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => setIsListening(pieceId);
    recognition.onend = () => setIsListening(null);
    recognition.onerror = () => setIsListening(null);

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      const piece = (currentNote.pieces || []).find((p) => p.id === pieceId);
      const currentDesc = piece?.description || "";
      updatePiece(pieceId, {
        description: currentDesc + (currentDesc ? " " : "") + transcript,
      });
    };

    recognition.start();
  };

  const updatePiece = (id: string, updates: Partial<ServicePiece>) => {
    setCurrentNote((prev) => ({
      ...prev,
      pieces: prev.pieces.map((p) => (p.id === id ? { ...p, ...updates } : p)),
    }));
  };

  const generatePDF = () => {
    const doc = new jsPDF();
    const margin = 20;
    let y = 20;

    // Header with better styling
    doc.setFillColor(0, 0, 0);
    doc.rect(0, 0, 210, 40, "F");

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(24);
    doc.setFont("helvetica", "bold");
    doc.text(workshopData?.name?.toUpperCase() || "OFICINA NOTES", margin, 25);

    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text("ORDEM DE SERVIÇO / ORÇAMENTO", margin, 32);

    if (workshopData?.location) {
      doc.setFontSize(8);
      doc.setTextColor(200, 200, 200);
      doc.text(workshopData.location, margin, 37);
      doc.setTextColor(255, 255, 255);
    }

    doc.setTextColor(150, 150, 150);
    doc.text(`EMITIDO EM: ${format(new Date(), "dd/MM/yyyy HH:mm")}`, 190, 25, {
      align: "right",
    });
    if (workshopData?.cnpj) {
      doc.text(`CNPJ: ${workshopData.cnpj}`, 190, 32, {
        align: "right",
      });
    }

    y = 55;
    doc.setTextColor(0, 0, 0);

    // Customer and Vehicle Section Grouped
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("DADOS DO CLIENTE E VEÍCULO", margin, y);
    doc.line(margin, y + 2, 190, y + 2);
    y += 10;

    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text("CLIENTE:", margin, y);
    doc.setFont("helvetica", "normal");
    doc.text(currentNote.customerName || "---", margin + 20, y);

    doc.setFont("helvetica", "bold");
    doc.text("WHATSAPP:", 110, y);
    doc.setFont("helvetica", "normal");
    doc.text(currentNote.whatsapp || "---", 135, y);

    y += 7;
    doc.setFont("helvetica", "bold");
    doc.text("VEÍCULO:", margin, y);
    doc.setFont("helvetica", "normal");
    doc.text(currentNote.vehicleNameColor || "---", margin + 20, y);

    doc.setFont("helvetica", "bold");
    doc.text("PLACA:", 110, y);
    doc.setFont("helvetica", "normal");
    doc.text(currentNote.plate || "---", 135, y);

    y += 7;
    doc.setFont("helvetica", "bold");
    doc.text("CPF/CNPJ:", margin, y);
    doc.setFont("helvetica", "normal");
    doc.text(currentNote.cpfCnpj || "---", margin + 20, y);

    y += 15;

    // Services Section
    const selectedPieces = (currentNote.pieces || []).filter((p) => p.selected);
    if (selectedPieces.length > 0) {
      if (y > 230) {
        doc.addPage();
        y = 20;
      }
      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.setFillColor(240, 240, 240);
      doc.rect(margin, y, 170, 8, "F");
      doc.text("SERVIÇOS EXECUTADOS / NOTAS", margin + 5, y + 6);
      y += 12;

      doc.setFontSize(9);
      selectedPieces.forEach((p) => {
        if (y > 260) {
          doc.addPage();
          y = 20;
        }
        doc.setFont("helvetica", "bold");
        doc.text(`> ${p.label.toUpperCase()}`, margin, y);
        y += 5;
        doc.setFont("helvetica", "normal");
        doc.setTextColor(60, 60, 60);
        const desc = doc.splitTextToSize(
          p.description || "(Sem descrição detalhada)",
          160,
        );
        doc.text(desc, margin + 5, y);
        y += desc.length * 5 + 5;
        doc.setTextColor(0, 0, 0);
      });
      y += 5;
    }

    // Material Items Section - Optimized List
    if (
      ((currentNote.materialItems || [])?.length || 0) > 0 &&
      !currentNote.onlyTotalValue
    ) {
      if (y > 230) {
        doc.addPage();
        y = 20;
      }
      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.setFillColor(240, 240, 240);
      doc.rect(margin, y, 170, 8, "F");
      doc.text("LISTAGEM DE PEÇAS E MATERIAIS", margin + 5, y + 6);
      y += 12;

      doc.setFontSize(9);
      doc.setFont("helvetica", "bold");
      doc.text("DESCRIÇÃO DO ITEM", margin + 5, y);
      doc.text("VALOR UNIT.", 190, y, { align: "right" });
      y += 5;
      doc.line(margin, y, 190, y);
      y += 6;

      doc.setFont("helvetica", "normal");
      const filteredItems = (currentNote.materialItems || []).filter(item => (item.price > 0 || (item.quantity && item.quantity > 0)));
      filteredItems.forEach((item) => {
        if (y > 270) {
          doc.addPage();
          y = 20;
        }
        const qtyStr = item.quantity && item.quantity > 0 ? `${item.quantity}x ` : "";
        doc.text(`${qtyStr}${item.name}`, margin + 5, y);
        const itemTotal = (item.quantity && item.quantity > 0 ? item.quantity : 1) * (item.price || 0);
        doc.text(`R$ ${itemTotal.toFixed(2)}`, 190, y, { align: "right" });
        y += 6;
        doc.setDrawColor(230, 230, 230);
        doc.line(margin + 5, y - 1, 185, y - 1);
        doc.setDrawColor(0, 0, 0);
        y += 2;
      });
      y += 5;
    }

    // Financial Section
    if (y > 240) {
      doc.addPage();
      y = 20;
    }
    y += 10;
    doc.setFillColor(0, 0, 0);
    doc.rect(margin, y, 170, 30, "F");
    y += 10;

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");

    if (currentNote.onlyTotalValue) {
      doc.text(`RESUMO: VALOR TOTAL FECHADO`, margin + 5, y);
    } else {
      const parts = currentNote.includePartsValue
        ? `Peças: R$ ${currentNote.partsValue.toFixed(2)}`
        : "";
      const labor = currentNote.includeLaborValue
        ? `Mão de Obra: R$ ${currentNote.laborValue.toFixed(2)}`
        : "";
      const materials = currentNote.includeMaterialsValue
        ? `Materiais: R$ ${Number(currentNote.materialsValue).toFixed(2)}`
        : "";
      doc.text(
        `${parts} ${parts && labor ? " | " : ""} ${labor} ${(parts || labor) && materials ? " | " : ""} ${materials}`,
        margin + 5,
        y,
      );
    }

    y += 10;
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.text(
      `TOTAL GERAL: R$ ${totalValue.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`,
      margin + 5,
      y,
    );

    doc.setTextColor(0, 0, 0);
    if (currentNote.observations) {
      y += 25;
      if (y > 260) {
        doc.addPage();
        y = 20;
      }
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.text("OBSERVAÇÕES ADICIONAIS", margin, y);
      y += 8;
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      const obs = doc.splitTextToSize(currentNote.observations, 170);
      doc.text(obs, margin, y);
    }

    doc.save(
      `os_${currentNote.plate || "nota"}_${format(new Date(), "yyyyMMdd")}.pdf`,
    );
  };

  const totalValue = currentNote.onlyTotalValue
    ? currentNote.totalValue
    : (currentNote.includePartsValue ? Number(currentNote.partsValue) : 0) +
      (currentNote.includeLaborValue ? Number(currentNote.laborValue) : 0) +
      (currentNote.includeMaterialsValue
        ? Number(currentNote.materialsValue)
        : 0);

  const handleLogin = async () => {
    setSubscriptionError(null);
    try {
      const result = await signInWithGoogle();
      const u = result.user;

      setIsVerifyingSubscription(true);
      const emailBusca = (u.email || "").toLowerCase().trim();
      const subDoc = await getDoc(doc(db, "assinaturas", emailBusca));
      const subData = subDoc.data();

      if (!subDoc.exists() || subData?.status !== "ativo") {
        if (subDoc.exists() && subData?.status === "inativo") {
          await signOut(auth);
          setPixPaymentEmail(emailBusca);
        } else {
          const errorDetails = `Acesso Negado!\n\nTentamos buscar o e-mail: ${emailBusca}\nEncontrado no Banco: ${subDoc.exists() ? "Sim" : "Não"}\nStatus da Assinatura: ${subData?.status || "N/A"}\n\nVerifique se o e-mail no Firestore está escrito exatamente como acima (em minúsculas).`;
          alert(errorDetails);
          await signOut(auth);
          setSubscriptionError(
            "Acesso Negado: Sua assinatura não está ativa ou não foi encontrada. Contate o suporte.",
          );
        }
      } else {
        setUser(u);
        setCurrentNote(initialNote(u.uid, workshopType || "funilaria"));
      }
    } catch (error: any) {
      if (
        error.code === "auth/popup-closed-by-user" ||
        error.code === "auth/cancelled-popup-request"
      ) {
        return;
      }
      console.error("Erro ao fazer login:", error);
      setSubscriptionError("Erro ao realizar login. Tente novamente.");
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
    if (pixPaymentEmail) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-black">
          <div className="w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-2xl p-8 flex flex-col items-center text-center shadow-2xl">
            <h2 className="text-2xl font-bold text-white mb-2">
              Assinatura Inativa
            </h2>
            <p className="text-zinc-400 text-sm mb-6">
              A sua assinatura para <strong>{pixPaymentEmail}</strong>{" "}
              encontra-se inativa. Realize o pagamento via PIX para reativar seu
              acesso.
            </p>

            <div className="bg-white p-4 rounded-xl mb-6">
              <img
                src="https://i.postimg.cc/s21f77tX/Whats-App-Image-2026-05-04-at-13-59-42.jpg"
                alt="QR Code PIX"
                className="w-48 h-48 object-contain"
                referrerPolicy="no-referrer"
              />
            </div>

            <p className="text-xs text-brand mb-4 uppercase tracking-widest font-bold">
              Ou pague usando a chave
            </p>

            <div className="w-full bg-zinc-800 p-3 rounded-lg flex items-center justify-between mb-6">
              <span className="text-zinc-300 font-mono text-sm truncate mr-3">
                jp1067103@gmail.com
              </span>
              <button
                onClick={() => {
                  navigator.clipboard.writeText("sua-chave-pix-aqui@email.com");
                  alert("Chave Copiada!");
                }}
                className="text-brand hover:text-brand/80 p-2"
              >
                <Copy size={16} />
              </button>
            </div>

            <button
              onClick={() => {
                setPixPaymentEmail(null);
                setSubscriptionError(null);
              }}
              className="w-full py-3 rounded-lg font-medium text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
            >
              Voltar para o Login
            </button>
          </div>
        </div>
      );
    }

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

  if (!workshopType) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-black">
        <div className="w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-2xl p-8 flex flex-col items-center text-center shadow-2xl">
          <h2 className="text-2xl font-bold text-white mb-2">Bem-vindo(a)!</h2>
          <p className="text-zinc-400 text-sm mb-6">
            Para personalizar sua experiência, escolha o tipo principal da sua
            oficina:
          </p>

          <div className="grid gap-4 w-full">
            <button
              onClick={() => {
                setWorkshopType("funilaria");
                localStorage.setItem("workshopType", "funilaria");
                setCurrentNote(initialNote(user?.uid || "", "funilaria"));
              }}
              className="w-full py-4 rounded-xl font-bold text-black bg-brand hover:bg-brand/90 transition-colors uppercase tracking-widest text-xs shadow-[0_0_30px_rgba(34,197,94,0.2)]"
            >
              Funilaria e Pintura
            </button>
            <button
              onClick={() => {
                setWorkshopType("mecanica");
                localStorage.setItem("workshopType", "mecanica");
                setCurrentNote(initialNote(user?.uid || "", "mecanica"));
              }}
              className="w-full py-4 rounded-xl font-bold text-white bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 transition-colors uppercase tracking-widest text-xs"
            >
              Oficina Mecânica
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!workshopData) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-black">
        <div className="w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-2xl p-8 flex flex-col items-center text-center shadow-2xl">
          <h2 className="text-2xl font-bold text-white mb-2">Quase lá!</h2>
          <p className="text-zinc-400 text-sm mb-6">
            Preencha os dados da sua oficina para que eles apareçam nas
            Notas/Orçamentos exportados.
          </p>

          <form
            className="w-full flex flex-col gap-4 text-left"
            onSubmit={(e) => {
              e.preventDefault();
              const formData = new FormData(e.currentTarget);
              const data = {
                name: formData.get("name") as string,
                cnpj: formData.get("cnpj") as string,
                location: formData.get("location") as string,
              };
              setWorkshopData(data);
              localStorage.setItem("workshopData", JSON.stringify(data));
            }}
          >
            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1 uppercase">
                Nome da Oficina
              </label>
              <input
                required
                name="name"
                type="text"
                className="w-full bg-black border border-zinc-800 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-brand transition-colors"
                placeholder="Ex: Oficina do João"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1 uppercase">
                CNPJ (Opcional)
              </label>
              <input
                name="cnpj"
                type="text"
                className="w-full bg-black border border-zinc-800 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-brand transition-colors"
                placeholder="Ex: 00.000.000/0000-00"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-400 mb-1 uppercase">
                Endereço/Localização
              </label>
              <input
                required
                name="location"
                type="text"
                className="w-full bg-black border border-zinc-800 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-brand transition-colors"
                placeholder="Ex: Rua das Flores, 123"
              />
            </div>

            <button
              type="submit"
              className="w-full py-4 mt-2 rounded-xl font-bold text-black bg-brand hover:bg-brand/90 transition-colors uppercase tracking-widest text-xs shadow-[0_0_30px_rgba(34,197,94,0.2)]"
            >
              Concluir Configuração
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-20 max-w-lg mx-auto">
      {view === "list" ? (
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
              <InstallButton />

              <div className="relative">
                <button
                  onClick={() => setIsMenuOpen(!isMenuOpen)}
                  className="bg-zinc-900 text-zinc-500 p-3 rounded hover:text-brand transition-colors"
                  title="Menu"
                >
                  <Menu size={24} />
                </button>

                <AnimatePresence>
                  {isMenuOpen && (
                    <>
                      {/* Overlay para fechar o menu ao clicar fora */}
                      <div
                        className="fixed inset-0 z-40"
                        onClick={() => setIsMenuOpen(false)}
                      />

                      <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, y: 10 }}
                        transition={{ duration: 0.2 }}
                        className="absolute right-0 top-full mt-2 w-48 bg-zinc-900 border border-zinc-800 rounded-lg shadow-xl z-50 overflow-hidden"
                      >
                        <div className="py-1">
                          {user?.email && (
                            <div className="px-4 py-3 border-b border-zinc-800 mb-1">
                              <p className="text-xs text-zinc-500 font-medium mb-0.5">
                                Conectado como
                              </p>
                              <p
                                className="text-sm text-zinc-200 font-medium truncate"
                                title={user.email}
                              >
                                {user.email}
                              </p>
                            </div>
                          )}
                          <button
                            onClick={() => {
                              setIsMenuOpen(false);
                              setIsCalculatorOpen(true);
                            }}
                            className="w-full flex items-center gap-2 px-4 py-3 text-sm text-zinc-100 hover:text-brand hover:bg-zinc-800/50 transition-colors text-left"
                          >
                            <Calculator size={16} />
                            <span>Calculadora</span>
                          </button>
                          <button
                            onClick={() => {
                              setIsMenuOpen(false);
                              setIsExportsModalOpen(true);
                            }}
                            className="w-full flex items-center gap-2 px-4 py-3 text-sm text-zinc-100 hover:text-brand hover:bg-zinc-800/50 transition-colors text-left"
                          >
                            <Download size={16} />
                            <span>Planilhas Exportadas</span>
                          </button>
                          <button
                            onClick={() => {
                              setIsMenuOpen(false);
                              const newType =
                                workshopType === "funilaria"
                                  ? "mecanica"
                                  : "funilaria";
                              setWorkshopType(newType);
                              localStorage.setItem("workshopType", newType);
                              // Clear active selections so it doesn't break when loading other module pieces
                              setCurrentNote(
                                initialNote(user?.uid || "", newType),
                              );
                            }}
                            className="w-full flex items-center gap-2 px-4 py-3 text-sm text-zinc-100 hover:text-brand hover:bg-zinc-800/50 transition-colors text-left"
                          >
                            <Edit2 size={16} />
                            <span>
                              Mudar para{" "}
                              {workshopType === "funilaria"
                                ? "Mecânica"
                                : "Funilaria"}
                            </span>
                          </button>

                          <button
                            onClick={() => {
                              setIsMenuOpen(false);
                              if (workshopData) {
                                setDraftWorkshopData(workshopData);
                              }
                              setIsWorkshopDataModalOpen(true);
                            }}
                            className="w-full flex items-center gap-2 px-4 py-3 text-sm text-zinc-100 hover:text-brand hover:bg-zinc-800/50 transition-colors text-left"
                          >
                            <Home size={16} />
                            <span>Editar Dados da Oficina</span>
                          </button>
                          <button
                            onClick={() => {
                              setIsMenuOpen(false);
                              setIsLightMode(!isLightMode);
                            }}
                            className="w-full flex items-center gap-2 px-4 py-3 text-sm text-zinc-100 hover:text-brand hover:bg-zinc-800/50 transition-colors text-left"
                          >
                            {isLightMode ? (
                              <Moon size={16} />
                            ) : (
                              <Sun size={16} />
                            )}
                            <span>
                              {isLightMode ? "Modo Escuro" : "Modo Claro"}
                            </span>
                          </button>
                          <button
                            onClick={() => {
                              setIsMenuOpen(false);
                              signOut(auth);
                            }}
                            className="w-full flex items-center gap-2 px-4 py-3 text-sm text-zinc-400 hover:text-red-500 hover:bg-zinc-800/50 transition-colors text-left"
                          >
                            <LogOut size={16} />
                            <span>Sair</span>
                          </button>
                        </div>
                      </motion.div>
                    </>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </header>

          <div className="relative flex gap-2">
            <div className="relative flex-1">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-700"
                size={18}
              />
              <input
                type="text"
                placeholder="PROCURAR POR PLACA OU CLIENTE"
                className="input-field pl-10 font-black tracking-widest text-[11px]"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <label className="bg-zinc-900 border border-zinc-800 text-brand p-3 rounded cursor-pointer hover:bg-zinc-800 transition-colors">
              <Download size={20} className="rotate-180" />
              <input
                type="file"
                accept=".json"
                onChange={importJSON}
                className="hidden"
              />
            </label>
          </div>

          <div className="flex bg-zinc-900 border border-zinc-800 p-1 rounded-xl overflow-hidden shadow-inner">
            {(
              ["all", "em_espera", "na_oficina", "finalizado"] as (
                | ServiceStatus
                | "all"
              )[]
            ).map((status) => {
              const count =
                status === "all"
                  ? notes.length
                  : notes.filter((n) => n.status === status).length;
              const isActive = activeTab === status;
              return (
                <button
                  key={status}
                  onClick={() => setActiveTab(status)}
                  className={`flex-1 flex flex-col items-center py-2.5 rounded-lg transition-all relative ${
                    isActive
                      ? "bg-zinc-800 text-brand shadow-[0_0_15px_rgba(34,197,94,0.1)]"
                      : "text-zinc-600 hover:text-zinc-400"
                  }`}
                >
                  <span
                    className={`text-[9px] font-black uppercase tracking-tighter mb-0.5 ${isActive ? "text-brand" : "text-zinc-500"}`}
                  >
                    {status === "all" ? "Todos" : SERVICE_STATUS_LABELS[status]}
                  </span>
                  <span
                    className={`text-base font-black font-mono leading-none ${isActive ? "text-white" : "text-zinc-700"}`}
                  >
                    {count.toString().padStart(2, "0")}
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
                <p>
                  {searchTerm
                    ? "Nenhum resultado encontrado."
                    : "Nenhuma nota cadastrada ainda."}
                </p>
              </div>
            ) : (
              filteredNotes.map((note) => (
                <motion.div
                  key={note.id}
                  onClick={() => handleEditNote(note)}
                  drag="x"
                  dragConstraints={{ left: 0, right: 0 }}
                  dragElastic={0.5}
                  onDragEnd={async (event, info) => {
                    const swipeThreshold = 50;
                    if (info.offset.x > swipeThreshold) {
                      // swipe right -> advance status
                      const newStatus = await handleAdjustStatus(note, 1);
                      if (newStatus) setActiveTab(newStatus);
                    } else if (info.offset.x < -swipeThreshold) {
                      // swipe left -> rollback status
                      const newStatus = await handleAdjustStatus(note, -1);
                      if (newStatus) setActiveTab(newStatus);
                    }
                  }}
                  className={`card group cursor-grab active:cursor-grabbing transition-colors relative overflow-hidden touch-pan-y
                    ${note.isDraft ? "border-amber-500/50 bg-amber-500/5 shadow-[0_0_20px_rgba(245,158,11,0.1)]" : "border-zinc-800 hover:border-brand"}`}
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
                      <div
                        className={`w-1.5 h-8 rounded-full ${note.isDraft ? "bg-amber-500 animate-pulse" : "bg-brand"}`}
                      ></div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-black text-xl italic tracking-tighter uppercase">
                            {note.plate || "SEM PLACA"}
                          </h3>
                          {note.isDraft && (
                            <span className="text-[8px] bg-amber-500 text-black px-1.5 py-0.5 rounded font-black uppercase tracking-tighter">
                              RASCUNHO
                            </span>
                          )}
                        </div>
                        <p className="text-zinc-500 text-[10px] uppercase font-bold tracking-widest">
                          {note.customerName || "Cliente não identificado"}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <p
                            className={`${note.isDraft ? "text-amber-500" : "text-brand"} text-xs font-mono font-bold whitespace-nowrap`}
                          >
                            R$ {note.totalValue?.toFixed(2)}
                          </p>
                          <div className="h-4 w-[1px] bg-zinc-800"></div>
                          <div className="flex items-center gap-1">
                            <span
                              onClick={(e) => {
                                e.stopPropagation();
                                handleAdjustStatus(note, 1, true);
                              }}
                              className={`text-[8px] font-black uppercase px-2 py-0.5 rounded cursor-pointer transition-transform active:scale-95 hover:brightness-110 ${
                                note.status === "finalizado"
                                  ? "bg-green-500 text-black"
                                  : note.status === "na_oficina"
                                    ? "bg-blue-500 text-white"
                                    : "bg-zinc-800 text-zinc-400"
                              }`}
                            >
                              {SERVICE_STATUS_LABELS[note.status]}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <span className="text-[9px] bg-zinc-800 px-2 py-0.5 rounded text-zinc-400 font-black tracking-widest">
                        {format(new Date(note.updatedAt), "dd/MM/yy")}
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
                </motion.div>
              ))
            )}
          </div>

          <div className="fixed bottom-8 right-6 z-40 flex items-center gap-4">
            {activeTab === "finalizado" &&
              notes.filter((n) => n.status === "finalizado").length > 0 && (
                <button
                  onClick={() => setIsConfirmExportOpen(true)}
                  className="bg-blue-500 text-white w-14 h-14 rounded-full flex items-center justify-center shadow-[0_0_30px_rgba(59,130,246,0.4)] hover:scale-110 active:scale-95 transition-all"
                  title="Exportar e limpar finalizadas"
                >
                  <Download size={24} strokeWidth={2.5} />
                </button>
              )}

            <button
              onClick={handleCreateNote}
              className="bg-brand text-black w-14 h-14 rounded-full flex items-center justify-center shadow-[0_0_30px_rgba(34,197,94,0.4)] hover:scale-110 active:scale-95 transition-all"
              title="Adicionar Nova OS"
            >
              <Plus size={28} strokeWidth={3} />
            </button>
          </div>
        </div>
      ) : view === "details" ? (
        <div className="p-4 space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
          <header className="flex items-center justify-between py-4 border-b border-zinc-900 sticky top-0 bg-black/80 backdrop-blur-md z-10">
            <div className="flex items-center gap-4">
              <button
                onClick={() => setView("list")}
                className="p-2 hover:bg-zinc-800 rounded-full"
              >
                <ArrowLeft size={24} />
              </button>
              <h2 className="text-xl font-black italic tracking-tighter uppercase">
                Detalhes da Nota
              </h2>
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
                  setView("editor");
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
                <p className="text-2xl font-black italic tracking-tighter uppercase">
                  {currentNote.customerName || "NÃO INFORMADO"}
                </p>
                <div className="flex gap-4 mt-2">
                  <div>
                    <label className="text-[9px] text-zinc-600 uppercase font-bold">
                      CPF/CNPJ
                    </label>
                    <p className="text-sm font-mono">
                      {currentNote.cpfCnpj || "---"}
                    </p>
                  </div>
                  <div>
                    <label className="text-[9px] text-zinc-600 uppercase font-bold">
                      WhatsApp
                    </label>
                    <p className="text-sm font-mono">
                      {currentNote.whatsapp || "---"}
                    </p>
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="flex justify-between items-start mb-2">
                  <h3 className="label-tech text-brand">Veículo</h3>
                  <div
                    className={`px-2 py-1 rounded text-[9px] font-black uppercase ${
                      currentNote.status === "finalizado"
                        ? "bg-green-500 text-black"
                        : currentNote.status === "na_oficina"
                          ? "bg-blue-500 text-white"
                          : "bg-zinc-800 text-zinc-400"
                    }`}
                  >
                    {SERVICE_STATUS_LABELS[currentNote.status]}
                  </div>
                </div>
                <p className="text-xl font-bold uppercase opacity-80">
                  {currentNote.vehicleNameColor || "NÃO INFORMADO"}
                </p>
                <p className="text-3xl font-black font-mono tracking-widest text-white mt-1">
                  {currentNote.plate || "---"}
                </p>
                {currentNote.arrivalDate && (
                  <div className="flex items-center gap-2 mt-3 text-zinc-500 text-[10px] uppercase font-bold">
                    <Calendar size={12} className="text-brand" />
                    <span>
                      Chegada:{" "}
                      {format(
                        new Date(currentNote.arrivalDate + "T12:00:00"),
                        "dd/MM/yyyy",
                      )}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="card">
              <h3 className="label-tech text-brand mb-4">Serviços e Peças</h3>
              <div className="space-y-4">
                {(currentNote.pieces || []).filter((p) => p.selected).length === 0 ? (
                  <p className="text-zinc-600 italic text-sm">
                    Nenhuma peça selecionada.
                  </p>
                ) : (
                  (currentNote.pieces || [])
                    .filter((p) => p.selected)
                    .map((piece) => (
                      <div
                        key={piece.id}
                        className="border-l-2 border-brand pl-4 py-1 space-y-2"
                      >
                        <div className="flex justify-between items-center">
                          <span className="font-black text-[11px] uppercase tracking-widest">
                            {piece.label}
                          </span>
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
                        <p className="text-xs text-zinc-400">
                          {piece.description || "(Sem descrição textual)"}
                        </p>
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
                <span className="w-1 h-3 bg-brand rounded-full"></span>Resumo
                Financeiro
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

                  {(() => {
                    const filteredItems = (currentNote.materialItems || []).filter(item => (item.price > 0 || (item.quantity && item.quantity > 0)));
                    if (filteredItems.length === 0) return null;
                    return (
                      <div className="space-y-1 mb-4 border-b border-zinc-800 pb-4">
                        <p className="text-[8px] text-zinc-600 mb-2 uppercase font-black">
                          Detalhamento de Itens
                        </p>
                        {filteredItems.map((item) => {
                          const qtyStr = item.quantity && item.quantity > 0 ? `${item.quantity}x ` : "";
                          const itemTotal = (item.quantity && item.quantity > 0 ? item.quantity : 1) * (item.price || 0);
                          return (
                            <div
                              key={item.id}
                              className="flex justify-between text-[10px] text-zinc-400"
                            >
                              <span>{qtyStr}{item.name}</span>
                              <span className="font-mono">
                                R$ {itemTotal.toFixed(2)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}

              <div className="flex justify-between items-end">
                <span className="text-[10px] font-black uppercase text-zinc-500">
                  Total Geral
                </span>
                <span className="text-3xl font-black italic tracking-tighter text-brand drop-shadow-[0_0_15px_rgba(34,197,94,0.3)]">
                  R${" "}
                  {totalValue.toLocaleString("pt-BR", {
                    minimumFractionDigits: 2,
                  })}
                </span>
              </div>
            </div>

            {currentNote.observations && (
              <div className="card">
                <h3 className="label-tech text-brand mb-2">
                  Observações Gerais
                </h3>
                <p className="text-xs text-zinc-400 whitespace-pre-wrap">
                  {currentNote.observations}
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 gap-2 pt-4">
              <button
                onClick={generatePDF}
                className="btn-primary flex items-center justify-center gap-2"
              >
                <FileText size={18} strokeWidth={3} /> GERAR PDF
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => {
                    const message = `*OFICINA NOTES - ORDEM DE SERVIÇO*\n\n*CLIENTE:* ${currentNote.customerName}\n*VEÍCULO:* ${currentNote.vehicleNameColor}\n*PLACA:* ${currentNote.plate}\n*TOTAL:* R$ ${totalValue.toFixed(2)}`;
                    window.open(
                      `https://wa.me/${currentNote.whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`,
                      "_blank",
                    );
                  }}
                  className="bg-[#25D366] text-black font-black uppercase tracking-widest text-[10px] py-4 rounded flex items-center justify-center gap-2"
                >
                  <Play size={18} className="fill-current" /> COMPARTILHAR
                </button>
                <button
                  onClick={() => setReadyModalNote(currentNote)}
                  className="bg-[#25D366]/20 border border-[#25D366]/50 text-[#25D366] font-black uppercase tracking-widest text-[10px] py-4 rounded flex items-center justify-center gap-2"
                >
                  <MessageCircle size={18} /> AVISAR PRONTO
                </button>
              </div>
              <button
                onClick={() => {
                  if ("geolocation" in navigator) {
                    navigator.geolocation.getCurrentPosition(
                      (position) => {
                        const { latitude, longitude } = position.coords;
                        const message = `*${workshopData?.name?.toUpperCase() || "OFICINA NOTES"}*\n\nAqui está a nossa localização:\nhttps://maps.google.com/?q=${latitude},${longitude}`;
                        window.open(
                          `https://wa.me/${currentNote.whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`,
                          "_blank",
                        );
                      },
                      () =>
                        alert(
                          "Não foi possível acessar a localização do dispositivo.",
                        ),
                    );
                  } else {
                    alert("Geolocalização não é suportada por este navegador.");
                  }
                }}
                className="w-full bg-zinc-800 text-brand font-black uppercase tracking-widest text-[10px] py-4 rounded flex items-center justify-center gap-2"
              >
                <MapPin size={18} /> ENVIAR LOCALIZAÇÃO
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="p-4 space-y-6">
          <header className="flex items-center gap-4 py-2">
            <button
              onClick={() => {
                saveDraft(currentNote);
                setView("list");
                setPieceSearchTerm("");
              }}
              className="p-2 hover:bg-zinc-800 rounded-full text-zinc-400"
            >
              <ArrowLeft size={24} />
            </button>
            <div className="flex-1">
              <h2 className="text-xl font-bold">
                {step === 1
                  ? "Dados Básicos"
                  : step === 2
                    ? "Peças"
                    : step === 3
                      ? "Detalhes"
                      : step === 4
                        ? "Financeiro"
                        : "Resumo"}
              </h2>
            </div>
          </header>

          <div className="flex gap-1 mb-8">
            {[1, 2, 3, 4, 5].map((s) => (
              <div
                key={s}
                className={`h-1.5 flex-1 rounded-full ${step >= s ? "bg-brand" : "bg-zinc-800"}`}
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
                    <span className="w-1 h-3 bg-brand rounded-full"></span>DADOS
                    DO CLIENTE
                  </h2>
                  <div className="space-y-4">
                    <div>
                      <label className="label-tech">Nome Completo</label>
                      <input
                        type="text"
                        value={currentNote.customerName}
                        onChange={(e) =>
                          setCurrentNote({
                            ...currentNote,
                            customerName: e.target.value,
                          })
                        }
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
                          onChange={(e) =>
                            setCurrentNote({
                              ...currentNote,
                              cpfCnpj: e.target.value,
                            })
                          }
                          className="input-field"
                          placeholder="000.000.000-00"
                        />
                      </div>
                      <div>
                        <label className="label-tech">WhatsApp</label>
                        <input
                          type="tel"
                          value={currentNote.whatsapp}
                          onChange={(e) =>
                            setCurrentNote({
                              ...currentNote,
                              whatsapp: e.target.value,
                            })
                          }
                          className="input-field"
                          placeholder="(00) 00000-0000"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="card">
                  <h2 className="text-xs font-black text-brand uppercase mb-4 flex items-center gap-2">
                    <span className="w-1 h-3 bg-brand rounded-full"></span>
                    DETALHES DO VEÍCULO
                  </h2>
                  <div className="space-y-4">
                    <div>
                      <label className="label-tech">Modelo - Cor</label>
                      <input
                        type="text"
                        value={currentNote.vehicleNameColor}
                        onChange={(e) =>
                          setCurrentNote({
                            ...currentNote,
                            vehicleNameColor: e.target.value,
                          })
                        }
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
                          onChange={(e) =>
                            setCurrentNote({
                              ...currentNote,
                              plate: e.target.value.toUpperCase(),
                            })
                          }
                          className="input-field font-mono"
                          placeholder="ABC-1E23"
                        />
                      </div>
                      <div>
                        <label className="label-tech">Data de Chegada</label>
                        <input
                          type="date"
                          value={currentNote.arrivalDate}
                          onChange={(e) =>
                            setCurrentNote({
                              ...currentNote,
                              arrivalDate: e.target.value,
                            })
                          }
                          className="input-field text-xs"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="label-tech">Status do Serviço</label>
                      <div className="flex gap-2 mt-2">
                        {(
                          Object.keys(SERVICE_STATUS_LABELS) as ServiceStatus[]
                        ).map((statusKey) => (
                          <button
                            key={statusKey}
                            onClick={() =>
                              setCurrentNote({
                                ...currentNote,
                                status: statusKey,
                              })
                            }
                            className={`flex-1 py-3 px-1 rounded border text-[9px] font-black uppercase tracking-tighter transition-all ${
                              currentNote.status === statusKey
                                ? "bg-brand border-brand text-black shadow-[0_0_10px_var(--color-brand-glow)]"
                                : "bg-black/40 border-zinc-800 text-zinc-500"
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
                  <span className="w-1 h-3 bg-brand rounded-full"></span>
                  CHECKLIST DE LATARIA
                </h2>

                <div className="relative mb-4">
                  <Search
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-700"
                    size={16}
                  />
                  <input
                    type="text"
                    placeholder="Pesquisar peça..."
                    value={pieceSearchTerm}
                    onChange={(e) => setPieceSearchTerm(e.target.value)}
                    className="w-full bg-black/40 border border-zinc-900 rounded p-2 pl-9 text-sm text-white focus:outline-none focus:border-brand transition-colors placeholder:text-zinc-700"
                  />
                  {pieceSearchTerm && (
                    <button
                      onClick={() => setPieceSearchTerm("")}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-white"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-2">
                  {(currentNote.pieces || [])
                    .filter((piece) =>
                      piece.label
                        .toLowerCase()
                        .includes(pieceSearchTerm.toLowerCase()),
                    )
                    .map((piece) => (
                      <div
                        key={piece.id}
                        onClick={() =>
                          updatePiece(piece.id, { selected: !piece.selected })
                        }
                        className={`flex items-center gap-3 p-3 rounded border transition-all cursor-pointer ${
                          piece.selected
                            ? "bg-brand/10 border-brand text-white shadow-[0_0_10px_var(--color-brand-glow)]"
                            : "bg-black/40 border-zinc-900 text-zinc-500"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={piece.selected}
                          readOnly
                          className="w-4 h-4 accent-brand bg-black"
                        />
                        <span className="text-[11px] font-black uppercase tracking-widest">
                          {piece.label}
                        </span>
                      </div>
                    ))}
                    
                    {pieceSearchTerm &&
                    (currentNote.pieces || []).filter((piece) =>
                      piece.label.toLowerCase().includes(pieceSearchTerm.toLowerCase())
                    ).length === 0 && (
                      <button
                        onClick={() => {
                           const newId = pieceSearchTerm.toLowerCase().replace(/\s+/g, "_") + "_" + Date.now();
                           setCurrentNote({
                             ...currentNote,
                             pieces: [
                               { id: newId, label: pieceSearchTerm, selected: true, description: "" },
                               ...(currentNote.pieces || [])
                             ]
                           });
                           setPieceSearchTerm("");
                        }}
                        className="flex items-center justify-center gap-3 p-3 rounded border border-dashed border-zinc-700 hover:border-brand text-brand bg-black/40 cursor-pointer transition-colors"
                      >
                         <PlusCircle size={14} />
                         <span className="text-[11px] font-black uppercase tracking-widest">
                           ADICIONAR "{pieceSearchTerm}"
                         </span>
                      </button>
                    )}
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
                  <span className="w-1 h-3 bg-brand rounded-full"></span>NOTAS
                  DE SERVIÇO
                </h2>
                {(currentNote.pieces || []).filter((p) => p.selected).length === 0 ? (
                  <div className="text-center py-10 text-zinc-600 italic">
                    Nenhuma peça selecionada na etapa anterior.
                  </div>
                ) : (
                  (currentNote.pieces || [])
                    .filter((p) => p.selected)
                    .map((piece) => (
                      <div key={piece.id} className="card space-y-3">
                        <div className="flex justify-between items-center bg-black/40 -mx-4 -mt-4 p-3 mb-3 border-b border-zinc-800 rounded-t-xl">
                          <h3 className="font-black text-brand text-[11px] tracking-widest uppercase">
                            {piece.label}
                          </h3>
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
                                  className={`p-1.5 rounded transition-colors ${isListening === piece.id ? "bg-brand text-black" : "bg-zinc-800 text-brand hover:bg-zinc-700"}`}
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
                                  onClick={() =>
                                    updatePiece(piece.id, {
                                      audioBlob: undefined,
                                    })
                                  }
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
                          onChange={(e) =>
                            updatePiece(piece.id, {
                              description: e.target.value,
                            })
                          }
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
                        onChange={(e) =>
                          setCurrentNote({
                            ...currentNote,
                            onlyTotalValue: e.target.checked,
                          })
                        }
                        className="w-4 h-4 accent-black"
                      />
                      <label
                        htmlFor="onlyTotal"
                        className="text-[9px] font-black"
                      >
                        APENAS TOTAL
                      </label>
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
                                onChange={(e) =>
                                  setCurrentNote({
                                    ...currentNote,
                                    includePartsValue: e.target.checked,
                                  })
                                }
                                className="w-4 h-4 accent-black"
                              />
                              <label
                                htmlFor="incParts"
                                className="text-[10px] font-black uppercase"
                              >
                                Peças
                              </label>
                            </div>
                            {currentNote.includePartsValue && (
                              <div className="w-24">
                                <input
                                  type="number"
                                  step="0.01"
                                  value={currentNote.partsValue || ""}
                                  onChange={(e) =>
                                    setCurrentNote({
                                      ...currentNote,
                                      partsValue:
                                        e.target.value === ""
                                          ? 0
                                          : Number(e.target.value),
                                    })
                                  }
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
                              onChange={(e) =>
                                setCurrentNote({
                                  ...currentNote,
                                  includeLaborValue: e.target.checked,
                                })
                              }
                              className="w-4 h-4 accent-black"
                            />
                            <label
                              htmlFor="incLabor"
                              className="text-[10px] font-black uppercase"
                            >
                              Mão de Obra
                            </label>
                          </div>
                          {currentNote.includeLaborValue && (
                            <div className="w-24">
                              <input
                                type="number"
                                step="0.01"
                                value={currentNote.laborValue || ""}
                                onChange={(e) =>
                                  setCurrentNote({
                                    ...currentNote,
                                    laborValue:
                                      e.target.value === ""
                                        ? 0
                                        : Number(e.target.value),
                                  })
                                }
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
                              onChange={(e) =>
                                setCurrentNote({
                                  ...currentNote,
                                  includeMaterialsValue: e.target.checked,
                                })
                              }
                              className="w-4 h-4 accent-black"
                            />
                            <label
                              htmlFor="incMat"
                              className="text-[10px] font-black uppercase"
                            >
                              Materiais
                            </label>
                          </div>
                          {currentNote.includeMaterialsValue && (
                            <div className="w-24">
                              <input
                                type="number"
                                step="0.01"
                                value={currentNote.materialsValue || ""}
                                onChange={(e) =>
                                  setCurrentNote({
                                    ...currentNote,
                                    materialsValue:
                                      e.target.value === ""
                                        ? 0
                                        : Number(e.target.value),
                                  })
                                }
                                className="w-full bg-transparent border-b border-black/30 text-xs font-bold font-mono py-1 rounded-none outline-none focus:border-black"
                              />
                            </div>
                          )}
                        </div>
                      </>
                    ) : (
                      <div className="flex items-center justify-between bg-black/10 p-4 rounded-xl border border-black/10">
                        <label className="text-[10px] font-black uppercase">
                          Valor Total do Serviço
                        </label>
                        <div className="w-40">
                          <input
                            type="number"
                            step="0.01"
                            value={currentNote.totalValue || ""}
                            onChange={(e) =>
                              setCurrentNote({
                                ...currentNote,
                                totalValue:
                                  e.target.value === ""
                                    ? 0
                                    : Number(e.target.value),
                              })
                            }
                            className="w-full bg-transparent border-b-2 border-black/30 text-2xl font-black font-mono py-1 rounded-none outline-none focus:border-black text-right"
                            placeholder="0,00"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="pt-4 border-t border-black/20">
                    <div className="flex justify-between items-end">
                      <span className="text-[10px] font-black uppercase opacity-60">
                        Valor total calculado
                      </span>
                      <span className="text-3xl font-black italic tracking-tighter">
                        R${" "}
                        {totalValue.toLocaleString("pt-BR", {
                          minimumFractionDigits: 2,
                        })}
                      </span>
                    </div>
                  </div>
                </div>

                {(currentNote.includePartsValue ||
                  currentNote.includeMaterialsValue) &&
                  !currentNote.onlyTotalValue && (
                    <div className="card border-t-4 border-t-brand">
                      <h2 className="text-[10px] font-black text-brand uppercase mb-4 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="w-1 h-3 bg-brand rounded-full"></span>
                          LISTA DE MATERIAIS / PEÇAS
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setIsMaterialModalOpen(true)}
                            className="text-[10px] bg-zinc-800 text-white px-3 py-1.5 rounded font-black flex items-center gap-1.5 active:scale-95 transition-all shadow-lg"
                          >
                            <Search size={14} /> BUSCAR MATERIAIS
                          </button>
                          <button
                            onClick={() => {
                              const newItem: MaterialItem = {
                                id: generateUUID(),
                                name: "",
                                quantity: 1,
                                price: 0,
                              };
                              setCurrentNote({
                                ...currentNote,
                                materialItems: [
                                  ...(currentNote.materialItems || []),
                                  newItem,
                                ],
                              });
                            }}
                            className="text-[10px] bg-brand text-black px-3 py-1.5 rounded font-black flex items-center gap-1.5 active:scale-95 transition-all shadow-lg"
                          >
                            <PlusCircle size={14} /> NOVO ITEM
                          </button>
                        </div>
                      </h2>

                      <div className="space-y-3">
                        {((currentNote.materialItems || [])?.length || 0) === 0 ? (
                          <div className="p-8 border border-zinc-900 border-dashed rounded-xl text-center">
                            <p className="text-[10px] text-zinc-600 italic uppercase">
                              Adicione itens para detalhar as peças ou materiais
                              utilizados.
                            </p>
                          </div>
                        ) : (
                          (currentNote.materialItems || []).map((item, idx) => (
                            <div
                              key={item.id}
                              className="flex flex-col gap-2 group bg-black/40 p-3 rounded-lg border border-zinc-900 shadow-sm"
                            >
                              <div className="flex justify-between items-start gap-2">
                                <div className="flex-1">
                                  <input
                                    type="text"
                                    value={item.name}
                                    placeholder="EX: LAMPADA H7"
                                    onChange={(e) => {
                                      const newList = [
                                        ...(currentNote.materialItems || []),
                                      ];
                                      newList[idx].name =
                                        e.target.value.toUpperCase();
                                      setCurrentNote({
                                        ...currentNote,
                                        materialItems: newList,
                                      });
                                    }}
                                    className="w-full bg-transparent text-sm font-bold text-white outline-none placeholder:text-zinc-700"
                                  />
                                </div>
                                <button
                                  onClick={() => {
                                    const newList = (
                                      (currentNote.materialItems || []) || []
                                    ).filter((i) => i.id !== item.id);
                                    setCurrentNote({
                                      ...currentNote,
                                      materialItems: newList,
                                    });
                                  }}
                                  className="text-zinc-700 hover:text-red-500 transition-colors"
                                >
                                  <X size={16} />
                                </button>
                              </div>

                              <div className="flex justify-between items-center mt-1 border-t border-zinc-900/50 pt-2">
                                <div className="flex items-center gap-2">
                                  <label className="text-[10px] text-zinc-500 uppercase font-black">Qtd:</label>
                                  <input
                                    type="number"
                                    inputMode="numeric"
                                    value={item.quantity || ""}
                                    placeholder="1"
                                    onChange={(e) => {
                                      const newList = [...(currentNote.materialItems || [])];
                                      newList[idx].quantity = e.target.value === "" ? 0 : Number(e.target.value);
                                      setCurrentNote({ ...currentNote, materialItems: newList });
                                    }}
                                    className="w-12 bg-transparent text-xs text-center outline-none text-brand font-mono border-b border-zinc-800 focus:border-brand"
                                  />
                                </div>
                                <div className="flex items-center gap-2">
                                  <label className="text-[10px] text-zinc-500 uppercase font-black">Preço:</label>
                                  <div className="relative">
                                    <span className="absolute left-0 top-1/2 -translate-y-1/2 text-zinc-600 text-[10px]">R$</span>
                                    <input
                                      type="number"
                                      inputMode="decimal"
                                      value={item.price || ""}
                                      placeholder="0,00"
                                      onChange={(e) => {
                                        const newList = [
                                          ...(currentNote.materialItems || []),
                                        ];
                                        newList[idx].price =
                                          e.target.value === ""
                                            ? 0
                                            : Number(e.target.value);
                                        setCurrentNote({
                                          ...currentNote,
                                          materialItems: newList,
                                        });
                                      }}
                                      className="w-20 bg-transparent text-xs text-right pl-4 outline-none text-white font-mono border-b border-zinc-800 focus:border-brand"
                                    />
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}

                <div className="card">
                  <h2 className="text-xs font-black text-brand uppercase mb-4 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-1 h-3 bg-brand rounded-full"></span>
                      OBSERVAÇÕES GERAIS
                    </div>
                    <div className="flex gap-2">
                      {isTranscribing === "observations" ? (
                        <div className="flex items-center gap-1 text-[10px] text-brand">
                          <Loader2 size={12} className="animate-spin" />
                          <span>TRANSCREVENDO...</span>
                        </div>
                      ) : isRecording === "observations" ? (
                        <button
                          onClick={stopRecording}
                          className="bg-red-600 text-white p-1.5 rounded animate-pulse shadow-[0_0_10px_rgba(220,38,38,0.5)]"
                        >
                          <StopCircle size={14} strokeWidth={3} />
                        </button>
                      ) : (
                        <div className="flex gap-1">
                          <button
                            onClick={() => startRecording("observations")}
                            className="bg-zinc-800 text-brand p-1.5 rounded hover:bg-zinc-700 transition-colors"
                            title="Gravar Áudio e Transcrever"
                          >
                            <AudioLines size={14} strokeWidth={3} />
                          </button>
                          <button
                            onClick={() => {
                              const SpeechRecognition =
                                (window as any).SpeechRecognition ||
                                (window as any).webkitSpeechRecognition;
                              if (!SpeechRecognition) {
                                alert(
                                  "Seu navegador não suporta reconhecimento de voz.",
                                );
                                return;
                              }
                              const recognition = new SpeechRecognition();
                              recognition.lang = "pt-BR";
                              recognition.onstart = () =>
                                setIsListening("observations");
                              recognition.onend = () => setIsListening(null);
                              recognition.onresult = (event: any) => {
                                const transcript =
                                  event.results[0][0].transcript;
                                setCurrentNote((prev) => ({
                                  ...prev,
                                  observations:
                                    prev.observations +
                                    (prev.observations ? " " : "") +
                                    transcript,
                                }));
                              };
                              recognition.start();
                            }}
                            className={`p-1.5 rounded transition-colors ${isListening === "observations" ? "bg-brand text-black" : "bg-zinc-800 text-brand hover:bg-zinc-700"}`}
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
                    onChange={(e) =>
                      setCurrentNote({
                        ...currentNote,
                        observations: e.target.value,
                      })
                    }
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
                      <span className="w-1 h-3 bg-brand rounded-full"></span>
                      CLIENTE
                    </h2>
                    <p className="font-black text-xl italic tracking-tighter uppercase">
                      {currentNote.customerName || "NÃO INFORMADO"}
                    </p>
                    <p className="text-zinc-500 font-mono text-xs mt-1">
                      {currentNote.whatsapp}
                    </p>
                  </div>
                  <div className="border-b border-zinc-800 pb-4 flex justify-between items-start">
                    <div>
                      <h2 className="text-[10px] font-black text-brand uppercase mb-3 flex items-center gap-2">
                        <span className="w-1 h-3 bg-brand rounded-full"></span>
                        VEÍCULO
                      </h2>
                      <p className="font-bold opacity-80 uppercase">
                        {currentNote.vehicleNameColor}
                      </p>
                      <p className="font-black text-2xl font-mono text-white tracking-widest mt-1">
                        {currentNote.plate}
                      </p>
                      {currentNote.arrivalDate && (
                        <p className="text-[10px] text-zinc-500 mt-2 uppercase font-bold flex items-center gap-1">
                          <Calendar size={10} /> Chegada:{" "}
                          {format(
                            new Date(currentNote.arrivalDate + "T12:00:00"),
                            "dd/MM/yyyy",
                          )}
                        </p>
                      )}

                      <div className="mt-4 pt-4 border-t border-zinc-800">
                        <label className="label-tech mb-2 block">
                          Alterar Data de Chegada
                        </label>
                        <input
                          type="date"
                          value={currentNote.arrivalDate}
                          onChange={(e) =>
                            setCurrentNote({
                              ...currentNote,
                              arrivalDate: e.target.value,
                            })
                          }
                          className="input-field text-xs bg-black/40"
                        />
                      </div>
                    </div>
                    <div
                      className={`px-2 py-1 rounded text-[9px] font-black uppercase ${
                        currentNote.status === "finalizado"
                          ? "bg-green-500 text-black"
                          : currentNote.status === "na_oficina"
                            ? "bg-blue-500 text-white"
                            : "bg-zinc-800 text-zinc-400"
                      }`}
                    >
                      {SERVICE_STATUS_LABELS[currentNote.status]}
                    </div>
                  </div>
                  <div>
                    <h2 className="text-[10px] font-black text-brand uppercase mb-3 flex items-center gap-2">
                      <span className="w-1 h-3 bg-brand rounded-full"></span>
                      VALOR FINAL
                    </h2>
                    <div className="flex flex-col gap-1">
                      {!currentNote.onlyTotalValue ? (
                        <>
                          {currentNote.includePartsValue && (
                            <div className="flex justify-between font-mono text-[10px] opacity-60 uppercase">
                              <span>Peças:</span>
                              <span>
                                R$ {currentNote.partsValue.toFixed(2)}
                              </span>
                            </div>
                          )}
                          {currentNote.includeLaborValue && (
                            <div className="flex justify-between font-mono text-[10px] opacity-60 uppercase">
                              <span>Mão de Obra:</span>
                              <span>
                                R$ {currentNote.laborValue.toFixed(2)}
                              </span>
                            </div>
                          )}
                          {currentNote.includeMaterialsValue && (
                            <div className="flex justify-between font-mono text-[10px] opacity-60 uppercase">
                              <span>Materiais:</span>
                              <span>
                                R$ {currentNote.materialsValue.toFixed(2)}
                              </span>
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="flex justify-between font-mono text-[10px] opacity-60 uppercase italic">
                          <span>Valor Fechado:</span>
                        </div>
                      )}

                      {(() => {
                        const filteredItems = (currentNote.materialItems || []).filter(item => (item.price > 0 || (item.quantity && item.quantity > 0)));
                        if (filteredItems.length > 0 && !currentNote.onlyTotalValue) {
                          return (
                            <div className="mt-2 pt-2 border-t border-zinc-800/50 space-y-1">
                              {filteredItems.map((item) => {
                                const qtyStr = item.quantity && item.quantity > 0 ? `${item.quantity}x ` : "";
                                const itemTotal = (item.quantity && item.quantity > 0 ? item.quantity : 1) * (item.price || 0);
                                return (
                                  <div
                                    key={item.id}
                                    className="flex justify-between text-[8px] text-zinc-500 uppercase"
                                  >
                                    <span>{qtyStr}{item.name}</span>
                                    <span className="font-mono">
                                      R$ {itemTotal.toFixed(2)}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        }
                        return null;
                      })()}

                      <div className="flex justify-between items-end mt-2">
                        <span className="text-3xl font-black italic tracking-tighter text-brand">
                          R${" "}
                          {totalValue.toLocaleString("pt-BR", {
                            minimumFractionDigits: 2,
                          })}
                        </span>
                      </div>
                    </div>
                  </div>
                  {currentNote.observations && (
                    <div className="pt-4 border-t border-zinc-800">
                      <h2 className="text-[10px] font-black text-brand uppercase mb-2 flex items-center gap-2">
                        <span className="w-1 h-3 bg-brand rounded-full"></span>
                        OBSERVAÇÕES
                      </h2>
                      <p className="text-[11px] text-zinc-400 whitespace-pre-wrap">
                        {currentNote.observations}
                      </p>
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

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => {
                        const message = `*OFICINA NOTES - ORDEM DE SERVIÇO*\n\n*CLIENTE:* ${currentNote.customerName}\n*VEÍCULO:* ${currentNote.vehicleNameColor}\n*PLACA:* ${currentNote.plate}\n*TOTAL:* R$ ${totalValue.toFixed(2)}`;
                        window.open(
                          `https://wa.me/${currentNote.whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`,
                          "_blank",
                        );
                      }}
                      className="w-full flex items-center justify-center gap-2 bg-[#25D366] text-black font-black uppercase tracking-widest text-[10px] py-4 rounded transition-all active:scale-95"
                    >
                      <Play size={18} className="fill-current" />
                      COMPARTILHAR
                    </button>
                    <button
                      onClick={() => setReadyModalNote(currentNote)}
                      className="w-full flex items-center justify-center gap-2 bg-[#25D366]/20 border border-[#25D366]/50 text-[#25D366] font-black uppercase tracking-widest text-[10px] py-4 rounded transition-all active:scale-95"
                    >
                      <MessageCircle size={18} />
                      AVISAR PRONTO
                    </button>
                  </div>
                  <button
                    onClick={() => {
                      if ("geolocation" in navigator) {
                        navigator.geolocation.getCurrentPosition(
                          (position) => {
                            const { latitude, longitude } = position.coords;
                            const message = `*${workshopData?.name?.toUpperCase() || "OFICINA NOTES"}*\n\nAqui está a nossa localização:\nhttps://maps.google.com/?q=${latitude},${longitude}`;
                            window.open(
                              `https://wa.me/${currentNote.whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(message)}`,
                              "_blank",
                            );
                          },
                          () =>
                            alert(
                              "Não foi possível acessar a localização do dispositivo.",
                            ),
                        );
                      } else {
                        alert(
                          "Geolocalização não é suportada por este navegador.",
                        );
                      }
                    }}
                    className="w-full bg-zinc-800 text-brand font-black uppercase tracking-widest text-[10px] py-4 rounded flex items-center justify-center gap-2"
                  >
                    <MapPin size={18} /> ENVIAR LOCALIZAÇÃO
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
                onClick={() => setStep((s) => s - 1)}
                className="flex-1 btn-secondary flex items-center justify-center gap-2"
              >
                <ChevronLeft size={16} strokeWidth={3} /> VOLTAR
              </button>
            )}
            {step < 5 ? (
              <button
                onClick={() => setStep((s) => s + 1)}
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

      <AnimatePresence>
        {isWorkshopDataModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
            >
              <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
                <h3 className="text-xl font-bold text-white flex items-center gap-2">
                  <Home size={20} className="text-brand" />
                  Dados da Oficina
                </h3>
                <button
                  onClick={() => setIsWorkshopDataModalOpen(false)}
                  className="p-2 text-zinc-400 hover:text-white rounded-full hover:bg-zinc-800 transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="p-4 overflow-y-auto w-full">
                <form
                  className="w-full flex flex-col gap-4 text-left"
                  onSubmit={(e) => {
                    e.preventDefault();
                    setWorkshopData(draftWorkshopData);
                    localStorage.setItem(
                      "workshopData",
                      JSON.stringify(draftWorkshopData),
                    );
                    setIsWorkshopDataModalOpen(false);
                    alert("Dados salvos com sucesso!");
                  }}
                >
                  <div>
                    <label className="block text-xs font-semibold text-zinc-400 mb-1 uppercase">
                      Nome da Oficina
                    </label>
                    <input
                      required
                      value={draftWorkshopData.name}
                      onChange={(e) =>
                        setDraftWorkshopData((prev) => ({
                          ...prev,
                          name: e.target.value,
                        }))
                      }
                      type="text"
                      className="w-full bg-black border border-zinc-800 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-brand transition-colors"
                      placeholder="Ex: Oficina do João"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-zinc-400 mb-1 uppercase">
                      CNPJ (Opcional)
                    </label>
                    <input
                      value={draftWorkshopData.cnpj}
                      onChange={(e) =>
                        setDraftWorkshopData((prev) => ({
                          ...prev,
                          cnpj: e.target.value,
                        }))
                      }
                      type="text"
                      className="w-full bg-black border border-zinc-800 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-brand transition-colors"
                      placeholder="Ex: 00.000.000/0000-00"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-zinc-400 mb-1 uppercase">
                      Endereço/Localização
                    </label>
                    <input
                      required
                      value={draftWorkshopData.location}
                      onChange={(e) =>
                        setDraftWorkshopData((prev) => ({
                          ...prev,
                          location: e.target.value,
                        }))
                      }
                      type="text"
                      className="w-full bg-black border border-zinc-800 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-brand transition-colors"
                      placeholder="Ex: Rua das Flores, 123"
                    />
                  </div>

                  <button
                    type="submit"
                    className="w-full py-4 mt-2 rounded-xl font-bold text-black bg-brand hover:bg-brand/90 transition-colors uppercase tracking-widest text-xs shadow-[0_0_30px_rgba(34,197,94,0.2)]"
                  >
                    Salvar Alterações
                  </button>
                </form>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isExportsModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
            >
              <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
                <h3 className="text-xl font-bold text-white flex items-center gap-2">
                  <Download size={20} className="text-brand" />
                  Histórico de Exportações
                </h3>
                <button
                  onClick={() => setIsExportsModalOpen(false)}
                  className="p-2 text-zinc-400 hover:text-white rounded-full hover:bg-zinc-800 transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {exportsList.length === 0 ? (
                  <div className="text-center py-8 text-zinc-500 text-sm font-medium">
                    Nenhuma planilha exportada ainda.
                  </div>
                ) : (
                  exportsList.map((exp) => (
                    <div
                      key={exp.id}
                      className="bg-black/40 border border-zinc-800 rounded-xl p-4 flex items-center justify-between"
                    >
                      <div>
                        <p className="text-white font-medium text-sm truncate max-w-[200px]">
                          {exp.fileName}
                        </p>
                        <p className="text-xs text-zinc-500 font-medium">
                          {format(
                            new Date(exp.createdAt),
                            "dd/MM/yyyy 'às' HH:mm",
                          )}{" "}
                          • {exp.notesCount} nota(s)
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() =>
                            generateAndDownloadPdf(
                              exp.fileName,
                              exp.exportDataJson,
                            )
                          }
                          className="p-2 bg-zinc-800 text-white rounded-lg hover:bg-zinc-700 transition-colors"
                          title="Baixar novamente"
                        >
                          <Download size={18} />
                        </button>
                        <button
                          onClick={() => handleDeleteExport(exp.id)}
                          className="p-2 bg-red-500/10 text-red-500 rounded-lg hover:bg-red-500 hover:text-white transition-colors"
                          title="Excluir planilha"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </motion.div>
        )}

        {isCalculatorOpen && (
          <CalculatorModal onClose={() => setIsCalculatorOpen(false)} />
        )}

        {isMaterialModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl p-6 flex flex-col h-[80vh]"
            >
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-bold text-white uppercase tracking-widest text-sm">
                  Materiais
                </h3>
                <button
                  onClick={() => setIsMaterialModalOpen(false)}
                  className="text-zinc-500 hover:text-white transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="relative mb-4">
                <Search
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-700"
                  size={16}
                />
                <input
                  type="text"
                  placeholder="Pesquisar material..."
                  value={materialSearchTerm}
                  onChange={(e) => setMaterialSearchTerm(e.target.value)}
                  className="w-full bg-black/40 border border-zinc-800 rounded p-3 pl-10 text-sm text-white focus:outline-none focus:border-brand transition-colors placeholder:text-zinc-600"
                />
                {materialSearchTerm && (
                  <button
                    onClick={() => setMaterialSearchTerm("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-white"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              <div className="flex-1 overflow-y-auto space-y-2 pr-2">
                {FUNILARIA_MATERIALS_LIST.filter((m) =>
                  m.name.toLowerCase().includes(materialSearchTerm.toLowerCase()),
                ).map((material) => {
                  const isSelected = (currentNote.materialItems || [])?.some(
                    (item) => item.id === material.id,
                  );
                  return (
                    <div
                      key={material.id}
                      onClick={() => {
                        if (isSelected) {
                          setCurrentNote({
                            ...currentNote,
                            materialItems: (currentNote.materialItems || []).filter(
                              (i) => i.id !== material.id,
                            ),
                          });
                        } else {
                          setCurrentNote({
                            ...currentNote,
                            materialItems: [
                              ...(currentNote.materialItems || []),
                              {
                                id: material.id,
                                name: material.name,
                                quantity: 1,
                                price: 0,
                              },
                            ],
                          });
                        }
                      }}
                      className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all ${
                        isSelected
                          ? "bg-brand/10 border-brand text-white"
                          : "bg-black/40 border-zinc-800 text-zinc-400 hover:border-zinc-700"
                      }`}
                    >
                      <span className="text-xs font-bold">{material.name}</span>
                      <div
                        className={`w-4 h-4 rounded flex items-center justify-center ${
                          isSelected ? "bg-brand text-black" : "bg-zinc-800"
                        }`}
                      >
                        {isSelected && <Check size={12} strokeWidth={4} />}
                      </div>
                    </div>
                  );
                })}
                
                {materialSearchTerm &&
                  FUNILARIA_MATERIALS_LIST.filter((m) =>
                    m.name.toLowerCase().includes(materialSearchTerm.toLowerCase()),
                  ).length === 0 && (
                    <div
                      onClick={() => {
                        const newId = materialSearchTerm.toLowerCase().replace(/\s+/g, "_") + "_" + Date.now();
                        setCurrentNote({
                          ...currentNote,
                          materialItems: [
                            ...(currentNote.materialItems || []),
                            {
                              id: newId,
                              name: materialSearchTerm.toUpperCase(),
                              quantity: 1,
                              price: 0,
                            },
                          ],
                        });
                        setMaterialSearchTerm("");
                      }}
                      className="flex items-center justify-center gap-2 p-3 rounded-lg border border-dashed border-zinc-700 hover:border-brand cursor-pointer text-brand bg-black/40 transition-all mt-2"
                    >
                      <PlusCircle size={14} />
                      <span className="text-xs font-bold uppercase">Adicionar "{materialSearchTerm}"</span>
                    </div>
                  )}
              </div>
            </motion.div>
          </motion.div>
        )}

        {isConfirmExportOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl p-6"
            >
              <h3 className="text-xl font-bold text-white mb-2">
                Exportar planilhas?
              </h3>
              <p className="text-zinc-400 mb-6 text-sm">
                Isso gerará um arquivo PDF e excluirá todas as notas finalizadas
                permanentemente desta lista para limpar espaço. O arquivo de
                exportação ficará salvo no histórico.
              </p>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setIsConfirmExportOpen(false)}
                  className="px-4 py-2 rounded font-medium text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleExportFinished}
                  className="px-4 py-2 rounded font-medium bg-blue-500 text-white hover:bg-blue-600 transition-colors flex items-center gap-2"
                >
                  <Download size={16} /> Exportar
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}

        {noteToDelete && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl p-6"
            >
              <h3 className="text-xl font-bold text-white mb-2">
                Excluir nota?
              </h3>
              <p className="text-zinc-400 mb-6">
                Tem certeza que deseja excluir esta nota? Esta ação não pode ser
                desfeita.
              </p>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setNoteToDelete(null)}
                  className="px-4 py-2 rounded font-medium text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={confirmDeleteNote}
                  className="px-4 py-2 rounded font-medium bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white transition-colors"
                >
                  Excluir
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}

        {readyModalNote && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl p-6"
            >
              <h3 className="text-xl font-bold text-white mb-4">
                Avisar Pronto
              </h3>

              <div className="space-y-4 mb-6">
                <div>
                  <label className="text-xs font-bold text-zinc-500 uppercase">
                    A partir das:
                  </label>
                  <input
                    type="time"
                    value={readyFromTime}
                    onChange={(e) => setReadyFromTime(e.target.value)}
                    className="w-full bg-black/40 border border-zinc-800 rounded p-2 text-white outline-none focus:border-[#25D366] transition-colors mt-1"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-zinc-500 uppercase">
                    Até as:
                  </label>
                  <input
                    type="time"
                    value={readyUntilTime}
                    onChange={(e) => setReadyUntilTime(e.target.value)}
                    className="w-full bg-black/40 border border-zinc-800 rounded p-2 text-white outline-none focus:border-[#25D366] transition-colors mt-1"
                  />
                </div>
                <div className="flex items-center gap-2 pt-2">
                  <input
                    type="checkbox"
                    id="readyIncludeValue"
                    checked={readyIncludeValue}
                    onChange={(e) => setReadyIncludeValue(e.target.checked)}
                    className="w-4 h-4 rounded border-zinc-700 bg-zinc-800 text-[#25D366] focus:ring-[#25D366] focus:ring-offset-zinc-900"
                  />
                  <label
                    htmlFor="readyIncludeValue"
                    className="text-sm text-zinc-300"
                  >
                    Incluir valor total na mensagem
                  </label>
                </div>
                {readyModalError && (
                  <p className="text-red-500 text-sm font-medium">
                    {readyModalError}
                  </p>
                )}
              </div>

              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => {
                    setReadyModalNote(null);
                    setReadyModalError(null);
                    setReadyFromTime("");
                    setReadyUntilTime("");
                    setReadyIncludeValue(true);
                  }}
                  className="px-4 py-2 rounded font-medium text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={confirmReadyMessage}
                  className="px-4 py-2 rounded font-medium bg-[#25D366] text-black hover:brightness-110 flex items-center gap-2 transition-all active:scale-95"
                >
                  <MessageCircle size={16} className="fill-current" />
                  Enviar
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
