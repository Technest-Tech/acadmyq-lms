# 03 — Access codes & enrollment

The code is the academy's substitute for a paywall. The school or a teacher **generates codes**,
scopes each to one or more courses, and hands them to students (printed cards, WhatsApp, in class).
A learner **redeems** a code to unlock the course(s) it covers.

This model was chosen deliberately over card checkout: it needs no payment integration, matches how
these academies already sell (prepaid cards / batch enrolment), and lets a teacher control access at
the granularity of "this batch, these courses, until this date".

## The code

`access_codes` (see [01](01-DATA-MODEL.md)):

- **`code`** — human-friendly, unique per academy. Generated as `<PREFIX>-<random>` where the random
  part avoids ambiguous chars (`0/O`, `1/I/L`). Example `SCIENCE-7F3K`.
- **`max_redemptions`** — `null` = unlimited (a shared class code), `1` = single-use (one card = one
  student). Enforced against `redemptions_count` at redemption time under a row lock.
- **`expires_at`** — optional hard cutoff. Past → redemption refused.
- **`is_active`** — a kill switch the academy can flip without deleting history.
- **`access_code_courses`** — the join listing which courses this code unlocks (one or more).

### Generating a batch

Dashboard: "Generate codes" → pick course(s), count (e.g. 50), per-code max redemptions (usually 1),
optional expiry, optional label. The API creates N `access_codes` rows + their `access_code_courses`
links in a transaction and returns them for **CSV export / print** (the physical cards).

`POST /api/courses/codes/batch`
```
{ course_ids: [uuid], count: 50, max_redemptions: 1, expires_at?: iso, label?: "Grade 10 A" }
→ { codes: [{ id, code }, ...] }   // exportable
```

Requires `access_code.manage`.

## Redemption

On the learner site, a signed-in learner enters a code:

`POST /api/learn/redeem` `{ code }` — in the subdomain's academy context. The handler, inside a
transaction with `SELECT … FOR UPDATE` on the code row:

1. Resolve `code` within the current academy; 404 if unknown.
2. Reject if `is_active = false`, `expires_at` past, or
   (`max_redemptions` not null and `redemptions_count >= max_redemptions`).
3. Reject if this learner already redeemed this code (`code_redemptions` unique).
4. Insert `code_redemptions (code_id, learner_id)`.
5. `UPSERT enrollments (learner_id, course_id, status ACTIVE, source_code_id)` for every course in
   `access_code_courses` — idempotent on `(learner_id, course_id)`, so redeeming a second code that
   overlaps courses is harmless.
6. `redemptions_count = redemptions_count + 1`.
7. Return the now-unlocked course list.

Concurrency: the row lock + the `redemptions_count < max_redemptions` check inside the transaction
prevents a single-use code from being redeemed twice in a race.

## Enrollment — the access gate

`enrollments` is the single source of truth the player asks: *may this learner watch this course?*

- Created by redemption, or — for a `price_minor = 0` course — by the learner themselves via
  `POST /api/learn/courses/{slug}/enroll`, which writes the same row with a null `source_code_id`.
  A free course needs no code: the price IS the authorisation, re-checked server-side, and a
  REVOKED enrollment is never resurrected by it. Later, paid checkout can create the row the same way.
- `status ACTIVE | REVOKED` — an academy can revoke access (dashboard) without deleting the row, so
  the learner's progress/history survives and access can be restored.
- **Every learner-facing content endpoint checks enrollment**: listing lessons, fetching a playback
  URL, saving progress, starting a quiz. `is_preview` lessons are the sole exception (watchable by an
  authenticated, un-enrolled learner as a teaser).

## What the academy sees

Dashboard (requires `learner.read`):

- **Codes** — list with redemption counts, expiry, active toggle, "regenerate batch", CSV export.
- **Learners** — who signed up, which courses they're enrolled in, last activity, block/unblock.
- **Enrollments/redemptions report** — per course: how many redeemed, by which code batch — the
  academy's basic "how is this course selling" view.

## Edge cases

- **Code for an unpublished course**: redemption still creates the enrollment, but the course only
  appears to the learner once `PUBLISHED` (lets a teacher pre-seed a cohort before launch).
- **Course archived after enrollment**: enrolled learners keep access to what they had (read-only);
  the course leaves the public catalog.
- **Deleting a code**: `code_redemptions` cascades away but `enrollments.source_code_id` is
  `set null` — the learner keeps access, we just lose the provenance link.
