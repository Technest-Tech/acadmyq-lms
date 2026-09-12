# Lesson Packages

An academy sells a student a **block of hours** — "20 hours, 4 000 EGP" — instead of billing them
month by month. Every lesson the student owes money for burns its own length out of the balance.
When the balance runs out the package closes itself and the bill is raised (or was already raised
at the start).

This is the **second billing mode**, and it is *mutually exclusive* with the monthly one.

---

## The three rules

Everything else in this document follows from these. They are enforced in the schema, not just in
code, so they cannot drift.

### 1. Minutes, never hours

Every stored quantity is an integer count of minutes. Hours exist only in labels and in the form
that sells the package. A balance rendered as `3.3333h` is a support ticket; rounded to `3.3h` it
silently loses two paid-for minutes. `formatHours()` on the client and `humanHours()` on the server
are the only places minutes become "3h 20m".

### 2. One lesson = one package = one invoice line

A 90-minute lesson against a 30-minute balance does **not** split 30/60 across two packages. It
**overdraws**: the package closes at −60 and those 60 minutes are charged at that package's own
snapshotted hourly rate, as one line, on one invoice.

`lesson_package_credits.session_id` is `UNIQUE`, so a lesson consuming two packages is not merely
discouraged — it is impossible.

Splitting was considered and rejected: it is accounting-perfect but puts one lesson on two
different bills, which nobody can explain to a parent.

### 3. Consumption is never gated on payment

The credit ledger records which lesson ate which minutes and is never blocked by an unpaid invoice.
A teacher marking attendance must never be stopped by the accounts.

So "he started a new package without paying for the last one" is **reportable, not prevented**: it
raises a `PACKAGE_UNPAID` alert and shows in the attention queue. Hard-blocking would get the
feature switched off within a month.

---

## How a student ends up on package billing

Their subscription's `price_basis` is `PER_PACKAGE`. That single fact switches the clock:
`Invoicing::onSessionBillable()` delegates to `LessonPackages::consume()` **before any invoice is
opened**, so a package student never also collects a monthly AUTO invoice line.

