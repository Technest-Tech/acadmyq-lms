# Splitting the centre's private subscription off the Quran package engine

Written 2026-11-04 after lingo's second week on the system. Read `00-OVERVIEW.md` first (the
profile rule: behaviour keys on a switch, never on the profile, and never as `if ($centre)` inside a
shared service). Then `docs/groups/00-OVERVIEW.md` and `01-ACCOUNTING.md`.

## Why

A centre's "private subscription" is today a row in `lesson_packages`, run by
`App\Services\LessonPackages` — the hour-block engine built for the one-to-one Quran academy. The
centre's asks landed as branches inside it (`countsLessons`, per-subject blocks, top-up, cancel on a
closed bill, `PackageSettlement::availableFor` as the proxy for "centre on receipts" in Invoicing,
InvoiceController, Payroll, PayoutController and FamilyAccountController). The service is ~2,600
lines with 30 refusals; every week a Quran rule the centre never wanted became a ticket:

| lingo's report | the Quran rule behind it | what we did |
|---|---|---|
| "shows 7, we recorded 8"; Malika 4×60 instead of 6×40 | the block is minutes at an hourly rate; a lesson burns its real length | `countsLessons`: one lesson = one lesson, centre only |
| "no edit on a private subscription" | a line with money on it is never rewritten | paid blocks editable, centre + receipts only |
| "discount isn't applied", "no edit on this bill" | month-end close freezes bills | a centre never closes bills (201 reopened) |
| "wrong-date lesson won't undo" | a sealed payout refuses reversal | the difference is carried, centre only |
| dues appearing by themselves | auto-renew on exhaustion; hourly fallback when no block is open; overdraft rolls onto the next bill; a backdated block imports and exhausts | still there |
| Hassan / Nancy / Yahya duplicates | the package popup's "record a lesson" has no duplicate guard, and the desk uses it because a private lesson needs a timetable first | still there |

Patching further means more `centre` branches in a shared engine, and every Quran change (payroll
corrections, late marks) now has to be checked against the centre branch and vice versa.

## The decision: a centre-only money object, on the same lesson rows

Two shapes were weighed.

**A. "A private subscription is a one-member group."** Rejected after the inventory. The group engine
bills hour-months *automatically* (`onMembersAdded` → `billHourMonths`, then the nightly job), which
is the very "dues by themselves" the centre complains about; it has no sold-block state, no
finished → renew at member level, no top-up, no settlement of unused prepaid money, no per-member
lesson length; `solo_billed_minutes` would apply to every lesson; every private student would be a
row on the Groups page, the timetable board, the payments and reports boards; capacity and
occupancy logic fights it; and the Enter button, punctuality and the lesson report exist only for
`sessions`. We would rebuild the one-to-one lesson inside the group tables to lose features.

**B. Keep the lesson, replace the money.** The one-to-one lesson (`schedules` → `sessions`,
attendance, Enter, overdue, reports, payroll per lesson) works and the centre uses it. What is wrong
is only the money object above it. So a centre gets its own one: `centre_subscriptions`, service
`App\Services\CentreSubscriptions`, routes `/subscriptions*` behind `entitled:centre`. The Quran
engine goes back to what it was before October, with no `centre` branch inside it, and
`packages` is switched OFF for the CENTRE preset. **This is the split.**

Same pattern as the groups module: own table, own service, own routes, own API client file, own
component directory, one feed into each shared surface, added deliberately.

## The centre subscription — rules

1. **Lessons, never minutes.** `lessons_sold`, `lesson_price_minor`, `price_minor` (= sold × price,
   editable), `lesson_minutes` (the expected length, display and timetable default only). A lesson
   counts one whatever it ran. The teacher is paid from the lesson's real length as today.
2. **Money moves only when the desk acts.** Selling raises one bill line on the family's bill.
   Editing re-issues that line (same line id, `trg_invoice_line_repriced` returns excess to credit;
   a dearer block leaves the difference due). Closing early settles (credit / refund / keep, the
   existing `PackageSettlement` rules, ported). Nothing else ever writes money: **no auto-renew, no
   hourly fallback, no overdraft, no backdated import**.
3. **A lesson beyond the block is a flag, not a charge.** When a subject's open block is used up, the
   next attended lesson is marked `outside_subscription` on the student (alert
   `SUBSCRIPTION_FINISHED`, the follow-up list on the dashboard, the subscriptions page "due"
   tab). When the desk sells the next block, its `starts_on` defaults to the first uncounted lesson
   and takes those lessons. Attendance is never blocked (rule 3 of packages stays).
4. **Scope = subject = teacher + course**, as the two-subjects work defined it; `untied` (no teacher)
   allowed for a student with one teacher. One OPEN block per scope. A lesson belongs to the block
   whose scope matches its timetable's teacher/course and whose range covers it.
