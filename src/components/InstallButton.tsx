import React, { useEffect, useState } from 'react';
import { Download, Share, PlusSquare, X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: Array<string>;
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

const InstallButton: React.FC = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);
  const [showIOSInstructions, setShowIOSInstructions] = useState(false);

  useEffect(() => {
    // Check if the app is already installed (standalone mode)
    const checkStandalone = () => {
      const isStandaloneMode = window.matchMedia('(display-mode: standalone)').matches || 
                               (window.navigator as any).standalone === true;
      setIsStandalone(isStandaloneMode);
    };

    checkStandalone();
    const mediaQuery = window.matchMedia('(display-mode: standalone)');
    mediaQuery.addEventListener('change', checkStandalone);

    // Detect iOS
    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIOSDevice = /iphone|ipad|ipod/.test(userAgent);
    setIsIOS(isIOSDevice);

    // Check if prompt was deferred globally before React mounted
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

    if (!deferredPrompt) return;
    
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
    }
  };

  // Do not show the button if it's already installed
  // Or if it's not iOS AND there is no deferred prompt yet
  if (isStandalone || (!isIOS && !deferredPrompt)) {
    return null;
  }

  return (
    <div className="w-full mb-6 mt-2">
      <button
        onClick={handleInstallClick}
        className="w-full flex flex-col items-center justify-center gap-2 bg-brand text-black p-5 rounded-2xl font-black transition-transform active:scale-95 shadow-[0_6px_0_#16a34a] active:shadow-[0_0px_0_#16a34a] active:translate-y-[6px]"
      >
        <div className="flex items-center gap-3">
          <Download className="w-8 h-8" strokeWidth={3} />
          <span className="text-lg sm:text-xl uppercase tracking-wider">Instalar App no Celular 📲</span>
        </div>
        <span className="text-sm font-bold opacity-80 uppercase tracking-widest text-[#064e3b]">Rápido, Seguro e Ocupa Pouco Espaço</span>
      </button>

      {/* iOS Instructions Modal */}
      {showIOSInstructions && (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/80 p-4 pb-12 sm:pb-4 animate-in fade-in duration-200" onClick={() => setShowIOSInstructions(false)}>
          <div 
            className="bg-zinc-900 border-2 border-brand rounded-2xl p-6 shadow-2xl max-w-sm w-full relative animate-in slide-in-from-bottom-4 sm:slide-in-from-bottom-0 sm:zoom-in-95 duration-200"
            onClick={e => e.stopPropagation()}
          >
            <button 
              onClick={() => setShowIOSInstructions(false)}
              className="absolute top-4 right-4 text-zinc-400 hover:text-white transition-colors"
            >
              <X className="w-8 h-8" />
            </button>
            
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
    </div>
  );
};

export default InstallButton;
