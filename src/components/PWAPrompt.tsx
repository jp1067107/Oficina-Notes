import React from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { RefreshCw, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

const PWAPrompt: React.FC = () => {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(r) {
      console.log('SW Registered: ' + r);
    },
    onRegisterError(error) {
      console.log('SW registration error', error);
    },
  });

  const close = () => {
    setOfflineReady(false);
    setNeedRefresh(false);
  };

  return (
    <AnimatePresence>
      {(offlineReady || needRefresh) && (
        <motion.div
          initial={{ y: 50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 50, opacity: 0 }}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] w-[90%] max-w-md"
        >
          <div className="bg-zinc-900 border border-brand/50 shadow-[0_0_20px_rgba(34,197,94,0.2)] p-4 rounded-2xl flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-brand/10 rounded-xl flex items-center justify-center text-brand">
                <RefreshCw size={20} className={needRefresh ? 'animate-spin' : ''} />
              </div>
              <div>
                <p className="text-white text-sm font-bold">
                  {needRefresh ? 'Nova versão disponível!' : 'Pronto para uso offline'}
                </p>
                <p className="text-zinc-500 text-xs">
                  {needRefresh ? 'Atualize para ver as novidades.' : 'O app foi cacheado com sucesso.'}
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              {needRefresh && (
                <button
                  onClick={() => updateServiceWorker(true)}
                  className="bg-brand text-black text-xs font-black px-4 py-2 rounded-lg uppercase tracking-tighter hover:scale-105 transition-transform active:scale-95"
                >
                  Atualizar Agora
                </button>
              )}
              <button
                onClick={close}
                className="p-2 text-zinc-500 hover:text-white transition-colors"
              >
                <X size={18} />
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default PWAPrompt;
