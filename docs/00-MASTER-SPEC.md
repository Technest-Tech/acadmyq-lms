# Academy Management SaaS — Master Product & Technical Specification

> **Document status:** Foundational / Living document
> **Version:** 1.0
> **Last updated:** June 2026
> **Audience:** Founders, product, engineering, QA

This is the single source of truth for the platform. Every sprint document references the sections here. When a business rule changes, it changes **here first**, then ripples into the affected sprint.

---

## 1. Product Vision

A multi-tenant SaaS platform for managing teaching academies. The first vertical is **Qur'an academies** (1-on-1 instruction), but the data model and architecture are **generalized** so that any academy type (languages, tutoring, music, etc.) can be onboarded later **without re-architecture** — only configuration and new "academy type" records.

### 1.1 Core value proposition
The platform replaces the manual, error-prone workflow most small academies run on (paper schedules, WhatsApp reports typed by hand, informal payment tracking) with a single structured system that:

- Tracks every student, teacher, schedule, and session in one place.
- Turns the per-session report into a **structured, archived record** (instead of a one-off WhatsApp message).
- Builds invoices **automatically and incrementally** from attended sessions.
- Computes teacher payouts from the same session data.
- Gives the platform owner a flexible control panel over every academy.

### 1.2 What we are NOT building (initially)
- We are **not** a payment processor. The platform owner charges **academies** a subscription. Student-to-academy payments are *recorded*, with a payment link placeholder; real payment gateways come later.
- We are **not** building self-service academy signup yet. The Super Admin onboards academies manually in the MVP.
- We are **not** giving students or guardians a login in the MVP. Guardians **receive** WhatsApp reports and invoice links; they are recipients, not users.

---

## 2. Business Model

| Aspect | Decision |
|---|---|
| Revenue source | Platform charges **academies** via subscription **plans/tiers** |
| Plans | Tiered (e.g. Basic / Professional), each unlocking a feature set |
| Add-ons | Extra features available as paid add-ons on top of a plan |
| Student payments | Academy collects from students/guardians; platform only **records** these (gateways are a future phase) |
| Why this model | Removes payment-gateway, tax, and payout complexity from the MVP; we sell software, not a wallet |

---

## 3. Domain Glossary (Ubiquitous Language)

These terms are used consistently across code, database, and UI.

