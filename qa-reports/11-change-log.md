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
pass), `react-scripts build` (compiles). No other bugs from the report were touched;
the remaining fix plan (10-recommended-fixes.md) still awaits approval.

## Commands executed (read-only / non-destructive)
- `react-scripts test --coverage`, `eslint src`, `react-scripts build` (build output was
  reverted via `git checkout -- build/`), `npm audit`, `npm outdated`.
- Static-served the existing `build/` on a local port and `curl`ed it (read-only).
- Ran the email-report job in **mock DRY_RUN** and, earlier, a real **TEST_RECIPIENT**
  GitHub Actions run (no real recipients — sent only to the owner's test address).
- No production database was used; no data was created, modified, or deleted; no real
  customer emails/notifications were sent.
