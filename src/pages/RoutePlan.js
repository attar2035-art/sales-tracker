import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { logAuditEvent } from '../lib/audit';

const pad2 = (n) => String(n).padStart(2, '0');
const dateStr = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const shiftDate = (s, days) => { const d = new Date(s); d.setDate(d.getDate() + days); return dateStr(d); };

const EMPTY = {
  customer_id: null, customer_name: '', region_id: '', neighborhood: '',
  city: '', phone: '', contact_person: '', customer_rating: '', notes: '',
};

// خطة خط السير اليومية — كل مندوب/مشرف يسجّل خطته بنفسه ليوم قادم.
export default function RoutePlan({ user }) {
  const isRep = user?.role === 'rep';
  const isSup = user?.role === 'supervisor';
  // The owner filter/payload for the current user's own plan.
  const owner = isRep ? { rep_id: user.rep_id } : isSup ? { supervisor_id: user.supervisor_id } : null;

  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const [planDate, setPlanDate] = useState(dateStr(tomorrow));
  const [sourceDate, setSourceDate] = useState(shiftDate(dateStr(tomorrow), -7));
  const [items, setItems] = useState([]);
  const [regions, setRegions] = useState([]);
  const [form, setForm] = useState({ ...EMPTY });
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [msg, setMsg] = useState(null);
  const [loading, setLoading] = useState(false);
  const [editId, setEditId] = useState(null);
  const searchTimer = useRef(null);

  const showMsg = (text, type = 'success') => { setMsg({ text, type }); setTimeout(() => setMsg(null), 3000); };

  const ownerMatch = (q) => (isRep ? q.eq('rep_id', user.rep_id) : q.eq('supervisor_id', user.supervisor_id));

  const fetchItems = useCallback(async () => {
    if (!owner) return;
    let q = supabase.from('daily_route_plan').select('*').eq('plan_date', planDate).order('sort_order').order('created_at');
    q = ownerMatch(q);
    const { data } = await q;
    setItems(data || []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planDate, user]);

  useEffect(() => {
    supabase.from('regions').select('id, name').order('name').then(({ data }) => setRegions(data || []));
  }, []);
  useEffect(() => { fetchItems(); }, [fetchItems]);

  // Search the customer database (name contains), to pre-fill from an existing customer.
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!search.trim()) { setResults([]); return; }
    searchTimer.current = setTimeout(async () => {
      const { data } = await supabase.from('customers')
        .select('id, customer_name, region_id, regions(name)')
        .eq('is_active', true).ilike('customer_name', `%${search.trim()}%`).limit(15);
      setResults(data || []);
    }, 250);
  }, [search]);

  const pickCustomer = (c) => {
    setForm(prev => ({ ...prev, customer_id: c.id, customer_name: c.customer_name, region_id: c.region_id || '' }));
    setSearch(c.customer_name); setResults([]);
  };

  const resetForm = () => { setForm({ ...EMPTY }); setSearch(''); setResults([]); setEditId(null); };

  // Weekly cycle: copy a previous day's planned customers into this plan_date.
  const generateFromDate = async () => {
    if (!owner) return;
    let q = supabase.from('daily_route_plan').select('*').eq('plan_date', sourceDate).eq('off_plan', false);
    q = ownerMatch(q);
    const { data } = await q;
    if (!data || !data.length) { showMsg('لا توجد خطة في التاريخ المصدر', 'error'); return; }
    const rows = data.map((it, i) => ({
      ...owner, plan_date: planDate, off_plan: false, visited: false,
      customer_id: it.customer_id, customer_name: it.customer_name, region_id: it.region_id,
      neighborhood: it.neighborhood, city: it.city, phone: it.phone, contact_person: it.contact_person,
      customer_rating: it.customer_rating, notes: it.notes, created_by: user.id, sort_order: items.length + i,
    }));
    const { error } = await supabase.from('daily_route_plan').insert(rows);
    if (error) showMsg('خطأ: ' + error.message, 'error');
    else {
      await logAuditEvent({ eventType: 'import', pageKey: 'routeplan', entityType: 'daily_route_plan', details: { from: sourceDate, to: planDate, count: rows.length } });
      showMsg(`تم توليد ${rows.length} عميل من ${sourceDate} ✓`); fetchItems();
    }
  };

  const saveItem = async () => {
    if (!owner) { showMsg('هذه الصفحة للمندوب أو المشرف فقط', 'error'); return; }
    if (!form.customer_name.trim()) { showMsg('اكتب اسم العميل أو اختره', 'error'); return; }
    setLoading(true);
    const payload = {
      ...owner, plan_date: planDate,
      customer_id: form.customer_id || null,
      customer_name: form.customer_name.trim(),
      region_id: form.region_id || null,
      neighborhood: form.neighborhood.trim() || null,
      city: form.city.trim() || null,
      phone: form.phone.trim() || null,
      contact_person: form.contact_person.trim() || null,
      customer_rating: form.customer_rating.trim() || null,
      notes: form.notes.trim() || null,
      created_by: user.id,
      updated_at: new Date().toISOString(),
    };
    let error;
    if (editId) ({ error } = await supabase.from('daily_route_plan').update(payload).eq('id', editId));
    else ({ error } = await supabase.from('daily_route_plan').insert({ ...payload, sort_order: items.length }));
    if (error) showMsg('خطأ: ' + error.message, 'error');
    else {
      await logAuditEvent({ eventType: editId ? 'update' : 'create', pageKey: 'routeplan', entityType: 'daily_route_plan', details: { customer: payload.customer_name, date: planDate } });
      showMsg(editId ? 'تم التعديل ✓' : 'تمت الإضافة للخطة ✓'); resetForm(); fetchItems();
    }
    setLoading(false);
  };

  const editItem = (it) => {
    setEditId(it.id); setSearch(it.customer_name);
    setForm({
      customer_id: it.customer_id, customer_name: it.customer_name, region_id: it.region_id || '',
      neighborhood: it.neighborhood || '', city: it.city || '', phone: it.phone || '',
      contact_person: it.contact_person || '', customer_rating: it.customer_rating || '', notes: it.notes || '',
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const deleteItem = async (it) => {
    if (!window.confirm(`حذف ${it.customer_name} من خطة ${planDate}؟`)) return;
    const { error } = await supabase.from('daily_route_plan').delete().eq('id', it.id);
    if (error) { showMsg('تعذّر الحذف: ' + error.message, 'error'); return; }
    showMsg('تم الحذف'); if (editId === it.id) resetForm(); fetchItems();
  };

  const regionName = (id) => regions.find(r => r.id === id)?.name || '—';

  if (!owner) {
    return <div className="card"><div className="empty-state">
      <div className="empty-state-icon">🗺️</div>
      <div className="empty-state-text">خطة خط السير متاحة للمندوب أو المشرف لتسجيل خطته اليومية.</div>
    </div></div>;
  }

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
        <h1 className="page-title">🗺️ خطة خط السير</h1>
        <div className="form-group" style={{ margin: 0 }}>
          <label className="form-label" style={{ display: 'inline-block', marginInlineEnd: '0.5rem' }}>تاريخ الخطة</label>
          <input className="form-input" type="date" value={planDate} onChange={e => { setPlanDate(e.target.value); setSourceDate(shiftDate(e.target.value, -7)); resetForm(); }}
            style={{ display: 'inline-block', width: 'auto' }} />
        </div>
      </div>
      {msg && <div className={`alert alert-${msg.type}`}>{msg.text}</div>}

      <div className="card">
        <div className="card-title">🔁 توليد الخطة من يوم سابق (الدورة الأسبوعية)</div>
        <p className="muted-text" style={{ fontSize: 12, marginBottom: '0.5rem' }}>
          انسخ عملاء خطة يوم سابق (الأسبوع اللي فات مثلًا) لهذا اليوم، وعدّل عليها. لا يمسح المضاف حاليًا.
        </p>
        <div className="btn-row" style={{ alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
          <input className="form-input" type="date" value={sourceDate} onChange={e => setSourceDate(e.target.value)} style={{ width: 'auto' }} />
          <button className="btn btn-ghost" onClick={generateFromDate}>🔁 توليد من هذا التاريخ</button>
        </div>
      </div>

      <div className="card">
        <div className="card-title">{editId ? '✏️ تعديل عميل في الخطة' : '➕ إضافة عميل للخطة'}</div>
        <div className="form-group" style={{ position: 'relative' }}>
          <label className="form-label">ابحث عن العميل (من قاعدة العملاء) أو اكتب اسم جديد</label>
          <input className="form-input" value={search}
            onChange={e => { setSearch(e.target.value); setForm(prev => ({ ...prev, customer_id: null, customer_name: e.target.value })); }}
            placeholder="اكتب اسم العميل..." />
          {results.length > 0 && (
            <div style={{ position: 'absolute', zIndex: 20, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, width: '100%', maxHeight: 220, overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,.1)' }}>
              {results.map(c => (
                <div key={c.id} onClick={() => pickCustomer(c)}
                  style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid #f1f5f9', color: '#0f172a' }}>
                  <b>{c.customer_name}</b> <span style={{ color: '#64748b', fontSize: 12 }}>— {c.regions?.name || 'بدون منطقة'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="form-grid">
          <div className="form-group">
            <label className="form-label">المنطقة</label>
            <select className="form-select" value={form.region_id} onChange={e => setForm(p => ({ ...p, region_id: e.target.value }))}>
              <option value="">-- اختر المنطقة --</option>
              {regions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <div className="form-group"><label className="form-label">الحي</label>
            <input className="form-input" value={form.neighborhood} onChange={e => setForm(p => ({ ...p, neighborhood: e.target.value }))} placeholder="الحي" /></div>
          <div className="form-group"><label className="form-label">المدينة</label>
            <input className="form-input" value={form.city} onChange={e => setForm(p => ({ ...p, city: e.target.value }))} placeholder="المدينة" /></div>
          <div className="form-group"><label className="form-label">التليفون</label>
            <input className="form-input" type="tel" inputMode="tel" value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} placeholder="رقم التليفون" /></div>
          <div className="form-group"><label className="form-label">الشخص المسؤول</label>
            <input className="form-input" value={form.contact_person} onChange={e => setForm(p => ({ ...p, contact_person: e.target.value }))} placeholder="اسم المسؤول" /></div>
          <div className="form-group"><label className="form-label">فئة العميل</label>
            <select className="form-select" value={form.customer_rating} onChange={e => setForm(p => ({ ...p, customer_rating: e.target.value }))}>
              <option value="">-- الفئة --</option>
              <option value="A">A — مهم جدًا</option>
              <option value="B">B — مهم</option>
              <option value="C">C — عادي</option>
              <option value="D">D — ضعيف</option>
            </select></div>
        </div>
        <div className="form-group"><label className="form-label">ملاحظات</label>
          <input className="form-input" value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} placeholder="ملاحظات (اختياري)" /></div>
        <div className="btn-row" style={{ marginTop: '0.5rem' }}>
          <button className="btn btn-success" onClick={saveItem} disabled={loading}>{loading ? '⏳...' : (editId ? '💾 حفظ التعديل' : '➕ أضف للخطة')}</button>
          {editId && <button className="btn btn-ghost" onClick={resetForm}>إلغاء</button>}
        </div>
      </div>

      <div className="card">
        <div className="card-title">خطة يوم {planDate} — {items.length} عميل</div>
        {items.length === 0 ? (
          <div className="empty-state"><div className="empty-state-icon">🗺️</div>
            <div className="empty-state-text">لا يوجد عملاء في خطة هذا اليوم بعد. أضِفهم من الأعلى.</div></div>
        ) : (
          <div className="table-wrapper">
            <table className="responsive-cards">
              <thead><tr><th>#</th><th>العميل</th><th>المنطقة</th><th>الحي</th><th>التليفون</th><th>المسؤول</th><th>الفئة</th><th>الإجراءات</th></tr></thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={it.id}>
                    <td data-label="#">{i + 1}</td>
                    <td data-label="العميل"><strong>{it.customer_name}</strong>{!it.customer_id && <span style={{ color: '#f59e0b', fontSize: 11 }}> (جديد)</span>}</td>
                    <td data-label="المنطقة">{regionName(it.region_id)}</td>
                    <td data-label="الحي">{it.neighborhood || '—'}</td>
                    <td data-label="التليفون">{it.phone || '—'}</td>
                    <td data-label="المسؤول">{it.contact_person || '—'}</td>
                    <td data-label="الفئة">{it.customer_rating || '—'}</td>
                    <td className="no-label"><div className="btn-row">
                      <button className="btn btn-ghost btn-sm" onClick={() => editItem(it)}>تعديل</button>
                      <button className="btn btn-danger btn-sm" onClick={() => deleteItem(it)}>حذف</button>
                    </div></td>
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
