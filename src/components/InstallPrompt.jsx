import React, { useState, useEffect } from 'react';

// A small banner that lets the user install the app on Android (Chrome fires
// `beforeinstallprompt`, captured in index.js). Hidden when already installed
// or when the browser doesn't support installation.
const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)')?.matches
  || window.navigator.standalone === true;

export default function InstallPrompt() {
  const [available, setAvailable] = useState(!!window.__deferredInstallPrompt);
  const [hidden, setHidden] = useState(isStandalone());
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    const onAvail = () => setAvailable(true);
    const onInstalled = () => { setAvailable(false); setHidden(true); };
    window.addEventListener('pwa-install-available', onAvail);
    window.addEventListener('pwa-installed', onInstalled);
    return () => {
      window.removeEventListener('pwa-install-available', onAvail);
      window.removeEventListener('pwa-installed', onInstalled);
    };
  }, []);

  if (hidden || !available || !window.__deferredInstallPrompt) return null;

  const install = async () => {
    const evt = window.__deferredInstallPrompt;
    if (!evt) return;
    setInstalling(true);
    try {
      evt.prompt();
      await evt.userChoice;
    } catch { /* user dismissed */ }
    window.__deferredInstallPrompt = null;
    setInstalling(false);
    setHidden(true);
  };

  return (
    <div style={{
      position: 'fixed', insetInlineStart: 0, insetInlineEnd: 0, bottom: 0, zIndex: 1200,
      background: '#1e293b', borderTop: '1px solid #334155',
      padding: 'calc(0.7rem + env(safe-area-inset-bottom, 0px)) 1rem 0.7rem',
      display: 'flex', alignItems: 'center', gap: '0.75rem',
      boxShadow: '0 -4px 16px rgba(0,0,0,0.35)',
    }}>
      <span style={{ fontSize: '1.5rem' }}>📲</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: '#f1f5f9', fontWeight: 700, fontSize: '0.9rem' }}>ثبّت التطبيق على هاتفك</div>
        <div style={{ color: '#94a3b8', fontSize: '0.75rem' }}>افتحه كتطبيق كامل من شاشتك الرئيسية</div>
      </div>
      <button className="btn btn-primary" onClick={install} disabled={installing}
        style={{ whiteSpace: 'nowrap' }}>
        {installing ? '...' : 'تثبيت'}
      </button>
      <button aria-label="إغلاق" onClick={() => setHidden(true)}
        style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '1.3rem', cursor: 'pointer', padding: '0 0.25rem' }}>
        ×
      </button>
    </div>
  );
}
