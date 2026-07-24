# 09 — Performance Review

Static performance review (no live-scale load test — Blocked without a seeded test DB).
Findings are ranked by likely production impact.

## 1. Large client-side data loads (BUG-019, BUG-020) — highest impact
| Location | Behavior | Risk |
|---|---|---|
| `Customers.js:86-106` | Fetches **all** `customer_product_sales` rows (1000-batch paging across up to 200 customers) and sums in JS | For admin this is the whole sales table → memory/CPU spikes, slow first paint |
| `CustomerSegmentation.js:43-46` | `select('*').limit(50000)` of `customer_yearly_sales`, all stats recomputed in JS | Heavy; silently truncates beyond 50k |
| `Dashboard.js:155-164` | `daily_entries` month (limit 10000) + 6-month window (limit 50000) | Grows with reps × days; JS aggregation |
| `Targets.js:29-31`, `Dashboard.js:153` | `monthly_targets` `.limit(10000)` every month change | Over-fetch + cross-scope exposure |
| `CustomerABCAnalysis`, `Pareto` | Full-year customer set, entire table rendered | No virtualization |

**Recommendation:** move aggregation into SQL views / RPC (server-side sums, ABC/Pareto,
today-stats), return only what the screen shows, add date/scope filters, and
paginate/virtualize long tables.

## 2. Unbounded table rendering
- ABC/Pareto/Segmentation render up to thousands of `<tr>` without pagination or
  virtualization → large DOM, jank on scroll. Add pagination or `react-window`.

## 3. Repeated / redundant fetching
- `RepDashboard.fetchRegionInsights` re-fetches the region customer/product portfolio
  on every **month** change even though that data isn't month-dependent (should split
  month-independent loads from month-dependent ones).
- `App.onAuthStateChange` re-runs `checkUser()` on every auth event (no debounce).

## 4. Aggregation that should be a DB query
- `ActivityLog` today-stats computed from the newest 500 rows instead of a `count`
  aggregate — both **wrong** (BUG-018) and needlessly ships rows.

## 5. Bundle size
- Production build main chunk ~large; a 339 kB chunk present. recharts + xlsx are heavy.
  Consider code-splitting analytics/segmentation routes and lazy-loading `xlsx` only on
  the import screen.

## 6. Network round-trips
- Several pages issue many sequential `.single()` lookups; batch where possible and use
  `.maybeSingle()` to avoid error overhead on empty results.

## 7. Positives
- The email-report job fetches with sensible `Promise.all` batching and computes each
  rep's metrics once, reusing them across rep/admin/supervisor emails. ✅
- Region-insight queries in RepDashboard tolerate missing tables gracefully.

## Prioritized performance actions
1. **P2** Replace client-side full-table aggregation with SQL views/RPC (Customers,
   Segmentation, Dashboard, ActivityLog).
2. **P2** Add server-side date/scope filters + pagination/virtualization for large tables.
3. **P3** Split month-independent vs month-dependent fetches in RepDashboard; debounce
   auth-state handling.
4. **P3** Code-split + lazy-load heavy deps (recharts, xlsx).
