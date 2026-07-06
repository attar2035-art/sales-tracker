import React, { useState } from 'react';
import { updatePassword } from '../lib/auth';

export default function ChangePassword({ forceChange = false, onChanged }) {
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState(null);

  const handleChange = async () => {
    if (!newPassword || !confirm) { setMsg({ text: 'أدخل كلمة السر والتأكيد', type: 'error' }); return; }
    if (newPassword !== confirm) { setMsg({ text: 'كلمتا السر غير متطابقتين', type: 'error' }); return; }
    if (newPassword.length < 6) { setMsg({ text: 'كلمة السر يجب أن تكون 6 أحرف على الأقل', type: 'error' }); return; }
    setLoading(true);
    const { error } = await updatePassword(newPassword);
    if (error) setMsg({ text: 'خطأ: ' + error.message, type: 'error' });
    else {
      setMsg({ text: '✓ تم تغيير كلمة السر بنجاح', type: 'success' });
      setNewPassword('');
      setConfirm('');
      if (onChanged) setTimeout(onChanged, 500);
    }
    setLoading(false);
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">🔑 تغيير كلمة السر</h1>
      </div>
      <div className="card" style={{ maxWidth: 450 }}>
        {msg && <div className={`alert alert-${msg.type}`}>{msg.text}</div>}
        {forceChange && (
          <div className="alert alert-warning">
            يجب تغيير كلمة السر المؤقتة قبل استخدام النظام.
          </div>
        )}
        <div className="form-group">
          <label className="form-label">كلمة السر الجديدة</label>
          <input className="form-input" type="password" value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            placeholder="••••••••" />
        </div>
        <div className="form-group">
          <label className="form-label">تأكيد كلمة السر</label>
          <input className="form-input" type="password" value={confirm}
            onChange={e => setConfirm(e.target.value)}
            placeholder="••••••••" />
        </div>
        <button className="btn btn-primary" onClick={handleChange} disabled={loading}
          style={{ width: '100%', padding: '0.75rem' }}>
          {loading ? '⏳ جاري الحفظ...' : forceChange ? 'تغيير كلمة السر والبدء' : '💾 حفظ كلمة السر'}
        </button>
      </div>
    </div>
  );
}
