import React, { useState, useEffect, useMemo, useRef } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';
import { MONTHS_AR } from '../lib/helpers';
import { logAuditEvent } from '../lib/audit';

// الفواتير النقدية — المندوب يحصّلها كاش وتُحوَّل له عمولة 5% لحظيًا تُخصم آخر الشهر.
// أميرة تختار المندوب والعميل وترفع ملف الفاتورة (Excel من النظام)، والتطبيق يسحب
// رقم الفاتورة والتاريخ والأصناف والإجمالي. العمولة 5% على صافي البيع قبل الضريبة
// (العمود commission_amount في قاعدة البيانات = amount × 5%، و amount = صافي قبل الضريبة).

const nf = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
const pad2 = (n) => String(n).padStart(2, '0');
const lastDay = (y, m) => new Date(y, m, 0).getDate();
const num = (v) => { const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')); return isNaN(n) ? 0 : n; };
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const EMPTY_FORM = { invoice_date: '', rep_id: '', customer_id: '', invoice_number: '', amount: '', note: '' };

// ── قارئ ملف الفاتورة (Excel) ───────────────────────────────────────────────
function toISODate(s) {
  const m = String(s || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return '';
  return `${m[3]}-${pad2(m[2])}-${pad2(m[1])}`;
}
function parseInvoiceWorkbook(data) {
  const wb = XLSX.read(data, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: null });
  const headerText = String((rows[0] && rows[0][0]) || '');
  const grab = (re) => { const x = headerText.match(re); return x ? x[1].trim() : ''; };

  const invoice_number = grab(/رقم الفاتورة\s*:\s*(\d+)/);
  const invoice_date = toISODate(grab(/التاريخ\s*:\s*([\d/]+)/));
  const type = grab(/نوع الفاتورة\s*:\s*([^\n]+?)(?:\s+التاريخ|\n|$)/);
  const custM = headerText.match(/اسم العميل\s*:\s*-?(\d+)?\s*([^\n]+)/);
  const customer_code = custM && custM[1] ? custM[1] : '';
  const customer_name = custM ? String(custM[2] || '').trim() : '';
  const repM = headerText.match(/المندوب\s*:\s*(?:مندوب\s*)?([^\n]+?)(?:\s+نوع الفاتورة|\n|$)/);
  const rep_name = repM ? repM[1].trim() : '';

  const norm = (c) => String(c == null ? '' : c).replace(/\s+/g, ' ').trim();
  let hi = rows.findIndex((r) => Array.isArray(r) && r.some((c) => norm(c) === 'رقم الصنف'));
  if (hi < 0) hi = 1;
  const H = (rows[hi] || []).map(norm);
  const find = (pred, fb) => { const i = H.findIndex(pred); return i >= 0 ? i : fb; };
  const cCode = find((h) => h === 'رقم الصنف', 1);
  const cName = find((h) => h === 'اسم الصنف', 2);
  const cUnit = find((h) => h === 'الوحدة', 3);
  const cQty = find((h) => h === 'الكمية', 4);
  const cDisc = find((h) => h === 'الخصم', 7);
  const cPrice = find((h) => h === 'السعر بعد الخصم', 8);
  const cVat = find((h) => h.startsWith('ضريبة'), 9);
  const cPVat = find((h) => h.includes('السعر') && h.includes('شامل'), 10);

  const items = [];
  for (let r = hi + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const code = row[cCode];
    if (code == null || String(code).trim() === '') continue;
    const quantity = num(row[cQty]);
    const unit_price = num(row[cPrice]);
    const price_with_vat = num(row[cPVat]);
    items.push({
      item_code: String(code).trim(),
      item_name: String(row[cName] ?? '').trim(),
      unit: String(row[cUnit] ?? '').trim(),
      quantity,
      unit_price,
      discount: num(row[cDisc]),
      vat_per_unit: num(row[cVat]),
      price_with_vat,
      line_total: r2(quantity * unit_price),
      line_total_with_vat: r2(quantity * price_with_vat),
    });
  }
  const amount = r2(items.reduce((a, it) => a + it.line_total, 0));
  const amount_with_vat = r2(items.reduce((a, it) => a + it.line_total_with_vat, 0));
  return { invoice_number, invoice_date, type, customer_code, customer_name, rep_name, items, amount, amount_with_vat };
}

export default function CashInvoices({ user }) {
  const canEdit = ['admin', 'data_entry'].includes(user?.role);
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;

  const [tab, setTab] = useState('entry');
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [reps, setReps] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [rows, setRows] = useState([]);
  const [listRep, setListRep] = useState('');
  const [form, setForm] = useState({ ...EMPTY_FORM, invoice_date: todayStr });
  const [parsed, setParsed] = useState(null);     // نتيجة قراءة الملف
  const [fileObj, setFileObj] = useState(null);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [expanded, setExpanded] = useState(null);
  const [allRows, setAllRows] = useState(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState(null);
  const fileRef = useRef(null);

  const years = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1];
  const showMsg = (text, type = 'success', ms = 4000) => { setMsg({ text, type }); setTimeout(() => setMsg(null), ms); };

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
  const fetchCustomers = async (repId) => {
    const rep = reps.find((r) => r.id === repId);
    if (!rep?.region_id) { setCustomers([]); return; }
    const { data } = await supabase.from('customers')
      .select('id, customer_name, customer_code').eq('region_id', rep.region_id).eq('is_active', true)
      .order('customer_name');
    setCustomers(data || []);
  };

  const selectCols = 'id, invoice_date, rep_id, customer_id, invoice_number, amount, amount_with_vat, commission_amount, source_file_path, source_file_name, note, representatives(name, regions(name)), customers(customer_name)';

  const fetchMonth = async () => {
    const first = `${year}-${pad2(month)}-01`;
    const last = `${year}-${pad2(month)}-${pad2(lastDay(year, month))}`;
    const { data } = await supabase.from('cash_invoices').select(selectCols)
      .gte('invoice_date', first).lte('invoice_date', last)
      .order('invoice_date', { ascending: false }).order('created_at', { ascending: false });
    setRows(data || []);
  };
  const fetchAll = async () => {
    const { data } = await supabase.from('cash_invoices').select(selectCols)
      .order('invoice_date', { ascending: false }).limit(5000);
    setAllRows(data || []);
  };

  const changeForm = (k, v) => setForm((prev) => ({ ...prev, [k]: v }));
  const resetForm = () => {
    setForm({ ...EMPTY_FORM, invoice_date: todayStr });
    setParsed(null); setFileObj(null); setParseError(''); setEditingId(null);
    if (fileRef.current) fileRef.current.value = '';
  };
  const commissionOf = (amt) => r2((Number(amt) || 0) * 0.05);

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFileObj(f); setParsing(true); setParseError('');
    try {
      const buf = await f.arrayBuffer();
      const p = parseInvoiceWorkbook(new Uint8Array(buf));
      setParsed(p);
      setForm((prev) => ({
        ...prev,
        invoice_number: p.invoice_number || prev.invoice_number,
        invoice_date: p.invoice_date || prev.invoice_date,
        amount: p.amount ? String(p.amount) : prev.amount,
      }));
      if (!p.invoice_number && !p.items.length) setParseError('اتقرأ الملف بس ماقدرتش ألاقي رقم فاتورة أو أصناف — راجع إنه نفس صيغة النظام.');
    } catch (err) {
      setParseError('تعذّر قراءة الملف: ' + (err?.message || err));
      setParsed(null);
    }
    setParsing(false);
  };

  const handleSave = async () => {
    if (!canEdit) return;
    if (!form.invoice_date) return showMsg('اختر تاريخ الفاتورة', 'error');
    if (!form.rep_id) return showMsg('اختر المندوب', 'error');
    if (!form.customer_id) return showMsg('اختر العميل', 'error');
    if (!form.invoice_number.trim()) return showMsg('رقم الفاتورة مطلوب', 'error');
    const amount = Number(form.amount);
    if (!(amount > 0)) return showMsg('قيمة الفاتورة (صافي قبل الضريبة) لازم تكون أكبر من صفر', 'error');

    setLoading(true);
    const { data: dup } = await supabase.from('cash_invoices').select('id')
      .eq('rep_id', form.rep_id).eq('invoice_number', form.invoice_number.trim());
    if ((dup || []).some((r) => r.id !== editingId)) {
      setLoading(false);
      return showMsg('رقم الفاتورة ده مُدخل قبل كده لنفس المندوب', 'error');
    }

    // رفع الملف للتخزين (لو فيه ملف جديد).
    let source_file_path = null, source_file_name = null;
    if (fileObj) {
      const safe = fileObj.name.replace(/[^\w.\-]+/g, '_');
      const path = `${form.rep_id}/${Date.now()}_${safe}`;
      const { error: upErr } = await supabase.storage.from('cash-invoices')
        .upload(path, fileObj, { upsert: false, contentType: fileObj.type || undefined });
      if (upErr) { setLoading(false); return showMsg('خطأ في رفع الملف: ' + upErr.message, 'error'); }
      source_file_path = path; source_file_name = fileObj.name;
    }

    const payload = {
      invoice_date: form.invoice_date,
      rep_id: form.rep_id,
      customer_id: form.customer_id,
      invoice_number: form.invoice_number.trim(),
      amount,
      amount_with_vat: parsed?.amount_with_vat ?? null,
      note: form.note?.trim() || null,
      extracted_meta: parsed
        ? { customer_code: parsed.customer_code, customer_name: parsed.customer_name, rep_name: parsed.rep_name, type: parsed.type }
        : null,
      updated_at: new Date().toISOString(),
    };
    if (source_file_path) { payload.source_file_path = source_file_path; payload.source_file_name = source_file_name; }

    let invoiceId = editingId;
    let error;
    if (editingId) {
      ({ error } = await supabase.from('cash_invoices').update(payload).eq('id', editingId));
    } else {
      const ins = await supabase.from('cash_invoices').insert(payload).select('id').single();
      error = ins.error; invoiceId = ins.data?.id;
    }
    if (error) { setLoading(false); return showMsg('خطأ: ' + error.message, 'error'); }

    // الأصناف: لو فيه ملف جديد متقري، نستبدل أصناف الفاتورة.
    if (parsed && parsed.items.length && invoiceId) {
      if (editingId) await supabase.from('cash_invoice_items').delete().eq('invoice_id', invoiceId);
      const itemRows = parsed.items.map((it, i) => ({ invoice_id: invoiceId, line_no: i + 1, ...it }));
      const { error: itErr } = await supabase.from('cash_invoice_items').insert(itemRows);
      if (itErr) showMsg('اتحفظت الفاتورة بس فيه مشكلة في حفظ الأصناف: ' + itErr.message, 'error', 6000);
    }

    const rep = reps.find((r) => r.id === form.rep_id);
    const cust = customers.find((c) => c.id === form.customer_id);
    await logAuditEvent({
      eventType: editingId ? 'update' : 'create', pageKey: 'cashinv', entityType: 'cash_invoices',
      entityId: invoiceId || `${form.rep_id}:${payload.invoice_number}`,
      details: { rep: rep?.name || '', customer: cust?.customer_name || '', invoice: payload.invoice_number, amount, commission: commissionOf(amount), items: parsed?.items.length || 0 },
    });
    showMsg(editingId ? '✓ تم حفظ التعديل' : '✓ تم حفظ الفاتورة');
    resetForm();
    setForm((prev) => ({ ...EMPTY_FORM, invoice_date: form.invoice_date, rep_id: editingId ? '' : form.rep_id }));
    fetchMonth();
    if (allRows !== null) fetchAll();
    setLoading(false);
  };

  const handleEdit = (r) => {
    setEditingId(r.id);
    setParsed(null); setFileObj(null); setParseError('');
    if (fileRef.current) fileRef.current.value = '';
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
    if (r.source_file_path) await supabase.storage.from('cash-invoices').remove([r.source_file_path]);
    await logAuditEvent({
      eventType: 'delete', pageKey: 'cashinv', entityType: 'cash_invoices', entityId: r.id,
      details: { rep: r.representatives?.name || '', invoice: r.invoice_number, amount: r.amount },
    });
    showMsg('✓ تم الحذف');
    fetchMonth();
    if (allRows !== null) fetchAll();
  };

  const openFile = async (path) => {
    const { data, error } = await supabase.storage.from('cash-invoices').createSignedUrl(path, 120);
    if (error || !data?.signedUrl) return showMsg('تعذّر فتح الملف: ' + (error?.message || ''), 'error');
    window.open(data.signedUrl, '_blank', 'noopener');
  };

  const listRows = useMemo(() => (listRep ? rows.filter((r) => r.rep_id === listRep) : rows), [rows, listRep]);
  const listTotals = useMemo(() => listRows.reduce(
    (a, r) => ({ amount: a.amount + Number(r.amount || 0), comm: a.comm + Number(r.commission_amount || 0) }),
    { amount: 0, comm: 0 }), [listRows]);

  const report = useMemo(() => {
    const byRep = new Map();
    for (const r of rows) {
      let g = byRep.get(r.rep_id);
      if (!g) { g = { rep_id: r.rep_id, name: r.representatives?.name || '—', region: r.representatives?.regions?.name || '—', count: 0, amount: 0, comm: 0, customers: new Map() }; byRep.set(r.rep_id, g); }
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
    { count: 0, amount: 0, comm: 0 }), [report]);

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || !allRows) return [];
    return allRows.filter((r) =>
      String(r.invoice_number || '').toLowerCase().includes(q)
      || String(r.customers?.customer_name || '').toLowerCase().includes(q)
      || String(r.representatives?.name || '').toLowerCase().includes(q)
    ).slice(0, 200);
  }, [query, allRows]);

  const TabBtn = ({ id, label }) => (
    <button className={`btn ${tab === id ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab(id)} style={{ padding: '0.5rem 1.1rem' }}>{label}</button>
  );

  // تلميح مطابقة العميل/المندوب المستخرجين من الملف مقابل المختار.
  const selectedCustomer = customers.find((c) => c.id === form.customer_id);
  const selectedRep = reps.find((r) => r.id === form.rep_id);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">🧾 الفواتير النقدية</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.25rem' }}>
          فواتير الكاش التي يحصّلها المندوب — عمولة ٥٪ على صافي البيع (قبل الضريبة) تُحوَّل لحظيًا وتُخصم آخر الشهر.
        </p>
      </div>
      {msg && <div className={`alert alert-${msg.type}`}>{msg.text}</div>}

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <TabBtn id="entry" label={canEdit ? '📤 رفع وإدخال فاتورة' : '📋 فواتير الشهر'} />
        <TabBtn id="report" label="📊 تقرير آخر الشهر" />
        <TabBtn id="search" label="🔎 بحث المرتجع" />
      </div>

      {tab !== 'search' && (
        <div className="card">
          <div className="form-grid">
            <div className="form-group">
              <label className="form-label">الشهر</label>
              <select className="form-select" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                {MONTHS_AR.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">السنة</label>
              <select className="form-select" value={year} onChange={(e) => setYear(Number(e.target.value))}>
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
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
              <div className="card-title">{editingId ? '✏️ تعديل فاتورة' : '📤 رفع وإدخال فاتورة نقدية'}</div>
              <div className="form-grid">
                <div className="form-group">
                  <label className="form-label">المندوب</label>
                  <select className="form-select" value={form.rep_id}
                    onChange={(e) => { changeForm('rep_id', e.target.value); changeForm('customer_id', ''); }}>
                    <option value="">-- اختر مندوب --</option>
                    {reps.map((r) => <option key={r.id} value={r.id}>{r.name} — {r.regions?.name || ''}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">العميل</label>
                  <select className="form-select" value={form.customer_id} disabled={!form.rep_id}
                    onChange={(e) => changeForm('customer_id', e.target.value)}>
                    <option value="">{form.rep_id ? '-- اختر عميل --' : 'اختر المندوب أولاً'}</option>
                    {customers.map((c) => <option key={c.id} value={c.id}>{c.customer_name}{c.customer_code ? ` (${c.customer_code})` : ''}</option>)}
                  </select>
                </div>
              </div>

              <div className="form-group" style={{ marginTop: '0.5rem' }}>
                <label className="form-label">ملف الفاتورة (Excel من النظام)</label>
                <input ref={fileRef} className="form-input" type="file" accept=".xlsx,.xls"
                  onChange={onFile} disabled={!form.rep_id || !form.customer_id} />
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                  اختر المندوب والعميل الأول، بعدين ارفع ملف الفاتورة — هيتسحب رقم الفاتورة والتاريخ والأصناف والإجمالي. (تقدر كمان تدخل يدوي من غير ملف.)
                </div>
              </div>

              {parsing && <div className="alert alert-info">⏳ جاري قراءة الملف...</div>}
              {parseError && <div className="alert alert-warning">{parseError}</div>}

              {/* مطابقة المستخرج مع المختار */}
              {parsed && (
                <div className="alert alert-info" style={{ fontSize: '0.82rem' }}>
                  <b>من الملف:</b>{' '}
                  العميل: {parsed.customer_name || '—'}{parsed.customer_code ? ` (${parsed.customer_code})` : ''} ·
                  {' '}المندوب: {parsed.rep_name || '—'} ·
                  {' '}النوع: {parsed.type || '—'} ·
                  {' '}الأصناف: {parsed.items.length}
                  <div style={{ marginTop: '0.25rem', color: 'var(--text-muted)' }}>
                    المختار في النظام: العميل «{selectedCustomer?.customer_name || '—'}» · المندوب «{selectedRep?.name || '—'}» — تأكّد إنهم نفس الفاتورة.
                  </div>
                </div>
              )}

              <div className="form-grid" style={{ marginTop: '0.5rem' }}>
                <div className="form-group">
                  <label className="form-label">رقم الفاتورة</label>
                  <input className="form-input" type="text" value={form.invoice_number}
                    onChange={(e) => changeForm('invoice_number', e.target.value)} placeholder="رقم الفاتورة" />
                </div>
                <div className="form-group">
                  <label className="form-label">تاريخ الفاتورة</label>
                  <input className="form-input" type="date" value={form.invoice_date}
                    onChange={(e) => changeForm('invoice_date', e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">صافي البيع (قبل الضريبة)</label>
                  <input className="form-input" type="number" min="0" inputMode="decimal" value={form.amount}
                    onChange={(e) => changeForm('amount', e.target.value)} placeholder="المبلغ قبل الضريبة" />
                </div>
                <div className="form-group">
                  <label className="form-label">العمولة ٥٪ (المُحوَّلة)</label>
                  <div className="form-input" style={{ fontWeight: 800, color: '#10b981' }}>{nf(commissionOf(form.amount))}</div>
                </div>
                {parsed && (
                  <div className="form-group">
                    <label className="form-label">الإجمالي شامل الضريبة (من الملف)</label>
                    <div className="form-input" style={{ color: 'var(--text-muted)' }}>{nf(parsed.amount_with_vat)}</div>
                  </div>
                )}
                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label className="form-label">ملاحظة (اختياري)</label>
                  <input className="form-input" type="text" value={form.note}
                    onChange={(e) => changeForm('note', e.target.value)} placeholder="ملاحظة" />
                </div>
              </div>

              {/* أصناف الفاتورة المستخرجة */}
              {parsed && parsed.items.length > 0 && (
                <div style={{ marginTop: '0.5rem' }}>
                  <div className="card-title" style={{ fontSize: '0.95rem' }}>أصناف الفاتورة ({parsed.items.length})</div>
                  <div className="table-wrapper">
                    <table className="responsive-cards">
                      <thead>
                        <tr><th>الصنف</th><th>الكود</th><th>الكمية</th><th>السعر (قبل ض.)</th><th>الإجمالي (قبل ض.)</th></tr>
                      </thead>
                      <tbody>
                        {parsed.items.map((it, i) => (
                          <tr key={i}>
                            <td data-label="الصنف">{it.item_name}</td>
                            <td data-label="الكود">{it.item_code}</td>
                            <td data-label="الكمية">{nf(it.quantity)} {it.unit}</td>
                            <td data-label="السعر">{nf(it.unit_price)}</td>
                            <td data-label="الإجمالي">{nf(it.line_total)}</td>
                          </tr>
                        ))}
                        <tr style={{ fontWeight: 800 }}>
                          <td data-label="الإجمالي" colSpan={4}>صافي البيع (قبل الضريبة)</td>
                          <td data-label="الإجمالي">{nf(parsed.amount)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
                <button className="btn btn-success" onClick={handleSave} disabled={loading || parsing}>
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
              <select className="form-select" value={listRep} onChange={(e) => setListRep(e.target.value)}>
                <option value="">كل المناديب</option>
                {reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
            {listRows.length === 0 ? (
              <div className="empty-state"><div className="empty-state-icon">🧾</div>
                <div className="empty-state-text">لا توجد فواتير نقدية في هذا الشهر</div></div>
            ) : (
              <div className="table-wrapper">
                <table className="responsive-cards">
                  <thead>
                    <tr><th>التاريخ</th><th>المندوب</th><th>العميل</th><th>رقم الفاتورة</th><th>صافي (قبل ض.)</th><th>العمولة ٥٪</th><th>الملف</th>{canEdit && <th>إجراءات</th>}</tr>
                  </thead>
                  <tbody>
                    {listRows.map((r) => (
                      <tr key={r.id}>
                        <td data-label="التاريخ">{r.invoice_date}</td>
                        <td data-label="المندوب">{r.representatives?.name || '—'}</td>
                        <td data-label="العميل">{r.customers?.customer_name || '—'}</td>
                        <td data-label="رقم الفاتورة">{r.invoice_number}</td>
                        <td data-label="صافي">{nf(r.amount)}</td>
                        <td data-label="العمولة ٥٪" style={{ color: '#10b981', fontWeight: 700 }}>{nf(r.commission_amount)}</td>
                        <td data-label="الملف">{r.source_file_path
                          ? <button className="btn btn-ghost btn-sm" onClick={() => openFile(r.source_file_path)}>📎 فتح</button>
                          : <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
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
                      <td data-label="إجمالي صافي">{nf(listTotals.amount)}</td>
                      <td data-label="إجمالي العمولة" style={{ color: '#10b981' }}>{nf(listTotals.comm)}</td>
                      <td className="no-label"></td>
                      {canEdit && <td className="no-label"></td>}
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* ===== تقرير آخر الشهر ===== */}
      {tab === 'report' && (
        <>
          <div className="card">
            <div className="card-title">إجمالي {MONTHS_AR[month - 1]} {year}</div>
            <div className="form-grid">
              <div style={{ background: '#eff6ff', borderRadius: 10, padding: '12px', textAlign: 'center' }}>
                <div style={{ color: '#64748b', fontSize: '0.8rem' }}>عدد الفواتير</div>
                <div style={{ fontSize: '1.6rem', fontWeight: 800 }}>{reportTotals.count}</div>
              </div>
              <div style={{ background: '#f0fdf4', borderRadius: 10, padding: '12px', textAlign: 'center' }}>
                <div style={{ color: '#64748b', fontSize: '0.8rem' }}>صافي البيع (قبل الضريبة)</div>
                <div style={{ fontSize: '1.6rem', fontWeight: 800 }}>{nf(reportTotals.amount)}</div>
              </div>
              <div style={{ background: '#fef3c7', borderRadius: 10, padding: '12px', textAlign: 'center' }}>
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
                    <tr><th>المندوب</th><th>المنطقة</th><th>عدد الفواتير</th><th>صافي البيع</th><th>الخصم من العمولة (٥٪)</th><th></th></tr>
                  </thead>
                  <tbody>
                    {report.map((g) => (
                      <React.Fragment key={g.rep_id}>
                        <tr>
                          <td data-label="المندوب"><strong>{g.name}</strong></td>
                          <td data-label="المنطقة">{g.region}</td>
                          <td data-label="عدد الفواتير">{g.count}</td>
                          <td data-label="صافي البيع">{nf(g.amount)}</td>
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
                                <thead><tr><th>العميل</th><th>عدد الفواتير</th><th>صافي البيع</th><th>العمولة ٥٪</th></tr></thead>
                                <tbody>
                                  {[...g.customers.entries()].sort((a, b) => b[1].comm - a[1].comm).map(([name, c]) => (
                                    <tr key={name}>
                                      <td data-label="العميل">{name}</td>
                                      <td data-label="عدد الفواتير">{c.count}</td>
                                      <td data-label="صافي البيع">{nf(c.amount)}</td>
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
                      <td data-label="صافي البيع">{nf(reportTotals.amount)}</td>
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

      {/* ===== بحث المرتجع ===== */}
      {tab === 'search' && (
        <div className="card">
          <div className="card-title">🔎 بحث مرجعي للمرتجع</div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '-0.25rem', marginBottom: '0.75rem' }}>
            ابحث برقم الفاتورة أو اسم العميل أو المندوب للتأكد إن المرتجع من فاتورة نقدية (محتسبة عمولة) أو لا.
          </p>
          <div className="form-group">
            <input className="form-input" type="text" value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="رقم الفاتورة / اسم العميل / المندوب" />
          </div>
          {allRows === null ? (
            <div className="loading"><div className="spinner" />جاري التحميل...</div>
          ) : !query.trim() ? (
            <div className="empty-state"><div className="empty-state-icon">🔎</div><div className="empty-state-text">اكتب كلمة للبحث</div></div>
          ) : searchResults.length === 0 ? (
            <div className="empty-state"><div className="empty-state-icon">∅</div>
              <div className="empty-state-text">لا توجد فاتورة نقدية مطابقة — المرتجع غالبًا ليس من الفواتير النقدية</div></div>
          ) : (
            <div className="table-wrapper">
              <table className="responsive-cards">
                <thead>
                  <tr><th>التاريخ</th><th>المندوب</th><th>العميل</th><th>رقم الفاتورة</th><th>صافي (قبل ض.)</th><th>العمولة ٥٪</th><th>الملف</th></tr>
                </thead>
                <tbody>
                  {searchResults.map((r) => (
                    <tr key={r.id}>
                      <td data-label="التاريخ">{r.invoice_date}</td>
                      <td data-label="المندوب">{r.representatives?.name || '—'}</td>
                      <td data-label="العميل">{r.customers?.customer_name || '—'}</td>
                      <td data-label="رقم الفاتورة">{r.invoice_number}</td>
                      <td data-label="صافي">{nf(r.amount)}</td>
                      <td data-label="العمولة ٥٪" style={{ color: '#10b981', fontWeight: 700 }}>{nf(r.commission_amount)}</td>
                      <td data-label="الملف">{r.source_file_path
                        ? <button className="btn btn-ghost btn-sm" onClick={() => openFile(r.source_file_path)}>📎 فتح</button>
                        : <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
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
