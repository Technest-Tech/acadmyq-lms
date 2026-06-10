# Sprint Roadmap

> **How to read this:** Each sprint below has a short **overview** only. The **full detailed spec** for a sprint (tasks, schema deltas, API, acceptance criteria, and test cases) is written in its own file under `/docs/sprints/NN-*.md` **right before we start that sprint** — not all up front. This is intentional: each sprint learns from the last.

> **Dependency rule:** A sprint may not begin until its predecessors' acceptance criteria pass. Foundation sprints (0–2) are strictly sequential. Later sprints have some flexibility noted per item.

---

## Delivery philosophy

- **Walking skeleton first.** Sprints 0–2 produce a thin but *end-to-end* slice: a tenant exists, a user logs in, isolation is enforced, and one real screen works against a real database. This de-risks the architecture before we pile on features.
- **Vertical slices after.** From Sprint 3 on, each sprint delivers a complete, demoable, testable capability (schema + API + UI + tests), not a horizontal layer.
- **Every sprint ships with tests.** No sprint is "done" until its acceptance criteria and test cases pass.

---

## The MVP line

Sprints **0 through 9** constitute the **Minimum Sellable Product**. Everything from Sprint 10 onward is post-MVP enhancement. We can sell after Sprint 9.

---

## Sprint 0 — Foundation & Project Setup
**Goal:** A running, deployable skeleton with the chosen stack wired together.
**Overview:** Initialize **two projects** — a **Laravel 11 JSON API** (`apps/api`, with Sanctum installed & idle) and a **Next.js 15 + TypeScript** frontend (`apps/web`, Tailwind + shadcn/ui, next-intl with Arabic-RTL and English) — wire the Supabase Postgres (DB-only) connection, CI, linting, environment config, and deploy pipelines (Railway for Laravel, Vercel for Next.js). Establish money-as-integer and UTC-time conventions in shared utilities on both sides. Output: an empty but live decoupled app with a `GET /api/health` check, a bilingual shell, and a connected database. No business logic yet.
**MVP:** ✅ (foundation)

---

## Sprint 1 — Data Model & Multi-Tenancy Core
**Goal:** The full database schema and tenant isolation, enforced at the DB layer.
**Overview:** Translate the entity overview (Master Spec §7) into a complete PostgreSQL schema with **Laravel migrations**: academies, academy_types, users, roles/permissions, guardians, students, subscriptions, schedules, sessions, session_reports, report_field_definitions, invoices, invoice_line_items, payouts, payout_line_items, audit_log. Add `academy_id` everywhere and implement **Row-Level Security** policies. Define the tenant-context contract that the Laravel `TenantContextMiddleware` (wired in Sprint 2) uses to set `app.current_academy_id`. Laravel seeders for a demo Qur'an academy. This sprint has **no UI** beyond what's needed to prove isolation; it is the architectural backbone.
**MVP:** ✅ (foundation)

---

## Sprint 2 — Auth, Roles & App Shell
**Goal:** Real login with role-based access, and the navigable dashboard shell.
**Overview:** Wire **Laravel Sanctum** SPA cookie auth for the three roles (Super Admin, Academy Owner, Teacher); `TenantContextMiddleware` resolves the authenticated user → academy/role and sets the `app.*` GUCs that feed RLS. Build the RBAC permission checks as **Laravel Gates** (capabilities, not hardcoded roles). Convert the prototype's visual shell (sidebar, header, RTL) into the real authenticated layout, routing each role to what it's allowed to see. Output: a user can log in and land on a role-appropriate, empty-but-real dashboard.
**MVP:** ✅

---

## Sprint 3 — Academy & Academy-Type Management (Super Admin)
**Goal:** Super Admin can onboard and configure academies.
**Overview:** CRUD for academies (create, suspend, edit), assignment of an Academy Type, plan/tier selection, currency and timezone settings, and the reserved branding fields (logo/name/subdomain — stored, not yet surfaced). Includes the academy-type record that will later drive report-field templates. Output: you can create "Noor Al-Qur'an Academy" from the Super Admin panel.
**MVP:** ✅

---

## Sprint 4 — People: Guardians, Students & Teachers
**Goal:** Manage the human entities of an academy.
**Overview:** Academy Owner CRUD for Guardians (with multiple children), Students (name, WhatsApp, country, currency, status, custom fields), and Teachers (name, phone, specialization, availability, session rate/currency). Model the Student↔Teacher active assignment with **history** (teacher can change over time). Modern data tables with search, filters, sorting, pagination, and row actions (the table upgrade the prototype hinted at). Output: a populated academy with real people.
**MVP:** ✅

---

