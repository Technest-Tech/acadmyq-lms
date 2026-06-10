# Sprint 5 — Scheduling & Session Generation

> **Status:** Detailed / Ready to execute
> **Depends on:** Sprint 1 (schedules/schedule_slots/sessions schema, UTC convention), Sprint 2 (Sanctum auth, `TenantContextMiddleware` / `Tenancy::withContext`, Gates/RBAC), Sprint 4 (students, teachers, active assignments, `teachers.availability`)
> **Blocks:** Sprint 6 (attendance/reports act on generated sessions), Sprint 7 (billing reads session status), Sprint 8 (payroll reads attended sessions)
> **References:** Master Spec §5.3 (R-SCH-1..4), §5.4 (status→billing), §6.3 (UTC storage, idempotency); Sprint 1 §6.5 (scheduling tables, `original_session_id`, `billed`/`paid_to_teacher` guards); Sprint 4 §7 (`teachers.availability`)

> **⚠️ This is the highest-risk logic sprint.** Recurrence + timezones + edits-without-disturbing-the-series is where subtle bugs live. The acceptance bar is correctness under edge cases (DST, schedule edits, partial weeks, reschedule across boundaries), not just the happy path. Budget extra time for the test suite.

---

## 1. Goal

Turn a student's **weekly recurring schedule** into concrete, dated **sessions**, and let users **cancel or reschedule** an individual session without disturbing the rest of the series — while **editing or deleting the schedule** affects only **future** sessions and never rewrites the past. Give teachers a **weekly calendar** of their sessions.

The deliverable is judged on one hard question: *after a messy real-world sequence — create a schedule, generate sessions, reschedule one, cancel another, then change the recurring schedule mid-month — is every session's date, time, and status exactly what a human would expect, with no duplicates, no lost history, and no drift across a DST boundary?*

## 2. Scope

