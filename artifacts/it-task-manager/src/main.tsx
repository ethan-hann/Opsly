import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import { registerSW } from 'virtual:pwa-register';
import { toast } from 'sonner';
import { setOfflineQueueHandler } from '@workspace/api-client-react';
import { standaloneAddToQueue } from '@/hooks/use-offline-queue';
import { restoreQueryCache, startQueryCachePersistence } from '@/lib/query-client';

// i18n must be imported before the app renders so translations are ready
import i18n from './i18n';
import App from './App';

import './index.css';

// Wire offline mutation queue into the shared fetch layer. Any non-GET/HEAD
// request that fails with a network-level TypeError (offline) will be
// silently serialised into IndexedDB and replayed when connectivity returns.
setOfflineQueueHandler(standaloneAddToQueue);

// Register service worker and show a toast when a new version is waiting.
registerSW({
  onNeedRefresh() {
    toast('New version available — refresh to update', {
      duration: Infinity,
      action: {
        label: 'Refresh',
        onClick: () => window.location.reload(),
      },
    });
  },
  onOfflineReady() {
    // Silently ready — the OfflineBanner communicates offline status.
  },
});

// Restore the persisted React Query cache from IndexedDB BEFORE the first
// render so query-driven UI (dropdowns, stages, projects) is populated
// immediately when the app loads while offline.
restoreQueryCache().then(() => {
  // Begin debounce-persisting cache changes to IndexedDB so every successful
  // fetch is available across page refreshes while offline.
  startQueryCachePersistence();

  createRoot(document.getElementById('root')!).render(
    <I18nextProvider i18n={i18n}>
      <App />
    </I18nextProvider>
  );
});
