# Group Classes (المجموعات)

English academies, language centres and subject "سناتر" teach **groups**: one teacher, several
students, a fixed weekly timetable, its own price, its own attendance and its own statistics. The
management system was built 100 % around the private lesson (one teacher, one student). This
module adds the group class next to it, without changing how a private lesson works.

It is a per-client switch, like Packages or Supervision: the `groups` feature of the MANAGEMENT
module. Turning it off hides the module and stops its jobs. It never deletes anything, and turning
it back on brings everything back.

---

## The five decisions

Everything below follows from these.

### 1. A group lesson is NOT a `sessions` row

`sessions.student_id` is `NOT NULL`: a lesson in this system is one teacher and one student. At
least 22 backend files read that table directly, including attendance, the calendar, supervision,
punctuality, the auto-deduct sweep, overdue-report alerts, WhatsApp group alerts, packages,
payroll, the Enter button and video rooms.

"One `sessions` row per member under a shared parent" was considered first and rejected. Every one
of those surfaces would then show a 15-student class 15 times, alert about it 15 times, deduct
from the teacher 15 times and pay them 15 times, unless each one was patched on day one.

A group lesson therefore lives in its own tables (`class_group_lessons` +
`class_group_attendance`). The free-trials feature already works this way: a trial is a real hour
of a real teacher, it is never a `sessions` row, and the calendar carries it as its own feed. With
the switch off, the private-lesson system is byte-for-byte what it was. Each surface that should
know about groups (calendar, attendance, payroll, alerts) gains a group feed **deliberately**,
one at a time, instead of all of them breaking at once.

### 2. A group lesson pays the teacher ONCE (Phase 2)

There is one payout line per group lesson, never one per student. Whatever the pay mode (§Money),
the line is anchored to the lesson, the same way a private payout line is anchored to its session.

### 3. Members are ordinary students

There is no second "group student" identity. A member is a `students` row, with their guardian,
phone, invoices and profile. The same child can take private lessons with one teacher and sit in
two groups, and their parent gets **one** bill with all of it (Phase 2).

### 4. Off means hidden and stopped, never deleted

The `groups` capability gates every `/groups*` and `/group-lessons*` route (`entitled:groups`,
402 when off), the sidebar item (`NAV_CAPABILITY`), the calendar feed, and lesson generation in
the nightly roll. The rows stay. Re-enabling regenerates the window and everything is where it
was.

### 5. Named `class_groups`, never `groups`

"Group" already means the academy's WhatsApp **staff** groups (`whatsapp_group_alerts`,
`GROUP_ALERT_*`). The tables, classes and routes say `class_group` / `group-lessons`; the UI says
"المجموعات". This is the same lesson as `lesson_packages` vs. the Super-Admin "package".

---

## Data model (Phase 1)

```
class_groups ─┬─ class_group_slots       weekly timetable (weekday + local time + minutes)
              ├─ class_group_members     who is in it, from when to when
              └─ class_group_lessons ─── class_group_attendance   one row per (lesson, student)
```

