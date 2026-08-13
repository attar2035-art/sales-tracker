import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';

// Capture the Android install prompt as early as possible (it can fire before
// React mounts) so the in-app install button can trigger it later.
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  window.__deferredInstallPrompt = e;
  window.dispatchEvent(new Event('pwa-install-available'));
});
window.addEventListener('appinstalled', () => {
  window.__deferredInstallPrompt = null;
  window.dispatchEvent(new Event('pwa-installed'));
});

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<React.StrictMode><App /></React.StrictMode>);

// Register the service worker so the app is installable and works offline.
// Only in production builds; failures are non-fatal (app still runs online).
if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${process.env.PUBLIC_URL}/service-worker.js`)
      .catch(() => { /* offline support unavailable; app still works online */ });
  });
}
