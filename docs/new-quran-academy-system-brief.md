# Qur'an Academy Management System — Build Brief

> How to read this: I am the product owner. This is me telling you (the AI building the new project) exactly what the system must do. It is a feature map, not a design document: pages, what is on them, the rules behind them, the backend each needs, and the jobs that run on their own. Styling and visual design are out of scope here; build whatever is clean and keep it consistent.
>
> This is a **single-academy** system. One academy, one owner, their staff, their teachers, their students and parents. There is **no** multi-tenancy, no "academy type" switch, no super-admin panel, no plans or entitlements, no feature flags per client. Everything below is simply ON.

---

## 0. What we are building, in one paragraph

An online Qur'an academy runs 1-on-1 lessons over Zoom/Meet between a teacher and a student. The academy owner needs one place to: keep students, their parents and their teachers; build each student's weekly timetable and have the lessons appear automatically; have the teacher mark each lesson and write a short structured report that goes to the parent on WhatsApp; turn attended lessons into a monthly bill per family (or a prepaid block of hours); turn the same lessons into each teacher's monthly salary; follow the day's lessons live (did the teacher join, did they mark, did they report); run free trial lessons for new leads; and watch money and quality from a dashboard. Arabic is the primary language (RTL), English second. WhatsApp is the channel to parents and teachers.

Keep the same stack and architecture style we already use unless I say otherwise: **Next.js (App Router) + TypeScript** for the web app, **Laravel (PHP) JSON API** for the backend, **PostgreSQL**, Sanctum auth, `next-intl` for i18n. All business logic in the API, the web app is a thin client.

---

## 1. People and roles

### 1.1 Who logs in

| Role | Who | Scope |
|---|---|---|
| **OWNER** | The academy owner | Everything. The only role that can manage extra admin logins, the data export, and the Account tab. |
| **MANAGER** | Owner's deputy | Same as owner minus the Account tab. |
| **SUPERVISOR** | Runs the day: follows lessons, marks, approves | Everything operational, **plus** prices, packages, teacher pay and bills (create, send link, mark paid). **No** payroll finalize, no treasury/statistics pages, no settings, no team management, no audit. |
| **ACCOUNTANT** | Money | Read people and lessons; full invoices, packages, payroll, prices, teacher pay, staff salaries. |
| **CUSTOMER_SERVICE** | Sales/front desk | Students, parents, teachers (read), timetables, add/reschedule lessons, trials. No money. |
| **STAFF** | Minimal | Read students, parents, timetables, lessons. |
| **TEACHER** | Delivers lessons | Own timetable and lessons only: mark attendance, write reports, add a lesson, reschedule, *request* a cancellation or a free lesson, see own payroll, own quality reports, submit monthly student reports, Enter button. |

Parents and students **do not log in**. They receive links (invoice page, parent portal page, pay page). See §16.

### 1.2 Permissions are capabilities, not role checks

Implement RBAC as **role → set of capability codes**. Every endpoint checks one capability. Roles are data; adding a role is a data change.

The capability catalogue (use these exact codes):

- People: `student.read/create/update/deactivate`, `student.set_price`, `guardian.read/create/update`, `teacher.read/read_own/create/update/deactivate`, `teacher.set_pay`, `teacher.create_login`, `staff.read/create/update/deactivate`, `staff.set_salary`
- Scheduling: `schedule.read/manage`, `session.read`, `session.create`, `session.mark_attendance`, `session.write_report`, `session.reschedule`, `session.cancel`, `session.cancel_request`, `session.cancel_approve`, `session.free`, `session.free_request`, `session.free_approve`, `session.revert_attendance`, `session.delete`, `session.bill_override`, `session.follow`, `supervision.stats`
- Trials: `trial.read/manage`
- Reports: `report_field.manage`, `student_report.submit`, `student_report.review`, `teacher_report.manage` (private notes on a teacher), `certificate.read/manage`
- Quality: `teacher_quality.read/manage/read_own`, `teacher_quality.insights`
- Money: `invoice.read/create/close/mark_paid/send_link`, `package.read/manage`, `payout.read/read_own/finalize/adjust`, `payment_settings.manage`
- System: `notification.read`, `audit.read`, `settings.manage`, `specialization.manage`, `user.invite`, `role.assign`, `role.manage`

Group the capabilities into **areas** for the role builder UI (each area has a "view" set and a "manage" set, and a kind: operations / financial / statistics): students, guardians, teachers, schedules, lessons, supervision, trials, notifications, quality, student_reports, teacher_notes, certificates, settings, staff, access, audit · invoices, packages, payroll, student_prices, teacher_pay, staff_salaries, lesson_billing, payment_settings · statistics.

### 1.3 Team & permissions page (`/staff`, tabs: People / Roles)

- **People tab**: every staff member (not teachers): name, phone, department, role, salary (money cap only), notes, active flag. Create a login for them (email + password), reset password, deactivate (login dies immediately, sessions revoked), reactivate.
- **Roles tab**: the role builder. A table of areas × (view / manage) checkboxes. Built-in roles (SUPERVISOR, ACCOUNTANT, CUSTOMER_SERVICE, STAFF, MANAGER) are **editable as add/remove deltas** on top of their defaults, with a "reset to default" button. The owner can also create **custom roles** from scratch and assign them to staff.
- Everything a staff member does is attributed: lists of students, teachers, parents, trials and lessons show a **"Done by"** column (who created the record) with a filter by staff member.

### 1.4 Account lifecycle rules

- Password change is real (hash + revoke other tokens). Forgot-password / reset-password flow by email with throttling.
- Deactivating a teacher or staff member revokes their tokens and refuses login, keeps every record.
- A teacher can be created **without** a login (just a person) and given one later.
- Extra **admin logins** for the owner (Settings → Account): several people can sign in as OWNER.

---

## 2. Domain glossary (use these words everywhere: code, DB, UI)

