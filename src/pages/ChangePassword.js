import React, { useState, useRef } from 'react';
import { updatePassword } from '../lib/auth';

export default function ChangePassword({ forceChange = false, onChanged }) {
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState(null);
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

  const handleChange = async () => {
    const fieldErrors = {};
    if (!newPassword) fieldErrors.newPassword = 'أدخل كلمة السر';
    else if (newPassword.length < 8) fieldErrors.newPassword = 'كلمة السر يجب أن تكون 8 أحرف على الأقل';
    else if (!/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      fieldErrors.newPassword = 'كلمة السر يجب أن تحتوي على حرف ورقم على الأقل';
    }
    if (!confirm) fieldErrors.confirm = 'أدخل تأكيد كلمة السر';
    else if (!fieldErrors.newPassword && newPassword !== confirm) fieldErrors.confirm = 'كلمتا السر غير متطابقتين';
    if (Object.keys(fieldErrors).length > 0) { setErrors(fieldErrors); return; }
    setErrors({});
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
      <div ref={containerRef} onKeyDown={handleKeyDown} className="card" style={{ maxWidth: 450 }}>
        {msg && <div className={`alert alert-${msg.type}`}>{msg.text}</div>}
        {forceChange && (
          <div className="alert alert-warning">
            يجب تغيير كلمة السر المؤقتة قبل استخدام النظام.
          </div>
        )}
        <div className="form-group">
          <label className="form-label">كلمة السر الجديدة</label>
          <input className={errCls('form-input', 'newPassword')} type="password" value={newPassword}
            enterKeyHint="next"
            onChange={e => changeField('newPassword', e.target.value, setNewPassword)}
            placeholder="••••••••" />
          {errors.newPassword && <div className="form-error">{errors.newPassword}</div>}
        </div>
        <div className="form-group">
          <label className="form-label">تأكيد كلمة السر</label>
          <input className={errCls('form-input', 'confirm')} type="password" value={confirm}
            enterKeyHint="done"
            onChange={e => changeField('confirm', e.target.value, setConfirm)}
            onKeyDown={e => e.key === 'Enter' && handleChange()}
            placeholder="••••••••" />
          {errors.confirm && <div className="form-error">{errors.confirm}</div>}
        </div>
        <button className="btn btn-primary" onClick={handleChange} disabled={loading}
          style={{ width: '100%', padding: '0.75rem' }}>
          {loading ? '⏳ جاري الحفظ...' : forceChange ? 'تغيير كلمة السر والبدء' : '💾 حفظ كلمة السر'}
        </button>
      </div>
    </div>
  );
}
