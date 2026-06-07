import React, { useState } from 'react';
import Dashboard from './pages/Dashboard';
import DailyEntry from './pages/DailyEntry';
import Targets from './pages/Targets';
import Setup from './pages/Setup';
import RepDetails from './pages/RepDetails';

const NAV = [
  { key: 'dashboard', label: 'لوحة المتابعة', icon: '📊' },
  { key: 'daily', label: 'الإدخال اليومي', icon: '📝' },
  { key: 'targets', label: 'الأهداف الشهرية', icon: '🎯' },
  { key: 'repdetails', label: 'تفاصيل المندوب', icon: '👤' },
  { key: 'setup', label: 'الإعدادات', icon: '⚙️' },
];

export default function App() {
  const [page, setPage] = useState('dashboard');

  const renderPage = () => {
    switch (page) {
      case 'dashboard': return <Dashboard />;
      case 'daily': return <DailyEntry />;
      case 'targets': return <Targets />;
      case 'repdetails': return <RepDetails />;
      case 'setup': return <Setup />;
      default: return <Dashboard />;
    }
  };

  return (
    <div className="app-container">
      <nav className="sidebar">
        <div className="sidebar-logo">
          🏭 نظام متابعة<br />المبيعات
        </div>
        {NAV.map(item => (
          <button key={item.key}
            className={`nav-item ${page === item.key ? 'active' : ''}`}
            onClick={() => setPage(item.key)}>
            <span className="nav-icon">{item.icon}</span>
            {item.label}
          </button>
        ))}
      </nav>
      <div style={{
        display: 'none',
        position: 'fixed',
        bottom: 0, left: 0, right: 0,
        background: '#1e293b',
        borderTop: '1px solid #334155',
        zIndex: 200,
        padding: '0.5rem 0',
      }} className="mobile-nav">
        {NAV.map(item => (
          <button key={item.key}
            onClick={() => setPage(item.key)}
            style={{
              flex: 1, background: 'none', border: 'none',
              color: page === item.key ? '#3b82f6' : '#64748b',
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', gap: '2px',
              fontSize: '0.65rem', cursor: 'pointer',
              fontFamily: 'Cairo, sans-serif',
            }}>
            <span style={{ fontSize: '1.2rem' }}>{item.icon}</span>
            {item.label.split(' ')[0]}
          </button>
        ))}
      </div>
      <main className="main-content">
        {renderPage()}
      </main>
      <style>{`
        @media (max-width: 600px) {
          .mobile-nav { display: flex !important; }
          .main-content { padding-bottom: 70px !important; }
        }
      `}</style>
    </div>
  );
}