| Table | What it holds |
|---|---|
| `class_groups` | name, `specialization_id` (subject), `level`, `teacher_id`, `capacity` (null = no limit), `mode` ONLINE/OFFLINE, `location` (room/branch), `meeting_url` (falls back to the teacher's), `timezone`, `start_date`, `end_date` (null = open-ended), `notes`, `status` ACTIVE/ARCHIVED |
| `class_group_slots` | `weekday` 0–6, `start_time_local`, `duration_minutes`. Same shape as `schedule_slots` |
| `class_group_members` | `student_id`, `joined_on`, `left_on`, `status` ACTIVE/LEFT, `left_reason`. One open membership per (group, student) |
| `class_group_lessons` | `teacher_id` (snapshot, so a substitute is possible), `slot_id` (null for an extra lesson), `occurrence_local_date`, `scheduled_at_utc`, `duration_minutes`, `status` SCHEDULED/HELD/CANCELLED, `cancel_reason`, `moved_at`, `topic`, `homework`, `notes`, `outcome_set_at/by` |
| `class_group_attendance` | `lesson_id`, `student_id`, `status` PRESENT/LATE/ABSENT/EXCUSED, `note`. Unique (lesson, student) |

Every table is a tenant table under the standard FORCE row-level-security policy. Statuses are
`text` + `CHECK` (like `teachers.pay_type`), not Postgres enums, so adding one later is a plain
migration.

**Lifecycle state is derived, not stored.** An ACTIVE group whose `start_date` is in the future is
*upcoming*. One whose `end_date` has passed is *finished*. Anything else is *running*. ARCHIVED is
the only stored terminal state.

**Who is expected at a lesson** is the set of members whose membership covers the lesson's local
date (`joined_on ≤ date` and `left_on` is null or `≥ date`), plus anyone who already has an
attendance row on it. Joining in week 3 never makes you "absent" for weeks 1–2, and leaving never
rewrites the attendance you already have.

---

## Generation

`App\Services\GroupLessonGenerator` mirrors `SessionGenerator`'s contract exactly:

- **Idempotent.** The unique `(group_id, slot_id, occurrence_local_date)` index is the backstop,
  so a re-run creates nothing.
- **Never rewrites history.** Only *untouched* future lessons are realigned or deleted:
  SCHEDULED, not moved, no attendance, not yet started. Anything held, cancelled, moved or past is
  never touched.
- **Back-fills from the start date.** Saving a group whose `start_date` is in the past creates the
  lessons since then as SCHEDULED, so the academy can mark them (same rule as timetables,
  `schedule-start-date`). The per-date count guard stops an edited slot time from duplicating
  lessons already taught.
- **Bounded by the group's dates.** Nothing is created before `start_date` or after `end_date`. An
  ARCHIVED group has an empty intended set, so archiving deletes only its future untouched lessons.

It runs on save (create / edit slots / change teacher / archive / restore) and in the nightly
`RollSessionWindowJob`, **only for academies that hold `groups`**.

---

## Attendance

One sheet per lesson. **"All present"** is the default, and the teacher only taps the
exceptions: Late, Absent, Absent with excuse. The same save records the lesson's `topic` (what
was taught), `homework` and `notes`, and moves the lesson to HELD.

- Re-saving the sheet edits it (Phase 1 has no money attached, so nothing is frozen yet).
- **Revert** (`session.revert_attendance`) puts the lesson back to SCHEDULED and clears the sheet.
- **Cancel** (group.manage) marks the lesson CANCELLED with a reason. It applies to the whole class
  at once, by construction, because there is one row.
- **Reschedule** moves one lesson (`moved_at` set, so the generator never drags it back).
- **Extra lesson** (حصة تعويض): an ad-hoc lesson with no slot.

A TEACHER sees and marks only their own groups' lessons. They hold `session.mark_attendance`
already; group access adds `group.read` (row-scoped to their groups).

---

## The switch

- `FeatureCatalog::MODULE_CAPABILITIES['MANAGEMENT'][] = 'groups'`. The client's **Features**
  card in Super Admin lists it automatically (it reads the catalog), with its own label in
  `feature-labels.ts`.
- **Existing clients get it OFF.** A module grants everything it owns, so a new MANAGEMENT feature
  would otherwise appear in every live client's sidebar on deploy. Migration
  `2026_10_19_000002_class_groups` adds `groups` to each live MANAGEMENT subscription's
  `overrides.disabled`. The Super Admin ticks it on per client.
- **New clients get it ON** (the module default). The Super Admin unticks it for a private-only
  academy, from the same card.
- A platform kill-switch row in `feature_flags` (enabled), like every other feature.

### Permissions

| Capability | Who by default | What it opens |
|---|---|---|
| `group.read` | Owner, Supervisor, Teacher (own groups only) | the Groups pages, a group's lessons and members |
| `group.manage` | Owner, Supervisor | create / edit / archive / delete a group, members, slots, cancel / move / add lessons |
| `session.mark_attendance` (existing) | Owner, Supervisor, Teacher | the attendance sheet |
| `session.revert_attendance` (existing) | Owner, Supervisor | un-mark a held lesson |

`PermissionCatalog::FEATURE_BY_DOMAIN['group'] = 'groups'`, so the role builder offers these only
to an academy that has the module. A group's **price** (Phase 2) is money and will be gated by
`student.set_price`, which is already in `FINANCIAL`. That keeps it away from supervisors.

---

## API (Phase 1)

All under `entitled:groups`, all audited.

