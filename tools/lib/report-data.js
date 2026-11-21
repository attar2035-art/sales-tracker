// Shared Supabase data access for the backend report senders. Pure data only —
// no HTML, no sending. Mirrors the SQL/filters used by the existing triggers
// and tools/send-debt-reports.js so report content stays equivalent.

const { EXCLUDED_REGIONS, EXCLUDED_REP_NAMES } = require('./report-config');

const n = (v) => Number(v) || 0;
const OVER60_KEYS = ['debt_over_60', 'debt_over_90', 'debt_over_120', 'debt_over_150'];
const over60Of = (d) => OVER60_KEYS.reduce((s, k) => s + n(d[k]), 0);

// Mandatory-upload precondition (مي updated debt / أميرة entered collection today, Riyadh).
async function uploadStatusToday(supabase) {
  // Count today's (Riyadh) debt imports and collection entries from audit_logs.
  const todayStartUtc = (() => {
    // Riyadh is UTC+3 with no DST; the Riyadh day starts at 21:00 UTC the day before.
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    return new Date(`${parts}T00:00:00+03:00`).toISOString();
  })();
  const { data: rows, error: e } = await supabase
    .from('audit_logs')
    .select('event_type, entity_type, created_at')
    .gte('created_at', todayStartUtc);
  if (e) throw e;
  // Filter to "today in Riyadh" in JS to avoid a server-side function dependency.
  const todayRiyadh = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const isToday = (ts) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts)) === todayRiyadh;
  let debt_may = 0; let coll_amira = 0;
  for (const r of rows || []) {
    if (!isToday(r.created_at)) continue;
    if (r.event_type === 'import' && r.entity_type === 'customers') debt_may += 1;
    if (r.entity_type === 'daily_entries' && (r.event_type === 'create' || r.event_type === 'update')) coll_amira += 1;
  }
  return { debt_may, coll_amira };
}

async function regionsMeta(supabase) {
  const [{ data: regions, error: er }, { data: reps, error: ep }] = await Promise.all([
    supabase.from('regions').select('id,name,exclude_from_debt'),
    supabase.from('representatives').select('id,name,region_id,is_active').eq('is_active', true),
  ]);
  if (er) throw er; if (ep) throw ep;
  const byName = new Map(); const byId = new Map();
  for (const r of regions || []) { byName.set(r.name, r); byId.set(r.id, r); }
  const repByRegion = new Map();
  for (const rep of reps || []) {
    if (EXCLUDED_REP_NAMES.includes(rep.name)) continue;
    if (rep.region_id && !repByRegion.has(rep.region_id)) repByRegion.set(rep.region_id, rep);
  }
  return { regionByName: byName, regionById: byId, repByRegion };
}

// Page past PostgREST's 1000-row cap (same approach as send-debt-reports.js).
async function onBookCustomers(supabase) {
  const out = []; const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await supabase
      .from('customers')
      .select('region_id, customer_name, credit_limit, debt_total, debt_1_45, debt_over_60, debt_over_90, debt_over_120, debt_over_150, regions!inner(name,exclude_from_debt)')
      .eq('debt_bad', false)
      .eq('debt_offbook', false)
      .eq('exclude_from_debt', false)
      .eq('regions.exclude_from_debt', false)
      .order('id', { ascending: true })
      .range(from, from + size - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < size) break;
  }
  return out;
}

function emptyAgg() { return { total: 0, cur: 0, d4560: 0, over60: 0, buckets: [0, 0, 0, 0], count: 0, customers: [] }; }

// Aggregate on-book customers into per-region debt-aging figures.
function aggregateDebtByRegion(customers) {
  const byRegion = new Map();
  for (const c of customers) {
    const name = c.regions?.name; if (!name || EXCLUDED_REGIONS.includes(name)) continue;
    const g = byRegion.get(name) || emptyAgg();
    g.total += n(c.debt_total);
    g.d4560 += n(c.debt_1_45);
    const o = over60Of(c);
    g.over60 += o;
    g.buckets[0] += n(c.debt_over_60); g.buckets[1] += n(c.debt_over_90); g.buckets[2] += n(c.debt_over_120); g.buckets[3] += n(c.debt_over_150);
    if (n(c.debt_total) > 0) g.count += 1;
    g.customers.push({ name: c.customer_name, over60: o, debt_total: n(c.debt_total), credit_limit: n(c.credit_limit), debt_over_60: n(c.debt_over_60), debt_over_90: n(c.debt_over_90), debt_over_120: n(c.debt_over_120), debt_over_150: n(c.debt_over_150) });
    byRegion.set(name, g);
  }
  for (const g of byRegion.values()) g.cur = g.total - (g.d4560 + g.over60);
  return byRegion;
}

// Collection + sales MTD per rep for the given period's month (Riyadh).
async function collectionMTD(supabase, period) {
  const [y, m] = period.split('-').map(Number);
  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  const end = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`;
  const { data, error } = await supabase
    .from('daily_entries')
    .select('rep_id, daily_sales, daily_collection, entry_date')
    .gte('entry_date', start).lt('entry_date', end);
  if (error) throw error;
  const byRep = new Map();
  for (const r of data || []) {
    const g = byRep.get(r.rep_id) || { sales: 0, coll: 0 };
    g.sales += n(r.daily_sales); g.coll += n(r.daily_collection);
    byRep.set(r.rep_id, g);
  }
  return byRep;
}

// Latest target per rep (highest year/month).
async function latestTargets(supabase) {
  const { data, error } = await supabase
    .from('monthly_targets')
    .select('rep_id, target_sales, target_collection, year, month');
  if (error) throw error;
  const byRep = new Map();
  for (const t of data || []) {
    const cur = byRep.get(t.rep_id);
    if (!cur || t.year > cur.year || (t.year === cur.year && t.month > cur.month)) byRep.set(t.rep_id, t);
  }
  return byRep;
}

function topOverdue(customers, limit = 5) {
  const { oldestSlice } = require('./hawafel-email');
  return customers
    .filter((c) => c.over60 > 0)
    .sort((a, b) => b.over60 - a.over60)
    .slice(0, limit)
    .map((c) => ({ name: c.name, amount: c.over60, oldest: oldestSlice(c), limit: c.credit_limit, overLimit: c.credit_limit > 0 && c.debt_total > c.credit_limit }));
}

module.exports = { uploadStatusToday, regionsMeta, onBookCustomers, aggregateDebtByRegion, collectionMTD, latestTargets, topOverdue, over60Of, emptyAgg };
