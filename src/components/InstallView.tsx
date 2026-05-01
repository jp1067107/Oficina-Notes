import React, { useEffect, useState } from 'react';
import { Download, Share, PlusSquare, ArrowLeft, Smartphone, CheckCircle2 } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: Array<string>;
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

export const InstallView: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [showIOSInstructions, setShowIOSInstructions] = useState(false);
  const [showManualInstructions, setShowManualInstructions] = useState(false);

  useEffect(() => {
    const checkStandalone = () => {
      const isStandaloneMode = window.matchMedia('(display-mode: standalone)').matches || 
                               (window.navigator as any).standalone === true;
      setIsStandalone(isStandaloneMode);
    };

    checkStandalone();
    const mediaQuery = window.matchMedia('(display-mode: standalone)');
    mediaQuery.addEventListener('change', checkStandalone);

    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIOSDevice = /iphone|ipad|ipod/.test(userAgent);
    setIsIOS(isIOSDevice);

    if ((window as any).deferredPrompt) {
      setDeferredPrompt((window as any).deferredPrompt);
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', handler);

    const installHandler = () => {
      setDeferredPrompt(null);
      setIsStandalone(true);
    };
    window.addEventListener('appinstalled', installHandler);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('appinstalled', installHandler);
      mediaQuery.removeEventListener('change', checkStandalone);
    };
  }, []);

  const handleInstallClick = async () => {
    if (isIOS) {
      setShowIOSInstructions(true);
      return;
    }

    if (!deferredPrompt) {
      // Instead of an alert window, let's open an instruction modal for manual installation
      setShowManualInstructions(true);
      return;
    }
    
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
    }
  };

  return (
    <div className="p-4 space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300 min-h-[80vh] flex flex-col">
      <header className="flex items-center gap-4 py-4 border-b border-zinc-900 sticky top-0 bg-black/80 backdrop-blur-md z-10 -mx-4 px-4">
        <button onClick={onBack} className="p-2 hover:bg-zinc-800 rounded-full text-zinc-400">
          <ArrowLeft size={24} />
        </button>
        <h2 className="text-xl font-black italic tracking-tighter uppercase text-white">Instalar Aplicativo</h2>
      </header>

      <div className="flex-1 flex flex-col items-center justify-center text-center py-8">
        <div className="w-24 h-24 bg-brand/20 rounded-3xl flex items-center justify-center mb-8 text-brand relative">
          <Smartphone size={48} strokeWidth={2} />
          {isStandalone && (
            <div className="absolute -bottom-2 -right-2 bg-black rounded-full p-1">
              <CheckCircle2 size={24} className="text-brand" />
            </div>
          )}
        </div>

        <h3 className="text-2xl font-black italic tracking-tighter uppercase mb-4">
          Oficina<span className="text-brand">Notes</span>
        </h3>

        <p className="text-zinc-400 font-medium mb-8 max-w-sm px-4">
          Tenha acesso rápido aos seus orçamentos e notas de serviço diretamente da tela inicial do seu celular.
        </p>

        <div className="w-full max-w-sm space-y-4 mb-12 text-left">
          <div className="flex items-center gap-3 bg-zinc-900/50 p-4 rounded-2xl border border-zinc-800">
            <div className="w-10 h-10 rounded-full bg-brand/10 flex items-center justify-center text-brand shrink-0">✨</div>
            <div>
              <p className="font-bold text-white text-sm uppercase tracking-wider">Acesso Imediato</p>
              <p className="text-xs text-zinc-500 mt-0.5">Sem precisar abrir o navegador</p>
            </div>
          </div>
          <div className="flex items-center gap-3 bg-zinc-900/50 p-4 rounded-2xl border border-zinc-800">
            <div className="w-10 h-10 rounded-full bg-brand/10 flex items-center justify-center text-brand shrink-0">🚀</div>
            <div>
              <p className="font-bold text-white text-sm uppercase tracking-wider">Desempenho Nativo</p>
              <p className="text-xs text-zinc-500 mt-0.5">Ocupa menos de 5MB de espaço</p>
            </div>
          </div>
        </div>

        {isStandalone ? (
          <div className="w-full max-w-sm flex flex-col items-center justify-center gap-3 bg-zinc-900/80 text-brand p-5 rounded-2xl font-black border border-brand/20">
            <CheckCircle2 className="w-8 h-8" />
            <span className="text-lg uppercase tracking-wider">Aplicativo Instalado</span>
            <span className="text-xs font-bold opacity-80 uppercase tracking-widest text-brand/60">Tudo pronto para usar</span>
          </div>
        ) : (
          <button
            onClick={handleInstallClick}
            className="w-full max-w-sm flex flex-col items-center justify-center gap-2 bg-brand text-black p-5 rounded-2xl font-black transition-transform active:scale-95 shadow-[0_6px_0_#16a34a] active:shadow-[0_0px_0_#16a34a] active:translate-y-[6px]"
          >
            <div className="flex items-center gap-3">
              <Download className="w-8 h-8" strokeWidth={3} />
              <span className="text-lg sm:text-xl uppercase tracking-wider">Instalar no Celular 📲</span>
            </div>
            <span className="text-sm font-bold opacity-80 uppercase tracking-widest text-[#064e3b]">Rápido e Ocupa Pouco Espaço</span>
          </button>
        )}
      </div>

      {showIOSInstructions && (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/80 p-4 pb-12 sm:pb-4 animate-in fade-in duration-200" onClick={() => setShowIOSInstructions(false)}>
          <div 
            className="bg-zinc-900 border-2 border-brand rounded-2xl p-6 shadow-2xl max-w-sm w-full relative animate-in slide-in-from-bottom-4 sm:slide-in-from-bottom-0 sm:zoom-in-95 duration-200"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex flex-col items-center text-center">
              <div className="w-20 h-20 bg-brand/20 rounded-2xl flex items-center justify-center mb-4 text-brand">
                <Download className="w-10 h-10" />
              </div>
              <h3 className="text-2xl font-black text-white mb-2 uppercase italic tracking-tighter">Instalar no iPhone</h3>
              <p className="text-zinc-300 mb-6 flex flex-col gap-4 text-base font-medium mt-2">
                <span>Para instalar o Oficina Notes no seu iPhone ou iPad, siga os 2 passos:</span>
                <span className="flex items-center justify-center gap-3 bg-zinc-800 p-4 rounded-xl border border-zinc-700">
                  1. Toque em Compartilhar <Share className="w-7 h-7 text-brand" />
                </span>
                <span className="flex items-center justify-center gap-3 bg-zinc-800 p-4 rounded-xl border border-zinc-700">
                  2. Em seguida, toque em "Adicionar à Tela de Início" <PlusSquare className="w-7 h-7 text-brand" />
                </span>
              </p>
              <button 
                onClick={() => setShowIOSInstructions(false)}
                className="w-full bg-brand text-black font-black uppercase tracking-widest py-4 rounded-xl transition-transform active:scale-95 text-lg"
              >
                Entendi
              </button>
            </div>
          </div>
        </div>
      )}
      {showManualInstructions && (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/80 p-4 pb-12 sm:pb-4 animate-in fade-in duration-200" onClick={() => setShowManualInstructions(false)}>
          <div 
            className="bg-zinc-900 border-2 border-brand rounded-2xl p-6 shadow-2xl max-w-sm w-full relative animate-in slide-in-from-bottom-4 sm:slide-in-from-bottom-0 sm:zoom-in-95 duration-200"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex flex-col items-center text-center">
              <div className="w-20 h-20 bg-brand/20 rounded-2xl flex items-center justify-center mb-4 text-brand">
                <Smartphone className="w-10 h-10" />
              </div>
              <h3 className="text-2xl font-black text-white mb-2 uppercase italic tracking-tighter">Instalação Manual</h3>
              <p className="text-zinc-300 mb-6 flex flex-col gap-4 text-base font-medium mt-2 text-left w-full">
                <span>O navegador não permitiu a instalação automática. Veja como fazer isso manualmente no Chrome do Android:</span>
                <span className="flex items-center gap-3 bg-zinc-800 p-4 rounded-xl border border-zinc-700">
                  <div className="flex flex-col">
                    <strong>1. Menu do Navegador</strong>
                    <span className="text-sm font-normal text-zinc-400">Toque nos três pontinhos no canto superior direito</span>
                  </div>
                </span>
                <span className="flex items-center gap-3 bg-zinc-800 p-4 rounded-xl border border-zinc-700">
                  <div className="flex flex-col">
                    <strong>2. Adicionar à Tela Inicial</strong>
                    <span className="text-sm font-normal text-zinc-400">Encontre a opção "Adicionar à Tela Inicial" ou "Instalar Aplicativo" na lista</span>
                  </div>
                </span>
              </p>
              <button 
                onClick={() => setShowManualInstructions(false)}
                className="w-full bg-brand text-black font-black uppercase tracking-widest py-4 rounded-xl transition-transform active:scale-95 text-lg"
              >
                Entendi
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