| Method | Path | |
|---|---|---|
| GET | `/groups` | list: teacher, subject, member count / capacity, slots, next lesson, derived state |
| POST | `/groups` | create + slots + initial members, then generate |
| GET | `/groups/{id}` | group, slots, members, counters |
| PATCH | `/groups/{id}` | edit details / slots / teacher, then regenerate |
| POST | `/groups/{id}/archive` · `/restore` | archive (drops future untouched lessons) / bring back |
| DELETE | `/groups/{id}` | only while nothing was ever held; otherwise 422 → archive |
| POST | `/groups/{id}/members` | add students (capacity enforced unless `allow_over_capacity`) |
| DELETE | `/groups/{id}/members/{studentId}` | leave (`left_on`, reason) |
| POST | `/groups/{id}/members/{studentId}/move` | leave this group, join another, same day |
| GET | `/groups/{id}/lessons` | lessons in a window, with attendance counts |
| POST | `/groups/{id}/lessons` | extra lesson |
| GET | `/group-lessons/{id}` | lesson + attendance sheet (expected members) |
| POST | `/group-lessons/{id}/attendance` | save the sheet → HELD |
| POST | `/group-lessons/{id}/attendance/revert` | back to SCHEDULED |
| POST | `/group-lessons/{id}/cancel` | CANCELLED + reason |
| POST | `/group-lessons/{id}/reschedule` | move one lesson |

`GET /calendar` gains a third feed, `group_lessons`, only for an academy holding `groups`.
Teacher-conflict warnings on private lessons now count the teacher's group lessons too, because
the teacher is just as busy.

---

## Screens (Phase 1)

- **Sidebar → المجموعات** (`/groups`, `group.read`, gated by `groups`). Cards per group: name,
  subject/level, teacher, *12 / 15* seats, the weekly times, the next lesson, and the derived state.
  Filters: running / upcoming / finished / archived, teacher, search.
- **Group page** (`/groups/{id}`) with tabs:
  - **Lessons** (default): upcoming and past, each with a status pill and the *present / expected*
    count. One tap opens the attendance sheet.
  - **Members**: add students (search the roster), remove, move to another group, seats left.
  - **Schedule**: the weekly slots and the dates.
  - **Overview**: attendance rate, lessons held / remaining, each member's attendance %.
- **Calendar**: a group lesson is ONE block labelled with the group name and the member count, not
  one block per student. Clicking it opens a card that links to the group page.

---

## Money (Phase 2, designed now so Phase 1 does not block it)

**What the student pays.** One mode per group, overridable per member (sibling discount,
scholarship):

| Mode | When the line is raised | Absences |
|---|---|---|
| `MONTHLY` (default) | Up front, on the 1st (or on joining, pro-rated optionally) | do not reduce it |
| `PER_LESSON` | One line per lesson the student was expected at | academy setting: charge absences or not |
| `COURSE` | One line on joining, for the whole level | n/a; installments optional |

Group lines land on the **same** invoice as the private lessons (per guardian or per student, as
the academy groups invoices). `invoice_line_items.session_id` is already nullable since manual
invoices, so a group line carries `class_group_id` / `class_group_lesson_id` instead.

**What the teacher earns per group lesson** (one line per HELD lesson):

| Mode | Amount |
|---|---|
| `PER_LESSON` | fixed amount |
| `PER_HOUR` | rate × duration (the group's rate, else the teacher's) |
| `PER_STUDENT` | rate × students present (the natural fit for the existing per-student pay type) |
| `REVENUE_SHARE` | % of the group's billed revenue for the month (common in centres) |

A FIXED-salary teacher gets 0-value lines, as with private lessons.

**Guards to carry over:** packages never consume group lessons. A held lesson whose invoice is
closed, or whose payout is finalised, cannot be reverted (same immutability as private). "Paid
up front" never blocks attendance (rule 3 of packages: consumption is not collection). A student
whose only enrolment is a group must count as enrolled. Today `REGULAR` requires an active
subscription, so that check must learn about memberships.

---

### As built (Phase 2)