### In scope
- **Recurring schedule editor**: per-student weekly template with **per-weekday times** (a student can have different times on different days), expressed in a stored timezone (R-SCH-1).
- **Session generator**: an **idempotent** job that materializes `sessions` rows from active schedules for a **rolling window** (current month + next month by default), in UTC (R-SCH-4, §6.3 idempotency).
- **Per-session cancel** (by student-with-notice / by teacher) and **reschedule** (move one occurrence to a new datetime) — **without affecting the rest of the series** (R-SCH-2). Reschedule links via `original_session_id`.
- **Schedule edit/delete affects future only** (R-SCH-3): regenerating future sessions from the changed template while preserving all already-generated past sessions and their reports/dates.
- **Ad-hoc sessions**: a one-off session not from any schedule (`schedule_id = NULL`).
- **Teacher weekly calendar** view (the prototype's calendar): the teacher's own sessions for a week, with status colors; owner can view any teacher's calendar.
- **Conflict detection**: warn when a new/rescheduled session overlaps an existing one for the same teacher (and optionally same student).
- **Availability guidance**: surface `teachers.availability` (Sprint 4) as soft guidance in the editor (warn on out-of-availability), not a hard block (decision §3.7).
- Audit entries for schedule create/edit/delete, session reschedule, session cancel, ad-hoc create, and generator runs.

### Out of scope (deferred)
- Marking attendance / writing reports / the status→billing consequences (Sprint 6) — this sprint creates sessions and the **non-billing** status changes (SCHEDULED / RESCHEDULED / CANCELLED_*). The *billable* statuses (ATTENDED / ABSENT_*) and their billing hook are Sprint 6.
- Invoice/payout creation (Sprints 7/8). The `billed`/`paid_to_teacher` guard columns exist but are not set here.
- Google Calendar sync (post-MVP).
- Group/halaqa scheduling (model is 1-on-1).
- Hard availability enforcement / auto-scheduling optimization (post-MVP).

---

## 3. Design decisions (locked for this sprint)

1. **Schedule = rule; Session = materialized instance.** We **do not** compute sessions on the fly at read time. We **generate and store** concrete `sessions` rows (Sprint 1 §6.5). Rationale: sessions accrue status, reports, billing, and payouts — they must be durable, addressable rows, not derived views. (This is the single most important decision in the sprint.)
2. **All session instants stored as `timestamptz` in UTC.** The schedule stores **local wall-clock times** + an IANA **timezone**; the generator converts each occurrence to a UTC instant **per-date** (so DST shifts are handled correctly at generation time). Rendering converts back to the viewer's tz. (§6.3, R-SCH)
3. **Generation is idempotent and keyed.** Re-running the generator must never duplicate. Idempotency key per generated session = `(schedule_id, occurrence_local_date, slot_id)`. A unique constraint enforces it. Re-runs upsert/skip, never insert duplicates.
4. **Edits are future-only and non-destructive.** Editing/deleting a schedule never touches sessions whose `scheduled_at_utc < now()` (or that already have a report/status change). It regenerates only **future, untouched** sessions. "Untouched" = status `SCHEDULED`, not rescheduled, no report. (R-SCH-3)
5. **Individual session changes are isolated.** Cancel/reschedule mutate exactly one `sessions` row (and, for reschedule, create one linked successor). They never alter the schedule or other occurrences. (R-SCH-2)
6. **Reschedule = cancel-origin + create-successor, linked.** The original row is marked `RESCHEDULED` (audit-visible, non-billable) and a new `SCHEDULED` row is created with `original_session_id` pointing back. The successor is a normal session thereafter.
7. **Availability is guidance, not a gate.** Real academies make exceptions. The editor warns on out-of-availability or conflicts but lets the owner proceed (logged). This avoids blocking legitimate real-world scheduling. (configurable to hard-block later)
8. **Generation window is rolling and bounded.** Default: from the start of the current month through the end of next month. A scheduled job extends the window monthly. Window bounds are explicit so the generator is deterministic and testable.
9. **Weekday convention is fixed and documented once.** `0 = Sunday … 6 = Saturday` (matches Sprint 1 §6.5). All code and tests use this; never re-derive from locale.

---

## 4. The recurrence & timezone model (the crux)

### 4.1 What is stored
- `schedules`: `student_id`, `teacher_id` (at time of scheduling), `timezone` (IANA, e.g. `Africa/Cairo`), `is_active`.
- `schedule_slots`: for each schedule, rows of `(weekday, start_time_local, duration_minutes)`. Different weekdays can have different times (R-SCH-1).

### 4.2 How a session instant is computed
For each slot and each date in the window matching `slot.weekday`:
```
local_naive   = (occurrence_date, slot.start_time_local)        // wall clock in schedule.timezone
scheduled_at_utc = convert(local_naive, from = schedule.timezone, to = UTC)   // DST-correct per date
```
- The conversion is done **per occurrence date**, so an occurrence before a DST change and one after it get the correct (different) UTC offsets automatically.
- `duration_minutes` is carried onto the session.

### 4.3 Why per-date conversion matters (DST)
If we converted once and added 7 days repeatedly in UTC, a DST transition would shift every later wall-clock time by an hour. Converting **each date's** local time to UTC independently keeps "5:00 PM Cairo" at 5:00 PM Cairo on both sides of a DST boundary. This is explicitly tested (TC-5.12/5.13).

### 4.4 Idempotency
- Unique constraint (added this sprint): `sessions_unique_occurrence` on `(schedule_id, occurrence_local_date, slot_id)` where `schedule_id is not null`.
- The generator computes the intended set for the window and **upserts**: existing untouched rows are left as-is, missing ones are inserted, and rows no longer implied by the (edited) schedule **in the future & untouched** are removed/deactivated. Past or touched rows are never removed.

### 4.5 "Touched" definition (protects history)
A future session is **untouched** (and thus regenerable) only if all hold:
- `status = 'SCHEDULED'` (not RESCHEDULED, CANCELLED_*, or any billable status), and
- no `session_reports` row exists for it, and
- `original_session_id is null` (it is not a reschedule successor), and
- `scheduled_at_utc >= now()`.
Anything else is **touched** and is preserved verbatim across schedule edits.

---

## 5. User flows

### 5.1 Create a weekly schedule
```
Student detail → Schedule → "Set weekly schedule"
  timezone defaults to academy tz (editable)
  add slots:  Sun 16:00 (30m), Tue 16:00 (30m), Thu 17:00 (45m)
  → save schedule (active)
  → generator runs for the window → concrete sessions appear on the calendar
  audit: schedule.created, generator.run(created N sessions)
```

### 5.2 Reschedule one session (series untouched)
```
Calendar → click a session → "Reschedule"
  pick new datetime (conflict/availability warnings shown, non-blocking)
  → original row status = RESCHEDULED
  → new SCHEDULED row created, original_session_id → original
  → only these two rows change; all other occurrences identical
  audit: session.rescheduled (from → to)
```

### 5.3 Cancel one session
```
Calendar → session → "Cancel"
  choose: cancelled by teacher | cancelled by student (with notice)
  → that row's status set accordingly (non-billable per Master Spec §5.4)
  audit: session.cancelled (who, reason)
  note: billable "absent" outcomes are NOT set here — that's attendance (Sprint 6)
```

### 5.4 Edit the recurring schedule (future-only)
```
Student detail → Schedule → edit slots (e.g. move Thu 17:00 → 18:00, add Sat 10:00)
  → save → generator re-runs:
       past sessions: untouched
       future untouched SCHEDULED sessions from old template: removed/replaced
       future touched sessions (rescheduled/with reports/cancelled): preserved
       new future sessions from new template: created
  audit: schedule.updated, generator.run(created X, removed Y)
```

### 5.5 Teacher calendar
```
Teacher logs in → weekly calendar of their own sessions (status colors)
Owner → can open any teacher's weekly calendar
navigation: prev/next week; sessions render in viewer's timezone
```

---

## 6. Session generator (algorithm)

Implemented as a PHP service (e.g. `App\Services\SessionGenerator`) invoked from a controller action, an Artisan command, and a queued job. `toUTC` is Sprint 0's `TimeHelper::toUtc`.
```
generateSessions(academyId, windowStart, windowEnd):   # all within Tenancy::withContext
  for each active schedule S in academy:
    intended = []
    for each slot in S.slots:
      for each date D in [windowStart..windowEnd] where weekday(D) == slot.weekday:
        utc = TimeHelper::toUtc(D + slot.start_time_local, S.timezone)   # per-date, DST-correct
        intended.push({schedule_id:S.id, slot_id:slot.id, occurrence_local_date:D,
                       scheduled_at_utc:utc, duration:slot.duration_minutes,
                       student_id:S.student_id, teacher_id:S.teacher_id})
    existing = sessions where schedule_id=S.id and scheduled_at_utc in window
    # INSERT intended not already present (idempotent via unique key)
    # For future & UNTOUCHED existing rows not in intended: remove (schedule changed)
    # Never touch past rows or touched rows (§4.5)
  return {created, removed}
```
- Runs: on schedule create/edit, and via a **monthly job registered in the Laravel scheduler** (`routes/console.php` → `Schedule::job(...)`) that rolls the window forward.
- Wrapped in a DB transaction (via `Tenancy::withContext`); safe to re-run (idempotent); logs `generator.run` to audit with counts.
- Teacher on each generated session is the schedule's teacher **at generation time**; a later teacher reassignment (Sprint 4) updates future sessions via regeneration or an explicit "apply new teacher to future sessions" action (decision: regeneration picks up the active assignment's teacher for future untouched rows).