| Term | Meaning |
|---|---|
| **Guardian / Parent** | The payer. Owns one or more students. Has a WhatsApp number, country, currency, notes, secondary phone. An adult student can be their own guardian ("self"). |
| **Student** | The learner. Name, WhatsApp, secondary phone, country, notes, status (`TRIAL`, `TRIAL_BOOKED`, `REGULAR`, `GRADUATED`, `WITHDRAWN`), guardian, one or more teachers (one per course), a subscription, a timetable. |
| **Teacher** | Delivers lessons. Specialization, timezone, currency, pay type and rates, weekly availability, meeting link (Zoom/Meet), payout method (InstaPay / wallet) + handle, optional login. |
| **Subscription** | A student's commercial terms: plan label, price, currency, price basis, start date, status (`ACTIVE/PAUSED/ENDED`), lessons per month, lesson length. Price is **per student**, negotiated. |
| **Schedule (timetable)** | A weekly recurring template per student per teacher: slots (weekday, local start time, duration), timezone, **start date**. |
| **Session / Lesson** | One concrete occurrence generated from a timetable (or added by hand). Has a status that drives money. |
| **Report** | The structured per-lesson report (academy-defined fields) the teacher fills after the lesson and sends to the parent. |
| **Invoice (bill)** | A monthly document per guardian (or per student) built automatically from billable lessons. Immutable once closed. |
| **Package** | A prepaid block of hours as the alternative billing clock to the monthly bill. |
| **Payout (statement)** | A teacher's monthly salary document built from attended lessons + rewards − deductions. Immutable once finalized. |
| **Trial** | A free taster lesson for a lead (not yet a student) or a student. |
| **Audit log** | Append-only: who did what, before/after. |

---

## 3. Navigation (the sidebar, in this order)

**General**: Dashboard · Notifications
**People**: Students · Parents · Teachers · Schedule (calendar) · Attendance (lessons) · Trials · Supervision · Teacher performance
**Academics**: Student reports (teacher side) · Student report reviews (admin side) · Certificates
**Financial**: Invoices · Due packages · Open packages · Finished packages · Payroll (or "My payroll" for a teacher) · Discounts & awards · Financial statistics
**System**: Settings · Audit log · Team & permissions

Items are hidden when the user lacks the capability. Badges on items: new notifications; lessons awaiting attendance today; custom bills unpaid over a day; packages awaiting payment; trials waiting for a decision; student reports awaiting review.

Arabic labels: لوحة التحكم، الإشعارات، الطلاب، أولياء الأمور، المعلمون، الجدول، الحضور، التجارب، الإشراف، أداء المعلّمين، تقارير الطلاب، مراجعة تقارير الطلاب، الشهادات، الفواتير، الباقات المستحقة، الباقات المفتوحة، الباقات المنتهية، الرواتب، الخصومات والمكافآت، الإحصائيات المالية، الإعدادات، سجل التدقيق، الفريق والصلاحيات.

---

## 4. Dashboard (`/dashboard`)

**Owner/staff view**: greeting + "live" strip, then KPI tiles and quick actions.

- KPIs: active students, teachers, lessons this week, lessons needing attendance (today / overdue), hours this month, open invoices, paid invoices, total due, awaiting payment, collection rate, average invoice, teacher salaries this month, net profit (billed − salaries).
- Finance block: billed vs collected vs outstanding for the month, invoice breakdown by status, simple revenue chart (last 6 months).
- Quick actions: add student, mark attendance, view calendar, view invoices, payroll, financial statistics.
- Links jump to filtered pages (e.g. attendance with `?view=overdue`, students with `?tab=trials`).

**Teacher view**: "My lessons today" (time, student, Enter button, mark button), my earnings this month, my pending reports, my quality reports and adjustments, my payroll link.

