import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { logAuditEvent } from '../lib/audit';

const pad2 = (n) => String(n).padStart(2, '0');
const dateStr = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);

const EMPTY = { customer_id: null, customer_name: '', region_id: '', neighborhood: '', phone: '', contact_person: '', customer_rating: '' };

// تنفيذ خط السير (مرحلة ٢) — مدخل البيانات يعلّم الزيارات الفعلية قصاد الخطة
// (صح/خطأ) ويضيف الزيارات اللي حصلت خارج الخطة، والنظام يحسب الالتزام والانحراف.
export default function RouteExecution({ user }) {
  const [ownerType, setOwnerType] = useState('rep');
  const [reps, setReps] = useState([]);
  const [sups, setSups] = useState([]);
  const [ownerId, setOwnerId] = useState('');
  const [planDate, setPlanDate] = useState(dateStr(new Date()));
  const [items, setItems] = useState([]);
  const [regions, setRegions] = useState([]);
  const [msg, setMsg] = useState(null);
  const [addForm, setAddForm] = useState({ ...EMPTY });
  const [search, setSearch] = useState('');
  const [results, setResults] = useState([]);
  const [adding, setAdding] = useState(false);
  const searchTimer = useRef(null);

  const showMsg = (text, type = 'success') => { setMsg({ text, type }); setTimeout(() => setMsg(null), 3000); };

  useEffect(() => {
    supabase.from('representatives').select('id, name').eq('is_active', true).order('name').then(({ data }) => setReps(data || []));
    supabase.from('supervisors').select('id, name').order('name').then(({ data }) => setSups(data || []));
    supabase.from('regions').select('id, name').order('name').then(({ data }) => setRegions(data || []));
  }, []);

  const fetchItems = useCallback(async () => {
    if (!ownerId) { setItems([]); return; }
    const col = ownerType === 'rep' ? 'rep_id' : 'supervisor_id';
    const { data } = await supabase.from('daily_route_plan').select('*')
      .eq('plan_date', planDate).eq(col, ownerId).order('off_plan').order('sort_order').order('created_at');
    setItems(data || []);
  }, [ownerType, ownerId, planDate]);
  useEffect(() => { fetchItems(); }, [fetchItems]);

  // reset selected owner when switching type
  useEffect(() => { setOwnerId(''); setItems([]); }, [ownerType]);

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

  const toggleVisited = async (it, val) => {
    const { error } = await supabase.from('daily_route_plan').update({ visited: val, updated_at: new Date().toISOString() }).eq('id', it.id);
    if (error) { showMsg('تعذّر الحفظ: ' + error.message, 'error'); return; }
    setItems(prev => prev.map(x => x.id === it.id ? { ...x, visited: val } : x));
  };

  const addActual = async () => {
    if (!ownerId) { showMsg('اختر المندوب/المشرف أولًا', 'error'); return; }
    if (!addForm.customer_name.trim()) { showMsg('اكتب اسم العميل أو اختره', 'error'); return; }
    setAdding(true);
    const ownerCol = ownerType === 'rep' ? { rep_id: ownerId } : { supervisor_id: ownerId };
    const { error } = await supabase.from('daily_route_plan').insert({
      ...ownerCol, plan_date: planDate, off_plan: true, visited: true,
      customer_id: addForm.customer_id || null, customer_name: addForm.customer_name.trim(),
      region_id: addForm.region_id || null, neighborhood: addForm.neighborhood.trim() || null,
      phone: addForm.phone.trim() || null, contact_person: addForm.contact_person.trim() || null,
      customer_rating: addForm.customer_rating.trim() || null, created_by: user.id,
    });
    if (error) showMsg('خطأ: ' + error.message, 'error');
    else {
      await logAuditEvent({ eventType: 'create', pageKey: 'routeexec', entityType: 'daily_route_plan', details: { customer: addForm.customer_name, date: planDate, off_plan: true } });
      showMsg('تمت إضافة زيارة خارج الخطة ✓'); setAddForm({ ...EMPTY }); setSearch(''); setResults([]); fetchItems();
    }
    setAdding(false);
  };

  const removeActual = async (it) => {
    if (!window.confirm(`حذف زيارة ${it.customer_name}؟`)) return;
    const { error } = await supabase.from('daily_route_plan').delete().eq('id', it.id);
    if (error) { showMsg('تعذّر الحذف: ' + error.message, 'error'); return; }
    fetchItems();
  };

  const kpi = useMemo(() => {
    const planned = items.filter(x => !x.off_plan);
    const plannedCount = planned.length;
    const visitedPlanned = planned.filter(x => x.visited).length;
    const missed = plannedCount - visitedPlanned;
    const offPlan = items.filter(x => x.off_plan).length;
    const commit = pct(visitedPlanned, plannedCount);
    const deviation = plannedCount > 0 ? Math.round(((missed + offPlan) / plannedCount) * 100) : 0;
    return { plannedCount, visitedPlanned, missed, offPlan, commit, deviation };
  }, [items]);

  const regionName = (id) => regions.find(r => r.id === id)?.name || '—';
  const owners = ownerType === 'rep' ? reps : sups;
  const planned = items.filter(x => !x.off_plan);
  const actualsOff = items.filter(x => x.off_plan);

  return (
    <div>
      <div className="page-header"><h1 className="page-title">✅ تنفيذ خط السير (الزيارات الفعلية)</h1></div>
      {msg && <div className={`alert alert-${msg.type}`}>{msg.text}</div>}

      <div className="card">
        <div className="form-grid">
          <div className="form-group">
            <label className="form-label">النوع</label>
            <select className="form-select" value={ownerType} onChange={e => setOwnerType(e.target.value)}>
              <option value="rep">مندوب</option>
              <option value="supervisor">مشرف</option>
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">{ownerType === 'rep' ? 'المندوب' : 'المشرف'}</label>
            <select className="form-select" value={ownerId} onChange={e => setOwnerId(e.target.value)}>
              <option value="">-- اختر --</option>
              {owners.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">تاريخ الخطة</label>
            <input className="form-input" type="date" value={planDate} onChange={e => setPlanDate(e.target.value)} />
          </div>
        </div>
      </div>

      {ownerId && (
        <>
          {/* KPIs */}
          <div className="card">
            <div className="card-title">مقارنة الالتزام بالخطة — {planDate}</div>
            <div className="form-grid">
              {[
                ['المخطط', kpi.plannedCount, '#0f172a'],
                ['تم زيارتهم', kpi.visitedPlanned, '#166534'],
                ['مفوّت (لم يُزَر)', kpi.missed, '#b91c1c'],
                ['خارج الخطة', kpi.offPlan, '#b45309'],
                ['نسبة الالتزام', `${kpi.commit}%`, kpi.commit >= 80 ? '#166534' : kpi.commit >= 50 ? '#b45309' : '#b91c1c'],
                ['نسبة الانحراف', `${kpi.deviation}%`, kpi.deviation <= 20 ? '#166534' : '#b91c1c'],
              ].map(([label, val, color]) => (
                <div key={label} className="stat" style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 12, textAlign: 'center', background: '#fff' }}>
                  <span style={{ display: 'block', color: '#64748b', fontSize: 13, marginBottom: 6 }}>{label}</span>
                  <strong style={{ fontSize: 22, color }}>{val}</strong>
                </div>
              ))}
            </div>
            <p className="muted-text" style={{ fontSize: 12, marginTop: 8 }}>
              الالتزام = تم زيارتهم ÷ المخطط. الانحراف = (المفوّت + خارج الخطة) ÷ المخطط.
            </p>
          </div>

          {/* Planned customers: mark visited ✓/✗ */}
          <div className="card">
            <div className="card-title">عملاء الخطة — علّم الزيارة الفعلية</div>
            {planned.length === 0 ? (
              <div className="empty-state"><div className="empty-state-icon">🗺️</div>
                <div className="empty-state-text">لا توجد خطة مسجّلة لهذا اليوم لهذا {ownerType === 'rep' ? 'المندوب' : 'المشرف'}.</div></div>
            ) : (
              <div className="table-wrapper">
                <table className="responsive-cards">
                  <thead><tr><th>#</th><th>العميل</th><th>المنطقة</th><th>الحي</th><th>الفئة</th><th>الحالة</th></tr></thead>
                  <tbody>
                    {planned.map((it, i) => (
                      <tr key={it.id} style={{ background: it.visited ? '#f0fdf4' : 'transparent' }}>
                        <td data-label="#">{i + 1}</td>
                        <td data-label="العميل"><strong>{it.customer_name}</strong></td>
                        <td data-label="المنطقة">{regionName(it.region_id)}</td>
                        <td data-label="الحي">{it.neighborhood || '—'}</td>
                        <td data-label="الفئة">{it.customer_rating || '—'}</td>
                        <td className="no-label"><div className="btn-row">
                          <button className={`btn btn-sm ${it.visited ? 'btn-success' : 'btn-ghost'}`} onClick={() => toggleVisited(it, true)}>✓ تمّت</button>
                          <button className={`btn btn-sm ${!it.visited ? 'btn-danger' : 'btn-ghost'}`} onClick={() => toggleVisited(it, false)}>✗ لم تتم</button>
                        </div></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Off-plan actual visits */}
          <div className="card">
            <div className="card-title">➕ إضافة زيارة فعلية خارج الخطة</div>
            <div className="form-group" style={{ position: 'relative' }}>
              <label className="form-label">ابحث عن العميل أو اكتب اسم جديد</label>
              <input className="form-input" value={search}
                onChange={e => { setSearch(e.target.value); setAddForm(p => ({ ...p, customer_id: null, customer_name: e.target.value })); }}
                placeholder="اسم العميل..." />
              {results.length > 0 && (
                <div style={{ position: 'absolute', zIndex: 20, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, width: '100%', maxHeight: 200, overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,.1)' }}>
                  {results.map(c => (
                    <div key={c.id} onClick={() => { setAddForm(p => ({ ...p, customer_id: c.id, customer_name: c.customer_name, region_id: c.region_id || '' })); setSearch(c.customer_name); setResults([]); }}
                      style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid #f1f5f9', color: '#0f172a' }}>
                      <b>{c.customer_name}</b> <span style={{ color: '#64748b', fontSize: 12 }}>— {c.regions?.name || 'بدون منطقة'}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="form-grid">
              <div className="form-group"><label className="form-label">المنطقة</label>
                <select className="form-select" value={addForm.region_id} onChange={e => setAddForm(p => ({ ...p, region_id: e.target.value }))}>
                  <option value="">-- اختر --</option>
                  {regions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select></div>
              <div className="form-group"><label className="form-label">الحي</label>
                <input className="form-input" value={addForm.neighborhood} onChange={e => setAddForm(p => ({ ...p, neighborhood: e.target.value }))} /></div>
              <div className="form-group"><label className="form-label">الفئة</label>
                <select className="form-select" value={addForm.customer_rating} onChange={e => setAddForm(p => ({ ...p, customer_rating: e.target.value }))}>
                  <option value="">--</option><option value="A">A</option><option value="B">B</option><option value="C">C</option><option value="D">D</option>
                </select></div>
            </div>
            <div className="btn-row"><button className="btn btn-warning" onClick={addActual} disabled={adding}>{adding ? '⏳...' : '➕ إضافة كزيارة خارج الخطة'}</button></div>

            {actualsOff.length > 0 && (
              <div className="table-wrapper" style={{ marginTop: '1rem' }}>
                <table className="responsive-cards">
                  <thead><tr><th>العميل (خارج الخطة)</th><th>المنطقة</th><th>الفئة</th><th></th></tr></thead>
                  <tbody>
                    {actualsOff.map(it => (
                      <tr key={it.id}>
                        <td data-label="العميل"><strong>{it.customer_name}</strong></td>
                        <td data-label="المنطقة">{regionName(it.region_id)}</td>
                        <td data-label="الفئة">{it.customer_rating || '—'}</td>
                        <td className="no-label"><button className="btn btn-danger btn-sm" onClick={() => removeActual(it)}>حذف</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
