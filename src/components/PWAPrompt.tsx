import React from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { RefreshCw, X } from 'lucide-react';

const PWAPrompt: React.FC = () => {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered(r) {
      console.log('SW Registered: ', r);
    },
    onRegisterError(error) {
      console.log('SW registration error', error);
    },
  });

  const close = () => {
    setNeedRefresh(false);
  };

  if (!needRefresh) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-80 bg-zinc-800 text-white p-4 rounded-xl shadow-2xl border border-zinc-700 z-50 flex flex-col gap-3">
      <div className="flex justify-between items-start">
        <div>
          <h3 className="font-semibold text-lg text-green-400">Nova versão disponível!</h3>
          <p className="text-zinc-400 text-sm mt-1">
            Atualize para ter acesso às novidades e melhorias do app.
          </p>
        </div>
        <button onClick={close} className="text-zinc-400 hover:text-white mt-1">
          <X className="w-5 h-5" />
        </button>
      </div>
      <button
        onClick={() => updateServiceWorker(true)}
        className="w-full bg-green-500 hover:bg-green-600 text-black font-semibold py-2 rounded-lg flex items-center justify-center gap-2 transition-colors"
      >
        <RefreshCw className="w-4 h-4" />
        Atualizar App
      </button>
    </div>
  );
};

export default PWAPrompt;
