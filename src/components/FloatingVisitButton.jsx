import React, { useState, useEffect, useRef } from 'react';
import {
  getOrCreateTodayRoute, searchCustomersForVisit, getCurrentPosition,
  startVisit, uploadVisitPhoto, attachPhotosToVisit, sendVisitReport,
} from '../lib/visits';

export default function FloatingVisitButton({ user, onVisitLogged }) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [results, setResults] = useState([]);
  const [customer, setCustomer] = useState(null);
  const [notes, setNotes] = useState('');
  const [files, setFiles] = useState([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const searchTimer = useRef(null);

  useEffect(() => {
    if (!open) return;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      const { data } = await searchCustomersForVisit(user, term);
      setResults(data || []);
    }, 300);
    return () => clearTimeout(searchTimer.current);
  }, [term, open, user]);

  const reset = () => {
    setTerm(''); setResults([]); setCustomer(null); setNotes(''); setFiles([]); setMsg(null);
  };

  const closeModal = () => { setOpen(false); reset(); };

  const handleSave = async () => {
    if (!customer) { setMsg({ text: 'اختر المحل/العميل أولاً', type: 'error' }); return; }
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
        routeId: route.id, customerId: customer.id, gps, notes,
      });
      if (visitError || !visit) throw new Error(visitError?.message || 'تعذّر تسجيل الزيارة');

      if (files.length > 0) {
        const uploaded = [];
        for (const file of files) {
          const { path, error } = await uploadVisitPhoto(user.id, file);
          if (!error && path) uploaded.push(path);
        }
        if (uploaded.length > 0) await attachPhotosToVisit(visit.id, uploaded);
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
            style={{ width: '100%', maxWidth: 480, maxHeight: '85vh', overflowY: 'auto', borderRadius: '16px 16px 0 0', margin: 0 }}
          >
            <div className="card-title">📍 إدخال زيارة جديدة</div>

            {msg && <div className={`alert alert-${msg.type}`}>{msg.text}</div>}

            {!customer ? (
              <div className="form-group">
                <label className="form-label">ابحث عن المحل/العميل</label>
                <input
                  className="form-input" value={term} autoFocus
                  onChange={e => setTerm(e.target.value)}
                  placeholder="اسم العميل..."
                />
                <div style={{ marginTop: '0.5rem', maxHeight: 220, overflowY: 'auto' }}>
                  {results.map(c => (
                    <button
                      key={c.id}
                      onClick={() => setCustomer(c)}
                      style={{
                        display: 'block', width: '100%', textAlign: 'right', padding: '0.6rem 0.75rem',
                        background: '#1e293b', border: 'none', borderBottom: '1px solid #334155',
                        color: '#e2e8f0', cursor: 'pointer',
                      }}
                    >
                      <div style={{ fontWeight: 700 }}>{c.customer_name}</div>
                      <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{c.regions?.name || '—'}</div>
                    </button>
                  ))}
                  {term && results.length === 0 && (
                    <div style={{ padding: '0.75rem', color: 'var(--text-secondary)' }}>لا نتائج</div>
                  )}
                </div>
              </div>
            ) : (
              <>
                <div style={{ padding: '0.75rem', background: '#1e293b', borderRadius: 8, marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{customer.customer_name}</div>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{customer.regions?.name || '—'}</div>
                  </div>
                  <button onClick={() => setCustomer(null)} style={{ background: 'none', border: 'none', color: '#3b82f6', cursor: 'pointer' }}>تغيير</button>
                </div>

                <div className="form-group">
                  <label className="form-label">صور (اختياري)</label>
                  <input
                    type="file" accept="image/*" capture="environment" multiple
                    className="form-input"
                    onChange={e => setFiles(Array.from(e.target.files || []))}
                  />
                  {files.length > 0 && <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '0.25rem' }}>{files.length} صورة مختارة</div>}
                </div>

                <div className="form-group">
                  <label className="form-label">ملاحظات</label>
                  <textarea
                    className="form-input" rows={3} value={notes}
                    onChange={e => setNotes(e.target.value)}
                    placeholder="طلبات، مشاكل، ملاحظات عن الزيارة..."
                  />
                </div>

                <button className="btn btn-primary" style={{ width: '100%' }} onClick={handleSave} disabled={saving}>
                  {saving ? '⏳ جاري الحفظ...' : '✓ تسجيل الدخول للزيارة'}
                </button>
              </>
            )}

            <button onClick={closeModal} style={{ width: '100%', marginTop: '0.75rem', background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: '0.5rem' }}>
              إلغاء
            </button>
          </div>
        </div>
      )}
    </>
  );
}
