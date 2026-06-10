# Sprint 4 — People: Guardians, Students & Teachers

> **Status:** Detailed / Ready to execute
> **Depends on:** Sprint 1 (guardians/students/teachers/subscriptions/student_teacher_assignments schema), Sprint 2 (Sanctum auth, Gates/`Gate::authorize`, `TenantContextMiddleware`, shell), Sprint 3 (a configured academy to put people into)
> **Blocks:** Sprint 5 (schedules need students + teachers), Sprint 6 (reports need students + teachers), Sprint 7 (invoices need guardians + subscription prices), Sprint 8 (payroll needs teacher rates)
> **References:** Master Spec §3 (glossary), §5.2 (R-STU-1..4), §5.7 (R-PAY rates), §6.3 (money/time); Sprint 1 §6.3 (people tables), §6.4 (subscriptions); Sprint 3 (academy config, currency defaults)

---

## 1. Goal

Populate an academy with its people: **guardians** (payers who may own several children), **students** (each with a per-student subscription price and an active teacher), and **teachers** (with a session rate that drives payroll). Model the **teacher-change-with-history** relationship correctly, and deliver the **modern data tables** (search, filters, sorting, pagination, row actions) that the rest of the product reuses.

The deliverable is judged on: *can an Academy Owner create a guardian with two children, give each child its own price and teacher, later reassign one child to a different teacher without losing history, and find any of them quickly via a fast, filterable table?*

## 2. Scope

### In scope
- **Guardian CRUD**: name, WhatsApp phone, country, currency (defaulting to academy currency). A guardian owns 1..N students (R-STU-1).
- **Student CRUD**: name, optional own WhatsApp, country, operational status; belongs to exactly one guardian; the **adult-solo** case where guardian and student are the same person conceptually (R-STU-2).
- **Subscription** (per student): plan label, sessions/month quota, **per-student price + currency + price basis** (R-STU-4), start date, status (ACTIVE/PAUSED/ENDED). One active subscription per student at a time.
- **Teacher CRUD**: name, phone, specialization, **session rate + currency** (R-PAY-1/3), timezone override, availability (the weekly windows they can teach — used as guidance by Sprint 5 scheduling).
- **Active teacher assignment** per student with **full history** (R-STU-3): assign, reassign (closes the current, opens a new), view history. Exactly one active assignment enforced (Sprint 1 partial unique index).
- **The reusable DataTable**: server-side search, column filters, multi-column sort, pagination, row actions (edit, deactivate, view), empty/loading/error states, bilingual + RTL, mobile-responsive. Replaces the prototype's static tables.
- Soft-delete (deactivate) for guardians/students/teachers; **no hard delete** (history preservation).
- Audit entries for create/update/deactivate of each entity, price changes, and teacher reassignments.

### Out of scope (deferred)
- Schedules and sessions (Sprint 5) — we set the teacher *rate* and *availability* here; we do not generate sessions.
- Attendance/reports (Sprint 6).
- Invoices/payroll computation (Sprints 7/8) — we store the price and rate; we do not compute money documents yet.
- Student/guardian logins or portals (post-MVP) — guardians remain non-users (Master Spec §1.2).
- Bulk import / CSV (post-MVP backlog).
- Teacher availability *enforcement* during scheduling (Sprint 5 decides how strictly to use it).

---

## 3. Design decisions (locked for this sprint)

