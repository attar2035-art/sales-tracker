# 10 — Recommended Fixes (Prioritized Plan)

Ordered by risk. **No large code changes were made in this QA phase** — this is the
proposed plan awaiting your approval (per your instruction #11).

## P1 — Fix before launch (blockers)
1. **BUG-001 — Non-destructive, atomic import.** Replace delete-all-then-insert with an
   upsert-only path (or a Postgres RPC/transaction); add a confirmation dialog and a
   dry-run row count. *Files:* `CustomerSegmentation.js`. *Effort:* M.
2. **BUG-005 — Patch the `xlsx` parser.** Upgrade to the patched SheetJS build (or move
   parsing server-side) and validate/bound uploaded files (columns, size, row cap).
   *Files:* `package.json`, `CustomerSegmentation.js`. *Effort:* M.
3. **BUG-004 — Fail-closed authorization.** Default unknown/null roles to a no-access
   screen; never default to `NAV_ADMIN`/admin pages. *Files:* `App.js`. *Effort:* S.
4. **BUG-003 — Daily-entry year/month integrity.** Set `year`/`month` explicitly in the
   upsert (or verify+document the DB generated column) and add an integration test.
   *Files:* `DailyEntry.js` (+ migration if needed). *Effort:* S.
5. **BUG-002 — Atomic rep handover.** Move handover into one RPC/transaction (or verify
   every step and compensate the last). *Files:* `Setup.js` (+ RPC). *Effort:* M.
6. **BUG-006 — Correct customer totals.** Either filter the query to the labeled range
   or show the true range. *Files:* `Customers.js`, `CustomerDetails.js`. *Effort:* S.
7. **RLS validation on staging** (TC-012–TC-015): run authenticated per-role tests on a
   test Supabase project before launch. *Effort:* M.

## P2 — Fix soon after launch
8. **BUG-012 — Input validation** (non-negative, upper bounds, cross-field) on Daily
   Entry & Targets. *Effort:* M.
9. **BUG-009 / BUG-010 / BUG-011 — Dashboard correctness:** selected-month KPI progress;
   real shelf-photos column; apply the RepDashboard month-phase fix to Dashboard &
   RepDetails. *Effort:* M.
10. **BUG-007 / BUG-008 — Analytics defects:** dynamic-year loyalty chart/headers; null
    guard in Pareto. *Effort:* S.
11. **BUG-018 — Activity Log today-stats** via a real aggregate query. *Effort:* S.
12. **BUG-019 / BUG-020 — Server-side aggregation & pagination** for Customers,
    Segmentation, Dashboard, Targets. *Effort:* L.
13. **BUG-013 — Daily Entry month/year selectors:** remove or wire to the saved row.
    *Effort:* S.
14. **BUG-015 — Setup mutation error handling** + protect FK-referenced deletes
    (soft-delete). *Effort:* M.
15. **BUG-016 / BUG-034 — Auth hardening:** CSPRNG temp passwords, masking, stronger
    password policy, email-format validation. *Effort:* S.
16. **BUG-024 — Handover inherited-target semantics.** *Effort:* S.
17. **BUG-026 — Standardized error/empty/loading states** (shared fetch hook). *Effort:* M.
18. **BUG-028 — Clean 26 ESLint warnings**; then enable CI warnings-as-errors. *Effort:* S.
19. **BUG-029 — Add component + E2E tests** (@testing-library/react, Playwright) against
    a seeded test DB. *Effort:* L.

## P3 — Backlog / polish
20. BUG-017 audit reliability + page_view throttle.
21. BUG-021 stale-on-error in ABC/Pareto.
22. BUG-022 unify ABC/grading definition.
23. BUG-023 create/update audit accuracy.
24. BUG-014 centralize local-date helper.
25. BUG-025 Customers scoping fail-closed.
26. BUG-027 daily-entry overwrite confirm.
27. BUG-030 fetch cancellation (RepDashboard/RepDetails).
28. BUG-031 remove committed `build/`; restrict edge CORS origin.
29. BUG-032 Gregorian dates in Activity Log.
30. BUG-033 align analytics year ranges to data.

## Suggested sequencing
1. **Sprint 1 (P1 blockers):** BUG-001, 005, 004, 003, 002, 006 + staging RLS tests.
2. **Sprint 2 (P2 correctness/UX):** dashboards/analytics/validation/error states + lint.
3. **Sprint 3 (P2/P3 perf + tests):** server-side aggregation, pagination, component/E2E
   test suite, remaining polish.
