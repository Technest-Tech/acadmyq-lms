# LMS module — online courses for academies

The LMS is the platform's **5th sellable module** (after `MANAGEMENT`, `WHATSAPP`, `VIDEO`, `CRM`).
It lets an academy publish **on-demand courses** their students watch from a **branded per-academy
subdomain**. Access is granted by **redemption codes** the school/teacher generates and hands out —
no card payments, no checkout.

It plugs into the existing module machinery exactly like CRM did: one client, one bill; a per-module
subscription that can trial, pause, and suspend on its own; capability-gated routes that fail closed.

## The two surfaces

| Surface | Who | Where | Auth |
|---|---|---|---|
| **Course dashboard** | academy staff (owner / delegated) | `app.<platform>/courses` — inside the existing Next.js app | staff `users` + `course.*` RBAC + `lms` entitlement |
| **Learner site** | students (self-signup) | `<academy>.<platform>` — public, tenant-resolved by subdomain | new `learners` guard |

The dashboard is the easy half (a module route like `(app)/crm`). The learner site + the learner
identity + on-demand video delivery are the genuinely new pieces this module adds.

## Documents

| Doc | Contents |
|---|---|
| [00-OVERVIEW.md](00-OVERVIEW.md) | Vision, actors, glossary, the one-client-one-bill fit, non-goals |
| [01-DATA-MODEL.md](01-DATA-MODEL.md) | Every table, phase by phase, with RLS + FK rules |
| [02-LEARNER-AUTH-AND-SUBDOMAINS.md](02-LEARNER-AUTH-AND-SUBDOMAINS.md) | The `learners` actor, its auth guard, subdomain → academy resolution |
| [03-ACCESS-CODES-AND-ENROLLMENT.md](03-ACCESS-CODES-AND-ENROLLMENT.md) | Code generation, redemption, the enrollment gate |
| [04-CONTENT-VOD-AND-QUIZZES.md](04-CONTENT-VOD-AND-QUIZZES.md) | Lesson types (video/YouTube/audio/PDF/quiz), the VOD pipeline, progress, certificates |
| [05-BILLING-ENTITLEMENT-PERMISSIONS.md](05-BILLING-ENTITLEMENT-PERMISSIONS.md) | Module registration, plan, `lms` capability, `course.*` permissions — mirroring CRM |
| [06-FRONTEND-SURFACES.md](06-FRONTEND-SURFACES.md) | Dashboard pages + learner-site pages |
| [07-ROADMAP.md](07-ROADMAP.md) | The four phases, each an independently shippable slice |
| [08-SUPERADMIN-OVERSIGHT.md](08-SUPERADMIN-OVERSIGHT.md) | `/admin/lms` — the LMS client roster, per-client statistics, and the four platform controls |
| [09-PUBLIC-SITE.md](09-PUBLIC-SITE.md) | The shared learner-site template + the per-client content profile the client edits at `/lms/site` |
| [10-ORDERS-CHECKOUT-AND-PAYMENTS.md](10-ORDERS-CHECKOUT-AND-PAYMENTS.md) | The shop: orders, the InstaPay / wallet / bank checkout, transfer receipts, and the client's sales desk |
| [11-DIGITAL-PRODUCTS.md](11-DIGITAL-PRODUCTS.md) | Selling books & PDFs alongside the courses — the file bundle, the free sample, and the shared order queue |

## Status

- **Phase 1 (module + course builder)** — in progress. Module registration + course data model land first.
- Phases 2–4 specced here, not yet built.

See [07-ROADMAP.md](07-ROADMAP.md) for the phase breakdown and acceptance criteria.