1. **Guardian is the billing anchor; student is the learner.** Every student has a guardian. For an adult solo student, the system still creates a guardian record (can be auto-derived from the student's own details) so invoicing (Sprint 7) has a consistent anchor regardless of grouping mode (R-STU-2).
2. **Price lives on the subscription, not the student and not a plan** (R-STU-4). A student's price is per-student and negotiated; changing it is an audited event and (per Master Spec R-INV-3) never touches already-closed invoices.
3. **Teacher change = close + open, never overwrite** (R-STU-3). Reassignment sets `ended_at` on the current `student_teacher_assignment` and inserts a new active one. History is queryable. The partial unique index (Sprint 1) guarantees only one active assignment.
4. **Currency defaults cascade but are overridable.** New guardian/student/subscription/teacher currency defaults to the academy `default_currency` (Sprint 3), but can differ per entity (R-INV-7 multi-currency). No FX conversion.
5. **Deactivate, don't delete.** Soft-delete via `deleted_at`. Deactivated people disappear from default table views (filterable to show them) and cannot be assigned new sessions, but all historical references (past sessions, closed invoices, payouts) remain intact.
6. **One reusable DataTable, server-driven.** Search/filter/sort/paginate happen in the query (within RLS), not in the browser, so it scales past a handful of rows. Every list screen in later sprints uses this component.
7. **Phone numbers stored canonical (E.164).** WhatsApp numbers normalized on input so Sprint 6/10 messaging and Sprint 7 invoice links are reliable.

---

## 4. Domain relationships (recap, enforced here)

```
Guardian (1) ──< Student (N)            R-STU-1   (a guardian has many children)
Student  (1) ──  Subscription (1 active) R-STU-4   (price + currency live here)
Student  (1) ──< StudentTeacherAssignment (1 active, N historical)  R-STU-3
Teacher  (1) ──< StudentTeacherAssignment (N)
```
- Adult solo student (R-STU-2): one Guardian whose details mirror the Student; still a distinct guardian row so billing is uniform.
- All rows carry `academy_id`; all access is RLS-scoped (Sprint 1) and permission-gated (Sprint 2).

---

## 5. User flows

### 5.1 Add a guardian with two children (the canonical case)
```
Owner → Guardians → "Add guardian"
  guardian: name, WhatsApp (E.164), country, currency (default EGP)
  → save → guardian detail
  → "Add child" ×2:
      child A: name, then subscription (8/month, 100 EGP, PER_SESSION, start today), assign Teacher 1
      child B: name, then subscription (12/month, 90 EGP, PER_SESSION), assign Teacher 2
  result: 1 guardian, 2 students, 2 active subscriptions, 2 active teacher assignments
```

### 5.2 Reassign a student's teacher (history-preserving)
```
Student detail → Teacher → "Change teacher"
  pick new teacher (+ effective date)
  → system: close current assignment (ended_at = effective date),
            open new active assignment (started_at = effective date)
  → audit: student.teacher_reassigned (from → to)
  → history tab shows both assignments
```

### 5.3 Change a student's price
```
Student detail → Subscription → "Edit price"
  new price + currency (or basis)
  → audit: subscription.price_changed (before → after)
  note: applies to FUTURE billing only; open invoice recalculates from change date,
        closed invoices are immutable (R-INV-3) — enforced in Sprint 7, respected here by not back-dating
```

### 5.4 Find people (the DataTable in action)
```
Students table:
  search: name / guardian / phone
  filters: teacher, subscription status, attendance band (later), active/inactive
  sort: name, start date, price
  paginate: 25/page, server-side
  row actions: view, edit, change teacher, deactivate
```

---

## 6. The reusable DataTable (component contract)

A single component reused by every list screen from here on. Server-driven.

### 6.1 Capabilities
- **Search:** debounced free-text across configured columns (ILIKE within RLS scope).
- **Filters:** typed per column (enum select, boolean, date range, FK picker).
- **Sort:** multi-column, stable, server-side (`order by` with safe allowlist of sortable columns — never raw user input into SQL).
- **Pagination:** keyset/cursor preferred for large sets; offset acceptable for MVP volumes. Page size selectable.
- **Row actions:** permission-aware (an action hidden when the user lacks the capability, per the `permissions[]` from `/api/auth/me`; the server still enforces it with `Gate::authorize`).
- **States:** loading (skeleton rows), empty (actionable copy, e.g. "No students yet — add your first"), error (retry).
- **i18n/RTL:** column headers and actions localized; layout mirrors in RTL; numbers in Arabic-Indic when locale=ar.
- **Responsive:** collapses to stacked cards under ~640px.

### 6.2 Query contract (server — Laravel controller + Eloquent/query builder)
```
GET /api/{entity}?search=&filter[...]=&sort=&cursor=|page=&pageSize=
  // RLS already scopes by academy; academy_id is implicit (set by TenantContextMiddleware)
  // sort/filter keys validated against a per-entity allowlist
  → { rows, total?, nextCursor? }
```
- All queries run through `TenantContextMiddleware` (Sprint 2), so RLS scopes them automatically. No raw column names from the client reach SQL; a server-side allowlist maps client sort/filter keys to safe expressions (and bindings are always parameterized).

---

## 7. Schema / Data deltas

Sprint 1 created the people tables. This sprint adds small, additive refinements:

- **`teachers.availability`** `jsonb not null default '[]'` — weekly windows `[{weekday, start_local, end_local}]`, guidance for Sprint 5.
- **`students.is_self_guardian`** `boolean not null default false` — marks the adult-solo case (R-STU-2) so UI can hide the separate guardian section.
- **`guardians.notes`** / **`students.notes`** `text null` — operational notes (not the session report).
- Ensure phone columns store **E.164**; add a format check or normalize on write (decision §3.7).
- Confirm the partial unique index on `student_teacher_assignments (student_id) where ended_at is null` exists (Sprint 1 AC-1.9); add if missing.

A Laravel migration `..._people_refinements` (with `down()`): adds the columns above, phone-format checks, and confirms the partial index (raw SQL via `DB::unprepared` for the check/partial-index DDL).

---

## 8. API surface

| Method & path | Permission | Purpose |
|---|---|---|
| `GET /api/guardians` | `guardian.read` | DataTable list (search/filter/sort/paginate) |
| `POST /api/guardians` | `guardian.create` | Create guardian |
| `GET /api/guardians/{id}` | `guardian.read` | Detail + children |
| `PATCH /api/guardians/{id}` | `guardian.update` | Edit |
| `POST /api/guardians/{id}/deactivate` | `guardian.update` | Soft-delete (blocked if active children — deactivate children first) |
| `GET /api/students` | `student.read` | DataTable list |
| `POST /api/students` | `student.create` | Create student (+ optional inline subscription + assignment) |
| `GET /api/students/{id}` | `student.read` | Detail (subscription, current teacher, assignment history) |
| `PATCH /api/students/{id}` | `student.update` | Edit |
| `POST /api/students/{id}/deactivate` | `student.deactivate` | Soft-delete |
| `PUT /api/students/{id}/subscription` | `student.update` | Set/replace active subscription |
| `PATCH /api/students/{id}/subscription/price` | `student.update` | Change price (audited; future-only) |
| `POST /api/students/{id}/teacher` | `student.update` | Reassign teacher (close+open, audited) |
| `GET /api/students/{id}/teacher-history` | `student.read` | Assignment history |
| `GET /api/teachers` | `teacher.read` | DataTable list |
| `POST /api/teachers` | `teacher.create` | Create teacher (+ optional login: `users` row + `user_roles(TEACHER)`) |
| `GET /api/teachers/{id}` | `teacher.read` | Detail (rate, availability, current students) |
| `PATCH /api/teachers/{id}` | `teacher.update` | Edit (rate change audited) |
| `POST /api/teachers/{id}/deactivate` | `teacher.deactivate` | Soft-delete (blocked if active students — reassign first) |

All run through `TenantContextMiddleware` and call `Gate::authorize`. Teacher self-view (`payout.read_own` etc.) is limited to own record (Sprint 2 §3.6).

## 9. Definition of Done / Acceptance Criteria

- **AC-4.1** Owner can create a guardian with multiple students; each student can have an independent subscription price/currency and an independent teacher. (R-STU-1, R-STU-4)
- **AC-4.2** The adult-solo case works: creating a self-guardian student auto-creates/links a guardian and hides the separate guardian step. (R-STU-2)
- **AC-4.3** Each student has at most **one active** teacher assignment; reassignment closes the old and opens a new one, preserving history. (R-STU-3)
- **AC-4.4** Teacher reassignment and price changes write audit entries with before/after; price changes apply to future billing only (no back-dating). (R-AUD-1, R-INV-3 respected)
- **AC-4.5** Teacher has a session rate + currency that will drive payroll; editing the rate is audited and does not retroactively change past payouts. (R-PAY-1/3)
- **AC-4.6** Currency defaults to the academy default but can be overridden per guardian/student/subscription/teacher; mixed currencies coexist with no FX. (R-INV-7)
- **AC-4.7** Deactivating a person hides them from default views and prevents new assignments, while all historical references remain intact; no hard-delete path exists.
- **AC-4.8** The DataTable performs search, per-column filters, multi-sort, and pagination **server-side**, within RLS scope, with loading/empty/error states, RTL, and mobile layout.
- **AC-4.9** Sort/filter keys from the client are validated against a server allowlist; no injection path exists.
- **AC-4.10** A Teacher (role) can read only their own assigned students and their own teacher record; cannot list all guardians/teachers or edit others. (Sprint 2 §3.6)
- **AC-4.11** All people operations are RLS-isolated: an Owner of Academy A can never see/edit Academy B's people. (R-TEN-1/2)
- **AC-4.12** Deactivating a guardian with active children, or a teacher with active students, is blocked with a clear, actionable message.

## 10. Test Cases

> `TC-4.<n>`, mapped to ACs.

### Guardians & students
- **TC-4.1** Create guardian → create 2 students under it, each with its own subscription price/currency → all persisted; guardian detail lists both children. *(AC-4.1)*
- **TC-4.2** Two children of the same guardian can have different teachers and different prices. *(AC-4.1)*
- **TC-4.3** Create an adult-solo student (`is_self_guardian=true`) → a linked guardian exists; the UI omits the separate guardian section. *(AC-4.2)*
- **TC-4.4** Edit a guardian's WhatsApp to a non-E.164 string → normalized or rejected with a clear error. *(decision §3.7)*
- **TC-4.5** Deactivate a student → removed from default list; still visible with "show inactive" filter; past references intact. *(AC-4.7)*
- **TC-4.6** Deactivate a guardian who still has active children → blocked with message to deactivate children first. *(AC-4.12)*

### Subscription & price
- **TC-4.7** Set a subscription with price 100 EGP, basis PER_SESSION, 8/month → stored exactly (minor units), readable back. *(AC-4.1)*
- **TC-4.8** Change price from 100 → 120 EGP → audit `subscription.price_changed` records before/after; effective date is not back-dated. *(AC-4.4)*
- **TC-4.9** A second active subscription for the same student is prevented (replace, not duplicate). *(AC-4.1)*
- **TC-4.10** Subscription currency differing from academy default (e.g. SAR student in an EGP academy) is allowed and stored. *(AC-4.6)*

### Teacher assignment & history
- **TC-4.11** Assign Teacher 1 to a student → one active assignment exists. *(AC-4.3)*
- **TC-4.12** Reassign to Teacher 2 → old assignment gets `ended_at`; new active assignment created; only one active remains. *(AC-4.3)*
- **TC-4.13** Attempt to insert a second active assignment directly → partial unique index rejects (Sprint 1 AC-1.9). *(AC-4.3)*
- **TC-4.14** `GET /api/students/{id}/teacher-history` returns both assignments with correct date ranges. *(AC-4.3)*
- **TC-4.15** Reassignment writes `student.teacher_reassigned` audit (from→to, effective date). *(AC-4.4)*

### Teacher rate & payroll readiness
- **TC-4.16** Create teacher with rate 80 EGP/session → stored; appears on teacher detail. *(AC-4.5)*
- **TC-4.17** Edit rate 80 → 90 → audited; (verify in Sprint 8 that past payouts are unaffected — here assert the rate change is forward-looking metadata only). *(AC-4.5)*
- **TC-4.18** Deactivate a teacher with active students → blocked; after reassigning their students, deactivation succeeds. *(AC-4.12)*

### DataTable
- **TC-4.19** Search "محمد" returns matching students/guardians within the academy only. *(AC-4.8, AC-4.11)*
- **TC-4.20** Filter students by teacher = Teacher 1 → only that teacher's active students. *(AC-4.8)*
- **TC-4.21** Sort by price descending → correct order; sort by name → locale-aware order. *(AC-4.8)*
- **TC-4.22** Pagination returns stable, non-overlapping pages; page size change works. *(AC-4.8)*
- **TC-4.23** Empty academy → students table shows the actionable empty state. *(AC-4.8)*
- **TC-4.24** A crafted sort key `name); drop table students;--` is rejected by the allowlist; no SQL executes. *(AC-4.9)*
- **TC-4.25** Table renders correctly in RTL (ar) and LTR (en); collapses to cards at 360px. *(AC-4.8)*

### Authorization & isolation
- **TC-4.26** Owner of A cannot read or edit any of B's guardians/students/teachers (RLS). *(AC-4.11)*
- **TC-4.27** Teacher role: `GET /api/students` returns only their assigned students; `GET /api/guardians` (full list) → 403; editing another teacher's record → 403. *(AC-4.10)*
- **TC-4.28** Teacher can read their own teacher record and rate. *(AC-4.10)*

### Audit
- **TC-4.29** Create/update/deactivate of guardian, student, teacher each write a correctly-attributed audit entry. *(AC-4.4)*
- **TC-4.30** Price change and teacher reassignment audits include before/after detail. *(AC-4.4)*

## 11. Risks & mitigations
- **Risk:** Reassignment race could create two active assignments. **Mitigation:** do close+open in one transaction; the partial unique index is the hard backstop (TC-4.13).
- **Risk:** Price change accidentally back-dates and corrupts an open invoice. **Mitigation:** price changes are forward-only with an effective date; closed invoices immutable (Sprint 1 trigger); Sprint 7 recalculates open invoices from the change date. TC-4.8 guards the non-back-dating rule.
- **Risk:** SQL injection via sort/filter. **Mitigation:** strict server allowlist mapping client keys → safe expressions; TC-4.24.
- **Risk:** Deactivation orphans (a deactivated teacher still on active students). **Mitigation:** block deactivation while active dependents exist (TC-4.18, TC-4.6).
- **Risk:** Inconsistent phone formats break later WhatsApp/invoice links. **Mitigation:** normalize to E.164 on write (TC-4.4).
- **Risk:** DataTable slow at scale if browser-side. **Mitigation:** server-driven query contract; keyset pagination; indexes from Sprint 1 plus any added here.

## 12. Estimate
**Large.** Two heavy parts: the **people/subscription/assignment domain logic** (history-preserving reassignment, per-student pricing, adult-solo case) and the **reusable server-driven DataTable**, which is an investment that pays off in every later list screen. Build the DataTable once, well.

## 13. Handoffs to later sprints
- **Sprint 5** reads `teachers.availability`, students, and active assignments to build recurring schedules and generate sessions.
- **Sprint 6** records reports against these students/teachers; uses the active assignment to attribute a session's teacher.
- **Sprint 7** reads `subscriptions.price_minor/currency/basis` and `guardians` (per grouping) to build invoices, snapshotting price at billing time.
- **Sprint 8** reads `teachers.session_rate_minor/currency` to compute payouts from attended sessions.
- Every later list screen reuses the **DataTable** built here.
