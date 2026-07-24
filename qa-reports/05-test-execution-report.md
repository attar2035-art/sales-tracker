# 05 — Test Execution Report

## Summary
| Metric | Count |
|---|---|
| Total test cases | 72 |
| **Passed** (actually executed, met expectation) | 8 |
| **Failed** (executed OR deterministically confirmed by static review) | 33 |
| **Blocked** (needs test DB / auth / browser — not available) | 30 |
| **Not Tested** | 1 |

> Honesty note: "Passed" is used **only** for tests actually executed in this
> environment. "Failed" includes defects confirmed by rigorous static code review
> where a live browser/DB run was not possible — each such row says so in its Actual
> Result. Nothing is reported as executed that was not.

## What was actually executed (evidence)
| # | Activity | Command / Method | Result |
|---|---|---|---|
| 1 | Unit tests (+coverage) | `react-scripts test --coverage` | **79/79 passed**, 5 suites |
| 2 | ESLint | `eslint src` | 0 errors, 26 warnings |
| 3 | Production build | `react-scripts build` | Success (warnings only) |
| 4 | Dependency audit | `npm audit` | 34 vulns (19 high) inc. `xlsx` |
| 5 | SPA smoke | static-serve `build/` + `curl` | HTTP 200, RTL, correct title |
| 6 | Email job (mock E2E) | node + mocked Supabase, DRY_RUN | Correct routing, `sent=3 failed=0` |
| 7 | Email job (real) | GitHub Actions, TEST_RECIPIENT | Real run `reps=15…sent=3 failed=0` |
| 8 | Secret scan | `grep` src/tools/supabase | No hardcoded secrets |
| 9 | Static code review | manual, every file | 34 issues logged |

**Passed test cases:** TC-018, TC-026, TC-039, TC-059, TC-061, TC-062, TC-069, TC-071
(unit-tested logic, build, SPA smoke, and the executed email-job runs).

## Coverage (Jest)
- `src/lib`: ~100% line coverage (helpers, targets, repMetrics, reportMetrics).
- `src/pages` and `src/components`: **0%** — no page/component tests exist (BUG-029).

## Why cases are Blocked
No test/staging Supabase database or service-role credentials are available here, and
production must not be used. Therefore login, RLS enforcement, DB reads/writes, and
browser-driven UI/responsive/cross-browser flows could not be executed. These are
listed as **Blocked** with the reason — not passed, not failed — in `04-test-cases.xlsx`.

## Failed cases (confirmed defects) — quick index
BUG-001 (TC-055 destructive import), BUG-002 (TC-030 handover atomicity),
BUG-004 (TC-010 role fallback), BUG-005 (TC-063 xlsx vuln), BUG-006 (TC-045 totals
range), BUG-007 (TC-050 loyalty chart), BUG-008 (TC-051 Pareto null crash),
BUG-009 (TC-041 KPI month), BUG-010 (TC-042 shelf column), BUG-011 (TC-043 past/future
month), BUG-012 (TC-021/028 validation), BUG-013 (TC-022 selectors), BUG-014 (TC-023
timezone), BUG-015 (TC-031 delete), BUG-016 (TC-032 temp pw), BUG-017 (TC-035 audit),
BUG-018 (TC-036 today-stats), BUG-019 (TC-025 over-fetch), BUG-020 (TC-060 perf),
BUG-021 (TC-052 stale-on-error), BUG-022 (TC-053 grading), BUG-024 (TC-033 handover
target), BUG-025 (TC-046 scoping), BUG-026 (TC-048/057/058/070 error states),
BUG-027 (TC-024 overwrite), BUG-028 (TC-062/065 lint), BUG-029 (TC-066 coverage),
BUG-030 (TC-044 race), BUG-031 (TC-064 build committed), BUG-032 (TC-037 calendar),
BUG-033 (TC-054 year range), BUG-034 (TC-005 auth validation).

## Screenshots / logs
Tool outputs (Jest, ESLint, `npm audit`, build, static-serve, and the two email-job
runs) were captured and summarized above and in `01-project-analysis.md §7`. Source
data for the spreadsheets is kept as `qa-reports/_test_cases.json` and
`qa-reports/_bugs.json` (regenerate the xlsx with `node qa-reports/_generate_xlsx.js`).
No UI screenshots were captured because authenticated screens could not be reached
without a test database (browser automation Blocked).
