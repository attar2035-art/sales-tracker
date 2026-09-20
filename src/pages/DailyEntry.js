import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { MONTHS_AR, isWorkingDay } from '../lib/helpers';
import { logAuditEvent } from '../lib/audit';

const EMPTY_ENTRY = {
  daily_sales: '', daily_returns: '', daily_collection: '',
  new_customers: '', new_customers_value: '',
  total_visits: '', shelf_photos: '', successful_visits: '',
  new_products_skus: '', new_products_qty: '',
  new_products_availability: '',
  working_hours: '', km: '',
  daily_expenses: '',
  debt_total: '', debt_1_45: '', debt_over_60: '', debt_over_90: '', debt_over_120: '', debt_over_150: '',
  notes: '',
};

// Debt-aging buckets (entered per rep per day) + their labels for the form.
const DEBT_FIELDS = [
  { key: 'debt_total', label: 'إجمالي الدين' },
  { key: 'debt_1_45', label: 'من ٤٥ إلى ٦٠ يوم' },
  { key: 'debt_over_60', label: 'من ٦١ إلى ٩٠ يوم' },
  { key: 'debt_over_90', label: 'من ٩١ إلى ١٢٠ يوم' },
  { key: 'debt_over_120', label: 'من ١٢١ إلى ١٥٠ يوم' },
  { key: 'debt_over_150', label: 'فوق ١٥٠ يوم' },
];
const DEBT_KEYS = DEBT_FIELDS.map(f => f.key);
// ALL numeric entry fields accept a "+"-sum for merged regions (everything the
// lock system tracks except the free-text notes).
const SUM_KEYS = [
  'daily_sales', 'daily_returns', 'daily_collection', 'new_customers', 'new_customers_value',
  'total_visits', 'shelf_photos', 'successful_visits', 'new_products_skus', 'new_products_qty',
  'new_products_availability', 'working_hours', 'km', 'daily_expenses',
  ...DEBT_KEYS,
];
// A box may hold a "+"-sum so merged regions can be typed as two numbers
// (e.g. "5000+3000") and stored as one total.
const sumExpr = (raw) => String(raw ?? '').split('+').reduce((a, p) => a + (parseFloat(p.trim()) || 0), 0);

// Entry fields that support per-field ownership/locking (form keys).
const LOCKABLE_KEYS = [
  'daily_sales', 'daily_returns', 'daily_collection', 'new_customers', 'new_customers_value',
  'total_visits', 'shelf_photos', 'successful_visits', 'new_products_skus', 'new_products_qty',
  'new_products_availability', 'working_hours', 'km', 'daily_expenses',
  'debt_total', 'debt_1_45', 'debt_over_60', 'debt_over_90', 'debt_over_120', 'debt_over_150',
  'notes',
];