Backend: one aggregated `GET /dashboard` endpoint per role (don't make the page fire ten requests).

---

## 5. Students (`/students`, `/students/{id}`)

### 5.1 List
- Columns: student, parent (or "self"), teacher(s) with "since" date, subscription (plan label, basis, lessons/month, start date), rate (money cap only), status, country, WhatsApp, added on (+ done by).
- Filters: status (active/inactive), stage (trial / trial booked / regular / graduated / withdrawn), subscription status, teacher, search by student or parent name/phone. **Search must find Arabic names however typed** (normalize hamza/taa marbuta/alef variants, ignore diacritics). Pagination + sort by name / start date / created.
- Stats tiles: total, active, inactive, trials.
- Tabs: All students / Trials (students in trial stage, with a "schedule trial" action).

### 5.2 Enrollment wizard (new student)
Steps: **Profile** (name, WhatsApp, secondary phone, country, parent: pick existing / create new / "self", notes) → **Pricing** (choose monthly billing *or* a lesson package, never both) → **Teacher** (one or more teachers, each with a course label e.g. تجويد / حفظ) → **Schedule** (weekly slots per teacher, timezone, start date; can skip).

### 5.3 Monthly subscription terms (the money basis)
`price_basis` is one of:
- `PER_SESSION` — price per lesson; each billable lesson adds one line at that price.
- `PER_HOUR` — price per hour; a lesson adds `price × minutes/60`.
- `PER_MONTH` — fixed monthly fee for `sessions_per_month` lessons; each billable lesson adds `fee / quota`, the **last lesson of the month absorbs the rounding remainder**; lessons beyond the quota are billed at the per-lesson share.
- `PER_PACKAGE` — the student is on prepaid hours (§12); **never** gets a monthly line.
- `FREE` — scholarship: lessons are tracked, teacher is paid, **no invoice is ever opened**.
Plus `lesson_minutes` (null ⇒ quota is counted in hours, otherwise quota is a count of lessons of this length), plan label, currency (defaults to guardian's then academy's), start date, status.

Changing the price: `PATCH /students/{id}/subscription/price` with a **reprice preview** endpoint showing which open (not closed) invoice lines will change. Closed invoices never change.

### 5.4 Profile tabs
- **Profile**: the form; status with reason for terminal statuses; done-by.
- **Teacher**: current teachers (one per course), reassign (choose which one is replaced, effective date), full teacher history.
- **Schedule**: the student's timetable(s), one per teacher (§8).
- **Subscription**: "This month" card (lessons taught vs quota, what's still to come, this month's bill, what the family owes overall) read from the real invoice lines; or the live **Package card** when on packages. Subscriptions history card.
- **Settings**: deactivate / reactivate / remove.

### 5.5 Lifecycle rules
- **Deactivate** (soft): status becomes terminal with reason; ends the timetable, cancels all future unmarked lessons, closes an open package; the student's lessons are **hidden** from calendar and attendance (`hidden_at`) and never un-hidden.
- **Delete** = same wind-down, soft delete; record and history retained; can be restored.
- Moving a student to another parent **carries their charges** (open invoice lines move to the new family's bill; closed bills that only belong to the student change hands; shared closed bills can't split and are reported as stuck). Provide `POST /students/{id}/carry-charges` for repairing old moves.

Backend: `GET/POST /students`, `GET/PATCH /students/{id}`, `/deactivate`, `/reactivate`, `DELETE`, `PUT /subscription`, `PATCH /subscription/price`, `GET /subscription/reprice-preview`, `GET /subscription/month`, `POST /teacher` (reassign), `PUT /teachers` (set all), `GET /teacher-history`, `GET /students/{id}/reports` (report archive).

---

## 6. Parents (`/guardians`, `/guardians/{id}`)

- List: name, phone, secondary phone, country, currency, number of children, state. Search like students.
- Family profile: the parent form; children list (each with teacher, rate, phone, added on) with **add existing student / add new child / move a child here**; "moved away" panel showing children moved to other families and whether their charges moved.
- **Suspend family** (all children paused: timetables end, future lessons cancelled, dues optionally cancelled) / **Resume**.
- **Deactivate / Delete** a parent: tick which children go with them (soft delete via the student wind-down). Blocked when a child still has open money unless confirmed.
- **Parent portal card**: issue / revoke / copy / send-by-WhatsApp the private `/p/{token}` link (§16).
- Advance dues endpoint for quoting an advance invoice (§11).

Backend: `GET/POST /guardians`, `GET/PATCH /guardians/{id}`, `/deactivate`, `/reactivate`, `DELETE`, `/suspend`, `/resume`, `/advance-dues`, `/portal` (GET/POST/DELETE/`/send`).

---

## 7. Teachers (`/teachers`, `/teachers/{id}`)

### 7.1 List
Name, specialization, phone, pay (money cap only), students count, active flag, login status, done-by. Filters: active/inactive, specialization.

### 7.2 Profile workspace tabs
- **Profile**: name, phone, specialization (from the Settings list), timezone, currency, **weekly availability** (weekday + from/to local), **meeting link** (Zoom/Meet URL — the Enter button opens it), payout method (INSTAPAY / WALLET) + handle, login section (create login, reset password, deactivate).
- **Calendar**: this teacher's lessons in week/month views.
- **Lessons**: table of their lessons with mark / move / undo / delete actions, filters by range and status.
- **Punctuality**: per lesson: Enter pressed at (minutes before/after start), outcome recorded at, report filed at; averages.
- **Reports (notes)**: private staff notes on the teacher, kind `NOTE / INCIDENT / PRAISE`, author, date. Never visible to the teacher.
- **Salary**: the pay card (§13) and the list of their statements.

### 7.3 Pay types (`teacher.set_pay`)
- `HOURLY` — one hourly rate; a lesson earns `rate × minutes/60`.
- `PER_STUDENT` — an hourly rate **per student** (`teacher_student_rates`), the teacher's default rate is the fallback.
- `FIXED` — monthly salary (`fixed_salary_minor`); lessons earn nothing per lesson; the statement carries the salary as its base.
Rates are snapshotted on the payout line at marking time; an explicit **reprice** action recomputes an open (not finalized) statement.

### 7.4 Rules
- Deactivate: login revoked; students keep history; their future lessons must be reassigned or cancelled (show the count before confirming).
- Delete: soft, blocked while they have unmarked future lessons.
- Teacher-facing restrictions are academy switches (§15 Controls): lessons read-only, can reschedule, can add lessons.

Backend: `GET/POST /teachers`, `GET/PATCH /teachers/{id}`, `PATCH /login`, `/deactivate`, `DELETE`, `GET/POST/DELETE /teachers/{id}/reports`, `GET /teachers/{id}/punctuality`.

---

## 8. Schedule & calendar (`/calendar`)

### 8.1 Timetables
- A student has one timetable **per teacher**. Each: timezone, teacher, **start date** (may be in the past — then lessons are back-filled so they can be marked), slots `[ {weekday 0–6, start_time_local HH:MM, duration_minutes 1–600} ]`.
- Saving a timetable **regenerates** lessons: idempotent, future-only (except the explicit past start date), never touches a lesson that was marked, reported, rescheduled, or is in the past. Removed slots delete their untouched future lessons; edited slots move them in place. A unique index on (schedule, occurrence) is the concurrency guard.
- A rolling window: lessons exist for **this month + next month**; a nightly job rolls the window forward per academy (fan-out one job per schedule batch so one slow run can't time out everything).
- Timetable log modal: who changed what, when.

### 8.2 Calendar page
- Views: **time grid** (week/day), **month**, **agenda**, **timetables** (the weekly templates themselves). Filters: teacher, student, status. Summary strip (lessons, attended, pending, cancelled for the visible range).
- Click a lesson → actions (§9.4). Quick-create a one-off lesson from an empty slot.
- A teacher only sees their own.

Backend: `GET /timetables`, `GET/PUT/DELETE /students/{id}/schedule`, `GET /calendar?from&to&teacher_id&student_id&status`, `POST /sessions` (one-off lesson), `sessions:generate` artisan command.

---

## 9. Lessons & attendance (`/attendance`, `/sessions/{id}`)

This is the heart. Marking a lesson is what creates money on both sides.

### 9.1 Statuses
`SCHEDULED`, `ATTENDED`, `FREE`, `CANCELLED_BY_TEACHER`, `CANCELLED_BY_STUDENT`, `RESCHEDULED` (the old row of a moved lesson; points at the new row via `original_session_id`). Keep `ABSENT_UNEXCUSED` / `ABSENT_EXCUSED` only as legacy values, not selectable.

### 9.2 The billing matrix (ONE pure function, used by attendance, invoicing and payroll)

| Status | Billed to student | Counts for teacher |
|---|---|---|
| ATTENDED | yes | yes |
| FREE | no | no (on the house for everyone) |
| CANCELLED_BY_TEACHER | no (default) | no (default) |
| CANCELLED_BY_STUDENT | no (default) | no (default) |
| SCHEDULED / RESCHEDULED | no | no |

Cancellations may carry a **per-lesson override**: "still charge the student" (`bill_override`) and/or "still pay the teacher" (`teacher_override`) — the late-cancel fee. The reason typed becomes the invoice line's label ("Cancelled lesson — <reason>"). `sessions.billed` and `sessions.paid_to_teacher` are **idempotency guards only**, never the truth.

### 9.3 Marking (`POST /sessions/{id}/attendance`)
- Body: `status`, `reason`, `charge_student`, `pay_teacher`, `override_timing`.
- **Timing gate**: a lesson cannot be marked ATTENDED before it starts. Owner/manager/supervisor can override (audited); a teacher cannot.
- One transaction: write status → add/remove the invoice line (or burn package minutes) → add/remove the payout line → audit before/after. If the invoice is closed or the payout finalized, **do not fail**: carry the line to the **next open** invoice/statement (a late mark in a closed month lands in the following month, and a PER_MONTH quota is counted by the lesson's own month).
- **Revert** (`/attendance/revert`): back to SCHEDULED; removes the lines (or releases minutes), clears reason, overrides and who-marked; refused if the money document is sealed.
- Stamp who marked and when.

### 9.4 Other lesson actions
- **Reschedule** (`/reschedule`): new local datetime + timezone (+ duration); old row becomes RESCHEDULED pointing at the new SCHEDULED row. Only SCHEDULED lessons.
- **Cancel** (`/cancel`): `cancelled_by: teacher|student`, reason, `charge_student`, `pay_teacher`.
- **Add class** (`POST /sessions`): student, teacher (default: the student's teacher), local datetime, timezone, duration.
- **Duration correction** (`PATCH /sessions/{id}/duration`, with `/duration-preview`): changes minutes after the fact and re-prices the open invoice line and payout line; `rebill` / `pay_teacher` flags.
- **Delete** (`DELETE /sessions/{id}`): a hidden, no-money tombstone — **never a row delete** (the nightly roll would re-create it).
- **Mark free** (`FREE`) — teachers can only *request* it.
- **Cancellation requests** (teacher side): `POST /sessions/{id}/cancellation-request` and `/free-request`; owner sees them under Notifications → Approvals; `approve` (with charge/pay overrides) / `reject` with note; the teacher sees the decision (`seen_by_teacher_at`). Teachers **never** cancel directly.
- **Enter** (`POST /sessions/{id}/join`): the teacher's button opening their meeting link; available 10 minutes before start until the end, only for the lesson's own teacher; logs `joined_at` (feeds Punctuality and Teacher performance).
- **Following** (`POST /sessions/{id}/follow`): a supervisor presses "Following" on a live lesson; silences the not-marked alert for that lesson and feeds Supervision stats.

### 9.5 Attendance page
- Sections: **Today** (lessons today, mark inline), **Pending** (started, not marked), **Overdue** (`?view=overdue`: ended ≥ 4 hours ago and still unmarked — "الحصص المعلقة"), **Period** (any date range with filters: teacher, student, status, trials only), **Awaiting approval** (cancellation/free requests).
- Tabs **حصصي / كل الحصص** (`?mine=1`) for a staff member who also teaches.
- Each row: time, student, teacher, duration, status badge, done-by, actions: record outcome, report, send WhatsApp, reschedule, cancel, revert, Following, Enter.
- Export the visible range to Excel.
- Lesson detail page `/sessions/{id}`: everything about one lesson, its report, its money lines, its audit trail.

Backend: `GET /sessions/day`, `/day/count`, `/pending-attendance`, `/overdue`, `GET /sessions/{id}`, plus the actions above; `GET/POST /cancellation-requests`, `/approve`, `/reject`.

---

## 10. Lesson reports (the thing the parent receives)

### 10.1 Report fields are academy-defined
Settings → Report fields: ordered list of fields with `key`, Arabic label, English label, type (`TEXT`, `TEXTAREA`, `NUMBER`, `SELECT` with options, `RATING`), required flag, active flag. **Deactivate, never delete** (old reports keep their values).

Seed the Qur'an defaults:
1. `surah_from` — من سورة / آية (text, required)
2. `surah_to` — إلى سورة / آية (text, required)
3. `tajweed_rating` — تقييم التجويد (select: ممتاز / جيد جداً / جيد, required)
4. `next_assignment` — الوِرد القادم (text)
5. `notes` — ملاحظات للأهل (textarea)

### 10.2 Filing and sending
- `PUT /sessions/{id}/report`: values keyed by field key, validated against the definitions; stamps who filled it and when. Only after an outcome is recorded.
- **WhatsApp send**: build a bilingual text from the filled values (every field with a value, Arabic + English labels) plus a `wa.me/<E.164>` deep link to the parent; one-click open. When the academy's WhatsApp is connected (§14), send it directly from the system instead and record `POST /sessions/{id}/report/whatsapp-sent`.
- **Report card image**: a branded PNG of the report (academy logo, student, date, the fields) downloadable from the report modal; template editable in Settings (accent colour, style `joyful/classic`); Arabic/English.
- **Report archive** per student (`GET /students/{id}/reports`): every report, filterable, printable.
- **Overdue report**: hourly job flags lessons that ended ≥ 2 hours ago with an outcome but no report (or no outcome at all) → `REPORT_OVERDUE` notification to the owner, deduped per lesson; filing clears it.

---

## 11. Invoices (`/invoices`)

### 11.1 How a bill is built
- One **open** invoice per payer per month, created on the first billable lesson. Payer = guardian (default, `PER_GUARDIAN`: all children on one bill, lines grouped by child) or student (`PER_STUDENT`) — an academy-wide setting.
- Each billable lesson adds a line with the **snapshotted** price (basis rules in §5.3), description, student, lesson date, duration, teacher. Un-marking removes the line while the invoice is open.
- Currency: each invoice is in the payer's currency; no FX. A lesson whose currency differs opens its own invoice.
- **Close**: a monthly job on the 2nd closes last month's invoices (status `CLOSED`, totals frozen). Also a manual "close period" action for a month.
- Payment statuses: `OPEN → CLOSED → PARTIALLY_PAID → PAID`, plus `VOID`.
- **Mark paid** (`/mark-paid`): method `CASH / BANK_TRANSFER / OTHER`, amount (partial allowed), reference, reason, **payment proof image** (phone photos up to 20 MB), paid at. Every payment writes an `invoice_payment_events` row.
- **Public page** `/i/{token}`: unguessable token; shows academy name/logo, payer, month, every line (child, date, duration, teacher, amount, "not charged" lines shown struck), totals, paid/balance, payment instructions from Payment settings (bank transfer details; PayPal button if configured; card gateway if configured), and a "send proof" upload.
- **Send link** (`/send-link`): copies a ready WhatsApp message (Arabic) with the public URL, or sends it through the connected WhatsApp.

### 11.2 Other bill types
- **Quick bill** (`POST /invoices/quick`): a one-off custom bill to a student, a guardian, or a typed payer name; amount, currency, description → public pay link. Unpaid quick bills older than 24 h show a **follow-up badge** (`GET /invoices/follow-up`).
- **Advance invoice** (`POST /invoices/advance`, with `/advance-quote`): bill a month up-front from the timetable (quota × price) for a student starting on a date.
- **Manual invoice** (`POST /invoices`): payer + period + free lines.
- **Family pay link** `/f/{token}`: one page with **everything the family owes** across children and months, one payment, split per bill on settle.

### 11.3 Page
- Summary tiles: billed, collected, outstanding, collection rate for the selected month; filters: month, status, payer, search; rows with balance due, children count, paid at, method; detail modal with lines grouped by child; actions: mark paid, copy link, open in WhatsApp, view public page, view payment proof.

Backend: `GET /invoices`, `/summary`, `/follow-up`, `/advance-quote`, `POST /invoices`, `/advance`, `/quick`, `/close`, `GET /invoices/{id}`, `/mark-paid`, `/payment-proof`, `/send-link`; public `GET /i/{token}`, `GET/POST /f/{token}`; `GET /payment-settings`, `PUT /payment-settings/{BANK_TRANSFER|PAYPAL|XPAY}`.

---

## 12. Lesson packages (`/packages`, `/packages/due`, `/packages/finished`)

The second billing clock, **mutually exclusive** with the monthly bill per student.

- Open a package for a student: label, **hours** (stored as **minutes**), price, currency (hourly rate derived and snapshotted), bill timing `ON_START` (default: the bill is due the day it opens) or `ON_COMPLETION`, starts on, expires on, carry-over of leftover minutes, **auto-renew**, lesson length, teacher/course. Opening raises its invoice (one line) → public link / family pay link / WhatsApp reminder (`/remind`).
- Every ATTENDED (or charged-cancel) lesson **burns its minutes**. Consumption is **never blocked by payment** — an unpaid block raises a notification, it does not stop the teacher.
- **A lesson never splits**: if 90 minutes hits a 30-minute balance the package closes at −60 and the overdraft is either billed as one line at the package's rate (`/bill-overdraft`) or absorbed by the next block when auto-renew is on.
- Alerts: `PACKAGE_LOW` (≤ 2 lessons left), `PACKAGE_ENDED`.
- Package card on the student profile: minutes bought / used / left, lessons list (add / correct / remove a lesson's credit), status (`ACTIVE / COMPLETED / CANCELLED`), sequence number.
- Close early with **settlement** (`/settlement`, `/settle`): credit the unused value to the family, refund, or keep; cancel; "return to monthly" flag.
- Pages: **Due** (packages awaiting payment — the red badge), **Open** (live balances), **Finished** (history). Summary tiles and search.
- Out-of-package hours gap (lesson taught between blocks) = a per-student bill at the last package rate.

Backend: `GET /packages`, `/summary`, `/students`, `POST /packages`, `GET/PATCH /packages/{id}`, `/sync-lessons`, `/close`, `/cancel`, `/settlement`, `/settle`, `/bill-overdraft`, `/remind`, `/available-lessons`, `POST/PATCH/DELETE /packages/{id}/lessons`, `POST /packages/family/{guardianId}/pay-link`.

---

## 13. Payroll (`/payroll`, `/discounts-awards`)

### 13.1 Statements
- One payout per teacher per month, opened on the first attended lesson (or daily by a job for FIXED-salary teachers so their month exists even with no lesson).
- Lines: one per counted lesson, amount = rate × minutes/60 (per pay type, §7.3), currency = teacher's. Net = base (fixed salary) + Σ lines + rewards − deductions.
- **Adjustments**: `REWARD` / `DEDUCTION` with amount, reason, details, author; removable while open.
- **Finalize**: monthly job on the 3rd seals last month (`finalized_at`); manual "finalize period" too. DB triggers refuse any change to a finalized statement or its lines.
- **Reprice**: recompute an open statement from current rates (with a confirm showing the delta).
- Views: by month (teacher rows → statement modal with line items, each linking to the lesson report), **by range** (`/payouts/range` + `/range/lessons`: salaries for an arbitrary window, lessons behind each row), **profit summary** (`/reports/profit-summary`: billed vs salaries per month).
- Teacher: **My payroll** (`/me/payouts`) — own statements only, no other teacher visible.

### 13.2 Discounts & awards (teacher quality)
- **Rubric**: categories → criteria, each criterion carries a **percent** docked when the teacher does NOT meet it (store basis points).
- **Quality report** on a teacher, scope `SESSION` (bites that lesson's payout line) or `MONTHLY` (bites the month's total); items = criterion met yes/no; note; author. The report stores the percent; the cash is a **derived** `payout_adjustments` row that is recomputed when the base changes and frozen when the statement finalizes. Delta-not-recompute, waive-not-delete.
- **Manual adjustments** list with waive.
- **Auto-deduct policy**: ON/OFF, grace hours, basis `FIXED` amount or `PERCENT_SESSION`; hourly job docks the teacher for every lesson that ended past the grace window without a report (same predicate as the overdue-report alert; one deduction per lesson forever).
- Teacher side: `/me/quality-reports`, `/me/adjustments` (they see the verdicts and the money).

Backend: `GET /payouts`, `/range`, `/range/lessons`, `POST /payouts/finalize`, `GET /me/payouts`, `GET /payouts/{id}`, `POST/DELETE /payouts/{id}/adjustments`, `POST /payouts/{id}/reprice`, `GET /reports/profit-summary`; `/quality/rubric/*`, `/quality/reports/*`, `/quality/teachers/{id}/sessions`, `/quality/settings`, `/quality/adjustments/*`, `/quality/teachers/{id}/adjustments`.

---

## 14. WhatsApp

### 14.1 Connection (Settings → WhatsApp)
- The academy links **its own WhatsApp number** by scanning a QR (self-hosted gateway, e.g. Baileys-based service, exposing: start session, QR image, status, send text, send image, check number, logout). Connect is **idempotent** (never re-create a live session). Show connected / disconnected / unreachable states, unlink with warning.
- Fallback when not connected: every "send" becomes a `wa.me` deep link the staff opens by hand.

### 14.2 Automations (per academy switches)
- **Type 1 — monthly billing**: on the 3rd (configurable billing day) send each payer last month's unpaid bill + pay link; repeat as dunning. Idempotent per (invoice, month) via a send log.
- **Type 2 — lesson & trial reminders**: hourly, lessons starting within the lead window; recipients `BOTH / TEACHERS / STUDENTS`; idempotent per (lesson, recipient).
- **Payment overdue**: an invoice still owed repeats every N days from its due day until paid.

### 14.3 Staff group alerts
Link WhatsApp **groups** (by group id) and tick which alerts each receives:
- Supervision: `SESSION_STARTED`, `SESSION_NOT_MARKED` (N minutes after start, unless "Following" was pressed), `REPORT_OVERDUE`, `TRIAL_STARTED`, `TRIAL_NOT_MARKED` (from trial END).
- Accounting: `PACKAGE_LOW`, `PACKAGE_ENDED`, `PAYMENT_RECEIVED`, `PAYMENT_OVERDUE`.
- Knobs: `not_marked_after_minutes` (default 15), `report_overdue_hours` (default 2), `payment_reminder_days` (default 2). A `TEST` alert button. Conditional alerts expire if too old to be useful.
- Runs every minute as a sweep command.

Message templates (Arabic + English bodies with variables) stored in a table so wording is editable.

---

## 15. Settings (`/settings`)

Tabs:
- **Account** (OWNER only): academy name, country, timezone, default currency, logo; **extra admin logins** (name, email, password, active, last login); **Excel export** of everything (students, parents, teachers, staff, timetables, lessons, lesson reports, trials, packages, invoices, payments, payouts) — API describes the sheets, the browser builds the styled workbook.
- **Report fields** (§10.1).
- **Specializations**: the list teachers pick from (حفظ، تجويد، قراءات، تفسير، لغة عربية، نور البيان…), orderable, active flag.
- **Controls**: academy switches that subtract teacher capabilities: `teacher_lessons_read_only`, `teacher_can_reschedule`, `teacher_can_add_lessons`. Add more as needed; they apply in middleware, not in the UI only.
- **Billing**: invoice grouping `PER_GUARDIAN / PER_STUDENT`, billing day.
- **Payment settings**: bank transfer details, PayPal, card gateway credentials — what the public invoice page shows.
- **Certificates** (§17.3 templates) and **Report card** template.
- **WhatsApp** (§14).

Backend: `GET/PATCH /academy`, `GET/PUT /academy/settings`, `GET /academy/export`, `/export/{dataset}`, `GET/POST/PATCH /academy/admins`, `/report-fields` CRUD, `/specializations` CRUD, `/payment-settings`, `/certificate-templates`, `/report-card-template`, `/academy/whatsapp` (+ `/connect`, `/logout`), public `/wa/connect/{token}/{start|qr|status}`.

---

## 16. Pages for people who don't log in

- **`/i/{token}` invoice page** (§11.1).
- **`/f/{token}` family pay page** (§11.2).
- **`/p/{token}` parent portal**: a private per-family link, no password. Shows the children, upcoming lessons, lessons just taken **with their reports**, approved monthly progress reports, the family's bills with pay links. Allow-list payload: names, times, statuses, report text, amounts — never phones, prices settings, staff notes or internal ids. Issued / revoked / sent from the parent profile.
- **`/docs/teacher-guide`**: a static how-to page for teachers (Enter, mark, report, request cancellation, my payroll).
- All public pages: throttled, token ≥ 32 random chars, read-only except payment proof upload.

---

## 17. Academics

### 17.1 Trials (`/trials`)
- A trial is a free taster lesson for a **lead** (name, WhatsApp, email — not yet a student) or an existing student; teacher, local datetime + timezone, duration from `15/30/45/60/90/120`, status `SCHEDULED / COMPLETED / NO_SHOW / CANCELLED / CONVERTED`, outcome notes.
- Page = **today's agenda** + a red **needs-decision queue** (trials that ended without an outcome, from the trial END) + table with filters (date range, teacher) + manual add + reschedule + outcome form + **convert** (creates/links the student, carries name/phone, opens the enrollment wizard) + delete (cancel) and permanent delete.
- Trials appear on the calendar and in attendance ("trials only" filter) and raise `TRIAL_STARTED` / `TRIAL_NOT_MARKED` alerts. The trial-stage student statuses (`TRIAL`, `TRIAL_BOOKED`) come from here.

Backend: `GET /trials`, `/summary`, `/agenda`, `/teachers`, `POST /trials`, `PATCH /trials/{id}`, `/convert`, `DELETE /trials/{id}`, `DELETE /trials/{id}/permanent`.

### 17.2 Student monthly progress reports (`/student-reports`, `/student-report-reviews`)
- Teacher writes a monthly report per student (month, title, body up to 5000 chars) → `PENDING`.
- Reviewer approves or rejects with a note; the teacher sees the decision. One pending report per student per month.
- Approved reports show on the parent portal.
Backend: `GET /student-reports`, `/students`, `/review`, `POST /student-reports`, `/approve`, `/reject`.

### 17.3 Certificates (`/certificates`)
- A catalogue of ~9 designs (families: classic, heritage, kids, modern, with variants). **Design numbers are permanent** (a template references its number).
- Per-design academy template: title, body text (AR/EN), accent colour, show logo, signature line.
- Issue to one student (recipient name, course title, date, serial) or **bulk** to a selected list (serial range), preview gallery, download PDF/PNG one-by-one or as a batch.
Backend: `GET /certificate-templates`, `PUT /certificate-templates/{number}`; rendering is client-side.

### 17.4 Supervision stats (`/supervision`)
How promptly each supervisor **followed** the day's lessons and how promptly outcomes were **marked**: tiles (lessons, followed, followed on time, marked, marked on time, pending), per-person table (avg follow delay, avg mark delay, on-time vs late), per-lesson drill-down, definitions of "on time" (follow within N minutes of start, mark within N minutes of end). Date range filter.
Backend: `GET /supervision/stats?from&to`.

### 17.5 Teacher performance (`/teacher-quality`)
Per teacher, for a range: lessons taught of scheduled, **avg Enter delay** (from the join log), **avg report delay** (report `created_at` − lesson end), student attendance/absence rate, a score; highlights (most punctual, fastest reporter, needs attention); detail drawer with the per-lesson log (entered at, marked, report filed). Chips for inactive / no meeting link.
Backend: `GET /teacher-insights?from&to`, `GET /teacher-insights/teachers/{id}`.

### 17.6 Financial statistics (`/financial-statistics`)
Monthly series: billed, collected, outstanding, salaries, net; per-currency with an **exchange-rate** table the owner can set (`GET /reports/exchange-rates`) to show a converted total; top payers, top earners, collection rate trend.

---

## 18. Notifications (`/notifications`)

Owner/staff feed with tabs:
- **Approvals**: cancellation & free-lesson requests from teachers (approve/reject inline).
- **Reports**: `REPORT_OVERDUE` alerts.
- **Money**: package low/ended, unpaid package, payment received, payment overdue.
- **Attended classes**: a log tab of every `LESSON_ATTENDED` (who marked which lesson when) — its own feed, never on the bell.
- Mark read / read all; summary endpoint for the badge; unique (lesson, type) so sweeps never duplicate.
Teacher feed: decisions on their requests, quality reports, auto-deductions.
Backend: `GET /notifications`, `/summary`, `POST /read-all`, `POST /{id}/read`.

---

## 19. Audit log (`/audit`)

Append-only `audit_log`: actor, role, action, entity type/id, before/after JSON, timestamp. Written for every sensitive mutation: price change, subscription change, invoice close/mark paid/void, payout finalize/adjust, schedule save/delete, lesson status change (incl. timing override), teacher reassign, role/permission change, login create/deactivate, settings change, deletes. Page: filterable by actor, entity, action, date; detail modal with a before/after diff.

---

## 20. Scheduled jobs (one cron line → Laravel scheduler; expose `/api/health` with each job's last-run age)

| Job | When | What |
|---|---|---|
| Scheduler heartbeat | every minute | writes a timestamp the health page reads |
| Roll session window | daily 00:30 | extend every timetable's lessons to cover this + next month, reconcile (idempotent) |
| Open fixed-salary payouts | daily 00:40 | create this month's statement for FIXED teachers |
| Close monthly invoices | 2nd, 01:00 | close last month's open invoices |
| Close monthly payouts | 3rd, 01:30 | finalize last month's statements |
| Flag overdue reports | hourly | `REPORT_OVERDUE` notifications (2 h grace, 14-day lookback) |
| Auto-deduct unreported | hourly at :30 | dock pay per policy (§13.2) |
| Monthly student billing (WA type 1) | 3rd, 08:00 | send unpaid bills + links |
| Lesson reminders (WA type 2) | hourly | upcoming lesson/trial reminders |
| WhatsApp group alerts | every minute | the supervision/accounting sweeps |
| Package reminders / payment overdue | daily 09:00 | repeat unpaid reminders |

Every job is idempotent and safe to re-run; log failures per job, never let one failure abort the rest.

---

## 21. Cross-cutting rules (non-negotiable)

1. **Money** is integer minor units + ISO currency code. Never floats. No FX conversion inside documents.
2. **Time**: store UTC; timetables in local time + IANA timezone; render in the viewer's timezone. Beware binding naive timestamps into `timestamptz` columns when app and DB timezones differ — always bind explicit UTC.
3. **Idempotency** everywhere money or generation is involved: unique (invoice, session), unique (payout, session), unique (schedule, occurrence), unique (session, notification type), unique (session) per auto-deduction.
4. **Immutability**: closed invoices and finalized payouts are frozen by DB triggers, not just app code.
5. **Soft delete** people, timetables, trials; **tombstone** lessons; **append-only** audit and payment events.
6. **Derived, not stored**: billable/counts-for-teacher come from the status matrix; quality cash from the percent; "this month" cards from real lines.
7. **Transactions**: every write request runs in one DB transaction; validation that happens after a write must throw inside it (a 422 after a partial write must roll back).
8. **Search** normalizes Arabic (hamza forms, taa marbuta/haa, alef maqsura/yaa, diacritics) on name and phone across students, parents, teachers, and every picker.
9. **Bilingual**: all strings externalized; Arabic RTL default, English LTR; dates/numbers localized; WhatsApp messages bilingual.
10. **Mobile-first**: every list works on a phone (single-column cards at small widths, bottom-sheet modals, never truncate money).
11. **Done by**: creator of every people/lesson record is visible and filterable.
12. **Uploads**: payment proofs and logos up to 20 MB, images only, stored outside the web root, served through signed/authorized routes.
13. **Performance**: badges and feeds poll gently and pause in hidden tabs; aggregate endpoints for dashboard/summaries.
14. **Tests**: every rule in §9.2, §5.3, §12, §13 gets a test; a test DB with migrations; feature tests for every endpoint's authorization (each role gets 403 where it should).

---

## 22. Data model (tables and the columns that matter)

- `users` (id, full_name, email, password, phone, is_active, locale, last_login_at) · `user_roles` (user_id, role) · `permissions`, `role_permissions`, `academy_roles` (custom), `academy_role_permissions`, `academy_role_tunings` (role, added[], removed[])
- `academy` (single row: name, timezone, country, default_currency, invoice_grouping, billing_day, logo) · `academy_settings` (switches) · `academy_payment_settings` (method, is_active, config) · `academy_automation_settings` (type1/type2 flags + config) · `message_templates` · `automation_send_log` · `whatsapp_groups` (group id, events[], settings)
- `guardians` (full_name, whatsapp_phone, secondary_phone, country, currency, notes, deleted_at, suspended_at)
- `students` (guardian_id, full_name, whatsapp_phone, secondary_phone, country, status, notes, deleted_at, created_by) · `student_teacher_assignments` (student, teacher, course, started_at, ended_at) · `subscriptions` (student, plan_label, sessions_per_month, lesson_minutes, price_minor, currency, price_basis, status, start_date)
- `teachers` (user_id?, full_name, phone, specialization, timezone, currency, pay_type, session_rate_minor, fixed_salary_minor, availability jsonb, meeting_url, payout_method, payout_handle, is_active, deleted_at) · `teacher_student_rates` · `teacher_reports` (kind, body, author)
- `staff` (user_id?, full_name, phone, department, role, salary_minor, currency, notes, is_active) · `staff_departments`
- `specializations` · `report_field_definitions` (key, label_ar, label_en, field_type, options, sort_order, is_required, is_active)
- `schedules` (student, teacher, timezone, start_date, is_active, deleted_at) · `schedule_slots` (weekday, start_time_local, duration_minutes)
- `sessions` (student, teacher, schedule_id, scheduled_at_utc, duration_minutes, status, status_reason, original_session_id, billed, paid_to_teacher, bill_override, teacher_override, marked_by, marked_at, hidden_at, is_trial?) · `session_reports` (session, values jsonb, filled_by, filled_at, whatsapp_sent_at) · `session_joins` (session, teacher, joined_at) · `session_follow_ups` (session, user, followed_at) · `session_cancellation_requests` (session, teacher, cancel_type, reason, status, decided_by, decided_at, decision_note, seen_by_teacher_at)
- `trials` (teacher, student?, lead_name, lead_whatsapp, lead_email, timezone, scheduled_at_utc, duration_minutes, status, outcome_note, converted_student_id)
- `invoices` (guardian?/student?/payer_name, period_year, period_month, status, currency, subtotal_minor, total_minor, amount_paid_minor, public_token, closed_at, paid_at, payment_method, payment_reason, payment_reference, payment_proof_path, kind: AUTO/QUICK/ADVANCE/PACKAGE) · `invoice_line_items` (invoice, session?, student, description, amount_minor, currency) · `invoice_payment_events`
- `lesson_packages` (student, label, minutes_total, minutes_consumed, carried_over_minutes, minutes_overdrawn, price_minor, currency, hourly_rate_minor, bill_timing, status, sequence_no, starts_on, expires_on, invoice_id, overdraft_invoice_id, auto_renew, next_terms jsonb, closed_at, closed_reason) · `lesson_package_credits` (package, session UNIQUE, minutes, minutes_overdrawn, amount_minor, consumed_at)
- `payouts` (teacher, period_year, period_month, base_minor, total_minor, currency, finalized_at) · `payout_line_items` (payout, session UNIQUE, amount_minor) · `payout_adjustments` (payout, type, amount_minor, reason, details, source: MANUAL/QUALITY/AUTO_UNREPORTED, session_id?, quality_report_id?, waived_at, created_by)
- `teacher_quality_categories` · `teacher_quality_criteria` (discount_bp) · `teacher_quality_reports` (teacher, scope, session?, period, total_bp, note, author) · `teacher_quality_report_items` · `teacher_quality_settings` (auto_deduct_*)
- `student_progress_reports` (student, teacher, period_month, title, body, status, review_note, reviewed_by, reviewed_at, seen_by_teacher_at)
- `certificate_templates` (template_number, content jsonb) · `report_card_template` (content jsonb)
- `notifications` (type, category, audience_role, recipient_user_id?, session_id?, data jsonb, read_at) · `guardian_portal_tokens` · `family_pay_tokens`
- `audit_log` (actor_user_id, actor_role, action, entity_type, entity_id, before, after, created_at)
- `exchange_rates` (from, to, rate, month)

---

## 23. Build order (what I want first)

1. **Foundation**: auth, roles/capabilities + role builder, users/staff, academy settings, i18n, audit log, health endpoint.
2. **People**: parents, students (wizard, subscription bases, multi-teacher), teachers (pay types, availability, meeting link, logins), specializations.
3. **Scheduling**: timetables + generator + rolling job, calendar views, one-off lessons, reschedule/cancel/delete.
4. **Attendance + reports**: status matrix, marking with all guards, cancellation requests, Enter/Following, report fields + report + WhatsApp text + archive + report card image, overdue sweeps, attendance page sections, lesson page.
5. **Money**: invoices (auto, quick, advance, public page, mark paid, proofs, family pay), payroll (statements, adjustments, finalize, reprice, my payroll), packages, discounts & awards, financial statistics, dashboard numbers.
6. **Ops**: notifications feed, trials, supervision stats, teacher performance, student progress reports, certificates, parent portal.
7. **WhatsApp**: gateway connect, direct sends, automations, group alerts, templates.
8. **Polish**: Excel export, teacher guide, mobile pass, test suite green.

Ship each phase usable on its own. Ask me when a rule here conflicts with something you find; do not silently pick one.
