import React, { useState, useRef } from 'react';
import { signIn } from '../lib/auth';
import { logAuditEvent } from '../lib/audit';

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState({});
  const containerRef = useRef(null);

  // Update a field and clear its inline error as the user corrects it.
  const changeField = (key, value, setter) => {
    setter(value);
    setErrors(prev => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  // Auto-advance: Enter (or the phone keyboard's "next") moves focus to the
  // next enabled, visible field.
  const handleKeyDown = (e) => {
    if (e.key !== 'Enter' || e.target.tagName === 'TEXTAREA') return;
    const root = containerRef.current;
    if (!root) return;
    const focusables = Array.from(
      root.querySelectorAll('input:not([disabled]), select:not([disabled])')
    ).filter(el => el.type !== 'hidden' && el.offsetParent !== null);
    const idx = focusables.indexOf(e.target);
    if (idx > -1 && idx < focusables.length - 1) {
      e.preventDefault();
      focusables[idx + 1].focus();
    }
  };

  const errCls = (base, key) => `${base}${errors[key] ? ' has-error' : ''}`;

  const handleLogin = async () => {
    const fieldErrors = {};
    if (!email) fieldErrors.email = 'أدخل البريد الإلكتروني';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) fieldErrors.email = 'صيغة البريد الإلكتروني غير صحيحة';
    if (!password) fieldErrors.password = 'أدخل كلمة السر';
    if (Object.keys(fieldErrors).length > 0) { setErrors(fieldErrors); return; }
    setErrors({});
    setLoading(true);
    setError('');
    const { error } = await signIn(email, password);
    if (error) setError('إيميل أو كلمة سر غلط');
    else {
      await logAuditEvent({ eventType: 'login', pageKey: 'login' });
      onLogin();
    }
    setLoading(false);
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: '#0f172a', padding: '1rem'
    }}>
      <div ref={containerRef} onKeyDown={handleKeyDown} style={{
        background: '#1e293b', border: '1px solid #334155',
        borderRadius: 16, padding: '2.5rem', width: '100%', maxWidth: 420
      }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>🏭</div>
          <h1 style={{ color: '#f1f5f9', fontSize: '1.5rem', fontWeight: 800 }}>نظام متابعة المبيعات</h1>
          <p style={{ color: '#94a3b8', fontSize: '0.875rem', marginTop: '0.5rem' }}>حوافز الجمال للصناعة</p>
        </div>

        {error && <div className="alert alert-error">{error}</div>}

        <div className="form-group">
          <label className="form-label">البريد الإلكتروني</label>
          <input className={errCls('form-input', 'email')} type="email" value={email}
            enterKeyHint="next"
            onChange={e => changeField('email', e.target.value, setEmail)}
            placeholder="example@hawafel.com" />
          {errors.email && <div className="form-error">{errors.email}</div>}
        </div>

        <div className="form-group">
          <label className="form-label">كلمة السر</label>
          <input className={errCls('form-input', 'password')} type="password" value={password}
            enterKeyHint="done"
            onChange={e => changeField('password', e.target.value, setPassword)}
            onKeyDown={e => e.key === 'Enter' && handleLogin()}
            placeholder="••••••••" />
          {errors.password && <div className="form-error">{errors.password}</div>}
        </div>

        <button className="btn btn-primary" onClick={handleLogin} disabled={loading}
          style={{ width: '100%', padding: '0.875rem', fontSize: '1rem', marginTop: '0.5rem' }}>
          {loading ? '⏳ جاري الدخول...' : '🔐 تسجيل الدخول'}
        </button>
      </div>
    </div>
  );
}
