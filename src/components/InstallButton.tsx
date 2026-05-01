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
    <>
      <button
        onClick={handleInstallClick}
        className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl font-medium transition-colors shadow-md border border-blue-500/50"
      >
        <Download className="w-5 h-5" />
        <span className="hidden sm:inline">Instalar App</span>
      </button>

      {/* iOS Instructions Modal */}
      {showIOSInstructions && (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/60 p-4 pb-12 sm:pb-4 animate-in fade-in duration-200" onClick={() => setShowIOSInstructions(false)}>
          <div 
            className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-2xl max-w-sm w-full relative animate-in slide-in-from-bottom-4 sm:slide-in-from-bottom-0 sm:zoom-in-95 duration-200"
            onClick={e => e.stopPropagation()}
          >
            <button 
              onClick={() => setShowIOSInstructions(false)}
              className="absolute top-4 right-4 text-zinc-400 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
            
            <div className="flex flex-col items-center text-center">
              <div className="w-16 h-16 bg-blue-500/20 rounded-2xl flex items-center justify-center mb-4 text-blue-500">
                <Download className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">Instalar no iOS</h3>
              <p className="text-zinc-400 mb-6 flex flex-col gap-4 text-sm mt-2">
                <span>Para instalar o Oficina Notes no seu iPhone ou iPad:</span>
                <span className="flex items-center justify-center gap-2 bg-zinc-800/50 p-3 rounded-lg border border-zinc-700/50">
                  1. Toque em Compartilhar <Share className="w-5 h-5 text-blue-400" />
                </span>
                <span className="flex items-center justify-center gap-2 bg-zinc-800/50 p-3 rounded-lg border border-zinc-700/50">
                  2. Toque em "Adicionar à Tela de Início" <PlusSquare className="w-5 h-5 text-blue-400" />
                </span>
              </p>
              <button 
                onClick={() => setShowIOSInstructions(false)}
                className="w-full bg-zinc-800 hover:bg-zinc-700 text-white font-medium py-3 rounded-xl transition-colors"
              >
                Entendi
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default InstallButton;
