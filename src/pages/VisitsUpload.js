import React, { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';
import { logAuditEvent } from '../lib/audit';

// Normalize a header/number cell: Arabic-Indic digits → Latin, trim.
const arDigits = '٠١٢٣٤٥٦٧٨٩';
const toLatin = (s) => String(s ?? '').replace(/[٠-٩]/g, d => String(arDigits.indexOf(d)));
const norm = (s) => toLatin(s).replace(/\s+/g, ' ').trim();

// Guess a column index from header keywords.
const findCol = (headers, test) => headers.findIndex(h => test(norm(h)));

// Convert a cell (Excel Date, serial, or text) to YYYY-MM-DD. Assumes DD/MM/YYYY for text.
const toISO = (v) => {
  if (v == null || v === '') return '';
  if (v instanceof Date && !isNaN(v)) {
    const y = v.getFullYear(), m = String(v.getMonth() + 1).padStart(2, '0'), d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = toLatin(String(v)).trim();
  let m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/); // DD/MM/YYYY
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/); // YYYY-MM-DD
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  const d = new Date(s);
  if (!isNaN(d)) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
  return '';
};

// Normalize the visit-result cell to a canonical value, or '' if unrecognized.
const normResult = (v) => {
  const s = norm(v);
  if (s.includes('غير')) return 'غير ناجحة';
  if (s.includes('ناجح')) return 'ناجحة';
  return '';
};

const TARGETS = [
  { key: 'code', label: 'رقم العميل (الكود)', guess: (h) => h.includes('رقم العميل') || h === 'كود' || h.includes('كود العميل') },
  { key: 'date', label: 'تاريخ الزيارة', guess: (h) => (h.includes('تاريخ') && h.includes('زيار')) || h === 'التاريخ' || h === 'تاريخ' },
  { key: 'result', label: 'نتيجة الزيارة', guess: (h) => (h.includes('نتيج') && h.includes('زيار')) || h === 'النتيجة' || h === 'نتيجة' },
];

