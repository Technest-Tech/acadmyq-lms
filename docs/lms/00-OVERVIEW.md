# 00 — Overview

## The problem

Some clients don't run a class-scheduling academy — they **sell online courses**. They need:

1. A **dashboard** to build courses (upload video, paste a YouTube link, upload audio, attach PDFs,
   author quizzes) — behind their own staff login.
2. A **public site** where their students watch those courses — branded to the academy, on the
   academy's own subdomain.
3. A way to **control who watches**: the school or a teacher generates **codes**, gives them to
   students, and a student redeems a code to unlock the course(s) it covers.

## The decision: one system, a new module

The LMS is added to the **existing platform**, not built as a separate app. The R1–R5 modules
refactor (see `docs/superadmin-modules`) already made "add a sellable module" cheap, and CRM proved
the path two weeks ago:

- **Billing is already generic over the module code.** `ModuleBilling` runs the full lifecycle
  (enable / trial / pause / end / suspend) for any module in its `MODULES` list. Adding `LMS`
  widens one enum and one check constraint; nothing else in the billing engine changes.
- **One client, one bill (M-BILL-1).** A client's modules are summed into a single invoice. An
  **LMS-only client** is just a client whose only live module is `LMS` — the platform already
  supports single-module clients (WhatsApp-only external clients, M-CLI-2).
- **Scoped suspension (M-BILL-2)** already isolates a paused/lapsed module from the rest. An LMS
  trial that lapses cuts the course dashboard without touching a MANAGEMENT client's other modules.
- **Entitlement fails closed.** `lms`-gated routes stay locked until the plan grants the capability.

A separate system would mean a second copy of auth, billing, admin oversight, RBAC, and audit to
build and keep in sync. The only thing that would have justified splitting a **frontend** off is
custom per-client domains — and we chose **subdomains**, which live inside the one Next.js app.

## Actors

| Actor | Table | Logs in where | Notes |
|---|---|---|---|
| **Super Admin** | `users` (SUPER_ADMIN) | admin panel | Enables the LMS module per client, sets the plan/trial |
| **Academy staff** | `users` (OWNER / custom roles) | `app.<platform>` dashboard | Builds courses, generates codes, sees learners — gated by `course.*` + `lms` |
| **Learner** | `learners` (**new**) | `<academy>.<platform>` public site | Self-signup; redeems codes; watches; tracked progress + certificate |

> **Learners are a new identity, separate from `students`.** Today's `students` are academy-managed
> records under `guardians`, with no login. A learner self-registers on the public site and has its
> own credentials, its own auth guard, and its own tenant-scoped table. A learner *may* later be
> reconciled to a `student` row, but that link is optional and out of scope for the first cut.

## Glossary

- **Course** — a published unit of learning: sections → lessons. Belongs to one academy.
- **Lesson** — one playable/readable item. Type ∈ `VIDEO_UPLOAD | YOUTUBE | AUDIO | PDF | TEXT | QUIZ`.
- **Media asset** — an uploaded video or audio file, transcoded and stored for on-demand playback.
- **Access code** — a redeemable string scoped to one or more courses, with an optional expiry and
  redemption cap. The academy's substitute for a paywall.
- **Enrollment** — the record that a learner may access a course (created by redeeming a code).
- **Redemption** — the act of a learner consuming a code, producing enrollment(s).

## Non-goals (first release)

- **Card payments / checkout.** Monetization is by code only. A `source_code_id` on `enrollments`
  keeps the door open to add paid checkout later without reshaping the model.
- **Custom domains.** Subdomains only (`<academy>.<platform>`). Custom domains are a later infra add.
- **DRM.** Content is protected by enrollment checks + short-lived signed URLs, not hardware DRM.
- **Live cohorts.** Courses are on-demand. A course *may* link to a live LiveKit room later, but the
  live classroom is the separate `VIDEO` module, not this one.
- **Learner ↔ student reconciliation.** Learners are standalone until a later phase asks otherwise.