---

## 7. Schema / Data deltas

Sprint 1 created the scheduling tables. This sprint adds:

- **`sessions.occurrence_local_date`** `date null` — the local calendar date the occurrence belongs to (idempotency key component; null for ad-hoc).
- **`sessions.slot_id`** `uuid null → schedule_slots(id)` — which slot produced it (idempotency key; null for ad-hoc/reschedule successor).
- **Unique index** `sessions_unique_occurrence` on `(schedule_id, occurrence_local_date, slot_id) where schedule_id is not null` — idempotency (§4.4).
- **`schedules.version`** `int not null default 1` — bumped on edit, useful for audit/debug of which template produced a row.
- Confirm calendar indexes from Sprint 1 (`(academy_id, teacher_id, scheduled_at_utc)`, student equivalent) exist.

A Laravel migration `..._session_generation` (with `down()`): adds the two session columns, the unique occurrence index (raw SQL via `DB::unprepared` for the partial unique index), `schedules.version`.

## 8. API surface

| Method & path | Permission | Purpose |
|---|---|---|
| `GET /api/students/{id}/schedule` | `schedule.read` | Get the student's recurring schedule + slots |
| `PUT /api/students/{id}/schedule` | `schedule.manage` | Create/replace schedule + slots; triggers generation |
| `DELETE /api/students/{id}/schedule` | `schedule.manage` | Deactivate schedule; removes future untouched sessions |
| `POST /api/sessions` | `schedule.manage` | Create ad-hoc session |
| `POST /api/sessions/{id}/reschedule` | `session.reschedule` | Reschedule one occurrence (link successor) |
| `POST /api/sessions/{id}/cancel` | `session.cancel` | Cancel one occurrence (by teacher/student) |
| `GET /api/calendar` | `session.read` | Sessions for a week; `?teacherId=&from=&to=` (teacher sees own only) |
| `POST /api/admin/generate-sessions` | `schedule.manage` (system/owner) | Manually trigger generation for the window (idempotent) |

