import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';

// i18n must be imported before the app renders so translations are ready
import i18n from './i18n';
import App from './App';

import './index.css';

createRoot(document.getElementById('root')!).render(
  <I18nextProvider i18n={i18n}>
    <App />
  </I18nextProvider>
);
