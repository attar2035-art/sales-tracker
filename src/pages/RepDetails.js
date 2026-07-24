import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { MONTHS_AR, formatCurrency, formatNumber, getRemainingWorkingDays, getTotalWorkingDaysInMonth, getMonthPhase } from '../lib/helpers';
import { buildEffectiveTargetsMap } from '../lib/targets';
import { getDailyRequirement } from '../lib/repMetrics';

const calcPercent = (achieved, target) => target > 0 ? Math.min(100, Math.round((achieved / target) * 100)) : 0;

function CircleMetric({ label, value, target, color = '#3b82f6', currency = false }) {
  const pct = calcPercent(value, target);
  const formatter = currency ? formatCurrency : formatNumber;
  return (
    <div className="circle-metric-card">
      <div className="circle-meter" style={{ '--pct': `${pct}%`, '--meter-color': color }}>
        <span>{target > 0 ? `${pct}%` : '-'}</span>
      </div>
      <div>
        <strong>{label}</strong>
        <span>{formatter(value)}</span>
        <small>{target > 0 ? `الهدف ${formatter(target)}` : 'بدون هدف'}</small>
      </div>
    </div>
  );
}

export default function RepDetails({ supervisorId }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [reps, setReps] = useState([]);
  const [selectedRep, setSelectedRep] = useState('');
  const [entries, setEntries] = useState([]);
  const [target, setTarget] = useState(null);
  const [loading, setLoading] = useState(false);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { fetchReps(); }, [supervisorId]);
  useEffect(() => {
    if (!selectedRep) return undefined;
    let ignore = false;
    fetchDetails(() => !ignore);
    return () => { ignore = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRep, year, month]);

  const fetchReps = async () => {
    let query = supabase.from('representatives')
      .select('*, supervisors(name), regions(name)').eq('is_active', true).order('name');
    if (supervisorId) query = query.eq('supervisor_id', supervisorId);
    const { data } = await query;
    if (data) setReps(data);
  };

  const fetchDetails = async (isCurrent = () => true) => {
    setLoading(true);
    const [e, t] = await Promise.all([
      supabase.from('daily_entries').select('*')
        .eq('rep_id', selectedRep).eq('year', year).eq('month', month).order('entry_date'),
      supabase.from('monthly_targets').select('*')
        .eq('rep_id', selectedRep).limit(10000),
    ]);
    if (!isCurrent()) return; // a newer selection superseded this response
    if (e.data) setEntries(e.data);
    const targetMap = buildEffectiveTargetsMap(t.data || [], year, month);
    setTarget(targetMap[selectedRep] || null);
    setLoading(false);
  };

  const years = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1];
  const rep = reps.find(r => r.id === selectedRep);
  const remainingDays = getRemainingWorkingDays(year, month);
  const totalDays = getTotalWorkingDaysInMonth(year, month);
  const monthPhase = getMonthPhase(year, month);
  const sum = (field) => entries.reduce((a, e) => a + (parseFloat(e[field]) || 0), 0);
  const totals = {
    sales: sum('daily_sales'), collection: sum('daily_collection'),
    new_customers: sum('new_customers'), new_customers_value: sum('new_customers_value'),
    total_visits: sum('total_visits'), successful_visits: sum('successful_visits'), shelf_photos: sum('shelf_photos'),
    new_products_skus: sum('new_products_skus'), new_products_qty: sum('new_products_qty'),
    working_hours: sum('working_hours'), km: sum('km'),
    expenses: sum('daily_expenses'), overdue_collected: sum('overdue_collected'),
  };

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">👤 تفاصيل المندوب</h1>
        <div className="month-selector">
          <select value={month} onChange={e => setMonth(+e.target.value)}>
            {MONTHS_AR.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <select value={year} onChange={e => setYear(+e.target.value)}>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>
      <div className="card">
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className="form-label">اختر المندوب</label>
          <select className="form-select" value={selectedRep} onChange={e => setSelectedRep(e.target.value)}>
            <option value="">-- اختر مندوب --</option>
            {reps.map(r => <option key={r.id} value={r.id}>{r.name} — {r.regions?.name || ''}</option>)}
          </select>
        </div>
      </div>
      {rep && (
        <div className="card">
          <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap' }}>
            <div><span className="form-label">المندوب: </span><strong>{rep.name}</strong></div>
            <div><span className="form-label">المشرف: </span>{rep.supervisors?.name || 'بدون مشرف'}</div>
            <div><span className="form-label">المنطقة: </span>{rep.regions?.name || '-'}</div>
            <div><span className="form-label">أيام العمل المتبقية: </span><strong style={{ color: '#f59e0b' }}>{remainingDays} من {totalDays}</strong></div>
          </div>
        </div>
      )}
      {selectedRep && target && (
        <section className="dashboard-visual-panel">
          <div className="section-head">
            <div>
              <div className="card-title">تقرير لحظي للمندوب — {MONTHS_AR[month - 1]} {year}</div>
              <div className="muted-text">بيع، تحصيل، زيارات، عملاء، منتجات، ومؤشرات تشغيلية للشهر الحالي</div>
            </div>
            <span className="badge badge-info">{entries.length} يوم إدخال</span>
          </div>
          <div className="circle-metric-grid">
            <CircleMetric label="المبيعات" value={totals.sales} target={target.target_sales || 0} color="#3b82f6" currency />
            <CircleMetric label="التحصيل" value={totals.collection} target={target.target_collection || 0} color="#10b981" currency />
            <CircleMetric label="الزيارات" value={totals.total_visits} target={target.target_total_visits || 0} color="#06b6d4" />
            <CircleMetric label="الزيارات الناجحة" value={totals.successful_visits} target={target.target_successful_visits || 0} color="#14b8a6" />
            <CircleMetric label="العملاء الجدد" value={totals.new_customers} target={target.target_new_customers || 0} color="#8b5cf6" />
            <CircleMetric label="قيمة العملاء الجدد" value={totals.new_customers_value} target={target.target_new_customers_value || 0} color="#a855f7" currency />
            <CircleMetric label="الأصناف الجديدة" value={totals.new_products_skus} target={target.target_new_products_skus || 0} color="#f59e0b" />
            <CircleMetric label="قطع المنتجات" value={totals.new_products_qty} target={target.target_new_products_qty || 0} color="#f97316" />
            <CircleMetric label="ساعات العمل" value={totals.working_hours} target={target.target_working_hours || 0} color="#64748b" />
            <CircleMetric label="الكيلومترات" value={totals.km} target={target.target_km || 0} color="#475569" />
            <CircleMetric label="تحصيل المتأخرات" value={totals.overdue_collected} target={target.overdue_total || 0} color="#ef4444" currency />
            <CircleMetric label="صور الرف" value={totals.shelf_photos} target={totals.total_visits || 0} color="#22c55e" />
          </div>
        </section>
      )}
      {selectedRep && target && (
        <div className="card">
          <div className="card-title">📊 ملخص الشهر</div>
          <div className="table-wrapper">
            <table>
              <thead><tr><th>البند</th><th>الهدف</th><th>المنجز</th><th>المتبقي</th><th>يومي مطلوب</th><th>%</th></tr></thead>
              <tbody>
                {[
                  { label: 'البيع', t: target.target_sales, a: totals.sales, currency: true },
                  { label: 'التحصيل', t: target.target_collection, a: totals.collection, currency: true },
                  { label: 'العملاء الجدد', t: target.target_new_customers, a: totals.new_customers },
                  { label: 'قيمة فواتير العملاء الجدد', t: target.target_new_customers_value, a: totals.new_customers_value, currency: true },
                  { label: 'الزيارات الإجمالي', t: target.target_total_visits, a: totals.total_visits },
                  { label: 'الزيارات الناجحة', t: target.target_successful_visits, a: totals.successful_visits },
                  { label: 'الأصناف الجديدة', t: target.target_new_products_skus, a: totals.new_products_skus },
                  { label: 'قطع المنتجات الجديدة', t: target.target_new_products_qty, a: totals.new_products_qty },
                  { label: 'ساعات العمل', t: target.target_working_hours, a: totals.working_hours },
                  { label: 'الكيلومترات', t: target.target_km, a: totals.km },
                ].map(row => {
                  const remaining = Math.max(0, row.t - row.a);
                  const daily = getDailyRequirement(remaining, remainingDays, monthPhase, totalDays);
                  const pct = row.t > 0 ? Math.round((row.a / row.t) * 100) : 0;
                  const fmt = row.currency ? formatCurrency : formatNumber;
                  return (
                    <tr key={row.label}>
                      <td>{row.label}</td>
                      <td>{fmt(row.t)}</td>
                      <td style={{ color: '#10b981', fontWeight: 700 }}>{fmt(row.a)}</td>
                      <td style={{ color: '#ef4444' }}>{fmt(remaining)}</td>
                      <td style={{ color: '#f59e0b' }}>{daily == null ? '-' : fmt(daily)}</td>
                      <td>
                        <span style={{ fontSize: '0.8rem', fontWeight: 700 }}>{pct}%</span>
                        <div className="progress-bar"><div className="progress-fill" style={{ width: `${Math.min(100, pct)}%`, background: pct >= 80 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444' }} /></div>
                      </td>
                    </tr>
                  );
                })}
                <tr style={{ background: '#0f172a' }}>
                  <td><strong>المتأخرات فوق 60 يوم</strong></td>
                  <td style={{ color: '#ef4444' }}>{formatCurrency(target.overdue_total)}</td>
                  <td style={{ color: '#10b981', fontWeight: 700 }}>{formatCurrency(totals.overdue_collected)}</td>
                  <td style={{ color: '#ef4444', fontWeight: 700 }}>{formatCurrency(Math.max(0, target.overdue_total - totals.overdue_collected))}</td>
                  <td>-</td><td>-</td>
                </tr>
                <tr>
                  <td>المصروفات التراكمية</td><td>-</td>
                  <td style={{ color: '#f59e0b', fontWeight: 700 }}>{formatCurrency(totals.expenses)}</td>
                  <td>-</td><td>-</td><td>-</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
      {selectedRep && (
        <div className="card">
          <div className="card-title">📅 السجل اليومي ({entries.length} يوم)</div>
          {loading ? <div className="loading"><div className="spinner" />جاري التحميل...</div> :
            entries.length === 0 ? <div className="empty-state"><div className="empty-state-icon">📅</div><div className="empty-state-text">لا توجد إدخالات يومية</div></div> : (
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr><th>التاريخ</th><th>المبيعات</th><th>التحصيل</th><th>عملاء جدد</th><th>زيارات</th><th>ناجحة</th><th>أصناف</th><th>قطع</th><th>توفر%</th><th>ساعات</th><th>كم</th><th>مصروفات</th><th>محصل متأخرات</th></tr>
                  </thead>
                  <tbody>
                    {entries.map(e => (
                      <tr key={e.id}>
                        <td>{new Date(e.entry_date).toLocaleDateString('ar-SA-u-ca-gregory')}</td>
                        <td>{formatCurrency(e.daily_sales)}</td>
                        <td>{formatCurrency(e.daily_collection)}</td>
                        <td>{e.new_customers}</td>
                        <td>{e.total_visits}</td>
                        <td>{e.successful_visits}</td>
                        <td>{e.new_products_skus}</td>
                        <td>{e.new_products_qty}</td>
                        <td>{e.new_products_availability}%</td>
                        <td>{e.working_hours}</td>
                        <td>{e.km}</td>
                        <td>{formatCurrency(e.daily_expenses)}</td>
                        <td>{formatCurrency(e.overdue_collected)}</td>
                      </tr>
                    ))}
                    <tr style={{ background: '#0f172a', fontWeight: 700 }}>
                      <td>الإجمالي</td>
                      <td style={{ color: '#10b981' }}>{formatCurrency(totals.sales)}</td>
                      <td style={{ color: '#10b981' }}>{formatCurrency(totals.collection)}</td>
                      <td>{totals.new_customers}</td>
                      <td>{totals.total_visits}</td>
                      <td>{totals.successful_visits}</td>
                      <td>{totals.new_products_skus}</td>
                      <td>{totals.new_products_qty}</td>
                      <td>-</td>
                      <td>{totals.working_hours}</td>
                      <td>{totals.km}</td>
                      <td style={{ color: '#f59e0b' }}>{formatCurrency(totals.expenses)}</td>
                      <td style={{ color: '#10b981' }}>{formatCurrency(totals.overdue_collected)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
        </div>
      )}
    </div>
  );
}