All run through `TenantContextMiddleware` + `Gate::authorize`. The monthly generation runs as a scheduled job, wrapping each academy's work in `Tenancy::withContext` (a system context scoped per academy).

## 9. Definition of Done / Acceptance Criteria

- **AC-5.1** A weekly schedule with different per-weekday times generates the correct concrete sessions across the window, in correct UTC instants. (R-SCH-1, R-SCH-4)
- **AC-5.2** Re-running the generator produces **no duplicates** (idempotent); counts are stable. (§4.4)
- **AC-5.3** Rescheduling one session marks the original `RESCHEDULED`, creates a linked successor, and leaves every other occurrence unchanged. (R-SCH-2)
- **AC-5.4** Cancelling one session sets the correct non-billable status and changes no other occurrence. (R-SCH-2, §5.4)
- **AC-5.5** Editing the schedule changes **future untouched** sessions only; past sessions and any touched future sessions (rescheduled / with reports / cancelled) are preserved verbatim. (R-SCH-3)
- **AC-5.6** Deleting/deactivating the schedule removes future untouched sessions but preserves past and touched ones. (R-SCH-3)
- **AC-5.7** DST correctness: an occurrence's local wall-clock time is preserved across a DST boundary (the UTC instant differs by the offset change, the local time does not). (§4.3)
- **AC-5.8** Conflict detection warns on overlapping sessions for the same teacher; availability warns on out-of-window times; neither hard-blocks (configurable). (§3.7)
- **AC-5.9** The teacher calendar shows only the teacher's own sessions; the owner can view any teacher's; sessions render in the viewer's timezone. (Sprint 2 §3.6)
- **AC-5.10** Ad-hoc sessions can be created without a schedule and behave like normal sessions thereafter.
- **AC-5.11** All scheduling operations are RLS-isolated and audited (schedule CRUD, reschedule, cancel, generator runs with counts). (R-TEN, R-AUD-1)
- **AC-5.12** No billable status (ATTENDED/ABSENT_*) or billing side effect is produced in this sprint — those are Sprint 6. The `billed`/`paid_to_teacher` guards remain false.

## 10. Test Cases

> `TC-5.<n>`, mapped to ACs. The recurrence/timezone cases are the priority — they get the most cases on purpose.

### Generation — correctness
- **TC-5.1** Schedule Sun/Tue/Thu at given times over a 2-month window → exact expected count and dates; each `scheduled_at_utc` equals the correct UTC for that local time. *(AC-5.1)*
- **TC-5.2** Different times per weekday (Thu 45m vs others 30m) → durations and times correct per day. *(AC-5.1)*
- **TC-5.3** Partial first week (schedule created mid-week) → only the remaining matching weekdays in that week are generated; no past-dated rows in the future window. *(AC-5.1)*
- **TC-5.4** A weekday with no slot produces no session. *(AC-5.1)*

### Idempotency
- **TC-5.5** Run generator twice for the same window → identical row set, no duplicates (unique occurrence index holds). *(AC-5.2)*
- **TC-5.6** Run generator, then run again after extending the window by a month → only the new month's sessions are added. *(AC-5.2)*
- **TC-5.7** Concurrent generator runs (simulate) do not create duplicates (unique constraint backstop). *(AC-5.2)*

