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
import SupervisorRoute from './pages/SupervisorRoute';
import SupervisorFollowup from './pages/SupervisorFollowup';
import KnowledgeCenter from './pages/KnowledgeCenter';
import PermissionsCenter from './pages/PermissionsCenter';
import FloatingVisitButton from './components/FloatingVisitButton';
import { logAuditEvent } from './lib/audit';

const NAV_ADMIN = [
  { key: 'dashboard', label: 'لوحة المتابعة', icon: '📊' },
  { key: 'daily', label: 'الإدخال اليومي', icon: '📝' },
  { key: 'targets', label: 'الأهداف الشهرية', icon: '🎯' },
  { key: 'repdetails', label: 'تفاصيل المندوب', icon: '👤' },
  { key: 'supervisors', label: 'متابعة المشرفين', icon: '👔' },
  { key: 'customers', label: 'العملاء', icon: '👥' },
  { key: 'analytics', label: 'تحليل العملاء', icon: '📈' },
  { key: 'segmentation', label: 'تقسيم العملاء', icon: '📊' },
  { key: 'knowledge', label: 'مركز المعرفة', icon: '🧠' },
  { key: 'audit', label: 'سجل النشاط', icon: '🧾' },
  { key: 'permissions', label: 'مركز الصلاحيات', icon: '🛡️' },
  { key: 'setup', label: 'الإعدادات', icon: '⚙️' },
  { key: 'password', label: 'تغيير كلمة السر', icon: '🔑' },
];

const NAV_SUPERVISOR = [
  { key: 'dashboard', label: 'لوحة المتابعة', icon: '📊' },
  { key: 'myroute', label: 'زياراتي اليوم', icon: '📍' },
  { key: 'knowledge', label: 'مركز المعرفة', icon: '🧠' },
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

// Managers: company-wide, read-only.
const NAV_MANAGER = [
  { key: 'dashboard', label: 'لوحة المتابعة', icon: '📊' },
  { key: 'supervisors', label: 'متابعة المشرفين', icon: '👔' },
  { key: 'knowledge', label: 'مركز المعرفة', icon: '🧠' },
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [recovery, setRecovery] = useState(false);
  // Bumped when a visit is logged via the floating button, so the supervisor's
  // "today's route" page reloads its list without a manual refresh.
  const [visitRefresh, setVisitRefresh] = useState(0);

  useEffect(() => {
    checkUser();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      // A password-reset link opens the app with a recovery session; show the
      // "set new password" screen instead of the normal dashboard.
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      checkUser();
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user || user.must_change_password) return;
    logAuditEvent({ eventType: 'page_view', pageKey: page });
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Recovery flow (from a password-reset email): let the user set a new password.
  if (recovery) return (
    <ChangePassword recovery onChanged={() => { setRecovery(false); checkUser(); }} />
  );

  if (!user) return <Login onLogin={checkUser} />;

  const getNav = () => {
    if (user.role === 'admin') return NAV_ADMIN;
    if (user.role === 'supervisor') return NAV_SUPERVISOR;
    if (user.role === 'data_entry') return NAV_DATA_ENTRY;
    if (user.role === 'rep') return NAV_REP;
    if (user.role === 'manager') return NAV_MANAGER;
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
    if (user.role === 'manager') {
      // Company-wide, read-only.
      if (page === 'password') return <ChangePassword />;
      if (page === 'supervisors') return <SupervisorFollowup />;
      if (page === 'knowledge') return <KnowledgeCenter user={user} />;
      if (page === 'customers') return <Customers user={user} />;
      if (page === 'analytics') return <CustomerAnalytics />;
      return <Dashboard />;
    }
    if (user.role === 'supervisor') {
      if (page === 'password') return <ChangePassword />;
      if (page === 'myroute') return <SupervisorRoute user={user} refreshSignal={visitRefresh} />;
      if (page === 'knowledge') return <KnowledgeCenter user={user} />;
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
        case 'supervisors': return <SupervisorFollowup />;
        case 'customers': return <Customers user={user} />;
        case 'analytics': return <CustomerAnalytics />;
        case 'segmentation': return <CustomerSegmentation />;
        case 'knowledge': return <KnowledgeCenter user={user} />;
        case 'permissions': return <PermissionsCenter />;
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
  const navigate = (key) => { setPage(key); setMenuOpen(false); };
  const roleBadge = () => {
    if (user.role === 'admin') return <span className="badge badge-info">مدير</span>;
    if (user.role === 'supervisor') return <span className="badge badge-success">مشرف — {user.supervisor?.name}</span>;
    if (user.role === 'data_entry') return <span className="badge badge-warning">مدخل بيانات</span>;
    if (user.role === 'rep') return <span className="badge badge-info">مندوب</span>;
    return null;
  };
  const activeLabel = nav.find(item => item.key === page)?.label || 'نظام متابعة المبيعات';

  const navList = (
    <>
      {nav.map(item => (
        <button key={item.key}
          className={`nav-item ${page === item.key ? 'active' : ''}`}
          onClick={() => navigate(item.key)}>
          <span className="nav-icon">{item.icon}</span>
          {item.label}
        </button>
      ))}
      <button className="nav-item" onClick={handleLogout}
        style={{ marginTop: 'auto', color: '#ef4444' }}>
        <span className="nav-icon">🚪</span>
        تسجيل الخروج
      </button>
    </>
  );

  const userStrip = (
    <div style={{ fontSize: '0.75rem', color: '#64748b', padding: '0 0.5rem 1rem', borderBottom: '1px solid #334155', marginBottom: '1rem' }}>
      <div style={{ color: '#94a3b8', fontWeight: 600, overflowWrap: 'anywhere' }}>{user.email}</div>
      <div style={{ marginTop: '0.25rem' }}>{roleBadge()}</div>
    </div>
  );

  return (
    <div className="app-container">
      {/* Mobile top bar (phones & tablets) */}
      <header className="mobile-topbar">
        <button className="menu-btn" aria-label="القائمة" aria-expanded={menuOpen}
          onClick={() => setMenuOpen(true)}>☰</button>
        <span className="topbar-logo">🏭</span>
        <span className="topbar-title">{activeLabel}</span>
      </header>

      {/* Slide-in drawer + overlay (mobile nav) */}
      <div className={`drawer-overlay ${menuOpen ? 'open' : ''}`}
        onClick={() => setMenuOpen(false)} aria-hidden={!menuOpen} />
      <nav className={`drawer ${menuOpen ? 'open' : ''}`} aria-label="التنقل">
        <div className="sidebar-logo">🏭 نظام متابعة<br />المبيعات</div>
        {userStrip}
        {navList}
      </nav>

      {/* Desktop sidebar */}
      <nav className="sidebar">
        <div className="sidebar-logo">🏭 نظام متابعة<br />المبيعات</div>
        {userStrip}
        {navList}
      </nav>

      <main className="main-content">
        {renderPage()}
      </main>

      {!user.must_change_password && (
        <FloatingVisitButton user={user} onVisitLogged={() => setVisitRefresh(v => v + 1)} />
      )}
    </div>
  );
}
