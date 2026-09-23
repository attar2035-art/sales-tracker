import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { logAuditEvent } from '../lib/audit';
import { formatCurrency } from '../lib/helpers';
import { debtDueOf } from '../lib/debtAging';

const pad2 = (n) => String(n).padStart(2, '0');
const dateStr = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const shiftDate = (s, days) => { const d = new Date(s); d.setDate(d.getDate() + days); return dateStr(d); };

const EMPTY = {
  customer_id: null, customer_name: '', region_id: '', neighborhood: '',
  city: '', phone: '', contact_person: '', customer_rating: '', notes: '',
  address: '', location_url: '',
};

// Columns pulled for a customer so route planning can auto-fill contact + location.
const CUSTOMER_COLS = 'id, customer_code, customer_name, region_id, phone, neighborhood, city, contact_person, customer_rating, address, location_url, debt_total, debt_1_45, debt_over_60, debt_over_90, debt_over_120, debt_over_150, regions(name)';

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
  const [scopeRegionIds, setScopeRegionIds] = useState([]); // customer search is limited to these regions
  const [custInfo, setCustInfo] = useState({}); // customer_id -> { code + debt } for plan rows
  const [selectedCust, setSelectedCust] = useState(null); // the picked customer record (for the header + first-time completion)
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
    const list = data || [];
    setItems(list);
    // Pull each linked customer's code + debt-aging so the plan table can show them.
    const ids = [...new Set(list.map(i => i.customer_id).filter(Boolean))];
    if (ids.length) {
      const { data: cust } = await supabase.from('customers')
        .select('id, customer_code, debt_total, debt_1_45, debt_over_60, debt_over_90, debt_over_120, debt_over_150')
        .in('id', ids);
      const map = {};
      (cust || []).forEach(c => { map[c.id] = c; });
      setCustInfo(map);
    } else setCustInfo({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planDate, user]);

  useEffect(() => {
    supabase.from('regions').select('id, name').order('name').then(({ data }) => setRegions(data || []));
  }, []);

  // Limit the customer search to the current user's own region(s): a rep sees
  // their region's customers, a supervisor sees all their team's regions.
  useEffect(() => {
    let ignore = false;
    (async () => {
      let ids = [];
      if (isRep && user?.rep_id) {
        const { data } = await supabase.from('representatives').select('region_id').eq('id', user.rep_id).single();
        if (data?.region_id) ids = [data.region_id];
      } else if (isSup && user?.supervisor_id) {
        const { data } = await supabase.from('representatives').select('region_id').eq('supervisor_id', user.supervisor_id);
        ids = [...new Set((data || []).map(r => r.region_id).filter(Boolean))];
      }
      if (!ignore) setScopeRegionIds(ids);
    })();
    return () => { ignore = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  // Search the customer database (name contains, within the user's regions) to
  // pre-fill contact + location from an existing customer.
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!search.trim()) { setResults([]); return; }
    searchTimer.current = setTimeout(async () => {
      // Strong search: match by name OR code OR phone, from the first character.
      // Strip characters that would break the PostgREST or() filter.
      const term = search.trim().replace(/[,()*]/g, ' ').trim();
      if (!term) { setResults([]); return; }
      let q = supabase.from('customers').select(CUSTOMER_COLS)
        .eq('is_active', true)
        .or(`customer_name.ilike.%${term}%,customer_code.ilike.%${term}%,phone.ilike.%${term}%`);
      if (scopeRegionIds.length) q = q.in('region_id', scopeRegionIds);
      const { data } = await q.limit(20);
      setResults(data || []);
    }, 200);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, scopeRegionIds]);

  const pickCustomer = (c) => {
    setSelectedCust(c);
    setForm(prev => ({
      ...prev,
      customer_id: c.id,
      customer_name: c.customer_name,
      region_id: c.region_id || '',
      phone: c.phone || '',
      neighborhood: c.neighborhood || '',
      city: c.city || '',
      contact_person: c.contact_person || '',
      customer_rating: c.customer_rating || '',
      address: c.address || '',
      location_url: c.location_url || '',
    }));
    setSearch(c.customer_name); setResults([]);
  };

  const resetForm = () => { setForm({ ...EMPTY }); setSearch(''); setResults([]); setEditId(null); setSelectedCust(null); };

  // A picked existing customer whose contact fields are still blank → the rep
  // must complete them on this first visit (they save back onto the customer).
  const missingContact = (c) => !!c && (!c.phone || !c.city || !c.neighborhood || !c.address);
  const needsCompletion = missingContact(selectedCust);

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
      customer_rating: it.customer_rating, address: it.address, location_url: it.location_url,
      notes: it.notes, created_by: user.id, sort_order: items.length + i,
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
    // First visit for a picked customer: city/neighborhood/phone/street are required.
    if (needsCompletion) {
      const miss = [];
      if (!form.city.trim()) miss.push('المدينة');
      if (!form.neighborhood.trim()) miss.push('الحي');
      if (!form.phone.trim()) miss.push('التليفون');
      if (!form.address.trim()) miss.push('الشارع/العنوان');
      if (miss.length) { showMsg('أكمل بيانات العميل (مرة واحدة): ' + miss.join('، '), 'error'); return; }
    }
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
      address: form.address.trim() || null,
      location_url: form.location_url.trim() || null,
      notes: form.notes.trim() || null,
      created_by: user.id,
      updated_at: new Date().toISOString(),
    };
    let error;
    if (editId) ({ error } = await supabase.from('daily_route_plan').update(payload).eq('id', editId));
    else ({ error } = await supabase.from('daily_route_plan').insert({ ...payload, sort_order: items.length }));
    if (error) showMsg('خطأ: ' + error.message, 'error');
    else {
      // Persist the completed contact info back onto the customer (fills blanks
      // only) — so it's captured once and won't be asked again.
      let completed = false;
      if (form.customer_id && needsCompletion) {
        const { error: rpcErr } = await supabase.rpc('complete_customer_contact', {
          p_customer_id: form.customer_id,
          p_phone: form.phone.trim() || null,
          p_city: form.city.trim() || null,
          p_neighborhood: form.neighborhood.trim() || null,
          p_address: form.address.trim() || null,
          p_location_url: form.location_url.trim() || null,
        });
        if (!rpcErr) completed = true;
      }
      await logAuditEvent({ eventType: editId ? 'update' : 'create', pageKey: 'routeplan', entityType: 'daily_route_plan', details: { customer: payload.customer_name, date: planDate } });
      showMsg(completed ? '✓ تم حفظ بيانات العميل (مرة واحدة) وإضافته للخطة' : (editId ? 'تم التعديل ✓' : 'تمت الإضافة للخطة ✓'));
      resetForm(); fetchItems();
    }
    setLoading(false);
  };

  const editItem = (it) => {
    setEditId(it.id); setSearch(it.customer_name);
    setForm({
      customer_id: it.customer_id, customer_name: it.customer_name, region_id: it.region_id || '',
      neighborhood: it.neighborhood || '', city: it.city || '', phone: it.phone || '',
      contact_person: it.contact_person || '', customer_rating: it.customer_rating || '', notes: it.notes || '',
      address: it.address || '', location_url: it.location_url || '',
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
          <label className="form-label">ابحث بالاسم أو الكود أو التليفون (من أول حرف) — أو اكتب اسم جديد</label>
          <input className="form-input" value={search}
            onChange={e => { setSearch(e.target.value); setSelectedCust(null); setForm(prev => ({ ...prev, customer_id: null, customer_name: e.target.value })); }}
            placeholder="اكتب اسم العميل..." />
          {results.length > 0 && (
            <div style={{ position: 'absolute', zIndex: 20, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, width: '100%', maxHeight: 220, overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,.1)' }}>
              {results.map(c => (
                <div key={c.id} onClick={() => pickCustomer(c)}
                  style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid #f1f5f9', color: '#0f172a' }}>
                  <b>{c.customer_name}</b>
                  <span style={{ color: '#64748b', fontSize: 12 }}> — {c.customer_code ? `كود ${c.customer_code}` : ''}{c.city ? ` · ${c.city}` : ''}{c.phone ? ` · ${c.phone}` : ''}</span>
                  {Number(c.debt_total) > 0 && (
                    <span style={{ color: '#b91c1c', fontSize: 12, fontWeight: 700 }}> · دين {formatCurrency(c.debt_total)}{debtDueOf(c) > 0 ? ` (مستحق ${formatCurrency(debtDueOf(c))})` : ''}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        {selectedCust && (
          <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', marginBottom: '0.75rem', background: 'rgba(37,99,235,0.08)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              <div>
                <strong style={{ fontSize: '1.05rem' }}>{selectedCust.customer_name}</strong>
                {selectedCust.customer_code && <span style={{ color: 'var(--text-secondary)', marginInlineStart: 8 }}>كود {selectedCust.customer_code}</span>}
                {selectedCust.city && <span style={{ color: 'var(--text-secondary)', marginInlineStart: 8 }}>· {selectedCust.city}</span>}
              </div>
              {Number(selectedCust.debt_total) > 0 && (
                <span style={{ color: '#dc2626', fontWeight: 800 }}>دين {formatCurrency(selectedCust.debt_total)}{debtDueOf(selectedCust) > 0 ? ` · مستحق ${formatCurrency(debtDueOf(selectedCust))}` : ''}</span>
              )}
            </div>
            {needsCompletion && (
              <div className="alert alert-warning" style={{ marginTop: 8, marginBottom: 0 }}>
                ⚠️ أول زيارة لهذا العميل — أكمل <b>المدينة والحي والتليفون والشارع</b>. تُكتب <b>مرة واحدة فقط</b> وتُحفظ على العميل.
              </div>
            )}
          </div>
        )}
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
          <div className="form-group"><label className="form-label">الشارع / العنوان</label>
            <input className="form-input" value={form.address} onChange={e => setForm(p => ({ ...p, address: e.target.value }))} placeholder="الشارع / وصف الموقع" /></div>
          <div className="form-group"><label className="form-label">رابط الموقع (خرائط جوجل)</label>
            <input className="form-input" type="url" inputMode="url" value={form.location_url} onChange={e => setForm(p => ({ ...p, location_url: e.target.value }))} placeholder="https://maps.google.com/..." /></div>
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
              <thead><tr><th>#</th><th>رقم العميل</th><th>العميل</th><th>المنطقة</th><th>الحي</th><th>التليفون</th><th>الموقع</th><th>دين العميل</th><th>المسؤول</th><th>الفئة</th><th>الإجراءات</th></tr></thead>
              <tbody>
                {items.map((it, i) => (
                  <tr key={it.id}>
                    <td data-label="#">{i + 1}</td>
                    <td data-label="رقم العميل">{custInfo[it.customer_id]?.customer_code || '—'}</td>
                    <td data-label="العميل"><strong>{it.customer_name}</strong>{!it.customer_id && <span style={{ color: '#f59e0b', fontSize: 11 }}> (جديد)</span>}</td>
                    <td data-label="المنطقة">{regionName(it.region_id)}</td>
                    <td data-label="الحي">{it.neighborhood || '—'}</td>
                    <td data-label="التليفون">{it.phone || '—'}</td>
                    <td data-label="الموقع">{it.location_url ? <a href={it.location_url} target="_blank" rel="noreferrer" style={{ color: '#2563eb', fontWeight: 700 }}>📍 فتح</a> : (it.address || '—')}</td>
                    <td data-label="دين العميل">{(() => {
                      const c = custInfo[it.customer_id];
                      if (!c || !(Number(c.debt_total) > 0)) return '—';
                      const due = debtDueOf(c);
                      return <span>{formatCurrency(c.debt_total)}{due > 0 && <span style={{ color: '#b91c1c', fontWeight: 700 }}> · مستحق {formatCurrency(due)}</span>}</span>;
                    })()}</td>
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
