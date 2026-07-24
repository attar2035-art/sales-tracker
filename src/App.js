import React, { useState, useEffect } from 'react';
import { getCurrentUser, signOut } from './lib/auth';
import { supabase } from './lib/supabase';
import Dashboard from './pages/Dashboard';
import DailyEntry from './pages/DailyEntry';
import Targets from './pages/Targets';
import Setup from './pages/Setup';
import RepDetails from './pages/RepDetails';
import Login from './pages/Login';
import ChangePassword from './pages/ChangePassword';
import RepDashboard from './pages/RepDashboard';
import Customers from './pages/Customers';
import CustomerAnalytics from './components/CustomerAnalytics';
import CustomerSegmentation from './pages/CustomerSegmentation';
import ActivityLog from './pages/ActivityLog';
import { logAuditEvent } from './lib/audit';

const NAV_ADMIN = [
  { key: 'dashboard', label: 'لوحة المتابعة', icon: '📊' },
  { key: 'daily', label: 'الإدخال اليومي', icon: '📝' },
  { key: 'targets', label: 'الأهداف الشهرية', icon: '🎯' },
  { key: 'repdetails', label: 'تفاصيل المندوب', icon: '👤' },
  { key: 'customers', label: 'العملاء', icon: '👥' },
  { key: 'analytics', label: 'تحليل العملاء', icon: '📈' },
  { key: 'segmentation', label: 'تقسيم العملاء', icon: '📊' },
  { key: 'audit', label: 'سجل النشاط', icon: '🧾' },
  { key: 'setup', label: 'الإعدادات', icon: '⚙️' },
  { key: 'password', label: 'تغيير كلمة السر', icon: '🔑' },
];

const NAV_SUPERVISOR = [
  { key: 'dashboard', label: 'لوحة المتابعة', icon: '📊' },
  { key: 'repdetails', label: 'تفاصيل المندوب', icon: '👤' },
  { key: 'customers', label: 'العملاء', icon: '👥' },
  { key: 'analytics', label: 'تحليل العملاء', icon: '📈' },
  { key: 'segmentation', label: 'تقسيم العملاء', icon: '📊' },
  { key: 'password', label: 'تغيير كلمة السر', icon: '🔑' },
];

const NAV_DATA_ENTRY = [
  { key: 'daily', label: 'الإدخال اليومي', icon: '📝' },
  { key: 'targets', label: 'الأهداف الشهرية', icon: '🎯' },
  { key: 'password', label: 'تغيير كلمة السر', icon: '🔑' },
];

const NAV_REP = [
  { key: 'repdashboard', label: 'تقريري', icon: '📊' },
  { key: 'customers', label: 'العملاء', icon: '👥' },
  { key: 'analytics', label: 'تحليل العملاء', icon: '📈' },
  { key: 'password', label: 'تغيير كلمة السر', icon: '🔑' },
];

