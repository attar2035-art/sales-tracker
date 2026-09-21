import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { formatNumber } from '../lib/helpers';

const pad2 = (n) => String(n).padStart(2, '0');
const dateStr = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);
const isImportant = (r) => r === 'A' || r === 'B';

// متابعة خطة خط السير — ملخص التزام كل مندوب/مشرف بخطته خلال فترة (للمديرين والمشرفين).
export default function RoutePlanFollowup() {
  const today = new Date();
  const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 6);
  const [from, setFrom] = useState(dateStr(weekAgo));
  const [to, setTo] = useState(dateStr(today));
  const [rows, setRows] = useState([]);
  const [reps, setReps] = useState([]);
  const [sups, setSups] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.from('representatives').select('id, name, supervisor_id, supervisors(name)').then(({ data }) => setReps(data || []));
    supabase.from('supervisors').select('id, name').then(({ data }) => setSups(data || []));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('daily_route_plan')
      .select('rep_id, supervisor_id, visited, off_plan, customer_rating, plan_date')
      .gte('plan_date', from).lte('plan_date', to).limit(50000);
    setRows(data || []);
    setLoading(false);
  }, [from, to]);
  useEffect(() => { load(); }, [load]);

  const repById = useMemo(() => new Map(reps.map(r => [r.id, r])), [reps]);
  const supById = useMemo(() => new Map(sups.map(s => [s.id, s])), [sups]);

  const summary = useMemo(() => {
    const map = new Map();
    for (const r of rows) {
      const isRep = !!r.rep_id;
      const key = isRep ? `rep:${r.rep_id}` : `sup:${r.supervisor_id}`;
      const g = map.get(key) || {
        key, type: isRep ? 'مندوب' : 'مشرف',
        name: isRep ? (repById.get(r.rep_id)?.name || 'مندوب') : (supById.get(r.supervisor_id)?.name || 'مشرف'),
        team: isRep ? (repById.get(r.rep_id)?.supervisors?.name || 'بدون مشرف') : '—',
        planned: 0, visited: 0, missed: 0, offPlan: 0, impMissed: 0,
      };
      if (r.off_plan) { g.offPlan += 1; }
      else {
        g.planned += 1;
        if (r.visited) g.visited += 1;
        else { g.missed += 1; if (isImportant(r.customer_rating)) g.impMissed += 1; }
      }
      map.set(key, g);
    }
    const list = [...map.values()].map(g => ({
      ...g,
      commit: pct(g.visited, g.planned),
      deviation: g.planned > 0 ? Math.round(((g.missed + g.offPlan) / g.planned) * 100) : 0,
    })).sort((a, b) => a.commit - b.commit); // worst adherence first
    const totals = list.reduce((a, g) => {
      a.planned += g.planned; a.visited += g.visited; a.missed += g.missed; a.offPlan += g.offPlan; a.impMissed += g.impMissed; return a;
    }, { planned: 0, visited: 0, missed: 0, offPlan: 0, impMissed: 0 });
    totals.commit = pct(totals.visited, totals.planned);
    return { list, totals };
  }, [rows, repById, supById]);

  const commitColor = (c) => (c >= 80 ? '#166534' : c >= 50 ? '#b45309' : '#b91c1c');

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
        <h1 className="page-title">📋 متابعة خطة خط السير</h1>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <label className="form-label" style={{ margin: 0 }}>من</label>
          <input className="form-input" type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} style={{ width: 'auto' }} />
          <label className="form-label" style={{ margin: 0 }}>إلى</label>
          <input className="form-input" type="date" value={to} min={from} onChange={e => setTo(e.target.value)} style={{ width: 'auto' }} />
        </div>
      </div>

      {loading ? (
        <div className="loading"><div className="spinner" />جاري التحميل...</div>
      ) : summary.list.length === 0 ? (
        <div className="card"><div className="empty-state">
          <div className="empty-state-icon">📋</div>
          <div className="empty-state-text">لا توجد خطط/زيارات مسجّلة في هذه الفترة.</div>
        </div></div>
      ) : (
        <>
          <div className="card">
            <div className="card-title">
              إجمالي الالتزام: {summary.totals.commit}% — المخطط {formatNumber(summary.totals.planned)} · تمّ {formatNumber(summary.totals.visited)} · مفوّت {formatNumber(summary.totals.missed)}
            </div>
            {summary.totals.impMissed > 0 && (
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: 12, color: '#991b1b', fontWeight: 700 }}>
                ⚠️ {formatNumber(summary.totals.impMissed)} عميل مهم (فئة A/B) كان مخططًا ولم تتم زيارته — أولوية متابعة.
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-title">التزام كل مندوب/مشرف (الأقل التزامًا أولًا)</div>
            <div className="table-wrapper">
              <table className="responsive-cards">
                <thead>
                  <tr>
                    <th>الاسم</th><th>النوع</th><th>المشرف</th><th>المخطط</th><th>تمّ</th><th>مفوّت</th>
                    <th>خارج الخطة</th><th>مهم لم يُزَر</th><th>الالتزام</th><th>الانحراف</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.list.map(g => (
                    <tr key={g.key}>
                      <td data-label="الاسم"><strong>{g.name}</strong></td>
                      <td data-label="النوع">{g.type}</td>
                      <td data-label="المشرف">{g.team}</td>
                      <td data-label="المخطط">{formatNumber(g.planned)}</td>
                      <td data-label="تمّ" style={{ color: '#166534' }}>{formatNumber(g.visited)}</td>
                      <td data-label="مفوّت" style={{ color: '#b91c1c' }}>{formatNumber(g.missed)}</td>
                      <td data-label="خارج الخطة" style={{ color: '#b45309' }}>{formatNumber(g.offPlan)}</td>
                      <td data-label="مهم لم يُزَر">{g.impMissed > 0 ? <span style={{ color: '#b91c1c', fontWeight: 700 }}>{formatNumber(g.impMissed)}</span> : '—'}</td>
                      <td data-label="الالتزام"><strong style={{ color: commitColor(g.commit) }}>{g.commit}%</strong></td>
                      <td data-label="الانحراف">{g.deviation}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted-text" style={{ fontSize: 12, marginTop: 8 }}>
              الالتزام = تمّ ÷ المخطط. الانحراف = (مفوّت + خارج الخطة) ÷ المخطط. «مهم لم يُزَر» = عملاء فئة A/B مخطط لهم ولم تتم زيارتهم.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
