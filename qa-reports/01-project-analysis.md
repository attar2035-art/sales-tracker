# 01 — Project Analysis Report
**Project:** sales-tracker — نظام متابعة المبيعات (حوافز الجمال للصناعة)
**Reviewer:** Senior QA Engineer / Senior Software Engineer (automated review)
**Date:** 2026-07-24
**Branch reviewed:** `claude/dashboard-review-5oyboy` (PR #2)

---

## 1. Purpose
Arabic (RTL) web application to track field sales representatives ("المناديب"): daily
entries (sales, collection, visits, new customers, new products…), monthly targets,
customer analytics (ABC / Pareto / loyalty / segmentation), an audit log, and an
automated daily email-report job (rep + admin + supervisor summaries).

## 2. Technology Stack
| Layer | Technology |
|---|---|
| Frontend | React 18.3.1 (Create React App / react-scripts 5.0.1), plain JS (no TypeScript) |
| Charts | recharts 2.15.4 |
| Spreadsheet import | xlsx (SheetJS) 0.18.5 |
| Backend / DB | Supabase (PostgreSQL + Auth + RLS + Edge Functions) |
| Auth | Supabase Auth (email/password) |
| Email | Resend API (via `tools/send-daily-rep-reports.js`) |
| CI/CD | GitHub Actions (4 workflows: rep account creation, daily email reports, deploy edge functions, health check) |
| Hosting | Render (`sales-tracker-ijyb.onrender.com`) per report links |

## 3. Repository Structure
```
src/
  App.js                     role-based nav + client-side routing (no router lib)
  index.js / index.css       CRA entry + global styles
  lib/       auth.js supabase.js audit.js helpers.js targets.js
             repMetrics.js reportMetrics.js  (+ *.test.js — 79 unit tests)
  pages/     Login ChangePassword Setup DailyEntry Targets Dashboard
             RepDashboard RepDetails Customers CustomerDetails
             CustomerSegmentation ActivityLog
  components/ CustomerAnalytics ABC Pareto Loyalty
tools/       send-daily-rep-reports.js create-rep-account.js production-health-check.js
supabase/
  functions/create-rep-account/index.ts   (Deno edge function, admin-only)
  migrations/*.sql                          (audit_logs, RLS hardening, recursion fix)
  config.toml
.github/workflows/*.yml                      (4 workflows)
import-tool.html                             (3.2 MB standalone bulk-import tool)
build/                                        (committed production build — see finding)
```

## 4. User Roles (from `src/App.js`, `src/lib/auth.js`)
| Role | Landing page | Navigation |
|---|---|---|
| `admin` | Dashboard | Dashboard, Daily Entry, Targets, Rep Details, Customers, Analytics, Segmentation, Audit, Setup, Password |
| `supervisor` | Dashboard | Dashboard, Rep Details, Customers, Analytics, Segmentation, Password (scoped to own team) |
| `data_entry` | Daily Entry | Daily Entry, Targets, Password |
| `rep` | RepDashboard ("تقريري") | RepDashboard, Customers, Analytics, Password |

Roles/links stored in `user_roles(user_id, role, supervisor_id, rep_id)`.

## 5. Data Model (observed tables)
`user_roles`, `representatives`, `supervisors`, `regions`, `products`,
`daily_entries`, `monthly_targets`, `customers`, `customer_product_sales`,
`customer_yearly_sales`, `customer_yearly_history`, `audit_logs`, plus optional
region-insight tables read defensively by RepDashboard (`top_customers_by_region`,
`customer_risks`, `product_analysis_by_region`, `opportunities_by_region`,
`region_strategy`) — missing-table errors are tolerated (`PGRST205`/`42P01`).

## 6. Security Posture (first-hand review of migrations + edge function)
**Strong points:**
- Row-Level Security is enabled and role/region-scoped on every core table
  (`20260708190000_secure_rls_policies.sql`): reads scoped by admin / supervisor
  (own reps/region) / rep (own rows/region); writes to reference & target/entry
  tables restricted to admin (+ data_entry for entries/targets). Deletes are
  admin-only.
- `user_roles` recursion resolved via a `security definer` `is_admin_user()`
  function (`20260712093000`).
- The `create-rep-account` edge function verifies the caller's JWT and requires
  `role='admin'` **server-side** before creating/linking a rep login; input is
  validated (email, password ≥ 6, rep existence); rolls back a newly created auth
  user if the role write fails.
- No hardcoded secrets in `src/`, `tools/`, or `supabase/` (scanned). `.env` is
  git-ignored; only `.env.example` with placeholders is committed.
- Audit logging with an admin-only read policy and `auth.uid() = user_id` insert check.

**Concerns (detailed in 08-security-review.md):**
- The Supabase **publishable/anon key is shipped to every browser** (expected for
  this architecture) — so RLS is the *only* real authorization boundary; several
  UI-only role checks are defense-in-depth, not security.
- Committed `build/` bakes the real Supabase project URL (public, but artifact
  should not be committed).
- `xlsx` (SheetJS) dependency has **HIGH** advisories (prototype pollution + ReDoS)
  and the app parses **user-uploaded** Excel with it.
- `config.toml` sets `verify_jwt = false` for the edge function (mitigated: the
  function verifies the JWT itself).

## 7. Tooling Results (executed this review)
| Check | Command | Result |
|---|---|---|
| Unit tests | `react-scripts test --coverage` | ✅ **79 passed**, 5 suites. Coverage: `lib/` ~100% lines; **all `src/pages` and `src/components` 0%** (no component/page tests). |
| Lint | `eslint src` | ✅ 0 errors, **26 warnings** (unused vars, `react-hooks/exhaustive-deps`). |
| Build | `react-scripts build` | ✅ Compiles (warnings only). Main bundle ~large; 339 kB chunk. |
| Dependency audit | `npm audit` | ⚠️ **34 vulnerabilities (19 high, 5 moderate, 10 low)** — notably `xlsx` (HIGH, no fix), plus dev-only `webpack-dev-server`/`sockjs`/`nth-check` chains. |
| Runtime (frontend) | static-serve committed `build/` + curl | ✅ SPA returns HTTP 200, Arabic RTL, `<title>نظام متابعة المبيعات</title>`. |
| Runtime (email job) | `send-daily-rep-reports.js` via GitHub Actions (TEST mode) | ✅ Real run: `reps=15 fullReports=3 supervisors=5 sent=3 failed=0` — job works end-to-end. |

## 8. Test Environment & Constraints (honesty note)
- **No test/staging Supabase database and no service-role credentials are available
  in this review environment.** Production credentials must NOT be used (explicit
  constraint). Therefore any test case requiring authenticated DB reads/writes,
  login, RLS enforcement, or live data was executed only where a safe mock or the
  isolated pure-logic layer allowed it; the rest are marked **Blocked** in
  `05-test-execution-report.md` with the reason.
- What *was* executed for real: 79 unit tests, ESLint, production build, npm audit,
  static SPA serving, a mocked end-to-end run of the daily-report job, and a real
  (TEST-mode) GitHub Actions run of the email job.
- Browser automation (Playwright) against authenticated flows was **not** run
  because it requires a seeded test DB + credentials; UI test cases are documented
  and marked Blocked/Not Tested accordingly rather than claimed as passed.

## 9. Overall First Impression
Architecturally sound for its size: RLS is genuinely well-designed, the edge
function is correctly guarded, and the shared calculation logic is now unit-tested.
The main risk areas are: (a) a **destructive, non-transactional bulk import** with
no confirmation, (b) **large unbounded client-side data aggregations**, (c) a
cluster of **presentation/calculation mismatches** (hardcoded years & date-range
labels), (d) a vulnerable `xlsx` parser on user uploads, and (e) **zero automated
tests for pages/components**. Details in reports 05–10.
