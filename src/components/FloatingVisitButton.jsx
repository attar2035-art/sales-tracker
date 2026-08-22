import React, { useState, useEffect } from 'react';
import {
  getOrCreateTodayRoute, getCurrentPosition, startVisit,
  uploadVisitPhoto, attachPhotosToVisit, attachFileToVisit,
  listRepsForSupervisor, sendVisitReport,
  createReport, attachReportMedia, REPORT_TYPES,
  listRegionsForSupervisor, listRoutePlanCustomers, WEEKDAYS,
  CUSTOMER_RATINGS,
} from '../lib/visits';

// Today's Arabic weekday, to pre-select the route-plan day.
const TODAY_WEEKDAY = WEEKDAYS[(new Date().getDay() + 1) % 7];

const EMPTY_VISIT = {
  customerName: '', contactPerson: '', city: '', neighborhood: '', street: '',
  repName: '', notes: '', customerRating: '',
};

export default function FloatingVisitButton({ user, onVisitLogged }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState('choose'); // 'choose' | 'visit' | 'report'
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  // Visit form
  const [form, setForm] = useState(EMPTY_VISIT);
  const [reps, setReps] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [attachment, setAttachment] = useState(null);

  // Route plan (region + weekday -> planned customers)
  const [regions, setRegions] = useState([]);
  const [regionId, setRegionId] = useState('');
  const [day, setDay] = useState(TODAY_WEEKDAY);
  const [routeCustomers, setRouteCustomers] = useState([]);
  const [routeLoading, setRouteLoading] = useState(false);

  // Report form
  const [reportType, setReportType] = useState(REPORT_TYPES[0]);
  const [reportContent, setReportContent] = useState('');
  const [reportPhotos, setReportPhotos] = useState([]);
  const [reportFiles, setReportFiles] = useState([]);

  useEffect(() => {
    if (!open || mode !== 'visit' || !user?.supervisor_id) return;
    listRepsForSupervisor(user.supervisor_id).then(({ data }) => setReps(data || []));
    listRegionsForSupervisor(user).then(({ data }) => {
      const list = data || [];
      setRegions(list);
      if (list.length === 1) setRegionId(list[0].id); // auto-pick the only region
    });
  }, [open, mode, user]);

  // Load the planned customers whenever the region or day changes.
  useEffect(() => {
    if (!open || mode !== 'visit' || !regionId || !day) { setRouteCustomers([]); return; }
    setRouteLoading(true);
    listRoutePlanCustomers(regionId, day).then(({ data }) => {
      setRouteCustomers(data || []);
      setRouteLoading(false);
    });
  }, [open, mode, regionId, day]);

  const pickRouteCustomer = (c) => {
    setForm(f => ({
      ...f,
      customerName: c.customer_name || '',
      neighborhood: c.neighborhood || '',
      city: c.city || '',
    }));
  };

  const set = (key, value) => setForm(f => ({ ...f, [key]: value }));

  const reset = () => {
    setMode('choose'); setMsg(null); setSaving(false);
    setForm(EMPTY_VISIT); setPhotos([]); setAttachment(null);
    setRegionId(''); setDay(TODAY_WEEKDAY); setRouteCustomers([]);
    setReportType(REPORT_TYPES[0]); setReportContent(''); setReportPhotos([]); setReportFiles([]);
  };
  const closeModal = () => { setOpen(false); reset(); };

  // Upload a list of files to storage, returning the stored paths.
  const uploadAll = async (files) => {
    const paths = [];
    for (const file of files) {
      const { path, error } = await uploadVisitPhoto(user.id, file);
      if (!error && path) paths.push(path);
    }
    return paths;
  };

  const handleSaveVisit = async () => {
    if (!form.customerName.trim()) { setMsg({ text: 'اكتب اسم العميل/المحل أولاً', type: 'error' }); return; }
    setSaving(true);
    setMsg(null);
    try {
      const { data: route, error: routeError } = await getOrCreateTodayRoute(user.supervisor_id);
      if (routeError || !route) throw new Error(routeError?.message || 'تعذّر إنشاء خط السير اليومي');

      let gps = null;
      try { gps = await getCurrentPosition(); } catch { /* GPS optional */ }

      const { data: visit, error: visitError } = await startVisit({
        routeId: route.id,
        customerName: form.customerName.trim(),
        contactPerson: form.contactPerson.trim(),
        city: form.city.trim(),
        neighborhood: form.neighborhood.trim(),
        street: form.street.trim(),
        repName: form.repName.trim(),
        gps,
        notes: form.notes.trim(),
        customerRating: form.customerRating,
      });
      if (visitError || !visit) throw new Error(visitError?.message || 'تعذّر تسجيل الزيارة');

      if (photos.length > 0) {
        const uploaded = await uploadAll(photos);
        if (uploaded.length > 0) await attachPhotosToVisit(visit.id, uploaded);
      }
      if (attachment) {
        const [path] = await uploadAll([attachment]);
        if (path) await attachFileToVisit(visit.id, path);
      }

      sendVisitReport({ type: 'single', visitId: visit.id }).catch(() => {});

      setMsg({ text: '✓ تم تسجيل الزيارة بنجاح', type: 'success' });
      if (onVisitLogged) onVisitLogged();
      setTimeout(closeModal, 800);
    } catch (e) {
      setMsg({ text: 'خطأ: ' + e.message, type: 'error' });
    }
    setSaving(false);
  };

  const handleSaveReport = async () => {
    if (!reportContent.trim() && reportPhotos.length === 0 && reportFiles.length === 0) {
      setMsg({ text: 'اكتب محتوى التقرير أو أرفق صور/ملفات', type: 'error' }); return;
    }
    setSaving(true);
    setMsg(null);
    try {
      const { data: report, error: reportError } = await createReport({
        supervisorId: user.supervisor_id,
        reportType,
        content: reportContent.trim(),
      });
      if (reportError || !report) throw new Error(reportError?.message || 'تعذّر إنشاء التقرير');

      const photoPaths = reportPhotos.length ? await uploadAll(reportPhotos) : [];
      const filePaths = reportFiles.length ? await uploadAll(reportFiles) : [];
      if (photoPaths.length || filePaths.length) {
        await attachReportMedia(report.id, { photos: photoPaths, files: filePaths });
      }

      sendVisitReport({ type: 'report', reportId: report.id }).catch(() => {});

      setMsg({ text: '✓ تم إرسال التقرير بنجاح', type: 'success' });
      if (onVisitLogged) onVisitLogged();
      setTimeout(closeModal, 800);
    } catch (e) {
      setMsg({ text: 'خطأ: ' + e.message, type: 'error' });
    }
    setSaving(false);
  };

  if (user?.role !== 'supervisor') return null;

  const sheetTitle = mode === 'visit' ? '📍 إدخال زيارة جديدة'
    : mode === 'report' ? '📋 إرسال تقرير'
    : '➕ إضافة جديدة';

  return (
    <>
      <button
        onClick={() => { setOpen(true); setMode('choose'); }}
        aria-label="إضافة جديدة"
        style={{
          position: 'fixed', bottom: '5rem', left: '1.25rem', zIndex: 250,
          width: 56, height: 56, borderRadius: '50%', border: 'none',
          background: '#3b82f6', color: '#fff', fontSize: '1.5rem',
          boxShadow: '0 4px 14px rgba(59,130,246,0.5)', cursor: 'pointer',
        }}
      >
        ➕
      </button>

      {open && (
        <div
          onClick={closeModal}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 400, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="card"
            style={{ width: '100%', maxWidth: 480, maxHeight: '90vh', overflowY: 'auto', borderRadius: '16px 16px 0 0', margin: 0 }}
          >
            <div className="card-title">{sheetTitle}</div>

            {msg && <div className={`alert alert-${msg.type}`}>{msg.text}</div>}

            {/* Step 1: choose between a visit and a report */}
            {mode === 'choose' && (
              <div style={{ display: 'flex', gap: '0.75rem', padding: '0.5rem 0 1rem' }}>
                <button
                  onClick={() => { setMode('visit'); setMsg(null); }}
                  style={{ flex: 1, padding: '1.5rem 0.5rem', borderRadius: 12, border: '1px solid #334155', background: '#1e293b', color: '#e2e8f0', cursor: 'pointer', fontSize: '1rem' }}
                >
                  <div style={{ fontSize: '2rem' }}>📍</div>
                  <div style={{ fontWeight: 700, marginTop: '0.5rem' }}>زيارة</div>
                  <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>زيارة ميدانية لعميل</div>
                </button>
                <button
                  onClick={() => { setMode('report'); setMsg(null); }}
                  style={{ flex: 1, padding: '1.5rem 0.5rem', borderRadius: 12, border: '1px solid #334155', background: '#1e293b', color: '#e2e8f0', cursor: 'pointer', fontSize: '1rem' }}
                >
                  <div style={{ fontSize: '2rem' }}>📋</div>
                  <div style={{ fontWeight: 700, marginTop: '0.5rem' }}>تقرير</div>
                  <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>بيان حر + صور وملفات</div>
                </button>
              </div>
            )}

            {/* Step 2a: the visit form */}
            {mode === 'visit' && (
              <>
                {/* Route plan: pick region + day to list the planned customers */}
                <div style={{ padding: '0.75rem', background: '#0f172a', borderRadius: 10, marginBottom: '1rem' }}>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <div className="form-group" style={{ flex: 1, marginBottom: '0.5rem' }}>
                      <label className="form-label">المنطقة</label>
                      <select className="form-input" value={regionId} onChange={e => setRegionId(e.target.value)}>
                        <option value="">— اختر المنطقة —</option>
                        {regions.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </select>
                    </div>
                    <div className="form-group" style={{ flex: 1, marginBottom: '0.5rem' }}>
                      <label className="form-label">اليوم</label>
                      <select className="form-input" value={day} onChange={e => setDay(e.target.value)}>
                        {WEEKDAYS.map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                    </div>
                  </div>
                  {regionId && (
                    routeLoading ? (
                      <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>⏳ جاري تحميل عملاء خط السير...</div>
                    ) : routeCustomers.length > 0 ? (
                      <div style={{ maxHeight: 180, overflowY: 'auto', marginTop: '0.25rem' }}>
                        <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: '0.35rem' }}>عملاء خط السير ({routeCustomers.length}) — اضغط لاختيار العميل:</div>
                        {routeCustomers.map(c => (
                          <button
                            key={c.id}
                            onClick={() => pickRouteCustomer(c)}
                            style={{
                              display: 'block', width: '100%', textAlign: 'right', padding: '0.5rem 0.6rem',
                              background: form.customerName === c.customer_name ? '#1d4ed8' : '#1e293b',
                              border: 'none', borderBottom: '1px solid #334155', color: '#e2e8f0', cursor: 'pointer',
                            }}
                          >
                            <div style={{ fontWeight: 700 }}>{c.customer_name}</div>
                            <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>{[c.city, c.neighborhood].filter(Boolean).join(' — ') || '—'}</div>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>لا يوجد عملاء لهذا اليوم في هذه المنطقة — اكتب العميل يدويًا بالأسفل (جديد أو خارج خط السير).</div>
                    )
                  )}
                </div>

                <div className="form-group">
                  <label className="form-label">اسم العميل/المحل *</label>
                  <input className="form-input" value={form.customerName} autoFocus
                    onChange={e => set('customerName', e.target.value)} placeholder="اكتب اسم المحل أو العميل..." />
                </div>
                <div className="form-group">
                  <label className="form-label">اسم المسؤول</label>
                  <input className="form-input" value={form.contactPerson}
                    onChange={e => set('contactPerson', e.target.value)} placeholder="اسم الشخص المسؤول..." />
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label">المدينة</label>
                    <input className="form-input" value={form.city}
                      onChange={e => set('city', e.target.value)} placeholder="المدينة" />
                  </div>
                  <div className="form-group" style={{ flex: 1 }}>
                    <label className="form-label">الحي</label>
                    <input className="form-input" value={form.neighborhood}
                      onChange={e => set('neighborhood', e.target.value)} placeholder="الحي" />
                  </div>
                </div>
                <div className="form-group">
                  <label className="form-label">الشارع</label>
                  <input className="form-input" value={form.street}
                    onChange={e => set('street', e.target.value)} placeholder="اسم الشارع..." />
                </div>
                <div className="form-group">
                  <label className="form-label">المندوب (في منطقتك)</label>
                  <select className="form-input" value={form.repName} onChange={e => set('repName', e.target.value)}>
                    <option value="">— اختر المندوب —</option>
                    {reps.map(r => <option key={r.id} value={r.name}>{r.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">فئة العميل (تقييم)</label>
                  <select className="form-input" value={form.customerRating} onChange={e => set('customerRating', e.target.value)}>
                    <option value="">— اختر فئة العميل —</option>
                    {CUSTOMER_RATINGS.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">📷 صور (كاميرا مباشرة)</label>
                  <input type="file" accept="image/*" capture="environment" multiple className="form-input"
                    onChange={e => setPhotos(Array.from(e.target.files || []))} />
                  {photos.length > 0 && <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '0.25rem' }}>{photos.length} صورة من الكاميرا</div>}
                </div>
                <div className="form-group">
                  <label className="form-label">📎 ملف مرفق (اختياري)</label>
                  <input type="file" className="form-input"
                    onChange={e => setAttachment((e.target.files || [])[0] || null)} />
                  {attachment && <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '0.25rem' }}>{attachment.name}</div>}
                </div>
                <div className="form-group">
                  <label className="form-label">ملاحظات حرة</label>
                  <textarea className="form-input" rows={3} value={form.notes}
                    onChange={e => set('notes', e.target.value)} placeholder="أي بيانات أو ملاحظات إضافية عن الزيارة..." />
                </div>
                <button className="btn btn-primary" style={{ width: '100%' }} onClick={handleSaveVisit} disabled={saving}>
                  {saving ? '⏳ جاري الحفظ...' : '✓ تسجيل الزيارة'}
                </button>
              </>
            )}

            {/* Step 2b: the free-form report */}
            {mode === 'report' && (
              <>
                <div className="form-group">
                  <label className="form-label">نوع التقرير</label>
                  <select className="form-input" value={reportType} onChange={e => setReportType(e.target.value)}>
                    {REPORT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">محتوى التقرير</label>
                  <textarea className="form-input" rows={6} value={reportContent} autoFocus
                    onChange={e => setReportContent(e.target.value)}
                    placeholder="اكتب هنا كل ما تريد إبلاغه للإدارة..." />
                </div>
                <div className="form-group">
                  <label className="form-label">📷 صور (اختياري)</label>
                  <input type="file" accept="image/*" multiple className="form-input"
                    onChange={e => setReportPhotos(Array.from(e.target.files || []))} />
                  {reportPhotos.length > 0 && <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '0.25rem' }}>{reportPhotos.length} صورة</div>}
                </div>
                <div className="form-group">
                  <label className="form-label">📎 ملفات جرد/مرفقات (اختياري)</label>
                  <input type="file" multiple className="form-input"
                    onChange={e => setReportFiles(Array.from(e.target.files || []))} />
                  {reportFiles.length > 0 && <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '0.25rem' }}>{reportFiles.length} ملف</div>}
                </div>
                <button className="btn btn-primary" style={{ width: '100%' }} onClick={handleSaveReport} disabled={saving}>
                  {saving ? '⏳ جاري الإرسال...' : '📤 إرسال التقرير'}
                </button>
              </>
            )}

            <button
              onClick={mode === 'choose' ? closeModal : () => { setMode('choose'); setMsg(null); }}
              style={{ width: '100%', marginTop: '0.75rem', background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: '0.5rem' }}
            >
              {mode === 'choose' ? 'إلغاء' : '→ رجوع'}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
