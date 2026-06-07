import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { MONTHS_AR } from '../lib/helpers';

const EMPTY_TARGET = {
  target_sales: '', target_collection: '',
  target_new_customers: '', target_new_customers_value: '',
  target_total_visits: '', target_successful_visits: '',
  target_new_products_skus: '', target_new_products_qty: '',
  target_working_hours: '', target_km: '', overdue_total: '',
};

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

  useEffect(() => { fetchReps(); }, []);
  useEffect(() => { fetchTargets(); }, [year, month]);

  const fetchReps = async () => {
    const { data } = await supabase.from('representatives')
      .select('*, supervisors(name), regions(name)')
      .eq('is_active', true).order('name');
    if (data) setReps(data);
  };

  const fetchTargets = async () => {
    const { data } = await supabase.from('monthly_targets')
      .select('*').eq('year', year).eq('month', month);
    if (data) {
      const map = {};
      data.forEach(t => { map[t.rep_id] = t; });
      setTargets(map);
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
      [rep.id]: existing ? {
        target_sales: existing.target_sales,
        target_collection: existing.target_collection,
        target_new_customers: existing.target_new_customers,
        target_new_customers_value: existing.target_new_customers_value,
        target_total_visits: existing.target_total_visits,
        target_successful_visits: existing.target_successful_visits,
        target_new_products_skus: existing.target_new_products_skus,
        target_new_products_qty: existing.target_new_products_qty,
        target_working_hours: existing.target_working_hours,
        target_km: existing.target_km,
        overdue_total: existing.overdue_total,
      } : { ...EMPTY_TARGET }
    }));
    setSelectedRep(rep.id);
  };

  const updateForm = (repId, field, value) => {
    setForms(prev => ({ ...prev, [repId]: { ...prev[repId], [field]: value } }));
  };

  const saveTarget = async (repId) => {
    const form = forms[repId];
    if (!form) return;
    setLoading(true);
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
    const { error } = await supabase.from('monthly_targets')
      .upsert(payload, { onConflict: 'rep_id,year,month' });
    if (error) showMsg('خطأ: ' + error.message, 'error');
    else { showMsg('تم حفظ الأهداف ✓'); fetchTargets(); setSelectedRep(null); }
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
            <table>
              <thead>
                <tr><th>المندوب</th><th>المشرف</th><th>المنطقة</th><th>الأهداف</th><th>الإجراءات</th></tr>
              </thead>
              <tbody>
                {reps.map(rep => (
                  <React.Fragment key={rep.id}>
                    <tr>
                      <td><strong>{rep.name}</strong></td>
                      <td>{rep.supervisors?.name || '-'}</td>
                      <td>{rep.regions?.name || '-'}</td>
                      <td>
                        {targets[rep.id]
                          ? <span className="badge badge-success">محددة ✓</span>
                          : <span className="badge badge-warning">غير محددة</span>}
                      </td>
                      <td>
                        <button className="btn btn-primary btn-sm"
                          onClick={() => selectedRep === rep.id ? setSelectedRep(null) : openForm(rep)}>
                          {selectedRep === rep.id ? 'إغلاق' : targets[rep.id] ? 'تعديل' : 'تحديد الأهداف'}
                        </button>
                      </td>
                    </tr>
                    {selectedRep === rep.id && forms[rep.id] && (
                      <tr>
                        <td colSpan={5} style={{ padding: '1.5rem', background: '#0f172a' }}>
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
                          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
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
