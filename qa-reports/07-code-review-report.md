# 07 — Code Review Report

Senior-engineer review of the full codebase (every page, component, lib, tool, edge
function, migration). Findings are grouped; each references the tracked Bug ID.

## A. Logic errors
- **Daily entry omits year/month** on save while dashboards filter by year/month —
  correctness depends on an unverified DB derivation. (BUG-003)
- **Dashboard KPI status** uses `getMonthProgress(new Date())` (today) regardless of
  the selected month, disagreeing with the rep tables. (BUG-009)
- **Dashboard "shelf photos" column** renders `total_visits` again; shelf photos are
  never aggregated. (BUG-010)
- **Past/finished-month "daily required"** falls back to the full remaining amount
  (Dashboard, RepDetails); future months read as "ahead". Fixed only in RepDashboard
  on this branch. (BUG-011)
- **Customer totals** are labeled with a fixed date range but the query has **no date
  filter** (sums all-time). (BUG-006)
- **Loyalty chart** builds `growth_data` with hardcoded `'سنة 2022'/'سنة 2023'` keys
  while chart dataKeys are dynamic → blank bars and mislabeled headers. (BUG-007)
- **Three inconsistent "ABC/grading" definitions** (positional vs cumulative-sales vs
  Pareto). (BUG-022)
- **Create-vs-update audit** decision keys off inherited-target truthiness. (BUG-023)
- **Handover** can materialize an inherited prior-month target into the current month
  and split it against current-month achievements only. (BUG-024)
- **Daily Entry month/year selectors** don't affect the saved row. (BUG-013)
- **Analytics year range** (2022-2025) inconsistent with Segmentation (2026) and
  loyalty compares `year+1`. (BUG-033)

## B. Error handling
- Many pages don't destructure/handle Supabase `error` (Customers, CustomerDetails,
  Setup, Dashboard, Targets, Loyalty) — failures render empty/zeroed silently.
  (BUG-026)
- `CustomerSegmentation.handleFileUpload` has no try/catch around `FileReader`/
  `XLSX.read` — corrupt files throw unhandled. (BUG-026)
- ABC/Pareto keep stale data on fetch error. (BUG-021)
- Audit insert errors swallowed (no `.select()`); fire-and-forget races drop events.
  (BUG-017)
- `.single()` used where `.maybeSingle()` is correct (DailyEntry prefill, Customers
  rep lookup) — noisy PGRST116 / silent failure on 0/many rows.

## C. Unguarded null access / crashes
- `CustomerParetoAnalysis`: `customer_name.substring(...)` with no null guard → render
  crash on a null name. (BUG-008)

## D. Concurrency / races
- `RepDashboard`/`RepDetails` fetch effects have no cancellation — rapid month changes
  can let a stale response overwrite newer data. (BUG-030)
- `App.onAuthStateChange` calls `checkUser` on every event with no debounce (loading
  flicker on rapid events).

## E. Destructive operations & transactions
- **Segmentation import deletes the whole `customer_yearly_sales` table** with no
  confirmation and no transaction. (BUG-001, Critical)
- **Handover** is a multi-step mutation with incomplete rollback (last step
  uncompensated). (BUG-002)
- **Setup delete/toggle/update** ignore results; FK-referenced deletes fail silently
  or could cascade and destroy history. (BUG-015)
- **Daily entry overwrite** (upsert) has no confirm dialog. (BUG-027)
- No DB transactions anywhere for multi-step writes.

## F. Validation weaknesses
- Daily entry & targets: numeric `min` is UI-only; negatives and illogical values
  (successful>total, availability>100) persist; no cross-field checks. (BUG-012)
- Login/ChangePassword: no email-format validation; password policy is min-6 only; no
  re-auth on password change. (BUG-034)
- Import: no column/schema validation; missing headers silently produce zeros.
  (BUG-026)
- No duplicate-name detection for regions/supervisors/reps (Setup).

## G. Dead code / quality (26 ESLint warnings — BUG-028)
- Unused state/imports in ABC/Pareto/Loyalty (`abcData`, `paretoData`,
  `loyaltyAnalysis`, `LineChart`, `Line`, `formatNumber`), `metricPercent` in
  Dashboard, `allowedRegionIds` in Customers.
- `react-hooks/exhaustive-deps` across App, Dashboard, RepDashboard, RepDetails,
  Targets, DailyEntry, analytics — risk of stale closures/missed refetches.

## H. Date/number handling
- UTC vs local "today" inconsistency (DailyEntry UTC vs Setup local). (BUG-014)
- Working-day/month-progress math tied to real "today" applied to arbitrary selected
  months. (BUG-011)
- Activity Log renders Hijri dates via `ar-SA` default. (BUG-032)

## I. Positives (well done)
- RLS policies are comprehensive, role/region-scoped, and the `user_roles` recursion
  is correctly solved with a `security definer` function.
- The `create-rep-account` edge function verifies JWT + admin role server-side,
  validates input, and rolls back a newly created user on role-write failure.
- Shared calc libs are cleanly separated and now unit-tested (79 tests).
- The daily email-report job is structured, resilient (per-email try/catch), and has a
  safe TEST-recipient mode.
- No hardcoded secrets; `.env` git-ignored.

## J. Maintainability recommendations
- Introduce a shared data-fetch hook with consistent loading/error/empty handling.
- Centralize date helpers (single local-today, month-phase) and reuse.
- Move heavy aggregation to SQL views/RPC.
- Add component (@testing-library/react) + E2E (Playwright) tests against a seeded
  test DB; enable CI warnings-as-errors after cleanup.
