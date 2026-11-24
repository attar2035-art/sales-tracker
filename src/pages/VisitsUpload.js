import React, { useState, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabase';
import { logAuditEvent } from '../lib/audit';

// Normalize a header/number cell: Arabic-Indic digits → Latin, trim.
const arDigits = '٠١٢٣٤٥٦٧٨٩';
const toLatin = (s) => String(s ?? '').replace(/[٠-٩]/g, d => String(arDigits.indexOf(d)));
const norm = (s) => toLatin(s).replace(/\s+/g, ' ').trim();

// Convert a cell (Excel Date, serial, or text) to YYYY-MM-DD. Assumes DD/MM/YYYY for text.
const toISO = (v) => {
  if (v == null || v === '') return '';
  if (v instanceof Date && !isNaN(v)) {
    // SheetJS (cellDates:true) builds the Excel calendar day at LOCAL midnight,
    // so read LOCAL components to keep the stored day equal to the file's date.
    // (Reading UTC here shifted uploaders in UTC+ zones — e.g. Riyadh/Cairo —
    // back by a day, which collided dates and dropped whole days on import.)
    const y = v.getFullYear(), m = String(v.getMonth() + 1).padStart(2, '0'), d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = toLatin(String(v)).trim();
  let m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/); // DD/MM/YYYY [time]
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = s.match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})/); // YYYY-MM-DD [time]
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  // A bare number (e.g. a visit id like 36194) is NOT a date — require a real
  // date separator before falling back to Date parsing.
  if (!/[-/.]/.test(s)) return '';
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

// Content tests used for automatic column detection (header-independent).
const isCodeCell = (v) => /^\d{8,12}$/.test(toLatin(String(v ?? '')).trim());
const isDateCell = (v) => { const iso = toISO(v); if (!iso) return false; const y = Number(iso.slice(0, 4)); return y >= 2000 && y <= 2100; };
const isResultCell = (v) => normResult(v) !== '';

const TARGETS = [
  { key: 'code', label: 'رقم العميل (الكود)' },
  { key: 'date', label: 'تاريخ الزيارة' },
  { key: 'result', label: 'نتيجة الزيارة' },
];

// Pick the column (index) whose cells most often satisfy `pred`, excluding already-used columns.
const detectCol = (rows, ncols, pred, exclude) => {
  let best = -1, bestCount = 0;
  for (let i = 0; i < ncols; i++) {
    if (exclude.includes(i)) continue;
    let c = 0;
    for (const r of rows) if (pred(r[i])) c++;
    if (c > bestCount) { bestCount = c; best = i; }
  }
  return bestCount > 0 ? best : undefined;
};

