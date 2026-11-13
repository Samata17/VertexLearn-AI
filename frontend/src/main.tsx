import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/index.css';
import { reloadForNewVersion } from './utils/chunkReload';

// Vite fires this when a page's supporting files (shared JS/CSS) are missing after a redeploy.
window.addEventListener('vite:preloadError', (e) => {
  if (reloadForNewVersion()) e.preventDefault(); // reloading; don't surface the error
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