5. **Everything on an open block is editable**: teacher/course (moves its lessons), start date,
   lessons sold (top-up = edit sold upward), price, length, label. A finished block can be reopened
   by editing sold upward (that *is* lingo's "it says finished, nobody stopped it").
6. **Status**: OPEN → FINISHED (used = sold, by the lesson that did it) → or CLOSED (desk, with
   settlement) / CANCELLED (nothing counted and nothing paid: the line is voided). No `EXHAUSTED`
   chain, no `next_terms`, no `carried_minutes`, no `absorbed_overdraft`.
7. **Undo and corrections**: un-marking a lesson simply uncounts it (a FINISHED block reopens if its
   bill is unpaid or paid — money is unchanged either way, because money never followed the
   lesson). Duration corrections never touch the block.
8. **Delete a family / student** lets go the unpaid part of their subscription lines
   (`ChargeCancellation::letGoAllOf`, already there).
9. **Pay-first** (`RenewalPolicy`) holds a *sale*, not an automatic renewal: selling while the last
   block's line is unpaid asks, and a 422 names the bill.

### Schema

```
centre_subscriptions
  id, academy_id, student_id, teacher_id NULL, course NULL, label
  lessons_sold int > 0, lesson_minutes int NULL, lesson_price_minor int, price_minor int, currency
  starts_on date, status OPEN|FINISHED|CLOSED|CANCELLED, finished_at, closed_at, closed_reason, closed_by
  invoice_id, invoice_line_id                       -- the one bill line; re-issued in place on edit
  settlement NULL|PENDING|CREDIT|REFUND|KEEP, settlement_* (ported from lesson_packages)
  sequence_no, opened_by, created_at, updated_at
  unique (student_id, teacher_id, lower(course)) where status = 'OPEN'; unique (student_id) where OPEN and teacher_id is null

centre_subscription_lessons
  subscription_id, session_id UNIQUE, counted_at      -- which lesson sat on which block
```

RLS as every tenant table. No triggers beyond the existing ledger ones.

### Service `CentreSubscriptions` (the whole public surface)

`sell`, `edit`, `close(reason, settlement)`, `cancel`, `count(session)` / `uncount(session)`
(called from the billing hook), `lessonNumber(session)`, `forStudent`, `summary`, `remind`,
`outsideSubscription(studentId)`. Target: under 600 lines, one refusal list under 10.

### Where it plugs into shared code (one seam each, resolved from the `centre` switch)

- `Invoicing::onSessionBillable` / `onSessionUnbilled`: a `LessonMoney` policy interface with two
  implementations, `PackageMoney` (today's `LessonPackages::consume/release`) and
  `SubscriptionMoney`; `App\Support\MoneyPolicy::for($academyId)` picks by switch. The monthly
  path is untouched for both.
- `SessionController::show` lesson number: via the policy.
- `SessionDurationCorrection`: the policy says "nothing to do" for a centre.
- `PayerDiscounts` PRIVATE scope: matches `centre_subscriptions` lines by `invoice_line_id`, not by
  description text.
- `ChargeCancellation`, `GuardianController::advanceDues`, `FamilyAccountController`,
  `FamilyPayController::dueQuery`, `GuardianPortal`, `CentreDashboardController`, `AcademyExport`,
  `GroupAlerts` (PACKAGE_LOW/ENDED → SUBSCRIPTION_FINISHED/UNPAID), `PackageReminderMessage`:
  each gets a subscription reader next to (or instead of) its package reader.
- **`CentreBooks::enabledFor($academyId)`** (= `centre` + `Ledger::keeps`) replaces every
  `PackageSettlement::availableFor` used as a proxy in Invoicing (:458), InvoiceController (:141,
  :448, :497), Payroll (:159, :677), PayoutController (:529), FamilyAccountController (:258). Pure
  rename first, so the behaviour it guards (bills never close, status by money, carry after seal)
  stops living in a package class.

### What leaves `LessonPackages` (Quran engine back to its own shape)

`countsLessons` + `lessonTake` + `recountLessons`, `topUp`, the per-subject `teacher_id`/`course`
branch in `open` (and the `activeIn` scope, if no Quran academy uses it — survey first; Alrayan
sells per-subject blocks, so the scope may stay as a plain feature), `cancel` voiding a CLOSED bill,
the paid-block edit in `rewritePackageInvoiceLine`, `lesson_minutes` display. Migrations stay
(additive rule); the columns go unused on Quran rows. Commands `packages:count-by-lesson` and
`subscriptions:clear-deleted-dues` are retired after the data move.

### Data move

`php artisan centre:migrate-packages {academy} [--dry-run|--apply]`, per CENTRE academy (lingo,
LetsLearn; Linguatech is empty):

- each `lesson_packages` row → one `centre_subscriptions` row: `lessons_sold` = sold lessons
  (`minutes_total / lesson_minutes`, the `lessonBalance` rule), used = credit count, price, currency,
  subject, `starts_on`, status (ACTIVE → OPEN or FINISHED by used ≥ sold; COMPLETED → FINISHED or
  CLOSED by reason; CANCELLED → CANCELLED), settlement columns copied, `invoice_id` + the line id
  found by `packageLineDescriptions` (the last time that text match is ever used);
- each credit → `centre_subscription_lessons`;
- bills, lines, receipts, allocations, payouts: **not touched**. Verify: per academy, sum of
  `invoice_line_items.amount_minor` and `receipt_allocations` before = after; every old package has a
  new row; every credit has a lesson row;
- then the preset flips `packages` OFF for CENTRE and `profile:set` re-applies it to lingo and
  LetsLearn; `/packages*` answers 402 for them; the old rows stay for audit.

Pre-deploy dump as always ([[prod-deploy-runbook]]).

## Every surface, and what happens to it for a centre

Inventory from the three sweeps of 2026-11-04 (API, web, group engine). Verdicts: **keep**,
**adjust**, **replace**, **hide**, **remove**.

### Money and subscriptions

| Surface | Today | Verdict |
|---|---|---|
| Sidebar "الاشتراكات" ▸ مستحقة / مفتوحة / منتهية → `/packages/*` | private packages only; group months absent | **replace** with `/subscriptions` (due / open / finished / outside-subscription), built on the new table; group memberships stay under Groups, and the page says so in one line |
| Student profile → Subscription tab: `SubscriptionsCard` + `SubscriptionSection` (no-timetable warning, hourly terms card, `StudentMonthCard`, monthly-terms form when no subscription) | Quran monthly machinery renders under the centre card | **adjust**: a centre shows its card only (groups + private blocks + renewal policy); the "no timetable for teacher X" warning stays, reworded "the private subscription with X has no timetable yet" |
| Student profile fact strip "Rate" (hourly) | Quran | **hide** for a centre |
| Student list price column / `priceSuffix` | hourly rate | **adjust**: subscriptions count or nothing |
| New-student form: inline package (`terms.toPayload()`, untied) | opens an untied hour block | **replace**: "private subscription" = subject (teacher + course, or new subject) + lessons + price; or none; groups block as today |
| Enrolment wizard (trial → active): monthly / package | Quran | **adjust**: centre path = subscription + groups, same fields as the form |
| Package popup `PackageDetail` (credits ledger, "record a lesson", attach/detach, rebill, pay teacher) | the duplicate-lesson source | **remove** for a centre; the subscription detail is read-only lessons list + edit/close; recording a lesson is only the Attendance page's create-class modal, which gets a same-student-same-minute guard (all academies) |
| `/packages/due` family cards + `/f/{token}` pay page (`FamilyPayController::dueQuery`) | reads lesson_packages | **adjust**: `/f/` reads subscription lines too (it is per-family bill lines; the purpose text comes from the subscription) |
| Quick bill modal "a package bill is already waiting" | lesson_packages | **adjust** to subscriptions |
| Family accounts card: unsettled packages, settle / refund modals, renewal policy | PackageSettlement | **adjust**: settlement ported to subscriptions; same UI |
| Suspend dialog advance dues (`GuardianController::advanceDues`) | package bills + group months | **adjust** reader |
| Notifications "Packages" tab + `packagesDue` sidebar badge (permission-gated only) | PACKAGE_LOW / UNPAID / NO_ACTIVE_PACKAGE | **replace** for a centre with a "Subscriptions" tab: FINISHED, UNPAID, OUTSIDE; badge = outside-subscription + unpaid |
| WhatsApp staff alerts PACKAGE_LOW / PACKAGE_ENDED; package reminder (`/packages/{id}/remind`) | package | **replace** with SUBSCRIPTION_FINISHED / SUBSCRIPTION_UNPAID and `/subscriptions/{id}/remind`, same templates with lessons wording |
| Parent portal package bars (`remaining_minutes`) | minutes | **adjust**: lessons left of sold per subject |
| Centre dashboard "subscriptions" KPI, ending-soon list, activity | lesson_packages | **adjust** reader |
| Invoices page (hidden for a centre), Accounting bills list | status from money for `availableFor` | **keep**, on `CentreBooks` |
| Payroll detail "blocks" view | centre branch | **keep** |
| `SessionDurationCorrection` | package-aware | **adjust**: no-op on a centre block |
| Renewal policy (`RenewalPolicy`, pay-first) | groups + packages | **adjust**: package half → subscription sale |
| Excel export `packages` dataset | lesson_packages | **adjust**: `subscriptions` dataset for a centre |
| Commands `packages:count-by-lesson`, `subscriptions:clear-deleted-dues`, `lessons:restore-half-undone` | repairs | **remove** after the move |

### Lessons, attendance, people (the one-to-one lesson stays)

| Surface | Today | Verdict |
|---|---|---|
| Attendance page: Groups tab first, then private `AttendanceManager` | Quran manager unchanged | **keep**; **hide** `FollowControl` when `supervision` is off (it is permission-gated only today); the lesson-report modal stays behind `lesson_report` |
| Overdue lessons board + badge | sessions | **keep** |
| Enter button, meeting links, punctuality tab | sessions only | **keep** (online centres use them); groups have none — a later ask, not this split |
| Calendar + "student timetables" tab | sessions + trials + group lessons | **keep** |
| Student profile → Schedule tab (`StudentTimetable`) | sessions | **keep**; after a subscription sale with no timetable for that teacher, link straight here |
| Student profile → Teachers tab | assignments | **keep**; selling a subscription for a new subject creates the assignment, as today |
| Level card / level badge on the live student profile | only in the legacy `student-detail.tsx`, which the route no longer uses | **adjust** (bug): move `LevelCard` + badge into `student-profile.tsx` |
| Teacher profile: Rate fact (hourly), Reports tab (session reports) | Quran | **adjust**: rate reads the teacher's pay type, not an hourly rate; Reports tab hidden unless `lesson_report` |
| Trials ("حصص تحديد المستوى") → convert | wizard | **keep**, via the adjusted wizard |
| Enrolment requests `/e/{token}` → place → convert | centre | **keep** |
| Settings: Report card tab, lesson report, Controls | capability-gated | **keep** |
| Supervision, teacher quality, student reports, discounts-awards pages | preset OFF | **keep hidden**; the server 402s |
| Family profile page | cards | **keep**; the children card rows show "rate" (hourly) → **adjust** to the child's subscriptions summary |
| Group boards, timetable board, group detail, grades, term reports | centre native | **keep** |
| Command palette | follows nav | **keep** (renames follow) |

### Things found on the way, not part of the split

- Quran dashboard links to `/sessions`, which has no index page (`academy-dashboard.tsx:1742`).
- `GroupPayroll` passes `studentId = null` to `lessonPayMinor`, so a PER_STUDENT-pay teacher's
  per-student rate never applies to group lessons.
- `solo_billed_minutes` roster counts deleted students and suspended families; `roster` does not.
- Guardian suspend pauses `schedules` only; group lessons keep generating (the roster drops the
  children, billing skips them, but the lessons exist).

## Order of work

0. **Commit the working tree** (79 files: the centre look redo + groups redesign) so the split starts
   from a clean base. Ahmed's call.
1. `CentreBooks::enabledFor` extraction (pure rename of the `availableFor` proxy) + `MoneyPolicy`
   seam in `Invoicing` with `PackageMoney` wrapping today's calls. Zero behaviour change; the
   package suites prove it.
2. Table + service + routes + tests (`tests/Feature/Centre/SubscriptionsTest.php`): sell / edit /
   close-settle / cancel / count / uncount / outside / lesson number / reminders / pay-first.
3. Web: `lib/subscriptions-api.ts`, `components/subscriptions/*` (list page with four tabs, sell
   form, edit form, close modal with settlement, detail), student form + wizard + `SubscriptionsCard`
   + family card + parent portal + `/f/` + centre dashboard + notifications tab + quick bill + app-shell
   (`CENTRE_PARENT_OF` → `/subscriptions/*`, badge).
4. The adjust/hide list above for the one-to-one surfaces (small, each pinned by a test).
5. Data move command, dry-run on a prod dump restored locally, then prod: dump → migrate →
   `--apply` → verify sums → preset flip → `profile:set` lingo, LetsLearn.
6. Strip the centre branches out of `LessonPackages`; Quran suites green; retire the repair commands.

Steps 1–4 ship behind `entitled:centre` with `packages` still ON for the centres, so nothing changes
for them until step 5. Each step is one commit, one deploy, revertable alone.

## API contract (fixed 2026-11-04 so the API and web halves can be built in parallel)

All routes under `/api`, middleware `auth` + `entitled:centre`; permissions reuse `package.read` /
`package.manage` (renamed in the catalogue copy to "subscriptions", same codes — no permission
migration). Money fields are minor units. Dates are `Y-m-d` in the academy's timezone.

```
GET    /subscriptions?view=open|due|finished|outside&student_id=&teacher_id=&q=&page=&per_page=
       → { rows: SubscriptionRow[], summary: Summary, meta }
         view: open = status OPEN; due = any status with outstanding_minor > 0;
               finished = FINISHED|CLOSED (unrenewed first); outside = students with outside_count > 0
GET    /subscriptions/summary                 → Summary
GET    /subscriptions/students?q=             → { rows: StudentPick[] }   (every active student; their subjects)
POST   /subscriptions                         SellInput → { subscription: SubscriptionRow, invoice_id, due_minor, warnings: string[] }
GET    /subscriptions/{id}                    → { subscription: SubscriptionRow, lessons: LessonRow[] }
PATCH  /subscriptions/{id}                    EditInput → { subscription, invoice_id, credited_minor, due_minor, moved_lessons }
GET    /subscriptions/{id}/settlement         → SettlementPreview
POST   /subscriptions/{id}/close              { reason: string, settlement?: CREDIT|REFUND|KEEP, refund?: { method, reference?, note? } } → { subscription, settlement }
POST   /subscriptions/{id}/cancel             { note?: string } → 204     (only while lessons_used = 0 and invoice_paid_minor = 0; voids the bill line)
POST   /subscriptions/{id}/remind             { kind: PAYMENT|FINISHED } → { sent: bool, preview: string }

SubscriptionRow {
  id, sequence_no, student: { id, full_name, guardian_id, guardian_name, is_self_guardian },
  teacher: { id, full_name } | null, course: string|null, label: string,
  lessons_sold, lessons_used, lessons_left, lesson_minutes: int|null,
  lesson_price_minor, price_minor, currency,
  starts_on, status: OPEN|FINISHED|CLOSED|CANCELLED, finished_at, closed_at, closed_reason, closed_by_name,
  invoice_id, invoice_line_id, invoice_paid_minor, outstanding_minor,
  settlement: null|PENDING|CREDIT|REFUND|KEEP, settlement_minor,
  next_lesson_at, upcoming_lesson_count,        -- this subject's timetable
  outside_count,                                 -- lessons attended after it finished, not yet on a block
  renewal_held: bool,                            -- pay-first: an earlier line of this subject is unpaid
  deletable: bool, opened_by_name, created_at
}
Summary { open, finished_unrenewed, outside_students, due_count, outstanding: [{ currency, minor }], ending: int (lessons_left <= 2) }
StudentPick { id, full_name, guardian_name, status, subjects: [{ teacher_id, teacher_name, course, open_subscription_id|null }], has_timetable_for: teacher_id[] }
SellInput { student_id, teacher_id?: uuid|null, course?: string|null, new_subject?: bool, label?: string,
            lessons_sold: int>0, lesson_minutes?: int|null, lesson_price_minor: int>=0, price_minor?: int (default sold×price),
            currency?: string (default family's), starts_on?: date (default: first outside lesson of this subject, else today),
            override_pay_first?: bool }
EditInput  { label?, teacher_id?, course?, lessons_sold?, lesson_minutes?, lesson_price_minor?, price_minor?, starts_on? }
LessonRow  { session_id, scheduled_at_utc, duration_minutes, teacher_name, status, counted_at, number }   -- number = 1..sold
SettlementPreview { paid_minor, used_value_minor, owed_back_minor, currency, can_refund: bool }
```

Notifications: category `SUBSCRIPTIONS`, types `SUBSCRIPTION_FINISHED` (subject_id = subscription),
`SUBSCRIPTION_UNPAID` (sold while the previous one unpaid), `LESSON_OUTSIDE_SUBSCRIPTION`
(subject_id = student; one per student while outside_count > 0). Staff WhatsApp (ACCOUNTING group):
`SUBSCRIPTION_FINISHED`, `SUBSCRIPTION_UNPAID` replace `PACKAGE_LOW` / `PACKAGE_ENDED` for a centre.
`GET /notifications/summary` gains `subscriptions`; `?category=SUBSCRIPTIONS` lists them.

Readers that gain a `subscriptions` field next to their package one (shape = SubscriptionRow unless
said): `GET /dashboard/centre` (`subscriptions: { open, ending, finished_unrenewed, outside }` — reads
the new table; the old `subscriptions` keys keep their names so the dashboard needs no change),
`GET /p/{token}` children[].subscriptions[] `{ label, teacher_name, course, lessons_sold, lessons_used,
lessons_left, status }`, `GET /accounting/family/{guardianId}` (`unsettled` includes subscription
settlements, `kind: SUBSCRIPTION|PACKAGE`), `GET /guardians/{id}/advance-dues` and `removal-dues`
(subscription lines included), `/f/{token}` (subscription bill lines with purpose text),
`GET /sessions/{id}` (`subscription: { id, label, number, lessons_sold } | null` next to the package
key), academy export dataset `subscriptions`.

`POST /students` takes `subscription: SellInput-without-student_id` (exclusive with `package` and
`subscription_terms`); the enrolment wizard's convert does the same.

Deploy note: steps 1–2 (API) can go live alone — nothing calls them. Step 3 (web) switches the
centre's navigation to `/subscriptions`, so it ships in the same release as step 5 (data move + preset
flip); until then the web work stays on the branch.

### Web needs (noted while building step 3 against this contract, 2026-11-05)

What the web half assumes beyond the text above. Each is a small addition the API should honour
(or the web line to change if it answers differently):

- **`SubscriptionRow.invoice_token`** (optional): the quick-bill modal used to hand over the
  package bill's own pay link. The row has `invoice_id` but no token, so for a centre the note
  names the block owed and links to `/subscriptions?view=due` instead. Add the token and the
  "use this bill" button comes back.
- **`unsettled[]` rows on `GET /accounting/family/{guardianId}`**: the web reads `kind` and
  `subscription_id ?? package_id` as the id; `used_minor` / `paid_minor` / `owed_back_minor` /
  `currency` as the package row has them. A `kind: SUBSCRIPTION` row is settled with
  **`POST /subscriptions/{id}/close { reason: "", settlement, refund? }` on an already CLOSED block
  whose settlement is PENDING** — the API must accept that as "settle only" (no second close,
  `reason` may be empty).
- **`charges[].subscription_id`** on the same reader: a PRIVATE charge line that carries it is
  linked to `/subscriptions?id=<id>` (the block's detail opens).
- **`CloseInput.settlement_note`** (web addition): the KEEP reason / a word on the credit, since
  `refund.note` only exists for a refund.
- **`refund.method`** is sent as a `ReceiptMethod` code (CASH / INSTAPAY / WALLET / BANK_TRANSFER /
  CARD / OTHER), with `reference` and `note`; no treasury account id is sent. If the API wants a
  cash account, add `refund.cash_account_id` and the web gets a picker.
- **Pay-first refusal**: the web shows the override checkbox on a 422 whose body carries
  `code: "PAY_FIRST"` (or `pay_first: true` / `renewal_held: true`), and, failing those, on any 422
  with no `errors` map (a rule refusal, not a field error). Please send `code: "PAY_FIRST"`.
- **`POST /students` `subscription:`** carries the SellTerms for a centre, but a Quran academy's
  form still sends its monthly terms (`plan_label`, …) under the SAME key. Tell them apart by the
  `centre` switch (or by `lessons_sold` being present). The create response may add
  `subscriptionId` (the web reads `packageId ?? subscriptionId` for "opened").
- **The enrolment wizard's convert** does NOT send `subscription:` on the student PATCH: it calls
  `POST /subscriptions` (the block), then `addGroupMembers`, then `PATCH /students/{id}
  { status: REGULAR }`. REGULAR must be reachable once a `centre_subscriptions` row is open (or a
  group membership exists) — the "needs an active subscription" rule in the student update.
- **Notification `data`** read by the subscriptions tab: `student_name`, `label`, `lessons_sold`
  (FINISHED), `outstanding_minor` + `currency` (UNPAID), `outside_count` (OUTSIDE). The alerts come
  from `GET /notifications?category=SUBSCRIPTIONS` and the count from `summary.subscriptions`.
- **`GET /p/{token}` children[].subscriptions[]** is rendered as the contract says; when present it
  replaces the package bars and the "hours" month stat on the child's card.
- **`LessonRow.number`** is read as `number | null` — null for a lesson attended outside the block
  (flagged in the detail). If the API lists only counted lessons, nothing is lost.
- **Student profile deep link**: `/students/{id}?tab=schedule` opens the Schedule tab (added to
  `student-profile.tsx`), the door the "no timetable with this teacher" warning uses.

### Contract additions and deviations (API half, as built 2026-11-05)

The contract above stands; the API adds to it and deviates in these places only:

- **`MoneyPolicy::for` picks `SubscriptionMoney` when `centre` is ON **and `packages` is OFF**** —
  not on `centre` alone. The split ships while lingo and LetsLearn still run on the block engine
  (`packages` ON for them until step 5); on `centre` alone, their lessons would have stopped
  consuming packages the day step 2 deployed. Pinned by `SubscriptionsTest` ("keeps every other
  academy on the package engine"). The preset flip is what moves a centre over.
- **`subscription` on `POST /students` is told apart by shape**: the monthly terms block has always
  travelled under the same key, so a block of lessons is recognised by `lessons_sold` (monthly terms
  never carry it); `subscription_terms` is accepted as the monthly block too. The response adds
  `subscriptionId`, `subscriptionInvoiceId`, `warnings`.
- **`POST /subscriptions/{id}/settle { settlement, refund? }`** — a block closed without a decision
  is `PENDING` on the family card and has to be settled later; the contract listed no route for it.
- **`refund`** takes `method` (resolved to the treasury account mapped for that method and currency,
  the way a receipt is) **or `cash_account_id`**; `reference` and `note` go on the expense.
- **`GET /subscriptions?view=outside`** returns the latest subscription row of each student with
  outside lessons, **plus `outside: [{ student, teacher, course, count, first_on, last_on,
  session_ids }]`** — a student taught outside any block who never bought one has no
  SubscriptionRow to put them in.
- `SubscriptionRow` gains `invoice_status`, `invoice_token`, `renewed`, `reminders_sent`,
  `last_reminded_at`, `student.deleted`; `StudentPick` gains `currency`,
  `untied_open_subscription_id`, `outside_count`. `SettlementPreview` carries `lessons_sold`,
  `lessons_used`, `unused_lessons`, `settlement`, `settled`, `accounts`, `can_settle` beside the
  four contract fields. `POST /subscriptions` also returns `lessons_taken`; `remind` returns
  `deeplink`, `phone`, `kind`, `reminders_sent` beside `sent` / `preview`.
- `GET /dashboard/centre` keeps `ending_soon` / `ending_soon_days` / `delta_pct` beside the new
  `ending`, `finished_unrenewed`, `outside`. `GET /accounting/family/{id}` `unsettled` rows carry
  `kind` (`PACKAGE` | `SUBSCRIPTION`) and `id`; subscription rows name `subscription_id`.
  `/f/{token}` subscription items carry `kind: SUBSCRIPTION`, `lessons_sold` and `purpose_text
  {ar, en}`; `minutes` is null on them. `GET /p/{token}` children get `subscriptions` only for a
  centre (a Quran family's page keeps its exact keys).
- The 422 of a pay-first refusal names the bill in `errors.student_id[0]` and carries
  `errors.unpaid_invoice_id[0]` and `errors.unpaid_subscription_id[0]`.
- `centre_subscriptions.legacy_package_id` (unique, nullable) remembers the `lesson_packages` row
  the data move came from — what makes `centre:migrate-packages` idempotent.

Honouring the web half's "Web needs" (2026-11-05, second pass):

- `SubscriptionRow.invoice_token` is there (the bill's public pay token).
- `unsettled[]` rows carry `kind`, `subscription_id` and `id`, and `used_minor` beside
  `used_value_minor`; **`POST /subscriptions/{id}/close` on a block already CLOSED with settlement
  PENDING is the settlement alone** — `reason` may be empty (it is now optional on the route), the
  decision comes from `settlement` (+ `refund`), a second attempt on a settled block is a 422.
  `charges[]` rows carry `subscription_id` when the line is a block's (and read `source: PRIVATE`).
- `CloseInput.settlement_note` (free text): stored in `centre_subscriptions.settle_note` on the
  close and on the settlement (a refund's `note` stands in when there is none).
- `refund.method` is a ReceiptMethod code resolved to the treasury account mapped for that method
  and currency, as a receipt is; no account mapped → 422 naming the account. `cash_account_id`
  stays as the alternative.
- The pay-first refusal is `App\Services\PayFirstRefusal` (a ValidationException with its own
  `render()`): the 422 body carries `code: "PAY_FIRST"`, `pay_first: true`, `unpaid_invoice_id`
  and `unpaid_subscription_id` at the top level beside `message` / `errors`.
- `POST /students` tells the centre's SellInput from the Quran monthly terms by `lessons_sold`
  being present (and refuses it with a 402 unless the academy holds `centre`); the Quran shape is
  untouched for everyone else.
- `CentreSubscriptions::sell` now calls `LessonPackages::ensurePackageBilling` (the `subscriptions`
  row becomes PER_PACKAGE, created if missing), so the student is REGULAR-able and the list badges
  read as before; only the centre engine reads it from then on. The wizard's convert
  (`POST /subscriptions` → `POST /groups/{id}/members` → `PATCH /students/{id} {status: REGULAR}`)
  is pinned by a test.
- Notification `data`: SUBSCRIPTION_FINISHED `{student_id, student_name, subscription_id, label,
  course, lessons_sold, sequence_no}`; SUBSCRIPTION_UNPAID `{student_id, student_name,
  subscription_id, label, invoice_id, outstanding_minor, currency, unpaid_subscriptions[]}`;
  LESSON_OUTSIDE_SUBSCRIPTION `{student_id, student_name, outside_count, teacher_id, teacher_name,
  course, session_id}`.
- `LessonRow.number` is always set: `GET /subscriptions/{id}` lists only the lessons counted on the
  block; a student's outside lessons are on `view=outside` (`outside[]`) and the student's
  `outside_count`.

## As built — the API half (2026-11-05, branch `worktree-agent-ac702fd615ae339d3` off e2a945c)

Steps 1, 2, the readers, the alerts and the data-move command, in one commit; the web half is on its
own branch against the contract.

- **Step 1** `App\Support\CentreBooks::enabledFor` replaced every `PackageSettlement::availableFor`
  used as the "centre on receipts" proxy (Invoicing, InvoiceController ×3, Payroll ×2,
  PayoutController, FamilyAccountController). Pure rename; `PackageSettlement::availableFor` stays
  for the settlement itself and `LessonPackages::rewritePackageInvoiceLine` (step 6 strips that).
- **Step 2** `App\Billing\LessonMoney` (interface) with `PackageMoney` (today's
  `LessonPackages::consume/release`, verbatim) and `SubscriptionMoney`; `App\Support\MoneyPolicy::for`
  picks by switch (see deviation above). `Invoicing::onSessionBillable` / `onSessionUnbilled` ask the
  policy and nothing else changed in them. `SubscriptionMoney` leaves a monthly-billed centre
  student (PER_HOUR / PER_SESSION / PER_MONTH / FREE) to the monthly path; no row or PER_PACKAGE →
  `CentreSubscriptions::count()` and "handled", so no AUTO line and no hourly fallback.
- **Tables** `centre_subscriptions`, `centre_subscription_lessons` (migration
  `2026_11_07_000001_centre_subscriptions`, dated after the course-term and assessments migrations
  so it runs last), RLS forced, the two partial unique indexes of the plan, `invoice_line_id` with
  `on delete set null`, `settle_*` columns as on `lesson_packages`, `reminders_sent` /
  `last_reminded_at`, `legacy_package_id`. The same migration adds `SUBSCRIPTION_FINISHED` /
  `SUBSCRIPTION_UNPAID` to `whatsapp_group_alerts_event_chk`.
- **Service** `App\Services\CentreSubscriptions` (715 lines) with exactly the plan's public surface
  plus `blockFor`, `lessonSubject`, `courseKey` (scope helpers the readers share); settlement in
  `SubscriptionSettlement` (ported from `PackageSettlement`, refunds through its `refundCredit`,
  the `app.settling_invoice_id` escape for a closed bill); the bill line in `SubscriptionBilling`
  (raise once, re-issue in place; discount through `PayerDiscounts::apply`, re-priced only when the
  price changed); rows, views, summary and the picker in `CentreSubscriptionRows`. Every write in one
  `DB::transaction`, every mutation `Audit::log`ged under entity `centre_subscription`.
- **Scope at count time**: the lesson's timetable teacher (else its own) and the subject it names;
  tied blocks of that teacher first (the course named, else the oldest), then the untied block; the
  block must have started on or before the lesson's local date. Outside rows remember teacher /
  course / date so a later sale takes them; a sale takes them up to what it has free, oldest first.
  The outside alert is one per student (its subject_id) and is cleared when their outside count
  returns to zero so it can fire again; the finished alert is cleared on reopen for the same reason.
- **Edit** with `starts_on` moved later releases the block's earlier lessons to outside; moved
  earlier, it takes outside lessons in range. A subject move keeps the block's lessons on it; an
  outside lesson of the OLD subject is not the new subject's to take. `lessons_sold` below what is
  counted is refused.
- **Cancel** voids the bill only when the block's line is the bill's only one (it always is: a sale
  raises its own MANUAL invoice). `ChargeCancellation::cancel` on a subscription line ends the block
  (cancel if nothing counted and nothing paid, else close); `advanceDues` lists a running block's
  line as `kind: SUBSCRIPTION`; `duesOf` / `letGoAllOf` already covered the line.
- **`SessionDurationCorrection`** needed no change: it acts only on `lesson_package_credits`, and a
  centre block has none — a no-op by construction.
- **Command** `centre:migrate-packages {academy} [--dry-run|--apply]`: `lessons_sold` =
  `LessonCount::whole(minutes_total + carried, lesson_minutes)` with the length falling back to the
  block's usual credit length, then 60; status ACTIVE → OPEN or FINISHED by used ≥ sold; COMPLETED →
  FINISHED (EXHAUSTED or used ≥ sold) else CLOSED; CANCELLED → CANCELLED; settlement columns
  copied; the line by `packageLineDescriptions`, then by label (a settled line says "— N used").
  Prints the two sums before and after and refuses to finish if they differ; `--apply` verifies
  every package has a row and every credit a lesson. Exercised only in
  `MigratePackagesCommandTest`, never run anywhere.
- **Traps hit**: a closure that calls another tenant-context closure from inside its own clears the
  GUCs on the way out (the test helpers must not nest); `assignTeacher` in the test traits ENDS the
  student's earlier link (insert the second subject by hand); a receipt dated before a treasury
  account's opening day is outside its balance; the alerts a group relays must be younger than
  `MAX_AGE_MINUTES`, so a test that writes them under a frozen 2026-06 clock has to unfreeze first;
  `Entitlement::resolve` reads `module_subscriptions` under RLS, so `MoneyPolicy::for` outside a
  tenant context sees no switches and answers `PackageMoney`.
- **Pre-existing, unrelated failures** seen while running the touched suites: `GroupAlertsTest`
  "backs off after a failed send" (fails identically with the pre-change alert files) and
  `Rls/IntrospectionTest` "stores no monetary column as float or numeric" (`group_assessments`
  numeric columns from the assessments feature).