export default function VisitsUpload() {
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState([]);
  const [dataRows, setDataRows] = useState([]);
  const [map, setMap] = useState({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [result, setResult] = useState(null);

  useEffect(() => { /* no lookups needed: rep is resolved by customer code server-side */ }, []);

  const showMsg = (text, type = 'success') => { setMsg({ text, type }); };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name); setResult(null); setMsg(null);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' });
      // Header row: first row containing a "رقم العميل" cell.
      let hIdx = rows.findIndex(r => r.some(c => norm(c).includes('رقم العميل')));
      if (hIdx < 0) hIdx = 0;
      const hdr = rows[hIdx].map(c => norm(c));
      const body = rows.slice(hIdx + 1).filter(r => r.some(c => String(c ?? '').trim() !== ''));
      setHeaders(hdr);
      setDataRows(body);
      const m = {};
      TARGETS.forEach(t => { const i = findCol(hdr, t.guess); if (i >= 0) m[t.key] = i; });
      setMap(m);
    } catch (err) {
      showMsg('تعذّر قراءة الملف: ' + err.message, 'error');
    }
  };

  // Per-line rows (one per operation) sent to the server; it dedups + attributes.
  const lines = useMemo(() => {
    if (!dataRows.length || map.code == null || map.date == null || map.result == null) return [];
    return dataRows.map(r => ({
      code: norm(r[map.code]),
      date: toISO(r[map.date]),
      result: normResult(r[map.result]),
    })).filter(x => x.code && x.date && x.result);
  }, [dataRows, map]);

  // Client-side preview: dedup a customer's multiple same-day operations into one visit.
  const preview = useMemo(() => {
    const seen = new Map(); // code|date -> ok(any)
    const dates = new Set();
    for (const x of lines) {
      dates.add(x.date);
      const k = x.code + '|' + x.date;
      seen.set(k, (seen.get(k) || false) || x.result === 'ناجحة');
    }
    let ok = 0;
    for (const v of seen.values()) if (v) ok++;
    return { lineCount: lines.length, visits: seen.size, successful: ok, failed: seen.size - ok, dates: [...dates].sort() };
  }, [lines]);

  const apply = async () => {
    if (!preview.visits) { showMsg('لا توجد زيارات صالحة — تأكد من أعمدة رقم العميل والتاريخ والنتيجة', 'error'); return; }
    const confirmText = `رفع زيارات ${preview.dates.length > 1 ? preview.dates.length + ' أيام' : 'يوم ' + preview.dates[0]}؟\n`
      + `${preview.visits} زيارة فعلية (بعد دمج العميل المكرر في نفس اليوم)، منها ${preview.successful} ناجحة.\n`
      + `التوزيع على المناديب بالكود. أرقام الزيارات في الإدخال اليومي هتتحدّث لهذه الأيام.`;
    if (!window.confirm(confirmText)) return;
    setBusy(true); setResult(null);
    const { data, error } = await supabase.rpc('import_daily_visits', { p_rows: lines });
    if (error) { showMsg('خطأ: ' + error.message, 'error'); setBusy(false); return; }
    setResult(data);
    await logAuditEvent({
      eventType: 'import', pageKey: 'visitsupload', entityType: 'daily_visits',
      details: { reps: data?.reps, visits: data?.visits, successful: data?.successful, dates: data?.dates, lines: lines.length },
    });
    const unmatched = Array.isArray(data?.unmatched) ? data.unmatched.length : 0;
    showMsg(`✓ تم رفع ${data?.visits || 0} زيارة لـ ${data?.reps || 0} مندوب${unmatched ? ` · ${unmatched} كود غير معروف` : ''}`, 'success');
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
      <div className="page-header"><h1 className="page-title">📍 رفع الزيارات اليومية (من تقرير البرنامج)</h1></div>
      {msg && <div className={`alert alert-${msg.type}`}>{msg.text}</div>}

      <div className="card">
        <div className="card-title">1) ارفع ملف الزيارات</div>
        <p className="muted-text" style={{ fontSize: 12, marginBottom: '0.75rem' }}>
          صدّري «تقرير الزيارات – تحليلي» من البرنامج كـ Excel وارفعيه هنا — بدل إدخال الزيارات الناجحة والفاشلة يدويًا.
          العميل اللي عليه أكتر من عملية في نفس اليوم (فاتورة + سند + مرتجع) يُحتسب <b>زيارة واحدة</b>،
          والزيارة تُوزَّع على مندوبها بـ«رقم العميل». ما تحتاجش تختاري منطقة.
        </p>
        <div className="form-group">
          <label className="form-label">ملف الزيارات (Excel / CSV)</label>
          <input className="form-input" type="file" accept=".xlsx,.xls,.csv" onChange={onFile} />
          {fileName && <div className="muted-text" style={{ fontSize: 12, marginTop: 4 }}>📄 {fileName}</div>}
        </div>
      </div>

      {headers.length > 0 && (
        <div className="card">
          <div className="card-title">2) مطابقة الأعمدة</div>
          <p className="muted-text" style={{ fontSize: 12, marginBottom: '0.75rem' }}>
            راجعي الأعمدة المكتشفة تلقائيًا وعدّليها لو لزم.
          </p>
          <div className="form-grid">
            {TARGETS.map(t => (
              <div className="form-group" key={t.key}>
                <label className="form-label">{t.label} *</label>
                <select className="form-select" value={map[t.key] ?? ''}
                  onChange={e => setMap(m => ({ ...m, [t.key]: e.target.value === '' ? undefined : Number(e.target.value) }))}>
                  {colOptions}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      {preview.visits > 0 && (
        <div className="card">
          <div className="card-title">
            3) معاينة — {preview.visits} زيارة فعلية · {preview.successful} ناجحة · {preview.failed} غير ناجحة
          </div>
          <p className="muted-text" style={{ fontSize: 13, marginBottom: '0.5rem' }}>
            عدد السطور في الملف: {preview.lineCount} · بعد دمج العميل المكرر في نفس اليوم: <b>{preview.visits}</b> زيارة.
          </p>
          <p className="muted-text" style={{ fontSize: 13 }}>
            التواريخ: {preview.dates.join('، ')}
          </p>
          <div className="btn-row" style={{ marginTop: '0.75rem' }}>
            <button className="btn btn-success" onClick={apply} disabled={busy}>
              {busy ? '⏳ جاري الرفع...' : '✅ رفع الزيارات وتحديث الإدخال اليومي'}
            </button>
          </div>
        </div>
      )}

      {result && (
        <div className="card" style={{ borderInlineStart: '4px solid #16a34a' }}>
          <div className="card-title">نتيجة الرفع</div>
          <div style={{ fontSize: 15 }}>
            ✅ تم رفع <strong>{result.visits}</strong> زيارة لـ <strong>{result.reps}</strong> مندوب
            {typeof result.successful === 'number' ? <> · منها <strong>{result.successful}</strong> ناجحة</> : null}.
          </div>
          {Array.isArray(result.dates) && result.dates.length > 0 && (
            <div className="muted-text" style={{ fontSize: 13, marginTop: 6 }}>التواريخ: {result.dates.join('، ')}</div>
          )}
          {Array.isArray(result.unmatched) && result.unmatched.length > 0 && (
            <div style={{ marginTop: 8, color: '#b45309' }}>
              ⚠️ {result.unmatched.length} رقم عميل غير معروف (لم يُحتسب — عميل جديد أو كود غير مسجّل):
              <div style={{ fontSize: 12, marginTop: 4, wordBreak: 'break-word' }}>
                {result.unmatched.slice(0, 30).join('، ')}{result.unmatched.length > 30 ? ' …' : ''}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