export default function VisitsUpload() {
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState([]);
  const [dataRows, setDataRows] = useState([]);
  const [map, setMap] = useState({});
  const [autoOk, setAutoOk] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [result, setResult] = useState(null);

  const showMsg = (text, type = 'success') => { setMsg({ text, type }); };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name); setResult(null); setMsg(null); setAutoOk(false); setShowMap(false);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' });
      const ncols = rows.reduce((mx, r) => Math.max(mx, r.length), 0);

      // Column names for the (optional) manual mapping dropdowns: use the first row
      // that looks like a header, else generic labels.
      let hIdx = rows.findIndex(r => r.some(c => { const s = norm(c); return s.includes('نتيج') || s.includes('العميل'); }));
      const hdr = hIdx >= 0
        ? Array.from({ length: ncols }, (_, i) => norm(rows[hIdx][i]) || `عمود ${i + 1}`)
        : Array.from({ length: ncols }, (_, i) => `عمود ${i + 1}`);

      // Auto-detect columns BY CONTENT (works even with the "رق العميل" typo,
      // per-rep section headers, repeated header rows and blank rows).
      const cCode = detectCol(rows, ncols, isCodeCell, []);
      const cResult = detectCol(rows, ncols, isResultCell, [cCode].filter(x => x != null));
      const cDate = detectCol(rows, ncols, isDateCell, [cCode, cResult].filter(x => x != null));

      const m = {};
      if (cCode != null) m.code = cCode;
      if (cDate != null) m.date = cDate;
      if (cResult != null) m.result = cResult;

      const ok = m.code != null && m.date != null && m.result != null;
      setHeaders(hdr);
      setDataRows(rows);
      setMap(m);
      setAutoOk(ok);
      setShowMap(!ok); // only reveal the mapping UI if auto-detection was incomplete
      if (!ok) showMsg('تعذّر اكتشاف بعض الأعمدة تلقائيًا — راجعي المطابقة بالأسفل', 'error');
    } catch (err) {
      showMsg('تعذّر قراءة الملف: ' + err.message, 'error');
    }
  };

  // Per-line rows (one per operation) sent to the server; it dedups + attributes.
  // Rows that aren't real visits (section headers, repeated header rows, blanks)
  // are dropped here because their code isn't a customer code / result isn't valid.
  const lines = useMemo(() => {
    if (!dataRows.length || map.code == null || map.date == null || map.result == null) return [];
    return dataRows.map(r => ({
      code: toLatin(String(r[map.code] ?? '')).trim(),
      date: toISO(r[map.date]),
      result: normResult(r[map.result]),
    })).filter(x => /^\d{8,12}$/.test(x.code) && x.date && x.result);
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
    if (!preview.visits) { showMsg('لا توجد زيارات صالحة في الملف — تأكدي من أعمدة رقم العميل والتاريخ والنتيجة', 'error'); return; }
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
    const held = Number(data?.held || 0);
    showMsg(`✓ تم رفع ${data?.visits || 0} زيارة لـ ${data?.reps || 0} مندوب${held ? ` · ${held} زيارة محفوظة بأكواد غير مسجّلة (هتتضاف تلقائيًا بعد تسجيل العميل)` : ''}`, 'success');
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
        <div className="card-title">1) ارفعي ملف الزيارات</div>
        <p className="muted-text" style={{ fontSize: 12, marginBottom: '0.75rem' }}>
          صدّري «تقرير الزيارات – تحليلي» من البرنامج كـ Excel وارفعيه هنا — بدل إدخال الزيارات الناجحة والفاشلة يدويًا.
          التطبيق يكتشف الأعمدة تلقائيًا ويتجاهل صفوف عناوين المناديب. العميل اللي عليه أكتر من عملية في نفس اليوم
          (فاتورة + سند + مرتجع) يُحتسب <b>زيارة واحدة</b>، والزيارة تُوزَّع على مندوبها بـ«رقم العميل». ما تحتاجيش تختاري منطقة.
        </p>
        <div className="form-group">
          <label className="form-label">ملف الزيارات (Excel / CSV)</label>
          <input className="form-input" type="file" accept=".xlsx,.xls,.csv" onChange={onFile} />
          {fileName && <div className="muted-text" style={{ fontSize: 12, marginTop: 4 }}>📄 {fileName}</div>}
        </div>
      </div>

      {autoOk && !showMap && (
        <div className="card" style={{ borderInlineStart: '4px solid #16a34a' }}>
          <div style={{ fontSize: 14, color: '#15803d', fontWeight: 700 }}>✅ تم اكتشاف الأعمدة تلقائيًا</div>
          <div className="muted-text" style={{ fontSize: 12, marginTop: 4 }}>
            رقم العميل: «{headers[map.code]}» · التاريخ: «{headers[map.date]}» · النتيجة: «{headers[map.result]}».
          </div>
          <button className="btn btn-secondary" style={{ marginTop: 8 }} onClick={() => setShowMap(true)}>تعديل الأعمدة يدويًا</button>
        </div>
      )}

      {headers.length > 0 && showMap && (
        <div className="card">
          <div className="card-title">مطابقة الأعمدة</div>
          <p className="muted-text" style={{ fontSize: 12, marginBottom: '0.75rem' }}>
            اختاري العمود المطابق لكل حقل من ملفك.
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
            2) معاينة — {preview.visits} زيارة فعلية · {preview.successful} ناجحة · {preview.failed} غير ناجحة
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
              ⚠️ <strong>{Number(result.held) || result.unmatched.length}</strong> زيارة بأكواد غير مسجّلة <strong>تم حفظها ولم تُفقَد</strong> — وستُضاف تلقائيًا بمجرد تسجيل هؤلاء العملاء، من غير إعادة رفع الملف.
              <div style={{ fontSize: 12, marginTop: 6 }}>عدد الأكواد غير المسجّلة: {result.unmatched.length}</div>
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