function NoAccess({ email, onLogout }) {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: '#0f172a', padding: '1rem',
    }}>
      <div style={{
        background: '#1e293b', border: '1px solid #334155', borderRadius: 16,
        padding: '2.5rem', width: '100%', maxWidth: 440, textAlign: 'center',
      }}>
        <div style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>🔒</div>
        <h1 style={{ color: '#f1f5f9', fontSize: '1.35rem', fontWeight: 800 }}>لا توجد صلاحية للوصول</h1>
        <p style={{ color: '#94a3b8', fontSize: '0.9rem', marginTop: '0.75rem', lineHeight: 1.9 }}>
          حسابك ({email}) غير مرتبط بأي دور في النظام.<br />
          تواصل مع مدير النظام لتفعيل الصلاحيات.
        </p>
        <button className="btn btn-primary" onClick={onLogout}
          style={{ width: '100%', padding: '0.75rem', marginTop: '1.5rem' }}>
          🚪 تسجيل الخروج
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState('dashboard');

  useEffect(() => {
    checkUser();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      checkUser();
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user || user.must_change_password) return;
    logAuditEvent({ eventType: 'page_view', pageKey: page });
  }, [page, user?.id, user?.must_change_password]);

  const checkUser = async () => {
    setLoading(true);
    const u = await getCurrentUser();
    setUser(u);
    if (u) {
      if (u.role === 'data_entry') setPage('daily');
      else if (u.role === 'rep') setPage('repdashboard');
      else setPage('dashboard');
    }
    setLoading(false);
  };

  const handleLogout = async () => {
    await logAuditEvent({ eventType: 'logout', pageKey: page });
    await signOut();
    setUser(null);
  };

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f172a' }}>
      <div className="loading"><div className="spinner" />جاري التحميل...</div>
    </div>
  );

  if (!user) return <Login onLogin={checkUser} />;

  const getNav = () => {
    if (user.role === 'admin') return NAV_ADMIN;
    if (user.role === 'supervisor') return NAV_SUPERVISOR;
    if (user.role === 'data_entry') return NAV_DATA_ENTRY;
    if (user.role === 'rep') return NAV_REP;
    // Fail closed: an unknown or missing role gets no navigation, not admin.
    return [];
  };

  const renderPage = () => {
    if (user.must_change_password) {
      return <ChangePassword forceChange onChanged={checkUser} />;
    }
    if (user.role === 'rep') {
      if (page === 'password') return <ChangePassword />;
      if (page === 'customers') return <Customers user={user} />;
      if (page === 'analytics') return <CustomerAnalytics />;
      return <RepDashboard repId={user.rep_id} />;
    }
    if (user.role === 'data_entry') {
      if (page === 'password') return <ChangePassword />;
      if (page === 'targets') return <Targets />;
      return <DailyEntry />;
    }
    if (user.role === 'supervisor') {
      if (page === 'password') return <ChangePassword />;
      if (page === 'repdetails') return <RepDetails supervisorId={user.supervisor_id} />;
      if (page === 'customers') return <Customers user={user} />;
      if (page === 'analytics') return <CustomerAnalytics />;
      if (page === 'segmentation') return <CustomerSegmentation />;
      return <Dashboard supervisorId={user.supervisor_id} />;
    }
    if (user.role === 'admin') {
      switch (page) {
        case 'dashboard': return <Dashboard />;
        case 'daily': return <DailyEntry />;
        case 'targets': return <Targets />;
        case 'repdetails': return <RepDetails />;
        case 'customers': return <Customers user={user} />;
        case 'analytics': return <CustomerAnalytics />;
        case 'segmentation': return <CustomerSegmentation />;
        case 'audit': return <ActivityLog />;
        case 'setup': return <Setup />;
        case 'password': return <ChangePassword />;
        default: return <Dashboard />;
      }
    }
    // Fail closed: unknown/missing role gets no access, never the admin pages.
    return <NoAccess email={user.email} onLogout={handleLogout} />;
  };

  const nav = getNav();

  return (
    <div className="app-container">
      <nav className="sidebar">
        <div className="sidebar-logo">
          🏭 نظام متابعة<br />المبيعات
        </div>
        <div style={{ fontSize: '0.75rem', color: '#64748b', padding: '0 0.5rem 1rem', borderBottom: '1px solid #334155', marginBottom: '1rem' }}>
          <div style={{ color: '#94a3b8', fontWeight: 600 }}>{user.email}</div>
          <div style={{ marginTop: '0.25rem' }}>
            {user.role === 'admin' && <span className="badge badge-info">مدير</span>}
            {user.role === 'supervisor' && <span className="badge badge-success">مشرف — {user.supervisor?.name}</span>}
            {user.role === 'data_entry' && <span className="badge badge-warning">مدخل بيانات</span>}
            {user.role === 'rep' && <span className="badge badge-info">مندوب</span>}
          </div>
        </div>
        {nav.map(item => (
          <button key={item.key}
            className={`nav-item ${page === item.key ? 'active' : ''}`}
            onClick={() => setPage(item.key)}>
            <span className="nav-icon">{item.icon}</span>
            {item.label}
          </button>
        ))}
        <button className="nav-item" onClick={handleLogout}
          style={{ marginTop: 'auto', color: '#ef4444' }}>
          <span className="nav-icon">🚪</span>
          تسجيل الخروج
        </button>
      </nav>

      <div style={{
        display: 'none', position: 'fixed', bottom: 0, left: 0, right: 0,
        background: '#1e293b', borderTop: '1px solid #334155',
        zIndex: 200, padding: '0.5rem 0',
      }} className="mobile-nav">
        {nav.map(item => (
          <button key={item.key} onClick={() => setPage(item.key)}
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
        <button onClick={handleLogout}
          style={{
            flex: 1, background: 'none', border: 'none', color: '#ef4444',
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            gap: '2px', fontSize: '0.65rem', cursor: 'pointer', fontFamily: 'Cairo, sans-serif',
          }}>
          <span style={{ fontSize: '1.2rem' }}>🚪</span>
          خروج
        </button>
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
