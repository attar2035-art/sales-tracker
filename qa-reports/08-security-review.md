# 08 — Security Review

Scope: authentication, authorization (RLS + app), secrets, dependencies, input
handling, edge function. Based on first-hand review of migrations, the edge function,
auth libs, and `npm audit`. Live penetration testing against the Supabase project was
**not** performed (production off-limits; no test project).

## 1. Authentication
- Supabase email/password auth. Forced first-login password change via
  `must_change_password` metadata. ✅
- **Weaknesses (BUG-034):** no email-format validation; password policy is min-6 only,
  no complexity; no current-password re-auth on change; no client-side lockout (relies
  on Supabase). Temp passwords use `Math.random()` and are shown in plaintext
  (BUG-016).

## 2. Authorization
### Database (RLS) — strong
- RLS enabled and role/region-scoped on every core table
  (`20260708190000_secure_rls_policies.sql`, `…191500`): admin full; supervisor limited
  to own reps/region; rep to own rows/region. Writes to entries/targets limited to
  admin+data_entry; reference tables and deletes admin-only. `user_roles` recursion
  fixed via `is_admin_user()` `security definer` (`…093000`). ✅ This is the real
  authorization boundary and it is well-constructed.

### Application — defense-in-depth only
- Role checks in `App.js`/pages are **UI-only**. The Supabase **publishable/anon key is
  shipped to every browser**, so a crafted client can call the REST API directly; only
  RLS stops it. This is expected for this architecture **but means UI checks are not
  security**.
- **BUG-004 (High):** a logged-in user with **no `user_roles` row** gets `role=null`,
  which **defaults to the admin nav and admin pages**. RLS still blocks the *data*, but
  privileged screens (Setup, Audit) are exposed. Fail-open default — should deny.
- **BUG-025 (Medium):** in Customers, missing `rep_id`/`supervisor_id` falls through to
  "show all" client-side (RLS backstops returned rows).

## 3. Edge function (`create-rep-account`) — good
- Verifies caller JWT (`admin.auth.getUser(jwt)`), requires `role='admin'`, validates
  email/password/rep, and deletes a newly created auth user if the role write fails. ✅
- `config.toml` sets `verify_jwt = false`, but the function performs its own JWT
  verification, so this is acceptable (note it as intentional).
- CORS `Access-Control-Allow-Origin: *` — acceptable because every request still
  requires a valid admin JWT; consider restricting to the app origin for defense-in-depth.

## 4. Secrets
- ✅ No hardcoded secrets in `src/`, `tools/`, `supabase/` (scanned). `.env` git-ignored;
  only `.env.example` placeholders committed. Report scripts validate key formats and
  refuse placeholder values.
- **BUG-031 (Low):** `build/` is committed and bakes the real Supabase **project URL**
  (public; the shipped key is the anon/publishable key). Committed build artifacts
  should be removed from VCS and built in CI/host.

## 5. Dependencies (`npm audit`) — action needed
- **BUG-005 (High):** `xlsx` (SheetJS 0.18.5) has **Prototype Pollution**
  (GHSA-4r6h-8v6p-xvw6) and **ReDoS** (GHSA-5pgg-2g8v-p4x9), **no fix in the pinned
  range**, and the app parses **user-uploaded** Excel with it (`CustomerSegmentation`).
  This is the most material security finding: untrusted input into a vulnerable parser.
  - Mitigation: upgrade to the patched SheetJS distribution (their CDN build), or move
    parsing server-side with strict validation, size caps, and row limits.
- 19 high / 5 moderate / 10 low total; most of the remainder are **dev-only**
  (`webpack-dev-server`, `sockjs`, `nth-check`, `postcss` via react-scripts) and do not
  ship to production, but keep them patched.

## 6. Input handling
- Excel/JSON import lacks schema/column validation and size/row limits (BUG-026); combined
  with the `xlsx` vulnerability this is the main untrusted-input surface.
- Numeric inputs unvalidated server-of-record side (client `min` only) (BUG-012).
- HTML in emails is escaped via `escapeHtml` in the report job. ✅

## 7. Audit trail
- `audit_logs` has admin-only read and `auth.uid()=user_id` insert check. ✅
- **BUG-017:** insert failures are swallowed and fire-and-forget calls can drop events —
  weakens the audit trail's reliability for security investigations.

## 8. Prioritized security actions
1. **P1** Patch/replace `xlsx`; validate & bound imported files (BUG-005).
2. **P1** Fail-closed on unknown/null role; never default to admin (BUG-004).
3. **P2** Strengthen password policy; CSPRNG temp passwords; mask secrets (BUG-034, BUG-016).
4. **P2** Make audit inserts detectable; consider server-side logging for security events (BUG-017).
5. **P3** Remove committed `build/`; restrict edge-function CORS origin (BUG-031).

## 9. Residual risk / not verified
RLS was reviewed statically and looks correct, but was **not executed** against a live
DB (no test project). A pre-launch task should run authenticated RLS tests per role
(TC-012–TC-015) on a staging project.
