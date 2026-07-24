import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { AUDIT_EVENT_LABELS, PAGE_LABELS } from '../lib/audit';

const ROLE_LABELS = {
  admin: 'مدير',
  supervisor: 'مشرف',
  data_entry: 'مدخل بيانات',
  rep: 'مندوب',
};

const ACTION_EVENTS = ['create', 'update', 'delete', 'status_change', 'handover', 'account_create'];

const formatDateTime = (value) => {
  if (!value) return '-';
  // Force the Gregorian calendar (ar-SA defaults to Hijri) for operator clarity.
  return new Intl.DateTimeFormat('ar-SA-u-ca-gregory', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
};

const EMPTY_TODAY_STATS = { logins: 0, pageViews: 0, actions: 0, users: 0 };

const computeTodayStats = (rows) => ({
  logins: rows.filter(log => log.event_type === 'login').length,
  pageViews: rows.filter(log => log.event_type === 'page_view').length,
  actions: rows.filter(log => ACTION_EVENTS.includes(log.event_type)).length,
  users: new Set(rows.map(log => log.user_id).filter(Boolean)).size,
});

const getDetailsText = (details) => {
  if (!details || typeof details !== 'object') return '-';
  const parts = [];
  if (details.name) parts.push(details.name);
  if (details.email) parts.push(details.email);
  if (details.table) parts.push(details.table);
  if (details.from || details.to) parts.push(`${details.from || '-'} ← ${details.to || '-'}`);
  return parts.length ? parts.join(' · ') : '-';
};

export default function ActivityLog() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [eventFilter, setEventFilter] = useState('');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [todayStats, setTodayStats] = useState(EMPTY_TODAY_STATS);

  useEffect(() => { fetchLogs(); }, []);

  const fetchLogs = async () => {
    setLoading(true);
    setError('');

    // Today's stats come from a dedicated today-scoped query, not the newest-500
    // list — otherwise a busy day (>500 rows) would undercount (BUG-018).
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const [listRes, todayRes] = await Promise.all([
      supabase.from('audit_logs').select('*')
        .order('created_at', { ascending: false }).limit(500),
      supabase.from('audit_logs').select('event_type,user_id')
        .gte('created_at', todayStart.toISOString()).limit(50000),
    ]);

    if (listRes.error) {
      setError(listRes.error.message);
      setLogs([]);
    } else {
      setLogs(listRes.data || []);
    }
    setTodayStats(todayRes.error ? EMPTY_TODAY_STATS : computeTodayStats(todayRes.data || []));
    setLoading(false);
  };

  const filteredLogs = useMemo(() => {
    const term = search.trim().toLowerCase();
    return logs.filter(log => {
      if (eventFilter && log.event_type !== eventFilter) return false;
      if (!term) return true;
      const haystack = [
        log.user_email,
        log.user_role,
        log.event_type,
        log.page_key,
        log.entity_type,
        getDetailsText(log.details),
      ].join(' ').toLowerCase();
      return haystack.includes(term);
    });
  }, [logs, eventFilter, search]);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">🧾 سجل النشاط</h1>
        <button className="btn btn-ghost" onClick={fetchLogs} disabled={loading}>تحديث</button>
      </div>

      {error && (
        <div className="alert alert-error">
          تعذر تحميل سجل النشاط: {error}
        </div>
      )}

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">دخول اليوم</div>
          <div className="stat-value">{todayStats.logins}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">مستخدمون نشطون اليوم</div>
          <div className="stat-value">{todayStats.users}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">فتح صفحات اليوم</div>
          <div className="stat-value">{todayStats.pageViews}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">إجراءات اليوم</div>
          <div className="stat-value">{todayStats.actions}</div>
        </div>
      </div>

      <div className="card">
        <div className="form-grid">
          <div className="form-group">
            <label className="form-label">بحث</label>
            <input
              className="form-input"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="إيميل، دور، صفحة، اسم..."
            />
          </div>
          <div className="form-group">
            <label className="form-label">نوع الحركة</label>
            <select className="form-select" value={eventFilter} onChange={e => setEventFilter(e.target.value)}>
              <option value="">كل الحركات</option>
              {Object.entries(AUDIT_EVENT_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="loading"><div className="spinner" />جاري تحميل السجل...</div>
        ) : filteredLogs.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">🧾</div>
            <div className="empty-state-text">لا توجد حركات مطابقة</div>
          </div>
        ) : (
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>الوقت</th>
                  <th>المستخدم</th>
                  <th>الدور</th>
                  <th>الحركة</th>
                  <th>الصفحة</th>
                  <th>الكيان</th>
                  <th>التفاصيل</th>
                </tr>
              </thead>
              <tbody>
                {filteredLogs.map(log => (
                  <tr key={log.id}>
                    <td>{formatDateTime(log.created_at)}</td>
                    <td>{log.user_email || '-'}</td>
                    <td><span className="badge badge-info">{ROLE_LABELS[log.user_role] || log.user_role || '-'}</span></td>
                    <td>{AUDIT_EVENT_LABELS[log.event_type] || log.event_type}</td>
                    <td>{PAGE_LABELS[log.page_key] || log.page_key || '-'}</td>
                    <td>{log.entity_type || '-'}</td>
                    <td>{getDetailsText(log.details)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