## Sprint 5 — Scheduling & Session Generation
**Goal:** Recurring weekly schedules that generate concrete sessions, plus a calendar.
**Overview:** Build the recurring schedule editor (per-weekday times), the idempotent **session generator** (rolling window), and per-session cancel/reschedule that does **not** disturb the series (R-SCH-2/3). Teacher calendar view (weekly). This is algorithmically the trickiest sprint; it gets extra care and a dedicated test suite around recurrence edge cases (DST, schedule edits, partial weeks).
**MVP:** ✅

---

## Sprint 6 — Attendance & Custom Session Reports
**Goal:** The heart of the system — mark attendance and file structured reports.
**Overview:** Implement the session status workflow (the five billable/non-billable outcomes), the **dynamic custom-report-field** engine (definitions per academy type + values per session), and the attendance/report entry screen for Teacher and Owner. Marking a billable status fires the billing hook (handed off to Sprint 7). WhatsApp report sending is **manual** in MVP (compose + copy/open), automation deferred. Output: a teacher completes a lesson, files the surah-from/to report, and the session is correctly classified.
**MVP:** ✅

---

## Sprint 7 — Invoicing Engine
**Goal:** Automatic, incremental, immutable monthly invoices.
**Overview:** Build the open-invoice accumulation (billable session → line item with **price snapshot**), per-academy grouping config (per-guardian vs per-student), automatic month-end close (scheduled job) making invoices immutable, the **public invoice page** at an unguessable link, the WhatsApp-sendable link, the **payment button placeholder**, and **mark-paid-outside-system** with method/reason. Multi-currency, no FX. This sprint leans heavily on the domain rules in Master Spec §5.5 and needs exhaustive test cases.
**MVP:** ✅

---

## Sprint 8 — Payroll
**Goal:** Compute teacher payouts from delivered sessions.
**Overview:** Aggregate `ATTENDED` sessions × teacher rate per period, per currency, into payout statements with line items; teacher can view their own payout; owner sees all and an academy profit summary (revenue − payouts). Output: month-end payout statement per teacher.
**MVP:** ✅

---

## Sprint 9 — Audit Log, Plans Enforcement & MVP Hardening
**Goal:** Make it sellable: traceable, plan-gated, and robust.
**Overview:** Implement the append-only **audit log** across all sensitive mutations (Master Spec §5.8), enforce **plan/tier feature gating and add-ons** (the billing model that makes you money), add empty states, error states, and the bilingual polish pass, plus a security review of RLS and the public invoice pages. Output: the Minimum Sellable Product. **You can take payment from your first academy after this.**
**MVP:** ✅ (last MVP sprint)

---

## Sprint 10 — Automated WhatsApp Delivery *(post-MVP)*
**Goal:** Auto-send session reports and invoice links via WhatsApp.
**Overview:** Integrate a WhatsApp Business API provider; template management; per-academy choice of auto-send vs teacher-confirm-send; delivery logs. This was deliberately deferred — MVP records and sends manually first.
**MVP:** ➖ (next)

---

## Sprint 11 — Payment Gateways *(post-MVP)*
**Goal:** Real online payment on the public invoice page.
**Overview:** Per-academy payment gateway configuration (the architecture already reserved this), checkout on the public invoice page, webhook reconciliation that flips invoices to PAID automatically. Region-appropriate providers.
**MVP:** ➖

---

## Sprint 12 — Per-Academy Branding & Subdomains *(post-MVP)*
**Goal:** Each academy gets its own branded entry point.
**Overview:** Activate the reserved branding fields: logos, custom academy name in UI, and per-academy subdomains (academy.platform.com), later custom domains. No migration needed — the fields were reserved in Sprint 3.
**MVP:** ➖

---

## Sprint 13 — Self-Service Academy Signup *(post-MVP)*
**Goal:** Academies onboard themselves.
**Overview:** A public signup flow, trial plans, guided setup wizard (academy type, first teacher, first student), and automated provisioning — replacing manual Super-Admin onboarding.
**MVP:** ➖

---

## Sprint 14 — Analytics & Reporting *(post-MVP)*
**Goal:** Insight dashboards for owners and the platform.
**Overview:** Cross-academy KPIs for Super Admin (MRR, churn, active students), per-academy operational dashboards (attendance trends, revenue, teacher utilization), exportable reports.
**MVP:** ➖

---

## Backlog / Future candidates
- Student & guardian portals (logins, self-rescheduling).
- Group/halaqa teaching mode (current model is 1-on-1).
- Mobile apps.
- Automated FX conversion & consolidated multi-currency reporting.
- Qur'an-specific progress tracking module (memorization map, ijazah/sanad).

---

## Sprint sizing & sequencing notes
- **0,1,2 are strictly sequential** and form the walking skeleton — do not parallelize.
- **5 (scheduling) and 6 (attendance)** are the highest-risk logic; budget extra time and tests.
- **7 (invoicing)** depends on 6; **8 (payroll)** depends on 6; 7 and 8 can overlap once 6 is done.
- **9** must be last in the MVP — it hardens everything before sale.
