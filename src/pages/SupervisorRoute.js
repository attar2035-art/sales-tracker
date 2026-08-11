import React, { useState, useEffect, useCallback } from 'react';
import { getOrCreateTodayRoute, listRouteVisits, summarizeVisits } from '../lib/visits';

const STATUS_LABELS = { planned: 'مخططة', completed: 'مكتملة', cancelled: 'ملغاة' };
const STATUS_COLORS = { planned: '#f59e0b', completed: '#10b981', cancelled: '#ef4444' };

export default function SupervisorRoute({ user }) {
  const [route, setRoute] = useState(null);
  const [visits, setVisits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!user?.supervisor_id) { setLoading(false); return; }
    setLoading(true);
    setError('');
    const { data: r, error: routeError } = await getOrCreateTodayRoute(user.supervisor_id);
    if (routeError || !r) {
      setError(routeError?.message || 'تعذّر تحميل خط السير. تأكد من تنفيذ migration جداول الزيارات.');
      setLoading(false);
      return;
    }
    setRoute(r);
    const { data: v } = await listRouteVisits(r.id);
    setVisits(v || []);
    setLoading(false);
  }, [user?.supervisor_id]);

  useEffect(() => { load(); }, [load]);

  const stats = summarizeVisits(visits);

  if (loading) return <div className="loading"><div className="spinner" />جاري التحميل...</div>;

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">📍 زياراتي اليوم</h1>
        {route && <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{route.route_date}</span>}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {!error && (
        <>
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
          </div>

          {visits.length === 0 ? (
            <div className="card" style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
              لسه ما فيش زيارات اليوم. اضغط على زر 📍 لتسجيل أول زيارة.
            </div>
          ) : (
            <div className="card" style={{ padding: 0 }}>
              {visits.map(v => (
                <div key={v.id} style={{ padding: '1rem', borderBottom: '1px solid #334155' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ fontWeight: 700 }}>{v.customer_name || 'عميل'}</div>
                      <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                        {v.check_in_time ? new Date(v.check_in_time).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }) : '—'}
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
          )}
        </>
      )}
    </div>
  );
}