- **Schema** (`2026_10_19_000004_class_group_money`): price + rule columns on `class_groups`, a
  per-member `price_minor` on `class_group_members`, and group links on both money documents.
  `invoice_line_items` gains `class_group_id / class_group_lesson_id / group_charge / group_period`,
  with partial unique indexes so a member is never billed twice for a month, a lesson or an
  enrolment. `payout_line_items.session_id` became nullable, and gains `class_group_lesson_id`
  (unique: one line per lesson) and `class_group_id + group_period` (unique: one revenue-share line
  per group per month).
- **Where a charge lands:** the payer's ordinary AUTO invoice for that month
  (`Invoicing::addGroupLine`). If that month's invoice has already closed, the charge goes on the
  current month's invoice. A closed bill is never reopened.
- **MONTHLY** is raised when a member joins (back-dated joins owe the months they cover, at most 12),
  when a price is first set, and by the daily `BillGroupMonthsJob` (00:45, after the roll). The
  join month is pro-rated by lessons: 4 of the month's 9 lessons left ⇒ 4/9 of the price. A
  student moved between groups is not billed the same month twice.
- **Prices are snapshots.** A new group or member price applies from now on, and charges already
  made keep theirs.
- **Teacher pay:** `GroupPayroll::syncLessonPay` keeps exactly one line per HELD lesson on its
  teacher's statement, re-priced as the sheet changes. `REVENUE_SHARE` is one monthly line, kept in
  step every time a group charge is raised or removed. It is only allowed when the group bills in
  the teacher's currency.
- **Payroll screens** show group lines under the group's name. Their minutes count toward hours
  taught; a revenue-share line is not counted as a lesson.
- **Who sees money:** `pricing` needs `student.set_price` or `invoice.read`, `teacher_pay` needs
  `teacher.set_pay` or `payout.read`, and the Money tab / `GET /groups/{id}/money` needs
  `invoice.read`. Setting a price needs `student.set_price`, and setting teacher pay needs
  `teacher.set_pay` (the team-roles rework's split of teacher rates).
- **Switches:** nothing bills without `invoicing`, and nothing pays without `payroll`.
- **A group-only student may be REGULAR:** an open membership counts as enrolment.
- **Atomicity:** the request transaction does not roll back a 422 (Laravel renders the exception
  before it returns to the middleware). So a sheet and its money, members and their bills, and a
  move each run in their own nested transaction.

## Alerts & statistics (Phase 3)

**Messages.** Each one is per lesson or per member, never ×N:

- reminder before the lesson to every member's parent (rides `LessonReminderJob`)
- absence notice to the parent the moment the sheet is saved
- monthly fee due, plus a repeating overdue reminder (rides `PAYMENT_OVERDUE`)
- broadcast to the whole group (cancellation, homework, announcement)
- group ends in 2 lessons → renew / next level; group full / seat freed
- staff WhatsApp group: group lesson started / not marked (once per lesson)

**Statistics per group:** seats used, attendance rate per lesson and per member, 3-absences-in-a-row
flag, expected vs. collected, unpaid members, teacher cost and margin, held / remaining, dropouts
and renewals.

**Other pages:** dashboard (today's groups, unpaid group fees), student profile (Groups tab), teacher
profile (groups + pay), Attendance page (group lessons in the pending/overdue lists), Supervision,
Financial statistics (private vs. groups revenue), report card + bulk certificates per group, one
video room per group lesson, student deactivation leaves their groups.

## Later (Phase 4)

Waiting list, placement test and level progression, exams and grades, trial seat in a group, room
clash detection for offline centres.

---

## Phases

| Phase | Scope | Status |
|---|---|---|
| **P1** | tables, switch, permissions, generation, groups pages, members, attendance sheet, calendar feed | built 2026-10-19 (uncommitted) |
| **P2** | student billing modes, teacher pay modes, invoices, payroll, enrolment status | built 2026-10-19 (uncommitted) |
| **P3** | reminders & absence messages, statistics, dashboard / student / teacher / attendance / supervision pages | — |
| **P4** | waiting list, levels, exams, trials in groups, rooms | — |

## Open questions (defaults taken, change any)

1. Default billing mode: **MONTHLY up front** (vs. per lesson).
2. Teacher pay: **all four modes**, default `PER_LESSON`. Which one do the clients actually use?
3. Existing clients: **off**. New clients: **on**.
4. Offline rooms: a free-text `location`, **no clash check** until P4.
