import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { MONTHS_AR, isWorkingDay } from '../lib/helpers';
import { logAuditEvent } from '../lib/audit';

const EMPTY_ENTRY = {
  daily_sales: '', daily_collection: '',
  new_customers: '', new_customers_value: '',
  total_visits: '', shelf_photos: '', successful_visits: '',
  new_products_skus: '', new_products_qty: '',
  new_products_availability: '',
  working_hours: '', km: '',
  daily_expenses: '',
  overdue_total_input: '', overdue_collected: '',
  notes: '',
};

export default function DailyEntry() {
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
      setForm({
        daily_sales: data.daily_sales || '',
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
    // illogical cross-field values before persisting.
    const numericKeys = [
      'daily_sales', 'daily_collection', 'new_customers', 'new_customers_value',
      'total_visits', 'shelf_photos', 'successful_visits', 'new_products_skus',
      'new_products_qty', 'new_products_availability', 'working_hours', 'km',
      'daily_expenses', 'overdue_total_input', 'overdue_collected',
    ];
    if (numericKeys.some(k => (parseFloat(form[k]) || 0) < 0)) {
      showMsg('لا يمكن إدخال قيم سالبة', 'error'); return;
    }
    if (availability > 100) { showMsg('نسبة توفر المنتجات يجب أن تكون بين 0 و 100', 'error'); return; }
    if (successfulVisits > totalVisits) { showMsg('الزيارات الناجحة لا يمكن أن تتجاوز إجمالي الزيارات', 'error'); return; }
    if (shelfPhotos > totalVisits) { showMsg('عدد صور الرف لا يمكن أن يتجاوز عدد الزيارات', 'error'); return; }

    if (existingEntry && !window.confirm('يوجد إدخال مسبق لهذا اليوم. سيتم استبداله بالقيم الجديدة. هل تريد المتابعة؟')) {
      return;
    }

    setLoading(true);
    // Derive year/month from the entry date so dashboards that filter by
    // year/month always find the row (do not rely on a DB-side derivation).
    const [entryYear, entryMonth] = selectedDate.split('-').map(Number);
    const payload = {
      rep_id: selectedRep,
      entry_date: selectedDate,
      year: entryYear,
      month: entryMonth,
      daily_sales: parseFloat(form.daily_sales) || 0,
      daily_collection: parseFloat(form.daily_collection) || 0,
      new_customers: parseInt(form.new_customers) || 0,
      new_customers_value: parseFloat(form.new_customers_value) || 0,
      total_visits: totalVisits,
      shelf_photos: shelfPhotos,
      successful_visits: successfulVisits,
      new_products_skus: parseInt(form.new_products_skus) || 0,
      new_products_qty: parseInt(form.new_products_qty) || 0,
      new_products_availability: availability,
      working_hours: parseFloat(form.working_hours) || 0,
      km: parseFloat(form.km) || 0,
      daily_expenses: parseFloat(form.daily_expenses) || 0,
      overdue_total_input: parseFloat(form.overdue_total_input) || 0,
      overdue_collected: parseFloat(form.overdue_collected) || 0,
      notes: form.notes || '',
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
      { key: 'daily_sales', label: 'مبيعات اليوم', placeholder: 'المبلغ' },
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
    <div>
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
            ✏️ يوجد إدخال مسبق لهذا اليوم — سيتم التحديث عند الحفظ
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
                    <input className="form-input" type="number" min="0" inputMode="decimal"
                      value={form[f.key]}
                      onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                      placeholder={f.placeholder} />
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
                <input className="form-input" type="number" min="0"
                  value={form.total_visits}
                  onChange={e => setForm(prev => ({ ...prev, total_visits: e.target.value }))}
                  placeholder="عدد" />
              </div>
              <div className="form-group">
                <label className="form-label">صور الرف</label>
                <input className="form-input" type="number" min="0"
                  value={form.shelf_photos}
                  onChange={e => setForm(prev => ({ ...prev, shelf_photos: e.target.value }))}
                  placeholder="عدد الصور" />
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
                <input className="form-input" type="number" min="0"
                  value={form.successful_visits}
                  onChange={e => setForm(prev => ({ ...prev, successful_visits: e.target.value }))}
                  placeholder="عدد" />
              </div>
            </div>
          </div>

          {/* المتأخرات */}
          <div className="card">
            <div className="card-title">⚠️ المتأخرات</div>
            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">إجمالي المتأخرات فوق 60 يوم</label>
                <input className="form-input" type="number" min="0"
                  value={form.overdue_total_input}
                  onChange={e => setForm(prev => ({ ...prev, overdue_total_input: e.target.value }))}
                  placeholder="المبلغ" />
              </div>
              <div className="form-group">
                <label className="form-label">المحصل من المتأخرات اليوم</label>
                <input className="form-input" type="number" min="0"
                  value={form.overdue_collected}
                  onChange={e => setForm(prev => ({ ...prev, overdue_collected: e.target.value }))}
                  placeholder="المبلغ" />
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
            <textarea className="form-input" rows={3} value={form.notes}
              onChange={e => setForm(prev => ({ ...prev, notes: e.target.value }))}
              placeholder="ملاحظات اليوم..." style={{ resize: 'vertical' }} />
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