### Reschedule / cancel — isolation
- **TC-5.8** Reschedule one occurrence → original status RESCHEDULED, successor SCHEDULED with `original_session_id` set; all sibling occurrences byte-for-byte unchanged. *(AC-5.3)*
- **TC-5.9** Re-running the generator after a reschedule does **not** recreate or duplicate the rescheduled occurrence (it's "touched"). *(AC-5.3, §4.5)*
- **TC-5.10** Cancel one occurrence (by teacher) → status CANCELLED_BY_TEACHER; cancel another (by student) → CANCELLED_BY_STUDENT; no other rows change. *(AC-5.4)*
- **TC-5.11** A cancelled/rescheduled session is preserved when the schedule is later edited. *(AC-5.5, §4.5)*

### DST & timezone (priority)
- **TC-5.12** Schedule "17:00 Africa/Cairo" spanning a DST transition → occurrences before and after both render as 17:00 local; their UTC instants differ by exactly the offset change. *(AC-5.7)*
- **TC-5.13** Same test for a southern-hemisphere tz (DST in the opposite direction) to catch sign errors. *(AC-5.7)*
- **TC-5.14** A schedule in `Asia/Riyadh` (no DST) generates consistent offsets year-round. *(AC-5.7)*
- **TC-5.15** Viewer in a different timezone sees each session at the correct converted local time; stored UTC unchanged. *(AC-5.9)*
- **TC-5.16** An occurrence at a wall-clock time that does not exist on a spring-forward day is handled deterministically (documented rule: shift forward to the next valid instant) and tested. *(AC-5.7)*

### Schedule edit — future-only
- **TC-5.17** Edit a slot time → future untouched sessions move to the new time; past sessions keep old time. *(AC-5.5)*
- **TC-5.18** Add a slot (new weekday) → future sessions for that weekday appear; existing ones unaffected. *(AC-5.5)*
- **TC-5.19** Remove a slot → future untouched sessions for that weekday are removed; touched ones (with reports/rescheduled) remain. *(AC-5.5)*
- **TC-5.20** Edit schedule when a future session already has a (Sprint-6-style) report attached (simulate a report row) → that session is preserved, not regenerated. *(AC-5.5, §4.5)*
- **TC-5.21** Delete the schedule → future untouched removed; past + touched preserved; calendar reflects it. *(AC-5.6)*

### Conflicts / availability / ad-hoc
- **TC-5.22** Reschedule onto a time overlapping another of the teacher's sessions → conflict warning returned; operation still permitted (non-blocking). *(AC-5.8)*
- **TC-5.23** Create a session outside the teacher's availability windows → availability warning; permitted. *(AC-5.8)*
- **TC-5.24** Create an ad-hoc session (no schedule) → exists, appears on calendar, can be cancelled/rescheduled like any session; generator never duplicates or removes it. *(AC-5.10)*

### Teacher reassignment interaction (with Sprint 4)
- **TC-5.25** Reassign a student's teacher (Sprint 4), then regenerate future sessions → future untouched sessions carry the new teacher; past and touched sessions keep the original teacher. *(§6)*

### Authorization, isolation, audit
- **TC-5.26** Teacher `GET /api/calendar` returns only their own sessions; requesting another teacher's via `?teacherId=` → 403/filtered. *(AC-5.9)*
- **TC-5.27** Owner can view any teacher's calendar within the academy; cannot see another academy's (RLS). *(AC-5.9, AC-5.11)*
- **TC-5.28** Schedule CRUD, reschedule, cancel, and each generator run write audit entries (generator logs created/removed counts). *(AC-5.11)*

### Billing isolation (boundary with Sprint 6)
- **TC-5.29** Nothing in this sprint sets a billable status or creates an invoice/payout line; `billed`/`paid_to_teacher` remain false on all generated sessions. *(AC-5.12)*

## 11. Risks & mitigations
- **Risk (highest):** DST / timezone bugs producing off-by-an-hour sessions. **Mitigation:** per-date local→UTC conversion (§4.2/4.3); explicit DST tests in both hemispheres and a no-DST tz (TC-5.12–5.16); store UTC, render on read.
- **Risk:** Schedule edits destroying history. **Mitigation:** the strict "touched" definition (§4.5) protects any session with a status change, report, or reschedule link; TC-5.11/5.19/5.20 guard it.
- **Risk:** Duplicate sessions on re-run or concurrency. **Mitigation:** unique occurrence index + idempotent upsert; TC-5.5–5.7.
- **Risk:** Reschedule accidentally affecting siblings. **Mitigation:** single-row mutation + linked successor; TC-5.8/5.9.
- **Risk:** Non-existent wall-clock times on spring-forward. **Mitigation:** documented deterministic rule (shift to next valid instant); TC-5.16.
- **Risk:** Hidden coupling to Sprint 6 (accidentally billing here). **Mitigation:** AC-5.12 + TC-5.29 assert no billable side effects.

## 12. Estimate
**Large (highest-risk).** The schema delta is small; the **generator algorithm, the future-only edit semantics, and timezone correctness** are where nearly all the effort and tests go. Do not declare done until TC-5.12 through TC-5.21 pass. Consider building the pure recurrence/timezone functions as a separately unit-tested module before wiring the DB generator.

## 13. Handoffs to later sprints
- **Sprint 6** consumes generated `SCHEDULED` sessions: sets billable statuses (ATTENDED/ABSENT_*), writes `session_reports` against `report_field_definitions`, and fires the billing hook (setting `billed`).
- **Sprint 7** reads session status (the §5.4 matrix) to create invoice line items with snapshotted prices.
- **Sprint 8** reads ATTENDED sessions to compute payouts (setting `paid_to_teacher`).
- The "touched" rule defined here is what makes those later mutations safe against schedule regeneration.
