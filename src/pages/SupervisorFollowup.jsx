import React, { useState, useEffect, useCallback } from 'react';
import {
  listSupervisors, listVisitsForSupervisor, listReportsForSupervisor,
  summarizeVisits,
} from '../lib/visits';

const STATUS_LABELS = { planned: 'مخططة', completed: 'مكتملة', cancelled: 'ملغاة' };
const STATUS_COLORS = { planned: '#f59e0b', completed: '#10b981', cancelled: '#ef4444' };

const ymd = (d) => d.toISOString().slice(0, 10);

const fmtDateTime = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('ar-EG', {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
};

// Manager view: pick a supervisor, then browse their visits and reports.
export default function SupervisorFollowup() {
  const today = new Date();
  const [supervisors, setSupervisors] = useState([]);
  const [supId, setSupId] = useState('');
  const [from, setFrom] = useState(ymd(new Date(today.getTime() - 29 * 86400000)));
  const [to, setTo] = useState(ymd(today));
  const [tab, setTab] = useState('visits');
  const [visits, setVisits] = useState([]);
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    listSupervisors().then(({ data }) => {
      const list = data || [];
      setSupervisors(list);
      if (list.length) setSupId(list[0].id);
    });
  }, []);

  const load = useCallback(async () => {
    if (!supId) { setVisits([]); setReports([]); return; }
    setLoading(true);
    setError('');
    const [v, r] = await Promise.all([
      listVisitsForSupervisor(supId, from, to),
      listReportsForSupervisor(supId, from, to),
    ]);
    if (v.error || r.error) {
      setError('تعذّر تحميل البيانات: ' + (v.error?.message || r.error?.message || ''));
    }
    setVisits(v.data || []);
    setReports(r.data || []);
    setLoading(false);
  }, [supId, from, to]);

  useEffect(() => { load(); }, [load]);

  const stats = summarizeVisits(visits);
  const supName = supervisors.find(s => s.id === supId)?.name || '';

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">👔 متابعة المشرفين</h1>
      </div>

      {/* Controls: supervisor + date range */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div className="form-grid">
          <div className="form-group">
            <label className="form-label">المشرف</label>
            <select className="form-select" value={supId} onChange={e => setSupId(e.target.value)}>
              {supervisors.length === 0 && <option value="">لا يوجد مشرفون</option>}
              {supervisors.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">من تاريخ</label>
            <input type="date" className="form-input" value={from} max={to} onChange={e => setFrom(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">إلى تاريخ</label>
            <input type="date" className="form-input" value={to} min={from} onChange={e => setTo(e.target.value)} />
          </div>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {/* KPI cards */}
      <div className="stats-grid" style={{ marginBottom: '1rem' }}>
        <div className="stat-card" style={{ borderRight: '4px solid #3b82f6' }}>
          <div className="stat-label">إجمالي الزيارات</div>
          <div className="stat-value">{stats.total}</div>
        </div>
        <div className="stat-card" style={{ borderRight: '4px solid #10b981' }}>
          <div className="stat-label">مكتملة</div>
          <div className="stat-value">{stats.completed}</div>
        </div>
        <div className="stat-card" style={{ borderRight: '4px solid #f59e0b' }}>
          <div className="stat-label">نسبة الإنجاز</div>
          <div className="stat-value">{stats.successRate}%</div>
        </div>
        <div className="stat-card" style={{ borderRight: '4px solid #8b5cf6' }}>
          <div className="stat-label">التقارير</div>
          <div className="stat-value">{reports.length}</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="tabs" style={{ marginBottom: '1rem' }}>
        <button className={`tab ${tab === 'visits' ? 'active' : ''}`} onClick={() => setTab('visits')}>
          📍 الزيارات ({visits.length})
        </button>
        <button className={`tab ${tab === 'reports' ? 'active' : ''}`} onClick={() => setTab('reports')}>
          📄 التقارير ({reports.length})
        </button>
      </div>

      {loading ? (
        <div className="loading"><div className="spinner" />جاري التحميل...</div>
      ) : tab === 'visits' ? (
        visits.length === 0 ? (
          <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
            لا توجد زيارات للمشرف {supName} في هذه الفترة.
          </div>
        ) : (
          <div className="card" style={{ padding: 0 }}>
            {visits.map(v => (
              <div key={v.id} style={{ padding: '1rem', borderBottom: '1px solid #334155' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{v.customer_name || 'عميل'}</div>
                    <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                      {v.route_date || '—'}
                      {' · '}
                      {v.check_in_time ? new Date(v.check_in_time).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) : '—'}
                      {v.gps_lat && v.gps_lng && (
                        <a
                          href={`https://www.google.com/maps?q=${v.gps_lat},${v.gps_lng}`}
                          target="_blank" rel="noreferrer"
                          style={{ color: '#3b82f6', marginInlineStart: '0.5rem' }}
                        >
                          📍 الموقع
                        </a>
                      )}
                    </div>
                    {(v.city || v.neighborhood) && (
                      <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginTop: '0.2rem' }}>
                        {[v.city, v.neighborhood].filter(Boolean).join(' — ')}
                      </div>
                    )}
                    {v.visit_notes && <div style={{ marginTop: '0.35rem', fontSize: '0.85rem', color: '#cbd5e1' }}>{v.visit_notes}</div>}
                  </div>
                  <span className="badge" style={{ background: STATUS_COLORS[v.visit_status], color: '#fff' }}>
                    {STATUS_LABELS[v.visit_status] || v.visit_status}
                  </span>
                </div>
                {Array.isArray(v.photos) && v.photos.length > 0 && (
                  <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: '#94a3b8' }}>
                    📷 {v.photos.length} صورة مرفقة
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      ) : (
        reports.length === 0 ? (
          <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
            لا توجد تقارير للمشرف {supName} في هذه الفترة.
          </div>
        ) : (
          <div className="card" style={{ padding: 0 }}>
            {reports.map(r => {
              const photoCount = Array.isArray(r.photos) ? r.photos.length : 0;
              const fileCount = Array.isArray(r.files) ? r.files.length : 0;
              return (
                <div key={r.id} style={{ padding: '1rem', borderBottom: '1px solid #334155' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ fontWeight: 700 }}>{r.report_type || 'تقرير'}</div>
                    <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>{fmtDateTime(r.created_at)}</span>
                  </div>
                  {r.content && (
                    <div style={{ marginTop: '0.4rem', fontSize: '0.88rem', color: '#cbd5e1', whiteSpace: 'pre-wrap' }}>{r.content}</div>
                  )}
                  {(photoCount > 0 || fileCount > 0) && (
                    <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: '#94a3b8' }}>
                      {photoCount > 0 && <span>📷 {photoCount} صورة</span>}
                      {photoCount > 0 && fileCount > 0 && <span> · </span>}
                      {fileCount > 0 && <span>📎 {fileCount} ملف</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )
      )}
    </div>
  );
}
