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
  overdue_total_input: '', overdue_collected: '',
  notes: '',
};

// Entry fields that support per-field ownership/locking (form keys).
const LOCKABLE_KEYS = [
  'daily_sales', 'daily_returns', 'daily_collection', 'new_customers', 'new_customers_value',
  'total_visits', 'shelf_photos', 'successful_visits', 'new_products_skus', 'new_products_qty',
  'new_products_availability', 'working_hours', 'km', 'daily_expenses',
  'overdue_total_input', 'overdue_collected', 'notes',
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
  const [errors, setErrors] = useState({});
  const containerRef = useRef(null);

  // A field is locked when another user already filled it (owner + admin edit it).
  const isLocked = (key) => !isAdmin && !!fieldOwners[key] && fieldOwners[key] !== myId;
  const lockNote = (key) => (isLocked(key)
    ? <div style={{ fontSize: '0.72rem', color: '#f59e0b', marginTop: '0.25rem' }}>🔒 مقفولة — أدخلها مستخدم آخر لهذا اليوم</div>
    : null);

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
  useEffect(() => { fetchReps(); }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (selectedRep && selectedDate) fetchEntry(); }, [selectedRep, selectedDate]);

  const fetchReps = async () => {
    const { data } = await supabase.from('representatives')
      .select('*, supervisors(name), regions(name)')
      .eq('is_active', true).order('name');
    if (data) setReps(data);
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
        overdue_total_input: data.overdue_total_input || '',
        overdue_collected: data.overdue_collected || '',
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
    const totalVisits = parseInt(form.total_visits) || 0;
    const shelfPhotos = parseInt(form.shelf_photos) || 0;
    const successfulVisits = parseInt(form.successful_visits) || 0;
    const availability = parseFloat(form.new_products_availability) || 0;

    // Validation (was UI-only min=0 before): reject negatives, out-of-range and
    // illogical cross-field values before persisting. Errors are attached to the
    // specific field so they render directly under it.
    const numericKeys = [
      'daily_sales', 'daily_returns', 'daily_collection', 'new_customers', 'new_customers_value',
      'total_visits', 'shelf_photos', 'successful_visits', 'new_products_skus',
      'new_products_qty', 'new_products_availability', 'working_hours', 'km',
      'daily_expenses', 'overdue_total_input', 'overdue_collected',
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
      overdue_total_input: num(fresh?.overdue_total_input), overdue_collected: num(fresh?.overdue_collected),
      notes: fresh?.notes || '',
    };

    // Merge each field: locked (owned by others) keeps the DB value; the user's
    // own or empty fields are updated, claiming/releasing ownership as needed.
    const v = {};
    for (const key of LOCKABLE_KEYS) {
      const owner = owners[key];
      const canEdit = isAdmin || !owner || owner === myId;
      const raw = form[key];
      const provided = raw !== '' && raw !== null && raw !== undefined;
      if (!canEdit) { v[key] = dbForm[key]; continue; }
      if (provided) {
        v[key] = key === 'notes' ? raw : num(raw);
        if (!owner && myId) owners[key] = myId; // claim this field
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
      overdue_total_input: v.overdue_total_input,
      overdue_collected: v.overdue_collected,
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

  const overdueRemaining = Math.max(0,
    (parseFloat(form.overdue_total_input) || 0) - (parseFloat(form.overdue_collected) || 0)
  );

  const shelfPhotosMissing = Math.max(0,
    (parseInt(form.total_visits) || 0) - (parseInt(form.shelf_photos) || 0)
  );

  const sections = [
    { title: '💰 البيع والتحصيل', fields: [
      { key: 'daily_sales', label: 'مبيعات اليوم (البيع)', placeholder: 'قيمة البيع' },
      { key: 'daily_returns', label: 'مردود اليوم', placeholder: 'قيمة المردود', hint: 'يُخصم من البيع — صافي المبيعات = البيع − المردود' },
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
              ? 'كمدير تقدر تعدّل كل الخانات.'
              : 'الخانات المقفولة 🔒 أدخلها مستخدم آخر — إنت تكمّل الخانات المتاحة فقط، وعند الحفظ بيتدمج إدخالك مع الباقي.'}
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
                    <input className={errCls(f.key)} type="number" min="0" inputMode="decimal"
                      enterKeyHint="next" data-field={f.key} disabled={isLocked(f.key)}
                      value={form[f.key]}
                      onChange={e => changeField(f.key, e.target.value)}
                      placeholder={f.placeholder} />
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
                <input className={errCls('total_visits')} type="number" min="0" inputMode="numeric"
                  enterKeyHint="next" data-field="total_visits" disabled={isLocked('total_visits')}
                  value={form.total_visits}
                  onChange={e => changeField('total_visits', e.target.value)}
                  placeholder="عدد" />
                {lockNote('total_visits')}
                {errors.total_visits && <div className="form-error">{errors.total_visits}</div>}
              </div>
              <div className="form-group">
                <label className="form-label">صور الرف</label>
                <input className={errCls('shelf_photos')} type="number" min="0" inputMode="numeric"
                  enterKeyHint="next" data-field="shelf_photos" disabled={isLocked('shelf_photos')}
                  value={form.shelf_photos}
                  onChange={e => changeField('shelf_photos', e.target.value)}
                  placeholder="عدد الصور" />
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
                <input className={errCls('successful_visits')} type="number" min="0" inputMode="numeric"
                  enterKeyHint="next" data-field="successful_visits" disabled={isLocked('successful_visits')}
                  value={form.successful_visits}
                  onChange={e => changeField('successful_visits', e.target.value)}
                  placeholder="عدد" />
                {lockNote('successful_visits')}
                {errors.successful_visits && <div className="form-error">{errors.successful_visits}</div>}
              </div>
            </div>
          </div>

          {/* المتأخرات */}
          <div className="card">
            <div className="card-title">⚠️ المتأخرات</div>
            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">إجمالي المتأخرات فوق 60 يوم</label>
                <input className={errCls('overdue_total_input')} type="number" min="0" inputMode="decimal"
                  enterKeyHint="next" data-field="overdue_total_input" disabled={isLocked('overdue_total_input')}
                  value={form.overdue_total_input}
                  onChange={e => changeField('overdue_total_input', e.target.value)}
                  placeholder="المبلغ" />
                {lockNote('overdue_total_input')}
                {errors.overdue_total_input && <div className="form-error">{errors.overdue_total_input}</div>}
              </div>
              <div className="form-group">
                <label className="form-label">المحصل من المتأخرات اليوم</label>
                <input className={errCls('overdue_collected')} type="number" min="0" inputMode="decimal"
                  enterKeyHint="done" data-field="overdue_collected" disabled={isLocked('overdue_collected')}
                  value={form.overdue_collected}
                  onChange={e => changeField('overdue_collected', e.target.value)}
                  placeholder="المبلغ" />
                {lockNote('overdue_collected')}
                {errors.overdue_collected && <div className="form-error">{errors.overdue_collected}</div>}
              </div>
              <div className="form-group">
                <label className="form-label">المتبقي من المتأخرات</label>
                <div className="form-input" style={{ color: overdueRemaining > 0 ? '#ef4444' : '#10b981', fontWeight: 700 }}>
                  {overdueRemaining.toLocaleString('ar-SA')}
                </div>
              </div>
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
