import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { logAuditEvent } from '../lib/audit';

const ROLE_LABELS = {
  sales_manager: 'مدير المبيعات',
  company_manager: 'مدير الشركة',
  other: 'أخرى',
};

export default function PermissionsCenter() {
  const [recipients, setRecipients] = useState([]);
  const [regions, setRegions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState(null);
  const [errors, setErrors] = useState({});
  const [form, setForm] = useState({ name: '', email: '', role: 'sales_manager', region_id: '' });
  const containerRef = useRef(null);

  const showMsg = (text, type = 'success') => {
    setMsg({ text, type });
    setTimeout(() => setMsg(null), 3000);
  };

  const clearErr = (key) => setErrors(prev => {
    if (!prev[key]) return prev;
    const next = { ...prev }; delete next[key]; return next;
  });
  const errCls = (base, key) => `${base}${errors[key] ? ' has-error' : ''}`;

  const handleKeyDown = (e) => {
    if (e.key !== 'Enter' || e.target.tagName === 'TEXTAREA') return;
    const root = containerRef.current; if (!root) return;
    const f = Array.from(root.querySelectorAll('input:not([disabled]), select:not([disabled])'))
      .filter(el => el.type !== 'hidden' && el.offsetParent !== null);
    const i = f.indexOf(e.target);
    if (i > -1 && i < f.length - 1) { e.preventDefault(); f[i + 1].focus(); }
  };

  const fetchAll = useCallback(async () => {
    const [{ data: recs, error: recErr }, { data: regs }] = await Promise.all([
      supabase.from('report_recipients').select('*, regions(name)').order('created_at', { ascending: false }),
      supabase.from('regions').select('id, name').order('name'),
    ]);
    if (recErr) showMsg('تعذّر تحميل المستلمين: ' + recErr.message, 'error');
    if (recs) setRecipients(recs);
    if (regs) setRegions(regs);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchAll(); }, []);

  const addRecipient = async () => {
    const fieldErrors = {};
    if (!form.name.trim()) fieldErrors.name = 'أدخل الاسم';
    if (!form.email.trim()) fieldErrors.email = 'أدخل البريد الإلكتروني';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) fieldErrors.email = 'صيغة البريد غير صحيحة';
    if (Object.keys(fieldErrors).length > 0) { setErrors(fieldErrors); return; }
    setErrors({});
    setLoading(true);
    const payload = {
      name: form.name.trim(),
      email: form.email.trim().toLowerCase(),
      role: form.role,
      region_id: form.region_id || null,
    };
    const { error } = await supabase.from('report_recipients').insert(payload);
    if (error) showMsg('خطأ: ' + error.message, 'error');
    else {
      await logAuditEvent({ eventType: 'create', pageKey: 'permissions', entityType: 'report_recipients', details: { name: payload.name, email: payload.email, role: payload.role } });
      showMsg('تمت إضافة المستلم ✓');
      setForm({ name: '', email: '', role: 'sales_manager', region_id: '' });
      fetchAll();
    }
    setLoading(false);
  };

  const toggleActive = async (rec) => {
    const { error } = await supabase.from('report_recipients').update({ is_active: !rec.is_active }).eq('id', rec.id);
    if (error) { showMsg('تعذّر تغيير الحالة: ' + error.message, 'error'); return; }
    await logAuditEvent({ eventType: 'status_change', pageKey: 'permissions', entityType: 'report_recipients', entityId: rec.id, details: { email: rec.email, to: !rec.is_active ? 'مفعّل' : 'موقوف' } });
    fetchAll();
  };

  const deleteRecipient = async (rec) => {
    if (!window.confirm(`حذف المستلم ${rec.email}؟`)) return;
    const { error } = await supabase.from('report_recipients').delete().eq('id', rec.id);
    if (error) { showMsg('تعذّر الحذف: ' + error.message, 'error'); return; }
    await logAuditEvent({ eventType: 'delete', pageKey: 'permissions', entityType: 'report_recipients', entityId: rec.id, details: { email: rec.email } });
    showMsg('تم الحذف');
    fetchAll();
  };

  return (
    <div ref={containerRef} onKeyDown={handleKeyDown}>
      <div className="page-header">
        <h1 className="page-title">🛡️ مركز الصلاحيات — مستلمو تقارير الزيارات</h1>
      </div>
      {msg && <div className={`alert alert-${msg.type}`}>{msg.text}</div>}

      <div className="card">
        <div className="card-title">➕ إضافة مستلم</div>
        <p className="muted-text" style={{ marginBottom: '1rem' }}>
          المديرون هنا يستلمون تقارير زيارات المشرفين بالإيميل. اترك المنطقة فارغة ليستلم عن كل المناطق.
        </p>
        <div className="form-grid">
          <div className="form-group">
            <label className="form-label">الاسم</label>
            <input className={errCls('form-input', 'name')} value={form.name} enterKeyHint="next"
              onChange={e => { setForm(p => ({ ...p, name: e.target.value })); clearErr('name'); }}
              placeholder="اسم المدير" />
            {errors.name && <div className="form-error">{errors.name}</div>}
          </div>
          <div className="form-group">
            <label className="form-label">البريد الإلكتروني</label>
            <input className={errCls('form-input', 'email')} type="email" value={form.email} enterKeyHint="next"
              onChange={e => { setForm(p => ({ ...p, email: e.target.value })); clearErr('email'); }}
              placeholder="manager@hawafel.com" />
            {errors.email && <div className="form-error">{errors.email}</div>}
          </div>
          <div className="form-group">
            <label className="form-label">الدور</label>
            <select className="form-select" value={form.role}
              onChange={e => setForm(p => ({ ...p, role: e.target.value }))}>
              <option value="sales_manager">مدير المبيعات</option>
              <option value="company_manager">مدير الشركة</option>
              <option value="other">أخرى</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">المنطقة (اختياري)</label>
            <select className="form-select" value={form.region_id}
              onChange={e => setForm(p => ({ ...p, region_id: e.target.value }))}>
              <option value="">كل المناطق</option>
              {regions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
        </div>
        <div className="btn-row" style={{ marginTop: '0.5rem' }}>
          <button className="btn btn-success" onClick={addRecipient} disabled={loading}>💾 إضافة</button>
        </div>
      </div>

      <div className="card">
        <div className="card-title">المستلمون الحاليون</div>
        {recipients.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">🛡️</div>
            <div className="empty-state-text">لا يوجد مستلمون بعد. أضف مدير المبيعات ومدير الشركة.</div>
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="responsive-cards">
              <thead>
                <tr><th>الاسم</th><th>البريد</th><th>الدور</th><th>المنطقة</th><th>الحالة</th><th>الإجراءات</th></tr>
              </thead>
              <tbody>
                {recipients.map(rec => (
                  <tr key={rec.id}>
                    <td data-label="الاسم"><strong>{rec.name}</strong></td>
                    <td data-label="البريد">{rec.email}</td>
                    <td data-label="الدور">{ROLE_LABELS[rec.role] || rec.role}</td>
                    <td data-label="المنطقة">{rec.regions?.name || 'كل المناطق'}</td>
                    <td data-label="الحالة">
                      <span className={`badge ${rec.is_active ? 'badge-success' : 'badge-warning'}`}>
                        {rec.is_active ? 'مفعّل' : 'موقوف'}
                      </span>
                    </td>
                    <td className="no-label">
                      <div className="btn-row">
                        <button className="btn btn-ghost btn-sm" onClick={() => toggleActive(rec)}>
                          {rec.is_active ? 'إيقاف' : 'تفعيل'}
                        </button>
                        <button className="btn btn-danger btn-sm" onClick={() => deleteRecipient(rec)}>حذف</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