export default function DailyEntry({ user }) {
  const isAdmin = user?.role === 'admin';
  const myId = user?.id || null;
  const now = new Date();
  const pad2 = (n) => String(n).padStart(2, '0');
  // Local calendar date (not UTC) so the default day is correct near midnight.
  const todayStr = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [reps, setReps] = useState([]);
  const [selectedRep, setSelectedRep] = useState('');
  const [form, setForm] = useState({ ...EMPTY_ENTRY });
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState(null);
  const [existingEntry, setExistingEntry] = useState(null);
  const [fieldOwners, setFieldOwners] = useState({});
  // Explicit per-field assignments: { field_key: user_id }. An assigned field
  // may only be entered/edited by its assigned user.
  const [assignments, setAssignments] = useState({});
  const [errors, setErrors] = useState({});
  const containerRef = useRef(null);

  // A field is locked when it belongs to someone else — and it stays locked for
  // EVERYONE else, admins included. If the field is explicitly assigned, only the
  // assigned user may touch it; otherwise it falls back to first-come ownership
  // (whoever filled it first owns it). Also enforced by a DB trigger.
  const isLocked = (key) => {
    const assignee = assignments[key];
    if (assignee) return assignee !== myId;
    return !!fieldOwners[key] && fieldOwners[key] !== myId;
  };
  const lockNote = (key) => {
    if (!isLocked(key)) return null;
    const msg = assignments[key] ? '🔒 مخصّصة لمستخدم آخر' : '🔒 مقفولة — أدخلها مستخدم آخر لهذا اليوم';
    return <div style={{ fontSize: '0.72rem', color: '#f59e0b', marginTop: '0.25rem' }}>{msg}</div>;
  };

  // Update a field and clear its inline error as the user corrects it.
  const changeField = (key, value) => {
    if (isLocked(key)) return; // guard: locked fields are read-only for others
    setForm(prev => ({ ...prev, [key]: value }));
    setErrors(prev => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  // Auto-advance: Enter (or the phone keyboard's "next") moves focus to the
  // next enabled, visible field — speeds up one-handed data entry.
  const handleKeyDown = (e) => {
    if (e.key !== 'Enter' || e.target.tagName === 'TEXTAREA') return;
    const root = containerRef.current;
    if (!root) return;
    const focusables = Array.from(
      root.querySelectorAll('input:not([disabled]), select:not([disabled])')
    ).filter(el => el.type !== 'hidden' && el.offsetParent !== null);
    const idx = focusables.indexOf(e.target);
    if (idx > -1 && idx < focusables.length - 1) {
      e.preventDefault();
      focusables[idx + 1].focus();
    }
  };

  const errCls = (key) => `form-input${errors[key] ? ' has-error' : ''}`;

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchReps(); fetchAssignments(); }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (selectedRep && selectedDate) fetchEntry(); }, [selectedRep, selectedDate]);

  const fetchReps = async () => {
    const { data } = await supabase.from('representatives')
      .select('*, supervisors(name), regions(name)')
      .eq('is_active', true).order('name');
    if (data) setReps(data);
  };

  const fetchAssignments = async () => {
    const { data } = await supabase.from('data_entry_field_assignments').select('field_key, user_id');
    if (data) setAssignments(Object.fromEntries(data.map(r => [r.field_key, r.user_id])));
  };

  const fetchEntry = async () => {
    const { data } = await supabase.from('daily_entries')
      .select('*').eq('rep_id', selectedRep).eq('entry_date', selectedDate).maybeSingle();
    if (data) {
      setExistingEntry(data);
      setFieldOwners(data.field_owners || {});
      setForm({
        // daily_sales stores NET; show gross (= net + returns) back in the البيع box.
        daily_sales: ((Number(data.daily_sales) || 0) + (Number(data.daily_returns) || 0)) || '',
        daily_returns: data.daily_returns || '',
        daily_collection: data.daily_collection || '',
        new_customers: data.new_customers || '',
        new_customers_value: data.new_customers_value || '',
        total_visits: data.total_visits || '',
        shelf_photos: data.shelf_photos || '',
        successful_visits: data.successful_visits || '',
        new_products_skus: data.new_products_skus || '',
        new_products_qty: data.new_products_qty || '',
        new_products_availability: data.new_products_availability || '',
        working_hours: data.working_hours || '',
        km: data.km || '',
        daily_expenses: data.daily_expenses || '',
        debt_total: data.debt_total || '',
        debt_1_45: data.debt_1_45 || '',
        debt_over_60: data.debt_over_60 || '',
        debt_over_90: data.debt_over_90 || '',
        debt_over_120: data.debt_over_120 || '',
        debt_over_150: data.debt_over_150 || '',
        notes: data.notes || '',
      });
    } else {
      setExistingEntry(null);
      setFieldOwners({});
      setForm({ ...EMPTY_ENTRY });
    }
  };

  const showMsg = (text, type = 'success') => {
    setMsg({ text, type });
    setTimeout(() => setMsg(null), 3000);
  };

  const handleSave = async () => {
    if (!selectedRep || !selectedDate) { showMsg('اختر المندوب والتاريخ', 'error'); return; }
    const totalVisits = sumExpr(form.total_visits);
    const shelfPhotos = sumExpr(form.shelf_photos);
    const successfulVisits = sumExpr(form.successful_visits);
    const availability = sumExpr(form.new_products_availability);

    // Validation (was UI-only min=0 before): reject negatives, out-of-range and
    // illogical cross-field values before persisting. Errors are attached to the
    // specific field so they render directly under it.
    const numericKeys = [
      'daily_sales', 'daily_returns', 'daily_collection', 'new_customers', 'new_customers_value',
      'total_visits', 'shelf_photos', 'successful_visits', 'new_products_skus',
      'new_products_qty', 'new_products_availability', 'working_hours', 'km',
      'daily_expenses',
      'debt_total', 'debt_1_45', 'debt_over_60', 'debt_over_90', 'debt_over_120', 'debt_over_150',
    ];
    const fieldErrors = {};
    // Both البيع (gross sales) and المردود (returns) are entered as non-negative
    // amounts; the net (sales − returns) may end up negative and that's fine.
    numericKeys.forEach(k => {
      if ((parseFloat(form[k]) || 0) < 0) fieldErrors[k] = 'لا يمكن إدخال قيمة سالبة';
    });
    if (availability > 100) fieldErrors.new_products_availability = 'النسبة يجب أن تكون بين 0 و 100';
    if (successfulVisits > totalVisits) fieldErrors.successful_visits = 'لا يمكن أن تتجاوز إجمالي الزيارات';
    if (shelfPhotos > totalVisits) fieldErrors.shelf_photos = 'لا يمكن أن يتجاوز عدد الزيارات';
    // Debt aging: the aging buckets are parts of the total debt, so their sum
    // can never exceed إجمالي الدين. This catches mis-typed figures (e.g. a
    // bucket larger than the whole debt).
    const debtBucketsSum = ['debt_1_45', 'debt_over_60', 'debt_over_90', 'debt_over_120', 'debt_over_150']
      .reduce((s, k) => s + sumExpr(form[k]), 0);
    const debtTotalVal = sumExpr(form.debt_total);
    if (debtBucketsSum > debtTotalVal) {
      fieldErrors.debt_total = `مجموع فترات التأخير (${debtBucketsSum.toLocaleString('en')}) أكبر من إجمالي الدين — راجع الأرقام`;
    }
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      showMsg('صحّح الحقول المميّزة بالأحمر', 'error');
      // Scroll the first errored field into view and focus it.
      const firstKey = numericKeys.find(k => fieldErrors[k]);
      const el = containerRef.current?.querySelector(`[data-field="${firstKey}"]`);
      if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.focus(); }
      return;
    }
    setErrors({});

    setLoading(true);

    // Re-read the freshest row so we merge onto whatever other data-entry users
    // just saved, and NEVER overwrite a field owned by someone else.
    const { data: fresh } = await supabase.from('daily_entries')
      .select('*').eq('rep_id', selectedRep).eq('entry_date', selectedDate).maybeSingle();
    const owners = { ...(fresh?.field_owners || {}) };
    const num = (v) => parseFloat(v) || 0;
    const dbReturns = num(fresh?.daily_returns);
    // Current DB values as form-equivalents (gross for the البيع box).
    const dbForm = {
      daily_sales: num(fresh?.daily_sales) + dbReturns, daily_returns: dbReturns,
      daily_collection: num(fresh?.daily_collection), new_customers: num(fresh?.new_customers),
      new_customers_value: num(fresh?.new_customers_value), total_visits: num(fresh?.total_visits),
      shelf_photos: num(fresh?.shelf_photos), successful_visits: num(fresh?.successful_visits),
      new_products_skus: num(fresh?.new_products_skus), new_products_qty: num(fresh?.new_products_qty),
      new_products_availability: num(fresh?.new_products_availability), working_hours: num(fresh?.working_hours),
      km: num(fresh?.km), daily_expenses: num(fresh?.daily_expenses),
      debt_total: num(fresh?.debt_total), debt_1_45: num(fresh?.debt_1_45),
      debt_over_60: num(fresh?.debt_over_60), debt_over_90: num(fresh?.debt_over_90),
      debt_over_120: num(fresh?.debt_over_120), debt_over_150: num(fresh?.debt_over_150),
      notes: fresh?.notes || '',
    };

    // Merge each field: locked (owned by others) keeps the DB value; the user's
    // own or empty fields are updated, claiming/releasing ownership as needed.
    const v = {};
    for (const key of LOCKABLE_KEYS) {
      const owner = owners[key];
      const assignee = assignments[key];
      // An assigned field may only be written by its assignee; an unassigned one
      // by its owner (or if still unclaimed). Admins are NOT exempt — this mirrors
      // the DB trigger that enforces the same rule.
      const canEdit = assignee ? assignee === myId : (!owner || owner === myId);
      const raw = form[key];
      const provided = raw !== '' && raw !== null && raw !== undefined;
      if (!canEdit) { v[key] = dbForm[key]; continue; }
      if (provided) {
        v[key] = key === 'notes' ? raw : (SUM_KEYS.includes(key) ? sumExpr(raw) : num(raw));
        if (myId) owners[key] = myId; // claim/record ownership
      } else {
        v[key] = key === 'notes' ? '' : 0;
        if (owner === myId) delete owners[key]; // release my own claim
      }
    }

    // NOTE: `year`/`month` are GENERATED columns (from entry_date) — omitted.
    const payload = {
      rep_id: selectedRep,
      entry_date: selectedDate,
      // Store NET sales (gross − returns); keep raw returns alongside.
      daily_sales: v.daily_sales - v.daily_returns,
      daily_returns: v.daily_returns,
      daily_collection: v.daily_collection,
      new_customers: Math.round(v.new_customers),
      new_customers_value: v.new_customers_value,
      total_visits: Math.round(v.total_visits),
      shelf_photos: Math.round(v.shelf_photos),
      successful_visits: Math.round(v.successful_visits),
      new_products_skus: Math.round(v.new_products_skus),
      new_products_qty: Math.round(v.new_products_qty),
      new_products_availability: v.new_products_availability,
      working_hours: v.working_hours,
      km: v.km,
      daily_expenses: v.daily_expenses,
      // Debt figures are whole riyals (rounded so stored == displayed).
      debt_total: Math.round(v.debt_total),
      debt_1_45: Math.round(v.debt_1_45),
      debt_over_60: Math.round(v.debt_over_60),
      debt_over_90: Math.round(v.debt_over_90),
      debt_over_120: Math.round(v.debt_over_120),
      debt_over_150: Math.round(v.debt_over_150),
      notes: v.notes || '',
      field_owners: owners,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('daily_entries')
      .upsert(payload, { onConflict: 'rep_id,entry_date' });
    if (error) showMsg('خطأ: ' + error.message, 'error');
    else {
      const rep = reps.find(item => item.id === selectedRep);
      await logAuditEvent({
        eventType: existingEntry ? 'update' : 'create',
        pageKey: 'daily',
        entityType: 'daily_entries',
        entityId: existingEntry?.id || `${selectedRep}:${selectedDate}`,
        details: {
          name: rep?.name || '',
          date: selectedDate,
          sales: payload.daily_sales,
          collection: payload.daily_collection,
        },
      });
      showMsg('✓ تم حفظ البيانات'); fetchEntry();
    }
    setLoading(false);
  };

  const handleDateChange = (e) => {
    const d = new Date(e.target.value);
    if (!isWorkingDay(d)) { showMsg('هذا اليوم إجازة (جمعة)', 'error'); return; }
    setSelectedDate(e.target.value);
    setYear(d.getFullYear());
    setMonth(d.getMonth() + 1);
  };

  const years = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1];

  // Live net sales = gross sales − returns (negative when it's a returns-only day).
  const netSales = sumExpr(form.daily_sales) - sumExpr(form.daily_returns);

  const shelfPhotosMissing = Math.max(0,
    sumExpr(form.total_visits) - sumExpr(form.shelf_photos)
  );

  const sections = [
    { title: '💰 البيع والتحصيل', fields: [
      { key: 'daily_sales', label: 'مبيعات اليوم (البيع)', placeholder: 'قيمة البيع' },
      { key: 'daily_returns', label: 'مردود اليوم', placeholder: 'قيمة المردود' },
      { key: 'net_sales', label: 'صافي المبيعات (البيع − المردود)', computed: true },
      { key: 'daily_collection', label: 'تحصيل اليوم', placeholder: 'المبلغ' },
    ]},
    { title: '👥 العملاء الجدد', fields: [
      { key: 'new_customers', label: 'عدد العملاء الجدد', placeholder: 'عدد' },
      { key: 'new_customers_value', label: 'قيمة فواتير العملاء الجدد', placeholder: 'المبلغ' },
    ]},
    { title: '📦 المنتجات الجديدة', fields: [
      { key: 'new_products_skus', label: 'عدد الأصناف الموزعة', placeholder: 'عدد الأصناف' },
      { key: 'new_products_qty', label: 'عدد القطع الموزعة', placeholder: 'عدد القطع' },
      { key: 'new_products_availability', label: 'نسبة توفر المنتجات %', placeholder: '0 - 100' },
    ]},
    { title: '⏰ العمل والتنقل', fields: [
      { key: 'working_hours', label: 'ساعات العمل', placeholder: 'ساعات' },
      { key: 'km', label: 'الكيلومترات', placeholder: 'كم' },
      { key: 'daily_expenses', label: 'المصروفات اليومية', placeholder: 'المبلغ' },
    ]},
  ];

  return (
    <div ref={containerRef} onKeyDown={handleKeyDown}>
      <div className="page-header">
        <h1 className="page-title">📝 الإدخال اليومي</h1>
      </div>
      {msg && <div className={`alert alert-${msg.type}`}>{msg.text}</div>}
      <div className="card">
        <div className="card-title">اختيار المندوب والتاريخ</div>
        <div className="form-grid">
          <div className="form-group">
            <label className="form-label">المندوب</label>
            <select className="form-select" value={selectedRep} onChange={e => setSelectedRep(e.target.value)}>
              <option value="">-- اختر مندوب --</option>
              {reps.map(r => <option key={r.id} value={r.id}>{r.name} — {r.regions?.name || ''}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">التاريخ (بدون الجمعة)</label>
            <input className="form-input" type="date" value={selectedDate} onChange={handleDateChange} />
          </div>
          <div className="form-group">
            <label className="form-label">الشهر (تِبعًا للتاريخ)</label>
            <div className="month-selector" style={{ padding: '0.5rem 0.875rem' }}>
              {/* Read-only: the saved row's month/year come from the selected date. */}
              <select value={month} disabled title="يُحدَّد تلقائيًا من التاريخ">
                {MONTHS_AR.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </select>
              <select value={year} disabled title="يُحدَّد تلقائيًا من التاريخ">
                {years.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>
        </div>
        {existingEntry && (
          <div className="alert alert-success" style={{ marginTop: '0.5rem' }}>
            ✏️ يوجد إدخال مسبق لهذا اليوم.{' '}
            {isAdmin
              ? 'الخانات المقفولة 🔒 مخصّصة لمستخدم آخر أو أدخلها غيرك، ولا يمكن تعديلها — حتى للمدير.'
              : 'الخانات المقفولة 🔒 مخصّصة لغيرك أو أدخلها مستخدم آخر — إنت تدخل خاناتك فقط، وعند الحفظ بيتدمج إدخالك مع الباقي.'}
          </div>
        )}
      </div>

      {selectedRep && (
        <>
          {sections.map(section => (
            <div className="card" key={section.title}>
              <div className="card-title">{section.title}</div>
              <div className="form-grid">
                {section.fields.map(f => (
                  <div className="form-group" key={f.key}>
                    <label className="form-label">{f.label}</label>
                    {f.computed ? (
                      <div className="form-input" style={{
                        fontWeight: 800,
                        color: netSales > 0 ? '#10b981' : netSales < 0 ? '#ef4444' : 'var(--text-secondary)',
                      }}>
                        {netSales.toLocaleString('ar-EG')}{netSales < 0 ? ' (مرتجع صافي)' : ''}
                      </div>
                    ) : SUM_KEYS.includes(f.key) ? (
                      <>
                        <input className={errCls(f.key)} type="text" inputMode="decimal"
                          enterKeyHint="next" data-field={f.key} disabled={isLocked(f.key)}
                          value={form[f.key]}
                          onChange={e => changeField(f.key, e.target.value.replace(/[^0-9.+ ]/g, ''))}
                          placeholder={f.placeholder} />
                        {String(form[f.key] || '').includes('+') && (
                          <div style={{ fontSize: '0.72rem', color: '#10b981', marginTop: '0.25rem', fontWeight: 700 }}>
                            = {sumExpr(form[f.key]).toLocaleString('en')}
                          </div>
                        )}
                      </>
                    ) : (
                      <input className={errCls(f.key)} type="number" min="0" inputMode="decimal"
                        enterKeyHint="next" data-field={f.key} disabled={isLocked(f.key)}
                        value={form[f.key]}
                        onChange={e => changeField(f.key, e.target.value)}
                        placeholder={f.placeholder} />
                    )}
                    {f.hint && !isLocked(f.key) && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>{f.hint}</div>}
                    {lockNote(f.key)}
                    {errors[f.key] && <div className="form-error">{errors[f.key]}</div>}
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* الزيارات وصور الرف */}
          <div className="card">
            <div className="card-title">📍 الزيارات وصور الرف</div>
            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">زيارات إجمالي</label>
                <input className={errCls('total_visits')} type="text" inputMode="numeric"
                  enterKeyHint="next" data-field="total_visits" disabled={isLocked('total_visits')}
                  value={form.total_visits}
                  onChange={e => changeField('total_visits', e.target.value.replace(/[^0-9.+ ]/g, ''))}
                  placeholder="عدد" />
                {String(form.total_visits || '').includes('+') && <div style={{ fontSize: '0.72rem', color: '#10b981', marginTop: '0.25rem', fontWeight: 700 }}>= {sumExpr(form.total_visits).toLocaleString('en')}</div>}
                {lockNote('total_visits')}
                {errors.total_visits && <div className="form-error">{errors.total_visits}</div>}
              </div>
              <div className="form-group">
                <label className="form-label">صور الرف</label>
                <input className={errCls('shelf_photos')} type="text" inputMode="numeric"
                  enterKeyHint="next" data-field="shelf_photos" disabled={isLocked('shelf_photos')}
                  value={form.shelf_photos}
                  onChange={e => changeField('shelf_photos', e.target.value.replace(/[^0-9.+ ]/g, ''))}
                  placeholder="عدد الصور" />
                {String(form.shelf_photos || '').includes('+') && <div style={{ fontSize: '0.72rem', color: '#10b981', marginTop: '0.25rem', fontWeight: 700 }}>= {sumExpr(form.shelf_photos).toLocaleString('en')}</div>}
                {lockNote('shelf_photos')}
                {errors.shelf_photos && <div className="form-error">{errors.shelf_photos}</div>}
              </div>
              <div className="form-group">
                <label className="form-label">فاقد الصور</label>
                <div className="form-input" style={{
                  color: shelfPhotosMissing > 0 ? '#ef4444' : '#10b981',
                  fontWeight: 700
                }}>
                  {shelfPhotosMissing} {shelfPhotosMissing > 0 ? '❌' : '✅'}
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">زيارات ناجحة</label>
                <input className={errCls('successful_visits')} type="text" inputMode="numeric"
                  enterKeyHint="next" data-field="successful_visits" disabled={isLocked('successful_visits')}
                  value={form.successful_visits}
                  onChange={e => changeField('successful_visits', e.target.value.replace(/[^0-9.+ ]/g, ''))}
                  placeholder="عدد" />
                {String(form.successful_visits || '').includes('+') && <div style={{ fontSize: '0.72rem', color: '#10b981', marginTop: '0.25rem', fontWeight: 700 }}>= {sumExpr(form.successful_visits).toLocaleString('en')}</div>}
                {lockNote('successful_visits')}
                {errors.successful_visits && <div className="form-error">{errors.successful_visits}</div>}
              </div>
            </div>
          </div>

          {/* أعمار الديون (المتأخرات التفصيلية) */}
          <div className="card">
            <div className="card-title">🧾 أعمار الديون (المتأخرات التفصيلية)</div>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '-0.25rem', marginBottom: '0.75rem' }}>
              أدخل إجمالي دين المندوب وتوزيعه على الفترات. النسبة تحت كل خانة تُحسب من إجمالي الدين تلقائيًا.
            </p>
            <div className="form-grid">
              {DEBT_FIELDS.map(f => {
                const debtTotal = sumExpr(form.debt_total);
                const val = sumExpr(form[f.key]);
                const pctOfTotal = f.key !== 'debt_total' && debtTotal > 0 ? Math.round((val / debtTotal) * 100) : null;
                const isSum = String(form[f.key] || '').includes('+');
                return (
                  <div className="form-group" key={f.key}>
                    <label className="form-label">{f.label}</label>
                    <input className={errCls(f.key)} type="text" inputMode="numeric"
                      enterKeyHint="next" data-field={f.key} disabled={isLocked(f.key)}
                      value={form[f.key]}
                      onChange={e => changeField(f.key, e.target.value.replace(/[^0-9+ ]/g, ''))}
                      placeholder="المبلغ (أو 5000+3000 لدمج منطقتين)" />
                    {isSum && (
                      <div style={{ fontSize: '0.72rem', color: '#10b981', marginTop: '0.25rem', fontWeight: 700 }}>
                        = {val.toLocaleString('en')}
                      </div>
                    )}
                    {pctOfTotal !== null && (
                      <div style={{ fontSize: '0.72rem', color: '#3b82f6', marginTop: '0.25rem' }}>
                        {pctOfTotal}% من إجمالي الدين
                      </div>
                    )}
                    {lockNote(f.key)}
                    {errors[f.key] && <div className="form-error">{errors[f.key]}</div>}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card">
            <div className="card-title">📝 ملاحظات</div>
            <textarea className="form-input" rows={3} value={form.notes} disabled={isLocked('notes')}
              onChange={e => changeField('notes', e.target.value)}
              placeholder="ملاحظات اليوم..." style={{ resize: 'vertical' }} />
            {lockNote('notes')}
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', marginBottom: '2rem' }}>
            <button className="btn btn-success" onClick={handleSave} disabled={loading}
              style={{ fontSize: '1rem', padding: '0.75rem 2rem' }}>
              {loading ? '⏳ جاري الحفظ...' : '💾 حفظ بيانات اليوم'}
            </button>
            <button className="btn btn-ghost" onClick={() => setForm({ ...EMPTY_ENTRY })}>مسح</button>
          </div>
        </>
      )}
    </div>
  );
}
