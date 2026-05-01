import React, { useEffect, useState } from 'react';
import { Download, AlertCircle, X } from 'lucide-react';

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
  const [isStandalone, setIsStandalone] = useState(false);
  const [showErrorModal, setShowErrorModal] = useState(false);

  useEffect(() => {
    const checkStandalone = () => {
      const isStandaloneMode = window.matchMedia('(display-mode: standalone)').matches || 
                               (window.navigator as any).standalone === true;
      setIsStandalone(isStandaloneMode);
    };

    checkStandalone();
    const mediaQuery = window.matchMedia('(display-mode: standalone)');
    mediaQuery.addEventListener('change', checkStandalone);

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
    if (!deferredPrompt) {
      setShowErrorModal(true);
      return;
    }
    
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
    }
  };

  if (isStandalone) {
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

      {showErrorModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 animate-in fade-in duration-200" onClick={() => setShowErrorModal(false)}>
          <div 
            className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 shadow-2xl max-w-sm w-full relative animate-in zoom-in-95 duration-200"
            onClick={e => e.stopPropagation()}
          >
            <button 
              onClick={() => setShowErrorModal(false)}
              className="absolute top-4 right-4 text-zinc-400 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
            
            <div className="flex flex-col items-center text-center">
              <div className="w-16 h-16 bg-amber-500/20 rounded-2xl flex items-center justify-center mb-4 text-amber-500">
                <AlertCircle className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold text-white mb-2">Instalação Nativa Indisponível</h3>
              <p className="text-zinc-400 mb-6 text-sm mt-2 leading-relaxed">
                Para instalar o aplicativo com nossa recomendação nativa automática, por favor abra este link em um <strong>navegador padrão</strong> (como Chrome, Edge ou Samsung Internet).
                <br /><br />
                <em>Nota: O sistema iOS (iPhone/iPad) e navegadores internos dificultam ou bloqueiam instalações nativas automáticas.</em>
              </p>
              <button 
                onClick={() => setShowErrorModal(false)}
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
