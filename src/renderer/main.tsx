import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/outfit/600.css';
import '@fontsource/hanken-grotesk/400.css';
import './index.css';
import App from './App';
import { ConfirmHost } from './components/Confirm';
import { initTheme } from './theme';

initTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <ConfirmHost />
  </StrictMode>,
);
