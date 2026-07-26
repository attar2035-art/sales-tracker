import React, { useState, useRef } from 'react';
import { signIn, sendPasswordReset } from '../lib/auth';
import { logAuditEvent } from '../lib/audit';

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState({});
  const [mode, setMode] = useState('login'); // 'login' | 'reset'
  const [info, setInfo] = useState('');
  const containerRef = useRef(null);

  const switchMode = (next) => {
    setMode(next); setError(''); setInfo(''); setErrors({});
  };

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

  const handleReset = async () => {
    const fieldErrors = {};
    if (!email) fieldErrors.email = 'أدخل البريد الإلكتروني';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) fieldErrors.email = 'صيغة البريد الإلكتروني غير صحيحة';
    if (Object.keys(fieldErrors).length > 0) { setErrors(fieldErrors); return; }
    setErrors({});
    setLoading(true);
    setError('');
    const { error } = await sendPasswordReset(email);
    // Do not reveal whether the email exists — always show the same message.
    if (error && !/rate limit|too many/i.test(error.message || '')) {
      setError('تعذّر إرسال الرابط الآن. حاول مرة أخرى بعد قليل.');
    } else if (error) {
      setError('محاولات كثيرة. انتظر قليلًا ثم أعد المحاولة.');
    } else {
      setInfo('إن كان البريد مسجّلًا، فسيصلك رابط لإعادة تعيين كلمة السر. تحقّق من صندوق الوارد (والبريد المزعج).');
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
        {info && <div className="alert alert-success">{info}</div>}

        <div className="form-group">
          <label className="form-label">البريد الإلكتروني</label>
          <input className={errCls('form-input', 'email')} type="email" value={email}
            enterKeyHint="next"
            onChange={e => changeField('email', e.target.value, setEmail)}
            placeholder="example@hawafel.com" />
          {errors.email && <div className="form-error">{errors.email}</div>}
        </div>

        {mode === 'login' ? (
          <>
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

            <button type="button" onClick={() => switchMode('reset')}
              style={{ background: 'none', border: 'none', color: '#60a5fa', cursor: 'pointer',
                fontFamily: 'Cairo, sans-serif', fontSize: '0.875rem', marginTop: '1rem',
                width: '100%', textAlign: 'center', padding: '0.5rem', minHeight: 40 }}>
              نسيت كلمة السر؟
            </button>
          </>
        ) : (
          <>
            <p className="muted-text" style={{ marginBottom: '1rem' }}>
              أدخل بريدك الإلكتروني وسنرسل لك رابطًا لإعادة تعيين كلمة السر.
            </p>
            <button className="btn btn-primary" onClick={handleReset} disabled={loading}
              style={{ width: '100%', padding: '0.875rem', fontSize: '1rem', marginTop: '0.25rem' }}>
              {loading ? '⏳ جاري الإرسال...' : '📧 إرسال رابط الاستعادة'}
            </button>

            <button type="button" onClick={() => switchMode('login')}
              style={{ background: 'none', border: 'none', color: '#60a5fa', cursor: 'pointer',
                fontFamily: 'Cairo, sans-serif', fontSize: '0.875rem', marginTop: '1rem',
                width: '100%', textAlign: 'center', padding: '0.5rem', minHeight: 40 }}>
              ← رجوع لتسجيل الدخول
            </button>
          </>
        )}
      </div>
    </div>
  );
}
