import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { MONTHS_AR } from '../lib/helpers';
import { logAuditEvent } from '../lib/audit';

// الفواتير النقدية — المندوب يحصّلها كاش وتُحوَّل له عمولة 5% لحظيًا تُخصم آخر الشهر
// من إجمالي عمولاته. تُدخلها أميرة (data_entry) يوميًا، وتُستخدم كمرجع عند المرتجع.
// العمولة ثابتة 5% وتُحسب على مستوى قاعدة البيانات (عمود commission_amount).

const COMMISSION_RATE = 0.05;
const nf = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
const pad2 = (n) => String(n).padStart(2, '0');
const lastDay = (y, m) => new Date(y, m, 0).getDate();

const EMPTY_FORM = { invoice_date: '', rep_id: '', customer_id: '', invoice_number: '', amount: '', note: '' };

export default function CashInvoices({ user }) {
  const canEdit = ['admin', 'data_entry'].includes(user?.role);
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;

  const [tab, setTab] = useState('entry');
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [reps, setReps] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [rows, setRows] = useState([]);           // فواتير الشهر المختار
  const [listRep, setListRep] = useState('');      // فلتر المندوب في قائمة الشهر
  const [form, setForm] = useState({ ...EMPTY_FORM, invoice_date: todayStr });
  const [editingId, setEditingId] = useState(null);
  const [expanded, setExpanded] = useState(null);  // المندوب المفتوح في تقرير الشهر
  const [allRows, setAllRows] = useState(null);    // كل الفواتير (للبحث المرجعي)
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState(null);

  const years = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1];
  const showMsg = (text, type = 'success') => { setMsg({ text, type }); setTimeout(() => setMsg(null), 3500); };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchReps(); }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchMonth(); }, [year, month]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (form.rep_id) fetchCustomers(form.rep_id); else setCustomers([]); }, [form.rep_id]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (tab === 'search' && allRows === null) fetchAll(); }, [tab]);

  const fetchReps = async () => {
    const { data } = await supabase.from('representatives')
      .select('id, name, region_id, regions(name)').eq('is_active', true).order('name');
    if (data) setReps(data);
  };

  // العملاء مربوطون بالمنطقة (region_id)، لذلك نعرض عملاء منطقة المندوب المختار.
  const fetchCustomers = async (repId) => {
    const rep = reps.find(r => r.id === repId);
    if (!rep?.region_id) { setCustomers([]); return; }
    const { data } = await supabase.from('customers')
      .select('id, customer_name, customer_code').eq('region_id', rep.region_id).eq('is_active', true)
      .order('customer_name');
    setCustomers(data || []);
  };

  const selectCols = 'id, invoice_date, rep_id, customer_id, invoice_number, amount, commission_amount, note, representatives(name, regions(name)), customers(customer_name)';

  const fetchMonth = async () => {
    const first = `${year}-${pad2(month)}-01`;
    const last = `${year}-${pad2(month)}-${pad2(lastDay(year, month))}`;
    const { data } = await supabase.from('cash_invoices')
      .select(selectCols)
      .gte('invoice_date', first).lte('invoice_date', last)
      .order('invoice_date', { ascending: false }).order('created_at', { ascending: false });
    setRows(data || []);
  };

  const fetchAll = async () => {
    const { data } = await supabase.from('cash_invoices')
      .select(selectCols).order('invoice_date', { ascending: false }).limit(5000);
    setAllRows(data || []);
  };

  const changeForm = (k, v) => setForm(prev => ({ ...prev, [k]: v }));
  const resetForm = () => { setForm({ ...EMPTY_FORM, invoice_date: todayStr }); setEditingId(null); };

  const commissionOf = (amt) => Math.round((Number(amt) || 0) * COMMISSION_RATE * 100) / 100;

  const handleSave = async () => {
    if (!canEdit) return;
    if (!form.invoice_date) return showMsg('اختر تاريخ الفاتورة', 'error');
    if (!form.rep_id) return showMsg('اختر المندوب', 'error');
    if (!form.customer_id) return showMsg('اختر العميل', 'error');
    if (!form.invoice_number.trim()) return showMsg('أدخل رقم الفاتورة', 'error');
    const amount = Number(form.amount);
    if (!(amount > 0)) return showMsg('أدخل قيمة فاتورة صحيحة أكبر من صفر', 'error');

    setLoading(true);
    // منع تكرار نفس رقم الفاتورة لنفس المندوب.
    const { data: dup } = await supabase.from('cash_invoices')
      .select('id').eq('rep_id', form.rep_id)
      .eq('invoice_number', form.invoice_number.trim());
    if ((dup || []).some(r => r.id !== editingId)) {
      setLoading(false);
      return showMsg('رقم الفاتورة ده مُدخل قبل كده لنفس المندوب', 'error');
    }

    const payload = {
      invoice_date: form.invoice_date,
      rep_id: form.rep_id,
      customer_id: form.customer_id,
      invoice_number: form.invoice_number.trim(),
      amount,
      note: form.note?.trim() || null,
      updated_at: new Date().toISOString(),
    };

    let error;
    if (editingId) {
      ({ error } = await supabase.from('cash_invoices').update(payload).eq('id', editingId));
    } else {
      ({ error } = await supabase.from('cash_invoices').insert(payload));
    }
    if (error) { showMsg('خطأ: ' + error.message, 'error'); setLoading(false); return; }

    const rep = reps.find(r => r.id === form.rep_id);
    const cust = customers.find(c => c.id === form.customer_id);
    await logAuditEvent({
      eventType: editingId ? 'update' : 'create',
      pageKey: 'cashinv',
      entityType: 'cash_invoices',
      entityId: editingId || `${form.rep_id}:${payload.invoice_number}`,
      details: { rep: rep?.name || '', customer: cust?.customer_name || '', invoice: payload.invoice_number, amount, commission: commissionOf(amount) },
    });
    showMsg(editingId ? '✓ تم حفظ التعديل' : '✓ تم حفظ الفاتورة');
    // للإدخال السريع: نحتفظ بالتاريخ والمندوب ونفرّغ رقم الفاتورة والقيمة.
    setForm(prev => ({ ...EMPTY_FORM, invoice_date: prev.invoice_date, rep_id: editingId ? '' : prev.rep_id, customer_id: '' }));
    setEditingId(null);
    fetchMonth();
    if (allRows !== null) fetchAll();
    setLoading(false);
  };

  const handleEdit = (r) => {
    setEditingId(r.id);
    setForm({
      invoice_date: r.invoice_date, rep_id: r.rep_id, customer_id: r.customer_id,
      invoice_number: r.invoice_number, amount: String(r.amount), note: r.note || '',
    });
    setTab('entry');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleDelete = async (r) => {
    if (!canEdit) return;
    if (!window.confirm(`حذف فاتورة رقم ${r.invoice_number} للعميل ${r.customers?.customer_name || ''}؟`)) return;
    const { error } = await supabase.from('cash_invoices').delete().eq('id', r.id);
    if (error) return showMsg('خطأ: ' + error.message, 'error');
    await logAuditEvent({
      eventType: 'delete', pageKey: 'cashinv', entityType: 'cash_invoices', entityId: r.id,
      details: { rep: r.representatives?.name || '', invoice: r.invoice_number, amount: r.amount },
    });
    showMsg('✓ تم الحذف');
    fetchMonth();
    if (allRows !== null) fetchAll();
  };

  // قائمة الشهر بعد فلتر المندوب
  const listRows = useMemo(
    () => (listRep ? rows.filter(r => r.rep_id === listRep) : rows),
    [rows, listRep]
  );
  const listTotals = useMemo(() => listRows.reduce(
    (a, r) => ({ amount: a.amount + Number(r.amount || 0), comm: a.comm + Number(r.commission_amount || 0) }),
    { amount: 0, comm: 0 }
  ), [listRows]);

  // تقرير الشهر لكل مندوب
  const report = useMemo(() => {
    const byRep = new Map();
    for (const r of rows) {
      let g = byRep.get(r.rep_id);
      if (!g) {
        g = { rep_id: r.rep_id, name: r.representatives?.name || '—', region: r.representatives?.regions?.name || '—',
              count: 0, amount: 0, comm: 0, customers: new Map() };
        byRep.set(r.rep_id, g);
      }
      g.count += 1; g.amount += Number(r.amount || 0); g.comm += Number(r.commission_amount || 0);
      const cname = r.customers?.customer_name || '—';
      const c = g.customers.get(cname) || { count: 0, amount: 0, comm: 0 };
      c.count += 1; c.amount += Number(r.amount || 0); c.comm += Number(r.commission_amount || 0);
      g.customers.set(cname, c);
    }
    return [...byRep.values()].sort((a, b) => b.comm - a.comm);
  }, [rows]);
  const reportTotals = useMemo(() => report.reduce(
    (a, g) => ({ count: a.count + g.count, amount: a.amount + g.amount, comm: a.comm + g.comm }),
    { count: 0, amount: 0, comm: 0 }
  ), [report]);

  // بحث المرتجع
  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !allRows) return [];
    return allRows.filter(r =>
      String(r.invoice_number || '').toLowerCase().includes(q)
      || String(r.customers?.customer_name || '').toLowerCase().includes(q)
      || String(r.representatives?.name || '').toLowerCase().includes(q)
    ).slice(0, 200);
  }, [query, allRows]);

  const TabBtn = ({ id, label }) => (
    <button className={`btn ${tab === id ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab(id)}
      style={{ padding: '0.5rem 1.1rem' }}>{label}</button>
  );

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">🧾 الفواتير النقدية</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.25rem' }}>
          فواتير الكاش التي يحصّلها المندوب — عمولة ٥٪ تُحوَّل لحظيًا وتُخصم آخر الشهر من إجمالي عمولاته.
        </p>
      </div>
      {msg && <div className={`alert alert-${msg.type}`}>{msg.text}</div>}

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        {canEdit && <TabBtn id="entry" label="📝 إدخال الفواتير" />}
        {!canEdit && <TabBtn id="entry" label="📋 فواتير الشهر" />}
        <TabBtn id="report" label="📊 تقرير آخر الشهر" />
        <TabBtn id="search" label="🔎 بحث المرتجع" />
      </div>

      {/* فلتر الشهر — لتبويبي الإدخال والتقرير */}
      {tab !== 'search' && (
        <div className="card">
          <div className="form-grid">
            <div className="form-group">
              <label className="form-label">الشهر</label>
              <select className="form-select" value={month} onChange={e => setMonth(Number(e.target.value))}>
                {MONTHS_AR.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">السنة</label>
              <select className="form-select" value={year} onChange={e => setYear(Number(e.target.value))}>
                {years.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>
        </div>
      )}

      {/* ===== تبويب الإدخال ===== */}
      {tab === 'entry' && (
        <>
          {canEdit && (
            <div className="card">
              <div className="card-title">{editingId ? '✏️ تعديل فاتورة' : '➕ إدخال فاتورة نقدية'}</div>
              <div className="form-grid">
                <div className="form-group">
                  <label className="form-label">تاريخ الفاتورة</label>
                  <input className="form-input" type="date" value={form.invoice_date}
                    onChange={e => changeForm('invoice_date', e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">المندوب</label>
                  <select className="form-select" value={form.rep_id}
                    onChange={e => changeForm('rep_id', e.target.value) || changeForm('customer_id', '')}>
                    <option value="">-- اختر مندوب --</option>
                    {reps.map(r => <option key={r.id} value={r.id}>{r.name} — {r.regions?.name || ''}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">العميل</label>
                  <select className="form-select" value={form.customer_id} disabled={!form.rep_id}
                    onChange={e => changeForm('customer_id', e.target.value)}>
                    <option value="">{form.rep_id ? '-- اختر عميل --' : 'اختر المندوب أولاً'}</option>
                    {customers.map(c => <option key={c.id} value={c.id}>{c.customer_name}{c.customer_code ? ` (${c.customer_code})` : ''}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">رقم الفاتورة</label>
                  <input className="form-input" type="text" value={form.invoice_number}
                    onChange={e => changeForm('invoice_number', e.target.value)} placeholder="رقم الفاتورة" />
                </div>
                <div className="form-group">
                  <label className="form-label">قيمة الفاتورة</label>
                  <input className="form-input" type="number" min="0" inputMode="decimal" value={form.amount}
                    onChange={e => changeForm('amount', e.target.value)} placeholder="المبلغ" />
                </div>
                <div className="form-group">
                  <label className="form-label">العمولة ٥٪ (المُحوَّلة)</label>
                  <div className="form-input" style={{ fontWeight: 800, color: '#10b981' }}>
                    {nf(commissionOf(form.amount))}
                  </div>
                </div>
                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label className="form-label">ملاحظة (اختياري)</label>
                  <input className="form-input" type="text" value={form.note}
                    onChange={e => changeForm('note', e.target.value)} placeholder="ملاحظة" />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
                <button className="btn btn-success" onClick={handleSave} disabled={loading}>
                  {loading ? '⏳ جاري الحفظ...' : editingId ? '💾 حفظ التعديل' : '💾 حفظ الفاتورة'}
                </button>
                <button className="btn btn-ghost" onClick={resetForm}>{editingId ? 'إلغاء التعديل' : 'مسح'}</button>
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-title">فواتير {MONTHS_AR[month - 1]} {year}</div>
            <div className="form-group" style={{ maxWidth: 320 }}>
              <label className="form-label">فلتر بالمندوب</label>
              <select className="form-select" value={listRep} onChange={e => setListRep(e.target.value)}>
                <option value="">كل المناديب</option>
                {reps.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
            {listRows.length === 0 ? (
              <div className="empty-state"><div className="empty-state-icon">🧾</div>
                <div className="empty-state-text">لا توجد فواتير نقدية في هذا الشهر</div></div>
            ) : (
              <div className="table-wrapper">
                <table className="responsive-cards">
                  <thead>
                    <tr><th>التاريخ</th><th>المندوب</th><th>العميل</th><th>رقم الفاتورة</th><th>القيمة</th><th>العمولة ٥٪</th>{canEdit && <th>إجراءات</th>}</tr>
                  </thead>
                  <tbody>
                    {listRows.map(r => (
                      <tr key={r.id}>
                        <td data-label="التاريخ">{r.invoice_date}</td>
                        <td data-label="المندوب">{r.representatives?.name || '—'}</td>
                        <td data-label="العميل">{r.customers?.customer_name || '—'}</td>
                        <td data-label="رقم الفاتورة">{r.invoice_number}</td>
                        <td data-label="القيمة">{nf(r.amount)}</td>
                        <td data-label="العمولة ٥٪" style={{ color: '#10b981', fontWeight: 700 }}>{nf(r.commission_amount)}</td>
                        {canEdit && (
                          <td className="no-label">
                            <button className="btn btn-primary btn-sm" onClick={() => handleEdit(r)}>تعديل</button>{' '}
                            <button className="btn btn-danger btn-sm" onClick={() => handleDelete(r)}>حذف</button>
                          </td>
                        )}
                      </tr>
                    ))}
                    <tr style={{ fontWeight: 800, background: 'var(--bg-elevated, #0f172a)' }}>
                      <td data-label="الإجمالي" colSpan={4}>الإجمالي ({listRows.length} فاتورة)</td>
                      <td data-label="إجمالي القيمة">{nf(listTotals.amount)}</td>
                      <td data-label="إجمالي العمولة" style={{ color: '#10b981' }}>{nf(listTotals.comm)}</td>
                      {canEdit && <td className="no-label"></td>}
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ===== تبويب تقرير آخر الشهر ===== */}
      {tab === 'report' && (
        <>
          <div className="card">
            <div className="card-title">إجمالي {MONTHS_AR[month - 1]} {year}</div>
            <div className="form-grid">
              <div className="stat-tile" style={{ background: '#eff6ff', borderRadius: 10, padding: '12px', textAlign: 'center' }}>
                <div style={{ color: '#64748b', fontSize: '0.8rem' }}>عدد الفواتير</div>
                <div style={{ fontSize: '1.6rem', fontWeight: 800 }}>{reportTotals.count}</div>
              </div>
              <div className="stat-tile" style={{ background: '#f0fdf4', borderRadius: 10, padding: '12px', textAlign: 'center' }}>
                <div style={{ color: '#64748b', fontSize: '0.8rem' }}>إجمالي قيمة الفواتير</div>
                <div style={{ fontSize: '1.6rem', fontWeight: 800 }}>{nf(reportTotals.amount)}</div>
              </div>
              <div className="stat-tile" style={{ background: '#fef3c7', borderRadius: 10, padding: '12px', textAlign: 'center' }}>
                <div style={{ color: '#64748b', fontSize: '0.8rem' }}>إجمالي العمولة ٥٪ (الخصم)</div>
                <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#b45309' }}>{nf(reportTotals.comm)}</div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-title">الخصم لكل مندوب — {MONTHS_AR[month - 1]} {year}</div>
            {report.length === 0 ? (
              <div className="empty-state"><div className="empty-state-icon">📊</div>
                <div className="empty-state-text">لا توجد فواتير نقدية في هذا الشهر</div></div>
            ) : (
              <div className="table-wrapper">
                <table className="responsive-cards">
                  <thead>
                    <tr><th>المندوب</th><th>المنطقة</th><th>عدد الفواتير</th><th>إجمالي القيمة</th><th>الخصم من العمولة (٥٪)</th><th></th></tr>
                  </thead>
                  <tbody>
                    {report.map(g => (
                      <React.Fragment key={g.rep_id}>
                        <tr>
                          <td data-label="المندوب"><strong>{g.name}</strong></td>
                          <td data-label="المنطقة">{g.region}</td>
                          <td data-label="عدد الفواتير">{g.count}</td>
                          <td data-label="إجمالي القيمة">{nf(g.amount)}</td>
                          <td data-label="الخصم" style={{ color: '#b45309', fontWeight: 800 }}>{nf(g.comm)}</td>
                          <td className="no-label">
                            <button className="btn btn-ghost btn-sm" onClick={() => setExpanded(expanded === g.rep_id ? null : g.rep_id)}>
                              {expanded === g.rep_id ? 'إخفاء العملاء' : 'عرض العملاء'}
                            </button>
                          </td>
                        </tr>
                        {expanded === g.rep_id && (
                          <tr>
                            <td className="no-label" colSpan={6} style={{ padding: '1rem', background: 'var(--bg-elevated, #0f172a)' }}>
                              <table className="responsive-cards" style={{ width: '100%' }}>
                                <thead><tr><th>العميل</th><th>عدد الفواتير</th><th>القيمة</th><th>العمولة ٥٪</th></tr></thead>
                                <tbody>
                                  {[...g.customers.entries()].sort((a, b) => b[1].comm - a[1].comm).map(([name, c]) => (
                                    <tr key={name}>
                                      <td data-label="العميل">{name}</td>
                                      <td data-label="عدد الفواتير">{c.count}</td>
                                      <td data-label="القيمة">{nf(c.amount)}</td>
                                      <td data-label="العمولة ٥٪" style={{ color: '#10b981' }}>{nf(c.comm)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                    <tr style={{ fontWeight: 800, background: 'var(--bg-elevated, #0f172a)' }}>
                      <td data-label="الإجمالي" colSpan={2}>الإجمالي</td>
                      <td data-label="عدد الفواتير">{reportTotals.count}</td>
                      <td data-label="إجمالي القيمة">{nf(reportTotals.amount)}</td>
                      <td data-label="الخصم" style={{ color: '#b45309' }}>{nf(reportTotals.comm)}</td>
                      <td className="no-label"></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ===== تبويب بحث المرتجع ===== */}
      {tab === 'search' && (
        <div className="card">
          <div className="card-title">🔎 بحث مرجعي للمرتجع</div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '-0.25rem', marginBottom: '0.75rem' }}>
            ابحث برقم الفاتورة أو اسم العميل أو المندوب للتأكد إن المرتجع من فاتورة نقدية (محتسبة عمولة) أو لا.
          </p>
          <div className="form-group">
            <input className="form-input" type="text" value={query} onChange={e => setQuery(e.target.value)}
              placeholder="رقم الفاتورة / اسم العميل / المندوب" />
          </div>
          {allRows === null ? (
            <div className="loading"><div className="spinner" />جاري التحميل...</div>
          ) : !query.trim() ? (
            <div className="empty-state"><div className="empty-state-icon">🔎</div>
              <div className="empty-state-text">اكتب كلمة للبحث</div></div>
          ) : searchResults.length === 0 ? (
            <div className="empty-state"><div className="empty-state-icon">∅</div>
              <div className="empty-state-text">لا توجد فاتورة نقدية مطابقة — المرتجع غالبًا ليس من الفواتير النقدية</div></div>
          ) : (
            <div className="table-wrapper">
              <table className="responsive-cards">
                <thead>
                  <tr><th>التاريخ</th><th>المندوب</th><th>العميل</th><th>رقم الفاتورة</th><th>القيمة</th><th>العمولة ٥٪</th></tr>
                </thead>
                <tbody>
                  {searchResults.map(r => (
                    <tr key={r.id}>
                      <td data-label="التاريخ">{r.invoice_date}</td>
                      <td data-label="المندوب">{r.representatives?.name || '—'}</td>
                      <td data-label="العميل">{r.customers?.customer_name || '—'}</td>
                      <td data-label="رقم الفاتورة">{r.invoice_number}</td>
                      <td data-label="القيمة">{nf(r.amount)}</td>
                      <td data-label="العمولة ٥٪" style={{ color: '#10b981', fontWeight: 700 }}>{nf(r.commission_amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', marginTop: '0.5rem' }}>
                يظهر حتى ٢٠٠ نتيجة. لو ظهرت الفاتورة هنا فهي <b>فاتورة نقدية محتسبة عمولة</b> — راجع قبل اعتماد المرتجع.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