**Selling them a block is what sets it.** `LessonPackages::open()` calls `ensurePackageBilling()`
before writing the row: a student on another basis is flipped in place (their monthly quota
cleared, the package's derived hourly rate adopted as their default), and a student with no
subscription at all gets one created in the package's own currency. A student already on
`PER_PACKAGE` is left untouched — the running package snapshots its own rate, so rewriting their
agreed default because one block was discounted would be a silent re-price.

This is why there is exactly **one place** a package is set up. The mode used to be a toggle on the
student's profile and the packages screen's picker listed only students who had already been
flipped, so the mandatory first step was invisible from the screen that needed it, and half the
terms of a deal were entered somewhere else. The picker now lists every active student and says
which clock each one is on; the form states the consequence before the owner commits.

**The way back** is `POST /packages/{id}/close` with `return_to_monthly` — offered as a checkbox on
the close dialog, because closing is when an owner actually decides a student is done buying
blocks. It refuses while a package is still open: a `PER_HOUR` student holding a live balance is
the double-bill the two modes exist to prevent. Both directions of the switch therefore live on the
packages screen, and no toggle elsewhere can disagree with the packages themselves.

For a package student, `subscriptions.price_minor` is read as the **default hourly rate** — it
pre-fills the next package and prices the fallback (below). It is never the authoritative rate for
a running package; that is snapshotted on the package row.

### The fallback

If the student is on `PER_PACKAGE` but has **no open package**, `consume()` declines and the lesson
bills the ordinary monthly way, priced by the hour. This is deliberate: a delivered lesson still has
to be billed to somebody, and silently swallowing it is lost revenue. The owner gets a
`NO_ACTIVE_PACKAGE` alert telling them to open the next block.

---

## What consumes minutes

Exactly what `SessionClassifier` already says costs the student money — there is no second matrix:

| Session outcome | Burns minutes? |
| --- | --- |
| `ATTENDED` | yes, the full `duration_minutes` |
| `FREE` | no — on the house, so it must not eat paid-for hours either |
| `CANCELLED_BY_*` | no, **unless** the owner ticked the late-cancel `bill_override` |
| free trial | no |

A charged cancellation burns its **full** duration, same as any other billable lesson.

---

## Billing moment

Per package, defaulting from `academies.package_bill_timing`:

- **`ON_START`** — the invoice goes out the moment the package opens. Recommended, and the default:
  it is cash up front for the academy and it is what makes the unpaid-package problem mostly stop
  existing.
- **`ON_COMPLETION`** — the invoice is raised at close, from what was actually consumed.
  - Ran its full course → billed the agreed price *exactly*, so full consumption never drifts by a
    rounding unit.
  - Closed early → billed **pro-rata** at the snapshotted rate. Billing a full block for half a
    block used is not a defensible reading of "pay at the end".

### Where an overdraft lands

- `ON_COMPLETION`: on the same closing invoice, as its own line.
- `ON_START`: the package's invoice went out before the lessons happened and is immutable by the
  time the last one overdraws it. The overdraft therefore **travels** — it rolls onto the *next*
  package's invoice as a line. If no next package is ever opened, `POST /packages/{id}/bill-overdraft`
  puts it on its own bill; the packages page surfaces it in the attention queue until it does.

Cross-currency debt is never converted (§3.6, no FX inside invoicing) — an overdraft only travels
onto a package in the same currency.

---

## Carry-over

Unused minutes at close are **not** moved automatically. Carry-over is an explicit checkbox when
opening the next package, because those hours are the academy's to keep or to forgive, and moving
them silently is how disputes start. Carried minutes land in `carried_over_minutes` and add to the
balance without changing `minutes_total` (what they bought stays what they bought).

---

## Schema

`lesson_packages` — one row per block sold. Holds `minutes_total`, `carried_over_minutes`,
`minutes_consumed`, `minutes_overdrawn`, the snapshotted `price_minor` / `hourly_rate_minor`,
`bill_timing`, `status`, a per-student `sequence_no`, and the two invoice links (`invoice_id`,
`overdraft_invoice_id`).

Two unique indexes carry real meaning:

- `lesson_packages_one_active_per_student` — at most one `ACTIVE` package per student. "Started a
  new one before paying the old one" is a fact about the previous package's *invoice*, never two
  live balances.
- `lesson_packages_sequence_uidx` — `(student_id, sequence_no)`, so "package #2" means the same
  thing forever.

`lesson_package_credits` — the ledger, one row per lesson, `unique (session_id)`. See rule 2.

`notifications.subject_id` — a generic anchor added so package alerts get the same
one-alert-per-subject-per-type dedupe that session alerts get from `(session_id, type)`.

Both new tables carry `academy_id` and the standard `FORCE` RLS tenant policy.

---

## Reversal

Correcting an outcome (`ATTENDED` → cancelled) hands the minutes back and deletes the ledger row. A
package that closed *only because it ran out* re-opens.

`release()` refuses once the package is closed **and** its bill has moved past `OPEN` — the
package-side mirror of the closed-invoice immutability guard. The throw rolls the whole attendance
change back, so the ledger and the invoice can never disagree.

---

## Surfaces

- **`/packages`** — the record, the work queue, and the *only* form. Live balance per student with
  a progress bar, overdraw drawn as its own red segment (the block finished *and* we went past it
  are two facts). Opening (including the billing-mode switch), closing early, returning a student
  to monthly, and billing a stranded overdraft all live here; the per-lesson ledger is one click
  in. `?open=<studentId>` opens the form with that student already chosen — the deep link the
  student's profile uses.
- **Student profile → Billing** — a READ. The hour balance and the history, a link to `/packages`,
  and an "open a package" button that is a link to the form above, never a second copy of it. The
  subscription modal edits the *rate*; it cannot change which clock the student is on.
- **Sidebar badge** — counts packages that need an action (running low, finished and unpaid,
  unbilled overdraft), *not* unread rows. It clears when the work is done, not when it is seen.
- **Notifications → Packages tab** — `PACKAGE_LOW`, `PACKAGE_COMPLETED`, `PACKAGE_UNPAID`,
  `NO_ACTIVE_PACKAGE`.

Package invoices are always `MANUAL` and always **per-student**, even at a `PER_GUARDIAN` academy —
a package belongs to one child, and folding it into a shared guardian bill makes "which of my kids
used their hours" unanswerable.

---

## Capabilities and gating

`package.read` / `package.manage`, owner-only by default (delegate through a custom role). Routes
sit behind `entitled:invoicing` — packages *are* invoicing, on a different clock.

---

## Deliberately out of scope (for now)

- Splitting a lesson across two packages. See rule 2.
- Automatic expiry enforcement — `expires_on` is stored and displayed, but nothing sweeps it yet.
- Guardian-level packages shared across siblings.
- Auto-renew, and instalments against a single package.
