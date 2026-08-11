import React, { useState, useEffect, useCallback, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { listVisitsInRange, summarizeVisits } from '../lib/visits';

const STATUS_LABELS = { planned: 'مخططة', completed: 'مكتملة', cancelled: 'ملغاة' };

const toDateStr = (d) => {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const defaultFrom = () => {
  const d = new Date();
  d.setDate(d.getDate() - 6);
  return toDateStr(d);
};

export default function KnowledgeCenter({ user }) {
  const [fromDate, setFromDate] = useState(defaultFrom());
  const [toDate, setToDate] = useState(toDateStr(new Date()));
  const [visits, setVisits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const { data, error: err } = await listVisitsInRange(user, fromDate, toDate);
    if (err) {
      setError(err.message || 'تعذّر تحميل بيانات الزيارات. تأكد من تنفيذ migration جداول الزيارات.');
      setVisits([]);
    } else {
      setVisits(data || []);
    }
    setLoading(false);
  }, [user, fromDate, toDate]);

  useEffect(() => { load(); }, [load]);

  const stats = useMemo(() => summarizeVisits(visits), [visits]);

  const bySupervisor = useMemo(() => {
    const map = {};
    visits.forEach(v => {
      const key = v.supervisor_name || '—';
      if (!map[key]) map[key] = { total: 0, completed: 0 };
      map[key].total += 1;
      if (v.visit_status === 'completed') map[key].completed += 1;
    });
    return Object.entries(map)
      .map(([name, s]) => ({ name, ...s, rate: s.total > 0 ? Math.round((s.completed / s.total) * 100) : 0 }))
      .sort((a, b) => b.total - a.total);
  }, [visits]);

  const exportExcel = () => {
    const rows = visits.map(v => ({
      'التاريخ': v.route_date,
      'المشرف': v.supervisor_name,
      'العميل': v.customer_name || '',
      'الحالة': STATUS_LABELS[v.visit_status] || v.visit_status,
      'وقت الدخول': v.check_in_time ? new Date(v.check_in_time).toLocaleString('ar-SA-u-ca-gregory') : '',
      'ملاحظات': v.visit_notes || '',
      'عدد الصور': Array.isArray(v.photos) ? v.photos.length : 0,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'الزيارات');
    XLSX.writeFile(wb, `تقرير-الزيارات-${fromDate}-${toDate}.xlsx`);
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">🧠 مركز المعرفة — الزيارات الميدانية</h1>
        <button className="btn btn-primary" onClick={exportExcel} disabled={visits.length === 0}>
          📊 تصدير Excel
        </button>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="card">
        <div className="form-grid">
          <div className="form-group">
            <label className="form-label">من تاريخ</label>
            <input type="date" className="form-input" value={fromDate} onChange={e => setFromDate(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">إلى تاريخ</label>
            <input type="date" className="form-input" value={toDate} onChange={e => setToDate(e.target.value)} />
          </div>
        </div>
      </div>

      {loading ? (
        <div className="loading"><div className="spinner" />جاري التحميل...</div>
      ) : !error && (
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
            <div className="stat-card" style={{ borderRight: '4px solid #ef4444' }}>
              <div className="stat-label">ملغاة</div>
              <div className="stat-value">{stats.cancelled}</div>
            </div>
            <div className="stat-card" style={{ borderRight: '4px solid #f59e0b' }}>
              <div className="stat-label">نسبة الإنجاز</div>
              <div className="stat-value">{stats.successRate}%</div>
            </div>
          </div>

          {user?.role === 'admin' && bySupervisor.length > 0 && (
            <div className="card">
              <div className="card-title">الأداء حسب المشرف</div>
              <div className="table-wrapper">
                <table className="responsive-cards">
                  <thead>
                    <tr><th>المشرف</th><th>إجمالي الزيارات</th><th>مكتملة</th><th>نسبة الإنجاز</th></tr>
                  </thead>
                  <tbody>
                    {bySupervisor.map(s => (
                      <tr key={s.name}>
                        <td data-label="المشرف">{s.name}</td>
                        <td data-label="إجمالي الزيارات">{s.total}</td>
                        <td data-label="مكتملة">{s.completed}</td>
                        <td data-label="نسبة الإنجاز">{s.rate}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-title">تفاصيل الزيارات</div>
            {visits.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-icon">📍</div>
                <div className="empty-state-text">لا توجد زيارات في هذه الفترة</div>
              </div>
            ) : (
              <div className="table-wrapper">
                <table className="responsive-cards">
                  <thead>
                    <tr>
                      <th>التاريخ</th>
                      {user?.role === 'admin' && <th>المشرف</th>}
                      <th>العميل</th>
                      <th>الحالة</th>
                      <th>وقت الدخول</th>
                      <th>صور</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visits.map(v => (
                      <tr key={v.id}>
                        <td data-label="التاريخ">{v.route_date}</td>
                        {user?.role === 'admin' && <td data-label="المشرف">{v.supervisor_name}</td>}
                        <td data-label="العميل">{v.customer_name || '—'}</td>
                        <td data-label="الحالة">
                          <span className="badge badge-info">{STATUS_LABELS[v.visit_status] || v.visit_status}</span>
                        </td>
                        <td data-label="وقت الدخول">
                          {v.check_in_time ? new Date(v.check_in_time).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' }) : '—'}
                        </td>
                        <td data-label="صور">{Array.isArray(v.photos) ? v.photos.length : 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
