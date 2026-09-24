import React, { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';
import { formatCurrency } from '../lib/helpers';
import { logAuditEvent } from '../lib/audit';

// Normalize a header/number cell: Arabic-Indic digits → Latin, trim, drop commas.
const arDigits = '٠١٢٣٤٥٦٧٨٩';
const toLatin = (s) => String(s ?? '').replace(/[٠-٩]/g, d => String(arDigits.indexOf(d)));
const num = (v) => {
  const s = toLatin(v).replace(/,/g, '').replace(/[^\d.-]/g, '').trim();
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
};
const norm = (s) => toLatin(s).replace(/\s+/g, ' ').trim();

// Guess a column index from header keywords.
const findCol = (headers, test) => headers.findIndex(h => test(norm(h)));

const TARGETS = [
  { key: 'code', label: 'رقم العميل (الكود)', guess: (h) => h.includes('رقم العميل') || h === 'كود' || h.includes('كود العميل') },
  { key: 'name', label: 'اسم العميل', guess: (h) => h.includes('اسم العميل') || h === 'الاسم' || h === 'اسم' },
  { key: 'debt_total', label: 'إجمالي الدين (المبلغ)', guess: (h) => (h === 'المبلغ' || h.includes('اجمالي') || h.includes('إجمالي')) && !h.includes('حد') },
  { key: 'debt_1_45', label: '45-60 يوم', guess: (h) => h.includes('45') && h.includes('60') },
  { key: 'debt_over_60', label: '61-90 يوم', guess: (h) => h.includes('61') && h.includes('90') },
  { key: 'debt_over_90', label: '91-120 يوم', guess: (h) => h.includes('91') && h.includes('120') },
  { key: 'debt_over_120', label: '121-150 يوم', guess: (h) => h.includes('121') && h.includes('150') },
  { key: 'debt_over_150', label: 'أكثر من 150', guess: (h) => h.includes('150') && !h.includes('121') && (h.includes('>') || h.includes('اكثر') || h.includes('أكثر') || h.includes('فوق')) },
];

export default function CustomerDebtUpload() {
  const [regions, setRegions] = useState([]);
  const [regionId, setRegionId] = useState('');
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState([]);
  const [dataRows, setDataRows] = useState([]);
  const [map, setMap] = useState({});
  const [busy, setBusy] = useState(false);
  const [mergeMode, setMergeMode] = useState(false); // add a 2nd file without zeroing the region
  const [msg, setMsg] = useState(null);
  const [result, setResult] = useState(null);

  useEffect(() => {
    supabase.from('regions').select('id, name').order('name').then(({ data }) => setRegions(data || []));
  }, []);

  const showMsg = (text, type = 'success') => { setMsg({ text, type }); };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name); setResult(null); setMsg(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' });
      // Find the header row: first row that contains a "رقم العميل" cell.
      let hIdx = rows.findIndex(r => r.some(c => norm(c).includes('رقم العميل')));
      if (hIdx < 0) hIdx = 0;
      const hdr = rows[hIdx].map(c => norm(c));
      const body = rows.slice(hIdx + 1).filter(r => r.some(c => String(c ?? '').trim() !== ''));
      setHeaders(hdr);
      setDataRows(body);
      // Auto-guess the mapping.
      const m = {};
      TARGETS.forEach(t => { const i = findCol(hdr, t.guess); if (i >= 0) m[t.key] = i; });
      setMap(m);
    } catch (err) {
      showMsg('تعذّر قراءة الملف: ' + err.message, 'error');
    }
  };

  const preview = useMemo(() => {
    if (!dataRows.length || map.code == null) return { rows: [], total: 0, count: 0 };
    const rows = dataRows.map(r => ({
      code: norm(r[map.code]),
      name: map.name != null ? norm(r[map.name]) : '',
      debt_total: map.debt_total != null ? num(r[map.debt_total]) : 0,
      debt_1_45: map.debt_1_45 != null ? num(r[map.debt_1_45]) : 0,
      debt_over_60: map.debt_over_60 != null ? num(r[map.debt_over_60]) : 0,
      debt_over_90: map.debt_over_90 != null ? num(r[map.debt_over_90]) : 0,
      debt_over_120: map.debt_over_120 != null ? num(r[map.debt_over_120]) : 0,
      debt_over_150: map.debt_over_150 != null ? num(r[map.debt_over_150]) : 0,
    })).filter(x => x.code);
    const total = rows.reduce((s, x) => s + x.debt_total, 0);
    return { rows, total, count: rows.length };
  }, [dataRows, map]);

  const apply = async () => {
    if (!regionId) { showMsg('اختر المنطقة أولًا', 'error'); return; }
    if (!preview.count) { showMsg('لا توجد صفوف صالحة — تأكد من عمود رقم العميل', 'error'); return; }
    const regionName = regions.find(r => r.id === regionId)?.name;
    const confirmText = mergeMode
      ? `دمج ${preview.count} عميل في منطقة «${regionName}» بدون تصفير الباقي؟\nيُستخدم لرفع ملف ثانٍ لنفس المنطقة (لن يُمسح ما رُفع قبله). أي كود جديد سيُضاف.`
      : `تحديث ديون ${preview.count} عميل لمنطقة «${regionName}»؟\nالعملاء غير الموجودين في الملف سيصبح دينهم صفر (لقطة جديدة). أي كود جديد في الملف سيُضاف كعميل جديد للمنطقة.`;
    if (!window.confirm(confirmText)) return;
    setBusy(true); setResult(null);
    const { data, error } = await supabase.rpc('import_customer_debt', { p_rows: preview.rows, p_region_id: regionId, p_zero_region: !mergeMode });
    if (error) { showMsg('خطأ: ' + error.message, 'error'); setBusy(false); return; }
    setResult(data);
    await logAuditEvent({ eventType: 'import', pageKey: 'debtupload', entityType: 'customers', details: { region: regionId, updated: data?.updated, inserted: data?.inserted, rows: preview.count } });
    showMsg(`✓ تم تحديث ${data?.updated || 0} عميل${data?.inserted ? ` وإضافة ${data.inserted} عميل جديد` : ''}`, 'success');
    setBusy(false);
  };

  const colOptions = (
    <>
      <option value="">— لا يوجد —</option>
      {headers.map((h, i) => <option key={i} value={i}>{h || `عمود ${i + 1}`}</option>)}
    </>
  );

  return (
    <div>
      <div className="page-header"><h1 className="page-title">📥 تحديث ديون العملاء (رفع تقرير)</h1></div>
      {msg && <div className={`alert alert-${msg.type}`}>{msg.text}</div>}

      <div className="card">
        <div className="card-title">1) اختر المنطقة وارفع ملف التقرير</div>
        <p className="muted-text" style={{ fontSize: 12, marginBottom: '0.75rem' }}>
          كل ملف يخص منطقة واحدة. عند التطبيق تصبح أرقام هذا الملف هي اللقطة الحالية لديون عملاء المنطقة
          (العميل غير الموجود في الملف يُصفَّر دينه). البيانات تُطابَق بـ«رقم العميل».
        </p>
        <div className="form-grid">
          <div className="form-group">
            <label className="form-label">المنطقة</label>
            <select className="form-select" value={regionId} onChange={e => setRegionId(e.target.value)}>
              <option value="">-- اختر المنطقة --</option>
              {regions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">ملف التقرير (Excel / CSV)</label>
            <input className="form-input" type="file" accept=".xlsx,.xls,.csv" onChange={onFile} />
            {fileName && <div className="muted-text" style={{ fontSize: 12, marginTop: 4 }}>📄 {fileName}</div>}
          </div>
        </div>
      </div>

      {headers.length > 0 && (
        <div className="card">
          <div className="card-title">2) مطابقة الأعمدة</div>
          <p className="muted-text" style={{ fontSize: 12, marginBottom: '0.75rem' }}>
            راجع الأعمدة المكتشفة تلقائيًا وعدّلها لو لزم.
          </p>
          <div className="form-grid">
            {TARGETS.map(t => (
              <div className="form-group" key={t.key}>
                <label className="form-label">{t.label}{t.key === 'code' ? ' *' : ''}</label>
                <select className="form-select" value={map[t.key] ?? ''}
                  onChange={e => setMap(m => ({ ...m, [t.key]: e.target.value === '' ? undefined : Number(e.target.value) }))}>
                  {colOptions}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      {preview.count > 0 && (
        <div className="card">
          <div className="card-title">3) معاينة — {preview.count} عميل · إجمالي الدين {formatCurrency(preview.total)}</div>
          <div className="table-wrapper">
            <table className="responsive-cards">
              <thead><tr>
                <th>رقم العميل</th><th>الاسم</th><th>الإجمالي</th><th>45-60</th><th>61-90</th><th>91-120</th><th>121-150</th><th>فوق 150</th>
              </tr></thead>
              <tbody>
                {preview.rows.slice(0, 8).map((x, i) => (
                  <tr key={i}>
                    <td data-label="رقم العميل"><strong>{x.code}</strong></td>
                    <td data-label="الاسم">{x.name || '—'}</td>
                    <td data-label="الإجمالي">{formatCurrency(x.debt_total)}</td>
                    <td data-label="45-60">{formatCurrency(x.debt_1_45)}</td>
                    <td data-label="61-90">{formatCurrency(x.debt_over_60)}</td>
                    <td data-label="91-120">{formatCurrency(x.debt_over_90)}</td>
                    <td data-label="121-150">{formatCurrency(x.debt_over_120)}</td>
                    <td data-label="فوق 150">{formatCurrency(x.debt_over_150)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.count > 8 && <p className="muted-text" style={{ fontSize: 12, marginTop: 6 }}>… و{preview.count - 8} صف آخر.</p>}
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: '0.75rem', cursor: 'pointer', fontSize: 13 }}>
            <input type="checkbox" checked={mergeMode} onChange={e => setMergeMode(e.target.checked)} style={{ marginTop: 3 }} />
            <span>
              <b>دمج بدون تصفير</b> — فعّلها لرفع <b>ملف ثانٍ لنفس المنطقة</b> (مثل «الرياض ٣» بعد «الرياض ٢»).
              يضيف/يحدّث بيانات هذا الملف <b>بدون</b> مسح ما رُفع قبله في نفس المنطقة.
              <br />
              <span style={{ color: '#b45309' }}>ابدأ دائمًا بملف واحد <b>بدون</b> هذا الخيار (لقطة جديدة)، ثم فعّله للملفات الإضافية.</span>
            </span>
          </label>
          <div className="btn-row" style={{ marginTop: '0.75rem' }}>
            <button className="btn btn-success" onClick={apply} disabled={busy || !regionId}>
              {busy ? '⏳ جاري التحديث...' : (mergeMode ? '➕ دمج الملف في المنطقة (بدون تصفير)' : '✅ تطبيق التحديث على المنطقة (لقطة جديدة)')}
            </button>
          </div>
        </div>
      )}

      {result && (
        <div className="card" style={{ borderInlineStart: '4px solid #16a34a' }}>
          <div className="card-title">نتيجة التحديث</div>
          <div style={{ fontSize: 15 }}>✅ تم تحديث <strong>{result.updated}</strong> عميل
            {result.inserted ? <> · وإضافة <strong>{result.inserted}</strong> عميل جديد</> : null}.</div>
          {Array.isArray(result.unmatched) && result.unmatched.length > 0 && (
            <div style={{ marginTop: 8, color: '#b45309' }}>
              ⚠️ {result.unmatched.length} رقم عميل بدون منطقة محددة (لم يُحدَّث):
              <div style={{ fontSize: 12, marginTop: 4, wordBreak: 'break-word' }}>{result.unmatched.slice(0, 30).join('، ')}{result.unmatched.length > 30 ? ' …' : ''}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
