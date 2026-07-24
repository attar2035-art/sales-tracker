# 03 — Test Plan

## 1. Objective
Verify functional correctness, data integrity, authorization, validation, error
handling, performance, and security of the sales-tracker application across all
modules and roles, and surface defects and risks with actionable evidence.

## 2. Scope
**In scope:** all frontend pages/components, shared calc libs, the daily email-report
job, the `create-rep-account` edge function, RLS policies (by static review), CI
workflows, dependency posture.
**Out of scope:** load/stress testing at production scale, penetration testing against
the live Supabase project, `import-tool.html` deep testing (3.2 MB standalone tool).

## 3. Test Types Covered
Functional, UI, UX, API (Supabase/RPC/edge/Resend), Database (RLS + schema by
review), Integration, Authentication, Authorization/Role, Validation, Negative,
Boundary-Value, Error-Handling, Security, Performance, Responsive, Cross-browser,
Regression, End-to-End.

## 4. Environment
| Item | Value |
|---|---|
| Code | branch `claude/dashboard-review-5oyboy` (PR #2) |
| Node | v22.22 (local review) / v24 (CI) |
| Test runner | Jest via react-scripts 5.0.1 |
| Lint | ESLint (react-app config) |
| DB | **No test/staging Supabase available; production must not be used** |
| Browser automation | Playwright available, but blocked without seeded test DB + creds |

## 5. Execution Strategy & Honesty Policy
- **Executed for real:** unit tests (Jest), ESLint, production build, `npm audit`,
  static SPA serving, mocked end-to-end run of the report job, real TEST-mode
  GitHub Actions run of the email job, and manual static code review of every file.
- **Blocked (documented, not claimed passed):** any case needing authenticated DB
  access, RLS enforcement, live data, or browser-driven UI flows — because no safe
  test database/credentials exist in this environment and production is off-limits.
- A test is marked **Passed only if actually executed.** Cases that could not run are
  **Blocked** (with reason) or **Not Tested**. No test result is fabricated.

## 6. Entry / Exit Criteria
- **Entry:** code compiles; dependencies installed.
- **Exit:** all executable tests run; every defect logged with severity/priority; a
  prioritized fix plan produced; launch-readiness scored.

## 7. Severity & Priority Definitions
| Severity | Meaning |
|---|---|
| Critical | Data loss, security breach, or core flow unusable |
| High | Major function broken or wrong data shown; no safe workaround |
| Medium | Function works but with wrong/ misleading results or missing safeguards |
| Low | Cosmetic, minor UX, tech-debt, or low-likelihood edge case |

| Priority | Meaning |
|---|---|
| P1 | Fix before launch |
| P2 | Fix soon after launch |
| P3 | Backlog |

## 8. Risk Areas (focus)
1. Destructive/non-atomic data operations (import, handover, delete).
2. Authorization correctness (RLS vs UI-only checks; role fallbacks).
3. Date/number calculations (timezone, month progress, targets).
4. Large client-side data aggregation (performance/memory).
5. Input validation & negative/boundary handling on data entry.
6. Dependency vulnerabilities (xlsx on user uploads).
7. Missing error/empty/loading states.

## 9. Deliverables
`01`–`11` report set in `qa-reports/` (analysis, features, plan, test cases xlsx,
execution report, bug report xlsx, code review, security review, performance review,
recommended fixes, change log) + executive summary.
