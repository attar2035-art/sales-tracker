import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { MONTHS_AR } from '../lib/helpers';
import { buildEffectiveTargetsMap, targetToForm } from '../lib/targets';
import { logAuditEvent } from '../lib/audit';

export default function Targets() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [reps, setReps] = useState([]);
  const [targets, setTargets] = useState({});
  const [forms, setForms] = useState({});
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState(null);
  const [selectedRep, setSelectedRep] = useState(null);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchReps(); }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchTargets(); }, [year, month]);

  const fetchReps = async () => {
    const { data } = await supabase.from('representatives')
      .select('*, supervisors(name), regions(name)')
      .eq('is_active', true).order('name');
    if (data) setReps(data);
  };

  const fetchTargets = async () => {
    // Only fetch targets on-or-before the selected month (what inheritance needs),
    // instead of the whole table — avoids over-fetch and leaking future targets.
    const { data } = await supabase.from('monthly_targets')
      .select('*')
      .or(`year.lt.${year},and(year.eq.${year},month.lte.${month})`)
      .limit(10000);
    if (data) {
      setTargets(buildEffectiveTargetsMap(data, year, month));
    }
  };

  const showMsg = (text, type = 'success') => {
    setMsg({ text, type });
    setTimeout(() => setMsg(null), 3000);
  };

  const openForm = (rep) => {
    const existing = targets[rep.id];
    setForms(prev => ({
      ...prev,
      [rep.id]: targetToForm(existing)
    }));
    setSelectedRep(rep.id);
  };

  const updateForm = (repId, field, value) => {
    setForms(prev => ({ ...prev, [repId]: { ...prev[repId], [field]: value } }));
  };

  const saveTarget = async (repId) => {
    const form = forms[repId];
    if (!form) return;
    const payload = {
      rep_id: repId, year, month,
      target_sales: parseFloat(form.target_sales) || 0,
      target_collection: parseFloat(form.target_collection) || 0,
      target_new_customers: parseInt(form.target_new_customers) || 0,
      target_new_customers_value: parseFloat(form.target_new_customers_value) || 0,
      target_total_visits: parseInt(form.target_total_visits) || 0,
      target_successful_visits: parseInt(form.target_successful_visits) || 0,
      target_new_products_skus: parseInt(form.target_new_products_skus) || 0,
      target_new_products_qty: parseInt(form.target_new_products_qty) || 0,
      target_working_hours: parseFloat(form.target_working_hours) || 0,
      target_km: parseFloat(form.target_km) || 0,
      overdue_total: parseFloat(form.overdue_total) || 0,
    };
    // Reject negative targets (would break downstream percentage math).
    if (Object.entries(payload).some(([k, v]) => k.startsWith('target_') || k === 'overdue_total' ? v < 0 : false)) {
      showMsg('لا يمكن إدخال أهداف سالبة', 'error'); return;
    }
    setLoading(true);
    // Log create only when there is no target that truly belongs to this month
    // (an inherited target must not be treated as an existing one — BUG-023).
    const hasMonthTarget = targets[repId] && !targets[repId]._isInherited;
    const { error } = await supabase.from('monthly_targets')
      .upsert(payload, { onConflict: 'rep_id,year,month' });
    if (error) showMsg('خطأ: ' + error.message, 'error');
    else {
      const rep = reps.find(item => item.id === repId);
      await logAuditEvent({
        eventType: hasMonthTarget ? 'update' : 'create',
        pageKey: 'targets',
        entityType: 'monthly_targets',
        entityId: `${repId}:${year}-${month}`,
        details: {
          name: rep?.name || '',
          month,
          year,
          sales_target: payload.target_sales,
          collection_target: payload.target_collection,
        },
      });
      showMsg('تم حفظ الأهداف ✓'); fetchTargets(); setSelectedRep(null);
    }
    setLoading(false);
  };

  const years = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1];

  const fields = [
    { key: 'target_sales', label: '🎯 هدف البيع الشهري', placeholder: 'المبلغ بالريال' },
    { key: 'target_collection', label: '💰 هدف التحصيل الشهري', placeholder: 'المبلغ بالريال' },
    { key: 'target_new_customers', label: '👥 هدف العملاء الجدد', placeholder: 'عدد العملاء' },
    { key: 'target_new_customers_value', label: '🧾 قيمة فواتير العملاء الجدد', placeholder: 'المبلغ بالريال' },
    { key: 'target_total_visits', label: '📍 هدف الزيارات الإجمالي', placeholder: 'عدد الزيارات' },
    { key: 'target_successful_visits', label: '✅ هدف الزيارات الناجحة', placeholder: 'عدد الزيارات' },
    { key: 'target_new_products_skus', label: '📦 هدف الأصناف الجديدة', placeholder: 'عدد الأصناف' },
    { key: 'target_new_products_qty', label: '📦 هدف كميات المنتجات الجديدة', placeholder: 'عدد القطع' },
    { key: 'target_working_hours', label: '⏰ هدف ساعات العمل', placeholder: 'ساعات شهرية' },
    { key: 'target_km', label: '🚗 هدف الكيلومترات', placeholder: 'كم شهري' },
    { key: 'overdue_total', label: '⚠️ إجمالي المتأخرات فوق 60 يوم', placeholder: 'المبلغ بالريال' },
  ];

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">🎯 الأهداف الشهرية</h1>
        <div className="month-selector">
          <select value={month} onChange={e => setMonth(+e.target.value)}>
            {MONTHS_AR.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <select value={year} onChange={e => setYear(+e.target.value)}>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>
      {msg && <div className={`alert alert-${msg.type}`}>{msg.text}</div>}
      <div className="card">
        <div className="card-title">المندوبون — {MONTHS_AR[month - 1]} {year}</div>
        {reps.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">👤</div>
            <div className="empty-state-text">أضف مندوبين أولاً من صفحة الإعدادات</div>
          </div>
        ) : (
          <div className="table-wrapper">
            <table className="responsive-cards">
              <thead>
                <tr><th>المندوب</th><th>المشرف</th><th>المنطقة</th><th>الأهداف</th><th>الإجراءات</th></tr>
              </thead>
              <tbody>
                {reps.map(rep => (
                  <React.Fragment key={rep.id}>
                    <tr>
                      <td data-label="المندوب"><strong>{rep.name}</strong></td>
                      <td data-label="المشرف">{rep.supervisors?.name || 'بدون مشرف'}</td>
                      <td data-label="المنطقة">{rep.regions?.name || '-'}</td>
                      <td data-label="الأهداف">
                        {targets[rep.id]
                          ? targets[rep.id]._isInherited
                            ? <span className="badge badge-info">متكررة من {MONTHS_AR[targets[rep.id]._sourceMonth - 1]} {targets[rep.id]._sourceYear}</span>
                            : <span className="badge badge-success">محددة ✓</span>
                          : <span className="badge badge-warning">غير محددة</span>}
                      </td>
                      <td className="no-label">
                        <button className="btn btn-primary btn-sm"
                          onClick={() => selectedRep === rep.id ? setSelectedRep(null) : openForm(rep)}>
                          {selectedRep === rep.id ? 'إغلاق' : targets[rep.id] ? 'تعديل الأهداف' : 'تحديد الأهداف'}
                        </button>
                      </td>
                    </tr>
                    {selectedRep === rep.id && forms[rep.id] && (
                      <tr>
                        <td className="no-label" colSpan={5} style={{ padding: '1.5rem', background: '#0f172a' }}>
                          <div className="form-grid">
                            {fields.map(f => (
                              <div className="form-group" key={f.key}>
                                <label className="form-label">{f.label}</label>
                                <input className="form-input" type="number" min="0"
                                  value={forms[rep.id][f.key]}
                                  onChange={e => updateForm(rep.id, f.key, e.target.value)}
                                  placeholder={f.placeholder} />
                              </div>
                            ))}
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginTop: '0.5rem' }}>
                            <button className="btn btn-success" onClick={() => saveTarget(rep.id)} disabled={loading}>💾 حفظ الأهداف</button>
                            <button className="btn btn-ghost" onClick={() => setSelectedRep(null)}>إلغاء</button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
