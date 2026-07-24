# 11 — Change Log (QA Phase)

Per instruction #11, **no application/source code was modified during this QA phase.**
All application-code changes on branch `claude/dashboard-review-5oyboy` predate this QA
engagement (they are the dashboard fixes and email-report feature from earlier in the
session, already reviewed/approved separately). The QA phase only **added** artifacts.

## Files added (QA artifacts only — under `qa-reports/`)
| File | Purpose |
|---|---|
| `01-project-analysis.md` | Architecture, stack, tooling results, constraints |
| `02-feature-inventory.md` | Modules / features / user flows |
| `03-test-plan.md` | Scope, types, environment, strategy |
| `04-test-cases.xlsx` | 72 test cases (all required columns + Summary sheet) |
| `05-test-execution-report.md` | Execution results & honesty notes |
| `06-bug-report.xlsx` | 34 bugs (all required columns + Summary sheet) |
| `07-code-review-report.md` | Code review findings |
| `08-security-review.md` | Security findings |
| `09-performance-review.md` | Performance findings |
| `10-recommended-fixes.md` | Prioritized fix plan (awaiting approval) |
| `11-change-log.md` | This file |
| `_test_cases.json`, `_bugs.json` | Source data for the spreadsheets |
| `_generate_xlsx.js` | Regenerates the two .xlsx from the JSON |

## Application code changes during QA
**Reporting phase:** none — the reports above were produced without touching source.

**Approved fixes phase (after sign-off):** the user approved fixing BUG-001 and
BUG-004. These source changes were then made:

| Date | Bug | File(s) | Change |
|---|---|---|---|
| 2026-07-24 | BUG-001 | `src/pages/CustomerSegmentation.js` | `runImport` no longer deletes the whole `customer_yearly_sales` table. Removed the `DELETE .gte('id',0)` step; import now uses idempotent `upsert` on `(customer_code, year, region_name)`, and prompts for confirmation first. A mid-run failure can no longer lose data. |
| 2026-07-24 | BUG-004 | `src/App.js` | Fail-closed authorization: `getNav()` returns `[]` (not `NAV_ADMIN`) for an unknown/missing role, and `renderPage()` gates the admin page switch behind `role === 'admin'`, returning a new `NoAccess` screen for any unknown/null role. |

Verification after the fixes: ESLint (0 new warnings), `react-scripts test` (79/79
pass), `react-scripts build` (compiles).

### Full fix run (Sprints 1-3, user approved "continue in order")

**Sprint 1 (P1):** BUG-005 (Excel parser hardened — type/size/row caps + try/catch;
dependency upgrade still needed at deploy), BUG-003 (daily-entry year/month written
explicitly), BUG-002 (handover deactivates old rep before splitting + full
compensation), BUG-006 (customer totals relabeled to all-time), plus BUG-012/013/014/
024/026/027 in the same files.

**Sprint 2 (P2):** BUG-009 (KPI selected-month progress), BUG-010 (shelf_photos
aggregated + correct column), BUG-011 (month-phase daily-required in Dashboard &
RepDetails), BUG-007 (dynamic-year loyalty chart), BUG-008 (Pareto null guard +
ComposedChart), BUG-021 (ABC/Pareto error/stale handling), BUG-018 (Activity Log
today-stats query), BUG-032 (Gregorian dates), BUG-019 (Targets scoped fetch),
BUG-023 (audit create/update accuracy), BUG-015 (Setup mutation error handling),
BUG-016 (crypto temp password), BUG-034 (auth validation), BUG-025 (Customers
fail-closed scoping), BUG-026 (error states), BUG-028 (**all ESLint warnings cleared;
`CI=true` build now passes the warnings-as-errors gate**), BUG-029 (component-test
infra + first ChangePassword test).

**Sprint 3 (P3):** BUG-017 (audit error capture + page_view throttle), BUG-030 (fetch
cancellation in RepDashboard/RepDetails), BUG-033 (data-aligned analytics years),
BUG-031 (build/ removed from VCS + gitignored).

**Deferred (need input, not silently changed):**
- BUG-020 (large client-side aggregation → move to SQL views/RPC + pagination) — a
  larger performance refactor; Targets over-fetch was fixed, Customers/Segmentation
  remain client-side.
- BUG-022 (three inconsistent ABC/grading definitions) — needs a product decision on
  the single canonical method before code is unified.

**Files changed across all sprints:** src/App.js, src/lib/audit.js,
src/pages/{CustomerSegmentation,Customers,CustomerDetails,DailyEntry,Setup,Login,
ChangePassword,Dashboard,RepDetails,RepDashboard,Targets,ActivityLog}.js,
src/components/{CustomerLoyaltyAnalysis,CustomerParetoAnalysis,CustomerABCAnalysis,
CustomerAnalytics}.jsx, src/setupTests.js, src/pages/ChangePassword.test.js,
package.json, package-lock.json, .gitignore.

**Final verification:** 83/83 unit/component tests pass, `eslint src` clean,
`CI=true react-scripts build` compiles successfully.

## Commands executed (read-only / non-destructive)
- `react-scripts test --coverage`, `eslint src`, `react-scripts build` (build output was
  reverted via `git checkout -- build/`), `npm audit`, `npm outdated`.
- Static-served the existing `build/` on a local port and `curl`ed it (read-only).
- Ran the email-report job in **mock DRY_RUN** and, earlier, a real **TEST_RECIPIENT**
  GitHub Actions run (no real recipients — sent only to the owner's test address).
- No production database was used; no data was created, modified, or deleted; no real
  customer emails/notifications were sent.