| Term | Definition |
|---|---|
| **Platform** | The whole SaaS product. Owned/operated by the **Super Admin**. |
| **Academy** | A tenant. An independent teaching organization. All data is isolated per academy. |
| **Academy Type** | A configurable category (Qur'an, Languages…) that drives which custom report fields and defaults apply. Stored as **data, not code**. |
| **Super Admin** | The platform owner (you). Sees and manages all academies. |
| **Academy Owner** | The admin of a single academy. Manages that academy's teachers, students, schedules, invoices, payroll. |
| **Teacher** | Delivers 1-on-1 sessions, marks attendance, writes session reports. |
| **Guardian** | A parent/payer. Owns one or more **Students**. Receives reports & invoices. **No login in MVP.** |
| **Student** | The learner. Belongs to a Guardian. Has a price, a plan, and (currently) one active Teacher. |
| **Subscription** | A student's enrollment terms: plan (e.g. 8 sessions/month), agreed price, currency, start date. Price is **per-student** (negotiated individually). |
| **Schedule (Recurring)** | A weekly recurring template of when a student's sessions happen. Can vary per weekday. Editing/deleting it affects future generated sessions. |
| **Session** | A single concrete lesson occurrence, generated from the schedule. Has a **status** that drives billing. |
| **Attendance / Report** | The act of marking a session's status + filling the (academy-type-specific) report fields. |
| **Invoice** | A monthly, per-guardian (or per-student) document built from billable sessions. **Immutable once closed.** |
| **Invoice Line Item** | One billable session represented on an invoice, with the price snapshotted at billing time. |
| **Payout** | A teacher's monthly earnings = sum of (delivered sessions × session rate). |
| **Audit Log** | An append-only record of who did what and when, for sensitive operations. |

---

## 4. Actors & Roles (RBAC)

The MVP has three login roles, but the permission system is **flexible (role-based)** so new roles (e.g. Academy Supervisor) can be added from configuration later.

| Role | Scope | Key permissions |
|---|---|---|
| **Super Admin** | Whole platform | Create/suspend academies, manage plans & add-ons, view cross-academy analytics, impersonate for support |
| **Academy Owner** | Single academy | Full CRUD on that academy's teachers, students, guardians, schedules, sessions, invoices, payroll, report-field config |
| **Teacher** | Own students/sessions | View own schedule (calendar), mark attendance, write/submit reports, view own payout |

**Design note:** Implement as **RBAC** (Roles → Permissions). Even though only 3 roles exist now, model permissions as discrete capabilities so adding a "Supervisor" role later is a data change, not a code change.

---

## 5. Core Domain Rules

These are the non-negotiable business rules. **Test cases must cover every one of them.**

### 5.1 Tenancy & isolation
- **R-TEN-1:** Every domain row carries an `academy_id`. No query may ever return rows across academies for a non-Super-Admin user.
- **R-TEN-2:** Isolation is enforced at the **database layer** (PostgreSQL Row-Level Security), not only in application code.
- **R-TEN-3:** Super Admin can cross tenancy boundaries explicitly and only through audited, intentional actions.

### 5.2 Students, Guardians & Teachers
- **R-STU-1:** A Guardian may have **multiple** Students (children). Each child can have an independent schedule and price.
- **R-STU-2:** An adult solo student may be modeled as their own Guardian (Guardian and Student can be the same person conceptually).
- **R-STU-3:** A Student has **one active Teacher** at a time, but the teacher **can change over time**; history is preserved.
- **R-STU-4:** Student price and currency are stored on the **Subscription** (per-student), not on a plan.

### 5.3 Scheduling & Sessions
- **R-SCH-1:** A Schedule is a **weekly recurring** template; times may differ per weekday.
- **R-SCH-2:** Individual sessions can be **cancelled** or **rescheduled** without affecting the rest of the recurring series.
- **R-SCH-3:** Editing or deleting the recurring Schedule affects **future** sessions only; already-generated past sessions and their reports are preserved with their original dates.
- **R-SCH-4:** Sessions are generated from schedules for a rolling window (e.g. the current + next month).

### 5.4 Attendance → Billing (the heart of the system)
Each Session has exactly one status. The status determines whether it is **billable** to the student:

| Session status | Billable to student? | Counts toward teacher payout? |
|---|---|---|
| `ATTENDED` | ✅ Yes | ✅ Yes |
| `ABSENT_UNEXCUSED` (no prior notice) | ✅ Yes | ❌ No |
| `ABSENT_EXCUSED` (student gave prior notice) | ❌ No | ❌ No |
| `CANCELLED_BY_TEACHER` | ❌ No | ❌ No |
| `CANCELLED_BY_STUDENT` (advance notice) | ❌ No | ❌ No |

- **R-BIL-1:** Marking a session billable **automatically adds an invoice line item** to the student's/guardian's **open** invoice for that month.
- **R-BIL-2:** A teacher payout line is created only when the session is `ATTENDED`.
- **R-BIL-3:** Each session report uses the academy's **custom report fields** (see 5.6).
- **R-BIL-4:** Attendance + report can be entered by the **Teacher** or by academy **support staff** (Academy Owner role covers this in MVP).

### 5.5 Invoicing
- **R-INV-1:** An invoice accumulates line items throughout the month (status `OPEN`).
- **R-INV-2:** Invoices **close automatically at month end** → status `CLOSED`.
- **R-INV-3:** A **closed invoice is immutable**: it snapshots all session details and prices. Later price changes do **not** affect it.
- **R-INV-4:** Invoice grouping is **configurable per academy**: either **one invoice per guardian** (aggregating all their children) or **one invoice per student**.
- **R-INV-5:** Every invoice has a **public page** at a unique, unguessable link. The link can be sent via WhatsApp. The page shows full session details and a **payment button** (gateway is a future phase; placeholder now).
- **R-INV-6:** An invoice can be marked **"Paid outside the system"** with a recorded reason/method (e.g. cash, bank transfer).
- **R-INV-7:** Multi-currency: each invoice is denominated in the student's/academy's currency. **No automatic FX conversion** in MVP; currencies are independent.

### 5.6 Custom report fields
- **R-CRF-1:** Each **academy** designs its own session-report fields (the Qur'an academy uses surah-from/to, tajweed rating, next assignment, notes; a language academy would define different ones).
- **R-CRF-2:** Field definitions support types: text, textarea, number, select (options), rating.
- **R-CRF-3:** Report values are stored against the session and rendered dynamically in the UI.

### 5.7 Payroll
- **R-PAY-1:** Teacher payout = Σ (delivered sessions × that teacher's session rate) for the period.
- **R-PAY-2:** Only `ATTENDED` sessions count (see 5.4).
- **R-PAY-3:** Payout is denominated in the teacher's configured currency.

### 5.8 Audit
- **R-AUD-1:** All sensitive mutations (price changes, invoice close, mark-paid, schedule delete, session status change, role changes) write an **append-only** audit entry: actor, action, entity, before/after, timestamp.
- **R-AUD-2:** Audit entries are scoped per academy and visible to the Academy Owner; Super Admin sees all.

### 5.9 Localization
- **R-LOC-1:** Bilingual from day one: **Arabic (RTL, primary)** and **English (LTR)**.
- **R-LOC-2:** All user-facing strings are externalized (i18n), no hardcoded copy.

### 5.10 Branding (future-proofing)
- **R-BRA-1:** MVP uses a single shared URL/login. **However**, the data model reserves space for per-academy branding (logo, name, subdomain) so it can be enabled later without migration pain.

---

## 6. High-Level Architecture

### 6.1 Multi-tenancy model
**Shared database + Row-Level Security (RLS)** via an `academy_id` column on every tenant-scoped table.

- **Why:** Cheapest to operate, easiest to maintain, scales well for early-stage. We avoid database-per-tenant until we hit large enterprise customers that demand hard isolation.
- **Enforcement:** PostgreSQL RLS policies keyed on session variables (`app.current_user_id`, `app.current_academy_id`, `app.current_role`) set per request after auth (see §6.3).

### 6.2 Recommended stack

| Layer | Choice | Rationale |
|---|---|---|
| Frontend | **Next.js 15 (App Router) + React + TypeScript** | Modern, fast, strong ecosystem, SSR/SEO for public invoice pages |
| Styling/UI | **Tailwind CSS + shadcn/ui** | Modern, flexible, accessible, fast to build a polished UI |
| Backend | **Laravel 11 (PHP) — JSON REST API** | All business logic isolated in a dedicated backend; fully decoupled from the frontend |
| Database | **PostgreSQL** (via Supabase, DB-only) | First-class RLS, robust, generous free tier |
| Auth | **Laravel Sanctum** (SPA auth via CSRF cookies) | Stateful SPA auth; RBAC enforced via Laravel Gates & Policies |
| Hosting | **Vercel** (Next.js frontend) + **Railway** (Laravel API; Laravel Forge as an alternative) + **Supabase** (PostgreSQL, DB-only) | Decoupled deploy; each layer scales independently |
| i18n | **next-intl** (frontend) | Mature RTL/LTR + message catalogs |

> **Stack is a recommendation, not dogma.** It's pinned here so all sprints assume the same primitives. Any change is made in this section first.

### 6.3 Key cross-cutting concerns
- **Tenant context middleware:** a Laravel middleware that resolves `academy_id` from the authenticated user (via Sanctum) and sets the three `app.*` PostgreSQL session variables (`current_user_id`, `current_academy_id`, `current_role`) per request before any query runs.
- **Money handling:** store amounts as **integer minor units** (e.g. piastres/cents) + an ISO currency code. Never use floats for money.
- **Time/scheduling:** store timestamps in **UTC**; render in the academy's/teacher's timezone. Recurring schedules stored as rules, sessions stored as concrete UTC datetimes.
- **Idempotency:** session generation and invoice line creation must be idempotent (re-running must not duplicate).
- **Soft deletes** for domain entities where history matters (students, schedules); **append-only** for audit and closed invoices.

---

## 7. Entity Overview (conceptual — full schema in Sprint 1)

```
Platform
 └── Plan / AddOn
 └── Academy (tenant) ──────────────────────────────────────┐
       ├── AcademyType (config: report field template)       │ all rows
       ├── User (Owner | Teacher) + Role/Permission          │ carry
       ├── Guardian ── Student ── Subscription (price,plan)   │ academy_id
       │                  └── Schedule (recurring) ── Session │
       │                                                │     │
       │                              SessionReport (custom fields)
       ├── Invoice ── InvoiceLineItem (snapshot)  ◄── billable Session
       ├── Payout  ── PayoutLineItem              ◄── attended Session
       └── AuditLog (append-only)
```

---

## 8. Documentation & Delivery Method

- We deliver in **sprints**. Each sprint has its own document under `/docs/sprints/`.
- **Not everything is written or built at once.** We write a sprint's full detail **just before executing it**, expanding from its overview in the roadmap. This lets each sprint absorb learnings from the previous one and produces a better system.
- Every sprint document contains: goal, scope (in/out), detailed tasks, data/schema deltas, API surface, acceptance criteria, and **test cases**.
- The **Sprint Roadmap** (`/docs/sprints/00-ROADMAP.md`) holds the ordered list and a one-paragraph overview of each sprint.

---

## 9. Glossary of Statuses (enums) — canonical list

```
SessionStatus:   SCHEDULED | ATTENDED | ABSENT_UNEXCUSED | ABSENT_EXCUSED
                 | CANCELLED_BY_TEACHER | CANCELLED_BY_STUDENT | RESCHEDULED
InvoiceStatus:   OPEN | CLOSED | PAID | PARTIALLY_PAID | VOID
PaymentMethod:   CASH | BANK_TRANSFER | GATEWAY | OTHER
AcademyStatus:   ACTIVE | SUSPENDED | TRIAL
SubscriptionStatus: ACTIVE | PAUSED | ENDED
ReportFieldType: TEXT | TEXTAREA | NUMBER | SELECT | RATING
AppRole:         SUPER_ADMIN | ACADEMY_OWNER | TEACHER
InvoiceGrouping: PER_GUARDIAN | PER_STUDENT
```

> This enum list is canonical. Sprints reference these names exactly.
