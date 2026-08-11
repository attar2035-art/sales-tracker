import React, { useState, useEffect } from 'react';
import {
  getOrCreateTodayRoute, getCurrentPosition, startVisit,
  uploadVisitPhoto, attachPhotosToVisit, attachFileToVisit,
  listRepsForSupervisor, sendVisitReport,
} from '../lib/visits';

const EMPTY = {
  customerName: '', contactPerson: '', city: '', neighborhood: '', street: '',
  repName: '', notes: '',
};

export default function FloatingVisitButton({ user, onVisitLogged }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [reps, setReps] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [attachment, setAttachment] = useState(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  // Load the supervisor's own reps once the sheet is opened.
  useEffect(() => {
    if (!open || !user?.supervisor_id) return;
    listRepsForSupervisor(user.supervisor_id).then(({ data }) => setReps(data || []));
  }, [open, user]);

  const set = (key, value) => setForm(f => ({ ...f, [key]: value }));

  const reset = () => {
    setForm(EMPTY); setPhotos([]); setAttachment(null); setMsg(null);
  };
  const closeModal = () => { setOpen(false); reset(); };

  const handleSave = async () => {
    if (!form.customerName.trim()) { setMsg({ text: 'اكتب اسم العميل/المحل أولاً', type: 'error' }); return; }
    setSaving(true);
    setMsg(null);
    try {
      const { data: route, error: routeError } = await getOrCreateTodayRoute(user.supervisor_id);
      if (routeError || !route) throw new Error(routeError?.message || 'تعذّر إنشاء خط السير اليومي');

      let gps = null;
      try {
        gps = await getCurrentPosition();
      } catch {
        // GPS optional — نكمّل الزيارة بدونه لو المستخدم رفض الإذن أو الجهاز ما يدعمهوش
      }

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
      });
      if (visitError || !visit) throw new Error(visitError?.message || 'تعذّر تسجيل الزيارة');

      // Live camera photos.
      if (photos.length > 0) {
        const uploaded = [];
        for (const file of photos) {
          const { path, error } = await uploadVisitPhoto(user.id, file);
          if (!error && path) uploaded.push(path);
        }
        if (uploaded.length > 0) await attachPhotosToVisit(visit.id, uploaded);
      }

      // Optional single file attachment.
      if (attachment) {
        const { path, error } = await uploadVisitPhoto(user.id, attachment);
        if (!error && path) await attachFileToVisit(visit.id, path);
      }

      // Notify the managers (Permissions Center) about this visit. Fire-and-
      // forget: an email failure must never block or fail the saved visit.
      sendVisitReport({ type: 'single', visitId: visit.id }).catch(() => {});

      setMsg({ text: '✓ تم تسجيل الزيارة بنجاح', type: 'success' });
      if (onVisitLogged) onVisitLogged();
      setTimeout(closeModal, 800);
    } catch (e) {
      setMsg({ text: 'خطأ: ' + e.message, type: 'error' });
    }
    setSaving(false);
  };

  if (user?.role !== 'supervisor') return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="إدخال زيارة جديدة"
        style={{
          position: 'fixed', bottom: '5rem', left: '1.25rem', zIndex: 250,
          width: 56, height: 56, borderRadius: '50%', border: 'none',
          background: '#3b82f6', color: '#fff', fontSize: '1.5rem',
          boxShadow: '0 4px 14px rgba(59,130,246,0.5)', cursor: 'pointer',
        }}
      >
        📍
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
            <div className="card-title">📍 إدخال زيارة جديدة</div>

            {msg && <div className={`alert alert-${msg.type}`}>{msg.text}</div>}

            <div className="form-group">
              <label className="form-label">اسم العميل/المحل *</label>
              <input
                className="form-input" value={form.customerName} autoFocus
                onChange={e => set('customerName', e.target.value)}
                placeholder="اكتب اسم المحل أو العميل..."
              />
            </div>

            <div className="form-group">
              <label className="form-label">اسم المسؤول</label>
              <input
                className="form-input" value={form.contactPerson}
                onChange={e => set('contactPerson', e.target.value)}
                placeholder="اسم الشخص المسؤول..."
              />
            </div>

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">المدينة</label>
                <input
                  className="form-input" value={form.city}
                  onChange={e => set('city', e.target.value)}
                  placeholder="المدينة"
                />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">الحي</label>
                <input
                  className="form-input" value={form.neighborhood}
                  onChange={e => set('neighborhood', e.target.value)}
                  placeholder="الحي"
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">الشارع</label>
              <input
                className="form-input" value={form.street}
                onChange={e => set('street', e.target.value)}
                placeholder="اسم الشارع..."
              />
            </div>

            <div className="form-group">
              <label className="form-label">المندوب (في منطقتك)</label>
              <select
                className="form-input" value={form.repName}
                onChange={e => set('repName', e.target.value)}
              >
                <option value="">— اختر المندوب —</option>
                {reps.map(r => (
                  <option key={r.id} value={r.name}>{r.name}</option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">📷 صور (كاميرا مباشرة)</label>
              <input
                type="file" accept="image/*" capture="environment" multiple
                className="form-input"
                onChange={e => setPhotos(Array.from(e.target.files || []))}
              />
              {photos.length > 0 && <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '0.25rem' }}>{photos.length} صورة من الكاميرا</div>}
            </div>

            <div className="form-group">
              <label className="form-label">📎 ملف مرفق (اختياري)</label>
              <input
                type="file"
                className="form-input"
                onChange={e => setAttachment((e.target.files || [])[0] || null)}
              />
              {attachment && <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '0.25rem' }}>{attachment.name}</div>}
            </div>

            <div className="form-group">
              <label className="form-label">ملاحظات حرة</label>
              <textarea
                className="form-input" rows={3} value={form.notes}
                onChange={e => set('notes', e.target.value)}
                placeholder="أي بيانات أو ملاحظات إضافية عن الزيارة..."
              />
            </div>

            <button className="btn btn-primary" style={{ width: '100%' }} onClick={handleSave} disabled={saving}>
              {saving ? '⏳ جاري الحفظ...' : '✓ تسجيل الزيارة'}
            </button>

            <button onClick={closeModal} style={{ width: '100%', marginTop: '0.75rem', background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: '0.5rem' }}>
              إلغاء
            </button>
          </div>
        </div>
      )}
    </>
  );
}
