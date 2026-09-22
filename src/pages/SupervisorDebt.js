import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { formatCurrency } from '../lib/helpers';
import { buildEffectiveTargetsMap } from '../lib/targets';
import { DEBT_BUCKETS, DEBT_COLUMNS, debtDueOf, debtPct } from '../lib/debtAging';

// مديونية مناديبي — the supervisor sees the latest debt-aging snapshot for each
// rep on their team (row-level security already limits reads to their team).
export default function SupervisorDebt({ supervisorId }) {
  const [reps, setReps] = useState([]);
  const [snaps, setSnaps] = useState([]); // latest debt row per rep
  const [targetMap, setTargetMap] = useState({});
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!supervisorId) return;
    setLoading(true);
    const { data: repRows } = await supabase.from('representatives')
      .select('id, name, is_active, regions(name)')
      .eq('supervisor_id', supervisorId).eq('is_active', true);
    const repList = repRows || [];
    const repIds = repList.map(r => r.id);
    setReps(repList);

    if (repIds.length === 0) { setSnaps([]); setTargetMap({}); setLoading(false); return; }

    const now = new Date();
    const [debtRes, targetsRes] = await Promise.all([
      supabase.from('daily_entries').select(`rep_id, ${DEBT_COLUMNS}`)
        .in('rep_id', repIds)
        .not('field_owners->>debt_total', 'is', null)
        .order('entry_date', { ascending: false })
        .limit(20000),
      supabase.from('monthly_targets').select('*').in('rep_id', repIds).limit(10000),
    ]);

    // Keep the newest debt row per rep (rows already sorted date desc).
    const latest = new Map();
    for (const row of (debtRes.data || [])) {
      if (!latest.has(row.rep_id)) latest.set(row.rep_id, row);
    }
    setSnaps([...latest.values()]);
    setTargetMap(buildEffectiveTargetsMap(targetsRes.data || [], now.getFullYear(), now.getMonth() + 1));
    setLoading(false);
  }, [supervisorId]);

  useEffect(() => { load(); }, [load]);

  const repById = useMemo(() => new Map(reps.map(r => [r.id, r])), [reps]);

  const rows = useMemo(() => {
    const list = snaps.map(s => {
      const rep = repById.get(s.rep_id);
      const due = debtDueOf(s);
      const target = Number(targetMap[s.rep_id]?.target_collection) || 0;
      return {
        repId: s.rep_id,
        name: rep?.name || 'مندوب',
        region: rep?.regions?.name || 'بدون منطقة',
        debt_total: Number(s.debt_total) || 0,
        due,
        target,
        pctOfTarget: debtPct(due, target),
        buckets: DEBT_BUCKETS.reduce((acc, b) => { acc[b.key] = Number(s[b.key]) || 0; return acc; }, {}),
      };
    });
    return list.sort((a, b) => b.due - a.due); // most to collect first
  }, [snaps, repById, targetMap]);

  const totals = useMemo(() => rows.reduce((a, r) => {
    a.debt_total += r.debt_total; a.due += r.due; return a;
  }, { debt_total: 0, due: 0 }), [rows]);

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">🏦 مديونية مناديبي</h1>
      </div>

      {loading ? (
        <div className="loading"><div className="spinner" />جاري التحميل...</div>
      ) : rows.length === 0 ? (
        <div className="card"><div className="empty-state">
          <div className="empty-state-icon">🏦</div>
          <div className="empty-state-text">لا توجد مديونية مسجّلة لمناديبك حتى الآن.</div>
        </div></div>
      ) : (
        <>
          <div className="card">
            <div className="card-title">إجمالي ديون مناديبي — {formatCurrency(totals.debt_total)}</div>
            <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 10, padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
              <span style={{ color: '#9a3412', fontWeight: 800, fontSize: 15 }}>💰 المبلغ المستحق تحصيله (فوق 60 يوم)</span>
              <span style={{ color: '#c2410c', fontWeight: 800, fontSize: 22 }}>{formatCurrency(totals.due)}
                <span style={{ fontSize: 12, fontWeight: 700, marginInlineStart: 6 }}>({debtPct(totals.due, totals.debt_total)}% من الإجمالي)</span>
              </span>
            </div>
          </div>

          <div className="card">
            <div className="card-title">تفصيل كل مندوب (الأكثر استحقاقًا للتحصيل أولًا)</div>
            <div className="table-wrapper">
              <table className="responsive-cards">
                <thead>
                  <tr>
                    <th>المندوب</th><th>المنطقة</th><th>إجمالي الدين</th><th>المستحق تحصيله (61+)</th>
                    {DEBT_BUCKETS.map(b => <th key={b.key}>{b.label}</th>)}
                    <th>٪ من هدف التحصيل</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.repId}>
                      <td data-label="المندوب"><strong>{r.name}</strong></td>
                      <td data-label="المنطقة">{r.region}</td>
                      <td data-label="إجمالي الدين"><strong>{formatCurrency(r.debt_total)}</strong></td>
                      <td data-label="المستحق تحصيله (61+)"><strong style={{ color: '#dc2626', fontSize: '1.05rem' }}>{formatCurrency(r.due)}</strong></td>
                      {DEBT_BUCKETS.map(b => (
                        <td key={b.key} data-label={b.label}>
                          {formatCurrency(r.buckets[b.key])}
                          <div style={{ fontSize: 11, color: '#94a3b8' }}>{debtPct(r.buckets[b.key], r.debt_total)}%</div>
                        </td>
                      ))}
                      <td data-label="٪ من هدف التحصيل">
                        {r.target > 0
                          ? <span style={{ display: 'inline-block', background: '#2563eb', color: '#ffffff', fontWeight: 800, fontSize: '0.95rem', padding: '6px 12px', borderRadius: 8, lineHeight: 1.5 }}>{r.pctOfTarget}%</span>
                          : <span style={{ color: '#94a3b8' }}>لا يوجد هدف</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted-text" style={{ fontSize: 12, marginTop: 8 }}>
              «المستحق تحصيله» = المديونية من 61 يوم فأكثر. «٪ من هدف التحصيل» = المستحق تحصيله ÷ هدف التحصيل الشهري للمندوب.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
