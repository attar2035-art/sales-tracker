# 12 — Deployment Guide & Staging Test Checklist
Branch: `claude/dashboard-review-5oyboy` (PR #2) · App: sales-tracker (CRA + Supabase + Resend)

> Goal: safely verify this branch on a **staging** Supabase project before merging/
> releasing to production. Do NOT test on the production database. Use test accounts
> and test data only. Nothing here sends real customer emails unless you explicitly
> run the live email job (kept for last, optional).

---

## PART A — Pre-deploy preparation

### A1. Provision a staging Supabase project (once)
- [ ] Create a **separate** Supabase project for staging (not production).
- [ ] Copy the production schema to staging (or run all migrations from scratch — see B1).
- [ ] Seed a small **test dataset**: 1 admin, 1 data_entry, 2 supervisors, ~4 reps
      across 2 regions, a handful of customers/products, a few `daily_entries` and
      `monthly_targets`, and some `customer_yearly_sales` rows for 2024/2025.
      Ready-made scripts:
      - `qa-reports/staging/seed_test_data.sql` — idempotent, id-type agnostic seed
        (create the test auth users first — see the header of that file).
      - `qa-reports/staging/rls_verification.sql` — per-role RLS checks with expected
        counts (impersonates each user via JWT claims; read-only, auto-rolls back).

### A2. Environment variables (frontend build)
- [ ] `REACT_APP_SUPABASE_URL` = staging project URL
- [ ] `REACT_APP_SUPABASE_KEY` = staging **publishable/anon** key
- [ ] Confirm these point at **staging**, never production, for the staging build.

### A3. Secrets (GitHub Actions — email job & rep-account workflow)
Set these as **staging** repo/environment secrets (or a separate staging environment):
- [ ] `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (staging)
- [ ] `RESEND_API_KEY`, `REPORTS_FROM_EMAIL`, `REPORTS_FROM_NAME`, `APP_URL`
- [ ] (optional) `ADMIN_REPORT_EMAILS` — comma-separated fixed recipients

### A4. Dependency remediation — **xlsx (BUG-005)** ⚠️
`npm audit` reports the pinned `xlsx@0.18.5` as HIGH (prototype pollution + ReDoS) and
the app parses user-uploaded Excel. The registry has no fix in that range.
- [ ] Upgrade to the patched SheetJS distribution from their CDN, e.g.
      `npm i https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`
      (this was blocked in the review sandbox by the proxy — do it in your build env).
- [ ] Re-run `npm audit` and confirm the xlsx HIGH advisories are gone.
- [ ] Re-run `CI=true npm test` and `CI=true npm run build` to confirm no breakage.
- [ ] Interim mitigation already shipped: file type/size/row caps + try/catch in
      `CustomerSegmentation.handleFileUpload`.

### A5. Build gate (already green on this branch)
- [ ] `CI=true npm test` → all suites pass (88 tests at time of review).
- [ ] `npx eslint src` → clean (0 problems).
- [ ] `CI=true npm run build` → "Compiled successfully."

---

## PART B — Deploy to staging (in this order)

### B1. Apply database migrations
Apply all files in `supabase/migrations/` to staging, in filename order. Newly added:
- [ ] `20260724120000_customer_sales_totals_rpc.sql` — server-side aggregation RPC
      (BUG-020). After apply, verify it exists:
      `select proname from pg_proc where proname = 'customer_sales_totals';`
- [ ] Confirm the earlier RLS/audit migrations are present (they define the security
      boundary the checks below rely on).

### B2. Verify the `daily_entries` year/month contract (BUG-003)
The app now writes `year`/`month` explicitly, but confirm the table accepts them:
- [ ] `daily_entries` has `year` and `month` columns (int). If they are **generated**
      columns, an explicit insert of the same value is fine; if they are plain
      columns, the new client value populates them. Either way, after saving a test
      entry, run:
      `select entry_date, year, month from daily_entries order by created_at desc limit 3;`
      and confirm year/month match the date.

### B3. Deploy the edge function
- [ ] Deploy `supabase/functions/create-rep-account` to staging
      (`supabase functions deploy create-rep-account`).

### B4. Deploy the frontend
- [ ] Build with the staging env (A2) and deploy to a staging host (e.g. a Render
      preview / separate site). Confirm the SPA loads (Arabic RTL, login screen).

---

## PART C — Staging verification checklist

Legend: run each as the stated role. Mark Pass/Fail. A **Fail on any P1 item blocks
release.** Bug IDs reference `06-bug-report.xlsx`.

### C1. Authentication & Authorization (P1)
- [ ] **Login** with valid creds routes each role to its landing page (admin→Dashboard,
      data_entry→Daily Entry, rep→تقريري, supervisor→Dashboard). (TC-001)
- [ ] **Invalid password** → generic error; **malformed email** → format error (BUG-034).
- [ ] **Forced password change**: a user with a temp password must change it before
      using the app; new policy = ≥8 chars + letter + digit (BUG-034). (TC-007)
- [ ] **No-role user (BUG-004, critical):** create an auth user with **no `user_roles`
      row**, log in → must see the **"لا توجد صلاحية للوصول"** screen, **not** admin
      pages/nav. (TC-010)
- [ ] **RLS per role (BUG — RLS):** using each role's session, confirm via the app
      (and optionally direct REST) that:
  - [ ] rep sees only their own `daily_entries`/`monthly_targets` and region customers.
  - [ ] supervisor sees only their team's reps' rows and region customers.
  - [ ] rep/data_entry **cannot** insert/delete another rep's `daily_entries`.
  - [ ] non-admin **cannot** call the create-rep-account function (403). (TC-014)

### C2. Daily Entry (P1)
- [ ] Save a valid entry → success; re-open shows prefilled values. (TC-016)
- [ ] **year/month persisted (BUG-003):** the saved row appears on the Dashboard for
      that month, and in Rep Details. (TC-020)
- [ ] **Validation (BUG-012):** reject negative values, availability>100,
      successful_visits>total_visits, shelf_photos>total_visits. (TC-021)
- [ ] **Overwrite confirm (BUG-027):** re-saving an existing rep/date prompts a confirm.
- [ ] **Friday blocked** when picking a Friday date. (TC-017)
- [ ] Month/Year selectors are read-only and follow the date (BUG-013).

### C3. Targets (P1)
- [ ] Set 11 targets for a rep → saved; badge shows "محددة". (TC-027)
- [ ] Reject negative targets (BUG-012).
- [ ] First real target for a month logs a **create** (not update) even if a prior
      month's target is inherited (BUG-023).
- [ ] Inherited-target badge ("متكررة من …") shows for months without an own target.

### C4. Setup / Handover (P1)
- [ ] Add region/supervisor/rep → created.
- [ ] **Delete a referenced entity (BUG-015):** deleting a region that has reps shows a
      clear "تعذّر الحذف — مرتبط ببيانات" message (not a silent no-op). (TC-031)
- [ ] **Handover atomicity (BUG-002, high):** hand over a rep with a current-month
      target → exactly **one** active rep afterward; target split (achieved→old,
      remaining→new). Then simulate a failure path if possible (e.g., revoke perms on
      one step) and confirm no state with two active reps. (TC-030)
- [ ] **Handover inherited target (BUG-024):** hand over a rep whose only target is
      inherited → no target is materialized/split; message says so. (TC-033)
- [ ] **Temp password (BUG-016):** generated password is random (crypto) and the rep
      is forced to change it at first login.
- [ ] Create a rep login account (edge function) → auth user + `user_roles` rep row.

### C5. Dashboards (P1/P2)
- [ ] Admin/supervisor Dashboard renders KPIs, leaderboard, rep tables.
- [ ] **Selected-month KPI status (BUG-009):** pick a **past** month → KPI status
      badges match the rep tables (both use the selected month, not today). (TC-041)
- [ ] **Shelf-photos column (BUG-010):** visits tab → "صور الرف" shows shelf-photo
      counts, not a duplicate of total visits. (TC-042)
- [ ] **Past/future month daily-required (BUG-011):** a finished month shows "-" for
      "مطلوب يوميًا" (Dashboard + Rep Details); current month shows sensible values.
- [ ] **Rep dashboard (تقريري):** per-indicator month breakdown (achieved/target/
      remaining/daily/percent/status) renders for a rep.
- [ ] **Fetch race (BUG-030):** rapidly toggle months on Rep Dashboard/Details → the
      latest selection's data wins (no flicker to stale data). (TC-044)

### C6. Customers & Analytics (P1/P2)
- [ ] **Customer totals (BUG-006):** the totals card reads "كل الفترات" and the numbers
      are the true all-time totals. (TC-045)
- [ ] **Server-side aggregation (BUG-020):** open Customers as admin → totals load;
      confirm in the network tab the `customer_sales_totals` RPC is called (and the app
      still works if you temporarily drop the function → falls back to client-side).
- [ ] **Fail-closed scoping (BUG-025):** a rep/supervisor with a missing rep_id/
      supervisor_id sees **no** customers (not all).
- [ ] **Error state (BUG-026):** force a load failure (e.g., revoke select) → an error
      message shows instead of an empty/zeroed screen.
- [ ] **ABC = Segmentation grading (BUG-022):** the same customer gets the same grade
      basis in the ABC tab and the Segmentation grading tab (cumulative-sales). (TC-053)
- [ ] **Loyalty chart (BUG-007):** pick a base year ≠ 2022 → chart bars render and the
      table headers show the selected years (not 2022/2023). (TC-050)
- [ ] **Pareto null name (BUG-008):** a customer with a null name does not crash Pareto;
      the cumulative curve (Line) renders on the ComposedChart. (TC-051)
- [ ] **Analytics years (BUG-033):** year list includes 2026; loyalty compares the
      selected year vs the previous year (has data).
- [ ] Large ABC/Pareto tables cap at 200 rows with a "عرض أول 200 من N" note (BUG-020).

### C7. Segmentation import (P1)
- [ ] **Non-destructive import (BUG-001, critical):** run the bundled-JSON import →
      confirmation dialog first; it **upserts** and does **not** delete existing rows;
      re-running is idempotent. Verify row counts before/after. (TC-055)
- [ ] **Excel upload guardrails (BUG-005/026):** reject a non-Excel file and an oversized
      file; a corrupt file shows an error (no crash); a file missing the
      "رقم العميل" column shows a "no valid rows" message. (TC-057/058)

### C8. Audit (P2)
- [ ] Activity Log loads (admin only); **today-stats** are accurate even with >500 rows
      today (BUG-018). (TC-036)
- [ ] Timestamps render in the **Gregorian** calendar (BUG-032). (TC-037)
- [ ] Page views are throttled (rapid re-navigation to the same page doesn't spam
      audit_logs) (BUG-017).

### C9. Responsive / Cross-browser (P2/P3)
- [ ] Load at 375px width → mobile nav appears; tables scroll; forms usable. (TC-067)
- [ ] Smoke-test in Chrome + Firefox + Safari. (TC-068)

### C10. Email job (optional, run LAST)
- [ ] Trigger `daily-rep-email-reports` workflow with `test_recipient=<your email>` on
      staging → exactly 3 sample emails (rep, full, supervisor) to that address only.
      Do **not** run without `test_recipient` unless you intend real sends. (TC-071)

---

## PART D — Rollback plan
- [ ] **Frontend:** redeploy the previous build / revert the merge — no schema
      dependency for the UI beyond the optional RPC (client falls back).
- [ ] **RPC migration:** safe to drop if needed:
      `drop function if exists public.customer_sales_totals(text[]);`
      The app reverts to client-side aggregation automatically.
- [ ] **Other migrations:** RLS/audit changes are additive policy definitions; keep a
      DB snapshot before applying so you can restore if necessary.
- [ ] No destructive data migration is introduced by this branch.

---

## PART E — Release sign-off gate
Release to production only when:
- [ ] All **P1** items in Part C pass on staging.
- [ ] xlsx dependency upgraded and `npm audit` clean of the xlsx HIGH advisories (A4).
- [ ] `daily_entries` year/month verified (B2).
- [ ] `customer_sales_totals` deployed and confirmed, or you accept the client-side
      fallback for now.
- [ ] Email job verified in TEST mode (C10) if the daily reports are going live.

**Known non-blocking follow-ups (backlog):** broader component/E2E test coverage
(BUG-029 — infra + first test shipped), and moving the remaining Segmentation
client-side aggregation to SQL (BUG-020 covers Customers; Segmentation stats still
compute client-side).
