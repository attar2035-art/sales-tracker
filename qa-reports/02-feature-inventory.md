# 02 — Feature Inventory
Complete list of Modules, Features, and User Flows (derived from first-hand code reading of every page/component/lib + backend).

## Modules & Features

### M1 — Authentication & Session
| Feature | File | Roles | Notes |
|---|---|---|---|
| Login (email/password) | `pages/Login.js`, `lib/auth.js` | all (pre-auth) | Enter-to-submit; generic error text |
| Session bootstrap & auth-state subscription | `App.js`, `lib/auth.js` | all | `getCurrentUser` reads `user_roles` |
| Forced password change (first login) | `App.js`, `pages/ChangePassword.js` | all | `must_change_password` metadata flag |
| Change password | `pages/ChangePassword.js`, `lib/auth.js` | all | min 6 chars, match confirm, no re-auth |
| Logout | `App.js`, `lib/auth.js` | all | audit-logged |

### M2 — Navigation & Authorization
| Feature | File | Roles |
|---|---|---|
| Role-based sidebar + mobile nav | `App.js` | all |
| Client-side page router (`renderPage`) | `App.js` | all |
| Page-view audit logging | `App.js`, `lib/audit.js` | all |

### M3 — Daily Entry
| Feature | File | Roles |
|---|---|---|
| Select rep + date (Friday blocked) | `pages/DailyEntry.js` | data_entry, admin |
| Enter daily metrics (6 sections: sales/collection, visits, customers, products, operations, notes) | `pages/DailyEntry.js` | data_entry, admin |
| Live-computed lost-photos & remaining-overdue | `pages/DailyEntry.js` | — |
| Upsert one row per rep/date | `pages/DailyEntry.js` | data_entry, admin |

### M4 — Monthly Targets
| Feature | File | Roles |
|---|---|---|
| Select month/year | `pages/Targets.js` | data_entry, admin |
| Set/edit 11 target metrics per rep | `pages/Targets.js` | data_entry, admin |
| Target inheritance from prior months | `lib/targets.js` | — |

### M5 — Admin Setup
| Feature | File | Roles |
|---|---|---|
| CRUD regions / supervisors / representatives | `pages/Setup.js` | admin |
| Toggle rep active / edit rep | `pages/Setup.js` | admin |
| Rep handover (create + deactivate + split target) | `pages/Setup.js` | admin |
| Create rep login account (temp password) | `pages/Setup.js`, `lib/auth.js`, edge fn | admin |

### M6 — Dashboards & Reporting (in-app)
| Feature | File | Roles |
|---|---|---|
| Admin/supervisor KPI dashboard + charts + leaderboard | `pages/Dashboard.js` | admin, supervisor |
| Per-rep operating dashboard ("تقريري") + AI smart goals | `pages/RepDashboard.js` | rep |
| Rep details viewer (per rep, circle meters, month summary) | `pages/RepDetails.js` | admin, supervisor |
| 6-month history, region insights | `pages/RepDashboard.js` | rep |

### M7 — Customers & Analytics
| Feature | File | Roles |
|---|---|---|
| Customer list (search/filter/sort/paginate) | `pages/Customers.js` | admin, supervisor, rep |
| Customer detail (per-product sales) | `pages/CustomerDetails.js` | admin, supervisor, rep |
| Customer analytics container (year + 3 tabs) | `components/CustomerAnalytics.jsx` | admin, supervisor, rep |
| ABC analysis (cumulative sales) | `components/CustomerABCAnalysis.jsx` | — |
| Pareto 80/20 analysis | `components/CustomerParetoAnalysis.jsx` | — |
| Loyalty (two-year comparison) | `components/CustomerLoyaltyAnalysis.jsx` | — |
| Customer segmentation + bulk import (JSON + Excel) | `pages/CustomerSegmentation.js` | admin, supervisor |

### M8 — Audit Log
| Feature | File | Roles |
|---|---|---|
| Audit viewer (stats/search/filter, last 500) | `pages/ActivityLog.js` | admin |

### M9 — Automated Email Reports (backend)
| Feature | File | Recipients |
|---|---|---|
| Daily rep report (yesterday + full month breakdown) | `tools/send-daily-rep-reports.js` | rep |
| Daily full summary (all reps) | same | admin, data_entry |
| Daily team summary | same | supervisor |
| Test-recipient mode | same | single test email |
| Rep-account creation (GitHub workflow) | `tools/create-rep-account.js`, workflow | admin-triggered |
| Production health check | `tools/production-health-check.js`, workflow | scheduled |

### M10 — Backend / Data Layer
| Feature | File |
|---|---|
| Supabase client | `lib/supabase.js` |
| RLS policies (role/region scoped) | `supabase/migrations/*.sql` |
| `create-rep-account` edge function (admin-guarded) | `supabase/functions/create-rep-account/index.ts` |
| Shared calc libs (helpers, targets, repMetrics, reportMetrics) | `lib/*.js` |

## Primary User Flows
1. **Login → forced password change → role landing page.**
2. **Data entry:** login → Daily Entry → pick rep/date → fill metrics → save (upsert).
3. **Targets:** login → Targets → pick month → per-rep set 11 targets → save.
4. **Admin setup:** manage regions/supervisors/reps → create rep login → (optional) handover rep.
5. **Rep self-service:** login → "تقريري" dashboard → view achievement, smart goals, 6-month history.
6. **Supervisor/Admin monitoring:** Dashboard → filter supervisor/region/month → KPIs, leaderboard, rep tables; Rep Details drill-down.
7. **Customer analysis:** Customers list → Customer detail; Analytics (ABC/Pareto/Loyalty); Segmentation + import.
8. **Audit:** Admin → Activity Log → search/filter events.
9. **Automated:** daily 05:00 UTC job emails rep/admin/supervisor reports via Resend.

**Counts:** 10 modules · ~40 discrete features · 9 primary user flows · 4 roles · 4 CI workflows.
