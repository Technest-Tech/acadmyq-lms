# Academy Management SaaS — Documentation

Multi-tenant SaaS for managing teaching academies. First vertical: Qur'an academies (1-on-1). Architecture is generalized for any academy type.

## How this documentation works

We deliver in **sprints**. We do **not** write or build everything at once — each sprint's full detail is written right before we execute it, so every sprint learns from the last and the system comes out better.

## Read in this order

1. **[`00-MASTER-SPEC.md`](./00-MASTER-SPEC.md)** — The single source of truth. Product vision, business model, domain glossary, roles, **all core domain rules (R-*)**, architecture, and canonical enums. Read this first; everything references it.

2. **[`sprints/00-ROADMAP.md`](./sprints/00-ROADMAP.md)** — The ordered list of all sprints with a one-paragraph overview each. Shows the MVP line (Sprints 0–9) and post-MVP work (10+).

3. **[`sprints/01-SPRINT-0-foundation.md`](./sprints/01-SPRINT-0-foundation.md)** — The first sprint in full detail. Also serves as the **template** for how every subsequent sprint document is structured: goal, scope, tasks, schema deltas, API surface, acceptance criteria, **test cases**, risks.

## Document conventions

- **Rule IDs** like `R-BIL-1` are defined in the Master Spec §5 and referenced by sprints and test cases. Change a rule in the Master Spec first, then ripple it outward.
- **Acceptance criteria** are `AC-<sprint>.<n>`; **test cases** are `TC-<sprint>.<n>` and map back to ACs.
- **Enums** are canonical in Master Spec §9 — use those exact names in code.

## Status of sprint detail

| Sprint | Detail written? |
|---|---|
| Roadmap (all) | ✅ overview |
| Sprint 0 — Foundation | ✅ full detail |
| Sprint 1 — Data Model & Tenancy | ✅ full detail |
| Sprint 2 — Auth, Roles & Shell | ✅ full detail |
| Sprint 3 — Academy Management | ✅ full detail |
| Sprint 4 — People (Guardians/Students/Teachers) | ✅ full detail |
| Sprint 5 — Scheduling & Sessions | ✅ full detail |
| Sprint 6 — Attendance & Custom Reports | ✅ full detail |
| Sprint 7 — Invoicing Engine | ✅ full detail |
| Sprint 8 — Payroll | ✅ full detail |
| Sprint 9 — Audit, Plan Gating & MVP Hardening | ✅ full detail |
| **— MVP COMPLETE (Sprints 0–9 all detailed) —** | ✅ |
| Sprint 10+ (post-MVP) | ⏳ write before executing |

**All nine MVP sprints are now fully detailed.** After executing Sprints 0–9, the product is sellable (see Sprint 9 §13, "Definition of Sellable").

Next action: begin execution starting at Sprint 0, **or** expand a post-MVP sprint (10 = automated WhatsApp, 11 = payment gateways, 12 = branding, 13 = self-signup, 14 = analytics) when ready.
