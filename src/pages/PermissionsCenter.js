import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { logAuditEvent } from '../lib/audit';

const ROLE_LABELS = {
  sales_manager: 'مدير المبيعات',
  company_manager: 'مدير الشركة',
  other: 'أخرى',
};

// Daily-entry fields that can be assigned to a specific data-entry user.
const ASSIGNABLE_FIELDS = [
  { key: 'daily_sales', label: 'المبيعات (البيع)' },
  { key: 'daily_returns', label: 'المردود' },
  { key: 'daily_collection', label: 'التحصيل' },
  { key: 'new_customers', label: 'عدد العملاء الجدد' },
  { key: 'new_customers_value', label: 'قيمة فواتير العملاء الجدد' },
  { key: 'total_visits', label: 'إجمالي الزيارات' },
  { key: 'shelf_photos', label: 'صور الرف' },
  { key: 'successful_visits', label: 'الزيارات الناجحة' },
  { key: 'new_products_skus', label: 'عدد الأصناف الموزعة' },
  { key: 'new_products_qty', label: 'عدد القطع الموزعة' },
  { key: 'new_products_availability', label: 'نسبة توفر المنتجات' },
  { key: 'working_hours', label: 'ساعات العمل' },
  { key: 'km', label: 'الكيلومترات' },
  { key: 'daily_expenses', label: 'المصروفات اليومية' },
  { key: 'overdue_total_input', label: 'إجمالي المتأخرات' },
  { key: 'overdue_collected', label: 'المحصل من المتأخرات' },
  { key: 'debt_total', label: 'إجمالي الدين' },
  { key: 'debt_1_45', label: 'دين ٤٥-٦٠ يوم' },
  { key: 'debt_over_60', label: 'دين ٦١-٩٠ يوم' },
  { key: 'debt_over_90', label: 'دين ٩١-١٢٠ يوم' },
  { key: 'debt_over_120', label: 'دين ١٢١-١٥٠ يوم' },
  { key: 'debt_over_150', label: 'دين فوق ١٥٠ يوم' },
  { key: 'notes', label: 'ملاحظات' },
];

export default function PermissionsCenter() {
  const [recipients, setRecipients] = useState([]);
  const [regions, setRegions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState(null);
  const [errors, setErrors] = useState({});
  const [form, setForm] = useState({ name: '', email: '', role: 'sales_manager', region_id: '' });
  // Daily-entry field assignments: users list + { field_key: user_id } map.
  const [entryUsers, setEntryUsers] = useState([]);
  const [assignments, setAssignments] = useState({});
  const [savingAssign, setSavingAssign] = useState(false);
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
    const [{ data: recs, error: recErr }, { data: regs }, usersRes, assignRes] = await Promise.all([
      supabase.from('report_recipients').select('*, regions(name)').order('created_at', { ascending: false }),
      supabase.from('regions').select('id, name').order('name'),
      supabase.rpc('list_data_entry_users'),
      supabase.from('data_entry_field_assignments').select('field_key, user_id'),
    ]);
    if (recErr) showMsg('تعذّر تحميل المستلمين: ' + recErr.message, 'error');
    if (recs) setRecipients(recs);
    if (regs) setRegions(regs);
    if (usersRes?.data) setEntryUsers(usersRes.data);
    if (assignRes?.data) setAssignments(Object.fromEntries(assignRes.data.map(r => [r.field_key, r.user_id])));
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchAll(); }, []);

  const saveAssignments = async () => {
    setSavingAssign(true);
    // Rows set to a user are upserted; rows set to "unassigned" are deleted.
    const toUpsert = ASSIGNABLE_FIELDS
      .filter(f => assignments[f.key])
      .map(f => ({ field_key: f.key, user_id: assignments[f.key], updated_at: new Date().toISOString() }));
    const toDelete = ASSIGNABLE_FIELDS.filter(f => !assignments[f.key]).map(f => f.key);
    let ok = true;
    if (toUpsert.length) {
      const { error } = await supabase.from('data_entry_field_assignments').upsert(toUpsert, { onConflict: 'field_key' });
      if (error) { ok = false; showMsg('خطأ في الحفظ: ' + error.message, 'error'); }
    }
    if (ok && toDelete.length) {
      const { error } = await supabase.from('data_entry_field_assignments').delete().in('field_key', toDelete);
      if (error) { ok = false; showMsg('خطأ في الحذف: ' + error.message, 'error'); }
    }
    if (ok) {
      await logAuditEvent({ eventType: 'update', pageKey: 'permissions', entityType: 'data_entry_field_assignments', details: { assigned: toUpsert.length } });
      showMsg('تم حفظ توزيع الخانات ✓');
      fetchAll();
    }
    setSavingAssign(false);
  };

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

      <div className="card">
        <div className="card-title">🧮 توزيع خانات الإدخال اليومي</div>
        <p className="muted-text" style={{ marginBottom: '1rem' }}>
          حدّد مين المسؤول عن كل خانة. الخانة المخصّصة لمستخدم لا يقدر يدخلها أو يعدّلها أي حساب آخر (حتى المدير).
          اترك «غير مخصّصة» لو عايز أي مدخِّل بيانات يقدر يملأها (أول من يدخلها يملكها).
        </p>
        <div className="table-wrapper">
          <table className="responsive-cards">
            <thead>
              <tr><th>الخانة</th><th>المسؤول عنها</th></tr>
            </thead>
            <tbody>
              {ASSIGNABLE_FIELDS.map(f => (
                <tr key={f.key}>
                  <td data-label="الخانة"><strong>{f.label}</strong></td>
                  <td data-label="المسؤول عنها">
                    <select className="form-select" value={assignments[f.key] || ''}
                      onChange={e => setAssignments(prev => ({ ...prev, [f.key]: e.target.value }))}>
                      <option value="">غير مخصّصة</option>
                      {entryUsers.map(u => <option key={u.user_id} value={u.user_id}>{u.email}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="btn-row" style={{ marginTop: '0.75rem' }}>
          <button className="btn btn-success" onClick={saveAssignments} disabled={savingAssign}>
            {savingAssign ? '⏳ جاري الحفظ...' : '💾 حفظ التوزيع'}
          </button>
        </div>
      </div>
    </div>
  );
}
