import React, { useState } from 'react';
import { signIn } from '../lib/auth';

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async () => {
    if (!email || !password) { setError('أدخل الإيميل وكلمة السر'); return; }
    setLoading(true);
    setError('');
    const { error } = await signIn(email, password);
    if (error) setError('إيميل أو كلمة سر غلط');
    else onLogin();
    setLoading(false);
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center',
      justifyContent: 'center', background: '#0f172a', padding: '1rem'
    }}>
      <div style={{
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
          <input className="form-input" type="email" value={email}
            onChange={e => setEmail(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleLogin()}
            placeholder="example@hawafel.com" />
        </div>

        <div className="form-group">
          <label className="form-label">كلمة السر</label>
          <input className="form-input" type="password" value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleLogin()}
            placeholder="••••••••" />
        </div>

        <button className="btn btn-primary" onClick={handleLogin} disabled={loading}
          style={{ width: '100%', padding: '0.875rem', fontSize: '1rem', marginTop: '0.5rem' }}>
          {loading ? '⏳ جاري الدخول...' : '🔐 تسجيل الدخول'}
        </button>
      </div>
    </div>
  );
}
