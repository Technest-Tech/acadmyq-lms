# Group Accounting (حسابات المجموعات)

A client academy said our group money is too thin: "most of the basics are missing". They sent
their own collections sheet (`Book6(تحصيلات)`) as a reference. It holds one row per payment:
date, payer name, phone, amount, payment method (InstaPay) and notes. That is a cash-received log,
not an accounting system, and it was saved as a non-Unicode CSV, so every Arabic character was lost.
We do NOT copy it. This doc designs what a centre/academy that runs groups actually needs, for
most academies and not one.

---

## What we have today (P2, live)

- A group has a price and a mode: MONTHLY up front (join month pro-rated by lessons), PER_LESSON
  (follows the sheet), or COURSE (once on join). A member can carry a price override.
- Each charge is a line on the payer's ordinary monthly AUTO invoice (`Invoicing::addGroupLine`).
- Teacher pay: one payout line per held lesson, or a share of what the group BILLED in the month.
- `/groups/payments`: per group billed / paid / outstanding + an unpaid list. `/groups/reports`:
  attendance and lessons.

## What is wrong with it (the real gaps)

1. **There is no payment record.** `POST /invoices/{id}/mark-paid` OVERWRITES one number,
   `invoices.amount_paid_minor`, plus one method, one reference and one proof per invoice. Two
   instalments by two methods cannot both exist. There is no receipt number, no "who took the
   money", no payment date other than `paid_at` on full payment, and no refund.
2. **"Paid" for a group is a guess.** A group line counts as paid only when its WHOLE invoice is
   `PAID` (`GroupBoardController::payments`). A parent who paid 400 of an 800 invoice (private
   lessons + a group) shows the group as fully unpaid, and nothing can say WHICH charge was paid.
3. **No balance.** No statement of account (كشف حساب), no credit carried forward when a parent
   overpays or pays in advance, no aging of arrears (متأخرات).
4. **Discounts are invisible.** A sibling or scholarship discount is just a lower `price_minor` on
   the member. Reports cannot show "list price 500, discount 100, net 400", nor who approved it.
   There is no exemption for a month (إعفاء), no registration/book/exam fee, and no freeze (تجميد).
5. **Collection happens somewhere else.** You cannot collect from the group screen. Staff open
   Invoices, find the parent, then type a total.
6. **No expenses, so no profit.** Hall rent, books, ads and printing are not recorded, so "is this
   group making money?" cannot be answered. Teacher cost is shown; nothing else is.
7. **Teacher % is on billed money.** Most Egyptian centres pay the teacher a share of what was
   COLLECTED, not of what was billed.
8. **No cash custody.** Nobody can close the day: "Mona took 3,200 cash + 1,500 InstaPay today,
   paid 200 for printing, and handed over 3,000."
9. **Methods do not match Egypt.** The `payment_method` enum is CASH / BANK_TRANSFER / GATEWAY /
   OTHER. InstaPay and wallets (Vodafone Cash etc.) are most of the real traffic.

---

## The rules a professional system follows

1. **Every amount has a document.** A charge is a line, money in is a numbered receipt, money out
   is a numbered expense or refund. Nothing is edited or deleted after the fact. A mistake is
   VOIDED with a reason and a user (the waive-not-delete rule teacher discounts already use).
2. **A payment is allocated to charges.** A receipt covers specific lines (oldest first by
   default), so "Ahmed paid October for English A1" is a fact, and a partial payment is exact.
3. **Balance = charges − discounts − payments.** Anything left over from a receipt is the payer's
   credit and is applied to their next charges automatically.
4. **A discount is a visible entry,** with a type, a reason and the user who gave it. It is never a
   quietly lower price.
5. **Cash has a custodian.** Every receipt records who received it. A day closing reconciles
   expected against counted.
6. **Group profit = collected − teacher cost − expenses,** per month.

---

## Data model

### Receipts: academy-wide, not group-only

A parent pays one amount that can cover private lessons AND groups, so receipts sit on the
payer, not on the group. Group screens read them through the allocations.

```
receipts
  id, academy_id
  number            text      -- per-academy sequence, e.g. R-000123; a voided receipt keeps its number
  kind              PAYMENT | REFUND
  guardian_id | student_id | payer_name     -- same payer shape as invoices
  amount_minor, currency
  method            CASH | INSTAPAY | WALLET | BANK_TRANSFER | CARD | OTHER
  reference, proof_path, note
  received_on       date      -- the day the money changed hands (may be back-dated)
  received_by       user_id   -- the custodian
  voided_at, voided_by, void_reason
  created_at

receipt_allocations
  receipt_id, invoice_line_id, amount_minor     -- sum per line <= the line's net amount
```

- `invoices.amount_paid_minor` and `invoices.status` become a CACHE kept by one service,
  `Receipts`, from the allocations. Every current writer (`markPaid`, the XPay and PayPal
  settlements, packages) goes through it. The WhatsApp payment-event trigger keeps working
  unchanged because it watches that column.
- `mark-paid` stays as an endpoint: it records a receipt for the remaining amount.
- **Backfill:** each invoice with `amount_paid_minor > 0` gets one receipt (`note = migrated`,
  dated `paid_at` or `updated_at`), allocated across its lines oldest-first. Totals do not change.
- `payment_method` is a Postgres enum. Adding values needs `alter type … add value` outside the
  migration's transaction.
- An unallocated remainder is the payer's **credit**. When a new line is raised for that payer,
  the credit is allocated to it automatically.

### Line amounts: list, discount, net

`invoice_line_items` gains `list_amount_minor` and `discount_minor`; `amount_minor` stays the net.
Each line's paid status is derived: PAID / PARTIAL / UNPAID / WAIVED.

### Member discounts, fees, freeze

```
class_group_members  + discount_kind (PERCENT|FIXED), discount_value, discount_reason
                       (SIBLING|SCHOLARSHIP|STAFF|EARLY|OTHER), discount_note, discount_by
class_group_fees       group_id, name, amount_minor, when (ON_JOIN | ONCE_NOW)   -- registration, books, exam
class_group_member_pauses  member_id, from_date, to_date, reason                 -- تجميد
```

- The existing `price_minor` override is migrated: below the group price it becomes a FIXED
  discount of the difference; above it, it stays an override.
- **Waive a month (إعفاء):** a 100 % discount on that line with a reason. On a CLOSED invoice it
  is a negative credit line on the current invoice instead, because closed invoices are immutable.
- **A paused member:** MONTHLY skips fully paused months and pro-rates partly paused months by
  lessons, like the join month. The member keeps their seat and drops off the roster for those dates.

### Expenses

```
expense_categories   academy_id, name   (seeded: rent, books & materials, printing, ads, utilities, other)
expenses             academy_id, number, spent_on, category_id, amount_minor, currency, method,
                     class_group_id NULL, note, attachment_path, paid_by user_id,
                     voided_at, voided_by, void_reason
```

### Cash closing

```
cash_closings  academy_id, user_id, day, expected_by_method jsonb, counted_minor,
               difference_minor, handed_to user_id NULL, note, closed_at
```

Expected = that user's receipts that day − the cash expenses they paid that day. A closed day
is read-only. A late receipt dated on a closed day is refused.

### Teacher share on collected money

`class_groups.teacher_share_basis` = `BILLED | COLLECTED`. With COLLECTED, the share line for
month M is the share of the allocations RECEIVED in M against this group's lines (cash basis). A
late payment in November for October counts in November. Nothing finalized is ever reopened.

---

## Screens

| Where | What |
|---|---|
| Group → **Accounts tab** (حسابات المجموعة) | Month picker. One row per member: due, discount, paid, remaining, status chip, last payment. Row buttons: **Collect**, **Waive**, **WhatsApp reminder**. A bulk "collected cash from the selected". Footer: expected / collected / remaining / collection rate. |
| **Collect modal** | Amount pre-filled with the payer's whole remaining balance (all groups + private), method, reference, proof, date. Shows how it will be allocated. Prints or WhatsApps a branded receipt image (reuses the report-card PNG pipeline). |
| `/groups/payments`, upgraded | Per group: expected, collected, remaining, rate %. Arrears list with exact partial amounts. |
| **Arrears** (المتأخرات) | Per payer: 0–30 / 31–60 / 60+ days, groups involved, last reminder. Bulk reminder. |
| **Statement of account** (كشف حساب) | Per payer, from the student/guardian profile: charges, discounts, receipts, running balance, credit. Print and WhatsApp. |
| **Receipts** (الإيصالات) | Every receipt: filter by date, method, collector, group. Void with reason. Reprint. |
| **Expenses** (المصروفات) | Add, filter and void. Optional group tag. Monthly totals by category. |
| **Cash box** (الخزنة) | Today by collector and method, cash expenses, net. Close day: counted vs expected, difference, hand-over. History. |
| **Group profit** (ربحية المجموعات), in `/groups/reports` | Per group per month: students, billed, discounts, collected, outstanding, teacher cost, expenses, **net profit, margin**. Plus a per-teacher roll-up. |

Every list exports to Excel, reusing the styled-workbook helper from the Account & data tab.

### Permissions

- Collect and record receipts: the existing `invoice.mark_paid`.
- Read: `invoice.read`.
- New capabilities: `receipt.void`, `expense.read`, `expense.manage`, `cashbox.close`.
- File every new capability under FINANCIAL in `PermissionCatalog::AREAS` and in
  `FEATURE_BY_DOMAIN`, so the Supervisor role never gets money,
  per the custom-roles rules.

---

## Phases

| | Scope | Why this order |
|---|---|---|
| **F1** | Receipts + allocations + credit; new methods; backfill; `mark-paid`/XPay/PayPal through `Receipts`; group **Accounts tab** + Collect modal + receipt image; exact paid status on `/groups/payments` | Everything else reads receipts |
| **F2** | Statement of account, arrears aging + reminders, discounts / waivers / fees / freeze | Needs allocations to be exact |
| **F3** | Expenses, group profit, teacher share on COLLECTED | Profit needs collected + expenses |
| **F4** | Cash box closing, Excel exports everywhere, collection KPIs on the dashboard | Polish once the money is right |

F1 touches the live invoice payment path for every academy, not just groups. It ships with a
pre-deploy dump and a check that every invoice's `amount_paid_minor` is unchanged after the backfill.

## The switch: opt-in, per client

`accounting` is a MANAGEMENT capability, and it is the first **opt-in** one
(`FeatureCatalog::OPT_IN_CAPABILITIES`). Every other feature is on until it is switched off. This
one is OFF for every client, new and existing, until a Super Admin turns it on from the client's
Features card. It is stored as `module_subscriptions.overrides.enabled`.
`ModuleBilling::setDisabledFeatures($academy, $module, $disabled, $enabled = null)` only changes an
opt-in feature when it is named, so no caller can switch it on by accident.

An academy without it (all the Quran / private-lesson clients today) runs the classic code paths,
byte for byte. The one change they do get is the trigger fix below.

- **Switching on** adopts the academy: a row in `academy_ledgers` marks it as kept by receipts,
  and every payment recorded the classic way becomes one `MIGRATED` receipt. Totals do not move.
- **Switching off** removes that row. Receipts stay as history, and "mark paid" is classic again.
- **Switching on again** only records the part of each invoice's paid amount that no receipt
  covers yet.

## F1 as built (2026-10-20, uncommitted)

**Database** (`2026_10_20_000001`–`000003`)
- New tables: `receipts`, `receipt_allocations`, `academy_counters` (receipt numbers R-000001…)
  and `academy_ledgers`, all under tenant RLS.
- `app.ledger_refresh_invoice` keeps the invoice cache. It is fired by every allocation change
  and does nothing for an academy that is not adopted.
- Allocation triggers refuse to cover more than a line, or to spend more than a receipt. A line
  repriced below what it holds gives the excess back to its receipts, which becomes credit.
- `app.public_receipt_by_token` serves the `/rc/{token}` page.
- `receipt.void` is a FINANCIAL capability, seeded to owner, manager and accountant, and to the
  custom roles that held `invoice.mark_paid`.

**Bug fixed for every academy:** `forbid_closed_invoice_mutation` refused PARTIALLY_PAID → PAID,
so a second instalment always returned 500. Payment states may now move among themselves. VOID is
still terminal, a closed invoice still never reopens, and totals stay frozen.
`Invoicing::closeInvoice` now skips any invoice that is not OPEN, which used to be a 500.

**`App\Services\Ledger`** — `record`, `void`, `applyCredit`, `afterLinesChanged`, `adopt`,
`release`, `recordGatewayPayment`, `balance`, `openLines`.
- Every place that writes invoice lines calls `afterLinesChanged`: Invoicing, LessonPackages and
  the session duration correction. That is how credit pays a new charge by itself.
- A receipt for a student resolves to whoever that student's bills go to (their guardian, unless
  the academy invoices per student).

**A running month stays OPEN however much is paid on it.** Closing lands it on PAID or
PARTIALLY_PAID. Because "OPEN" no longer means "nothing paid":
- XPay and PayPal checkouts charge `total − paid`.
- The public invoice page treats a fully covered invoice as paid.
- A settled card payment becomes a GATEWAY receipt (`recordGatewayPayment`). Without that, the
  next allocation change would wipe it.

**API**
- `/receipts`: index, store, show, void, send, proof.
- `/payer-account`.
- `/groups/{id}/accounts`.
- `/rc/{token}`.
- `mark-paid` records a receipt on an adopted academy, with the same response plus `receipt`.
- `/invoices/{id}` returns `receipts` and each line's `paid_minor`.
- `/group-payments` counts partial payments exactly.

**Web**
- The Collect screen (`components/accounting/collect-modal.tsx`). The classic `MarkPaidModal`
  becomes Collect when accounting is on.
- The receipt detail: send, print, copy, void.
- The `/receipts` register: totals by method, filters, server-side payer search.
- The group's **Accounts** tab, which replaces Money when accounting is on.
- The public `/rc/[token]` receipt (bilingual, Save as PDF).
- The Features card's opt-in switch.
- The receipts list on the invoice.

**Tests:** `tests/Feature/Accounting/ReceiptsTest.php` (19) and
`components/accounting/accounting.test.tsx` (5), plus the client-page opt-in test.

**Defaults taken** (decisions 2 and 3 below were not answered):
- Teacher % on collected money is F3 and not built yet.
- A member who leaves mid-month gets nothing back (unchanged).

## The section, reorganised (2026-10-21)

The first Accounting dropdown listed nine pages — one per table (receipts, statement, daily, arrears,
treasury, expenses, income, groups, overview). An accountant does not think in tables; they ask four
questions. The sidebar now has four pages, laid out by question, and nothing changed server-side:

| Sidebar | Question | What is on it |
|---|---|---|
| **Overview** `/accounting` | How is the month going? | KPIs, collection rate, by day / method / collector, aging, top debtors (a name opens their statement in place), latest receipts, the treasury strip once accounts exist. |
| **Arrears** `/accounting/arrears` | Who owes? | Every family with a balance, aged. From a row: Collect, WhatsApp reminder, **Statement** (a modal — the family never leaves the list; "Open to print" is the page). A hero button picks any family's statement. |
| **Treasury & expenses** `/accounting/treasury` | Where is the money, what moved? | Tabs: **Accounts** (balances, mapping, transfers, close the day) · **Receipts** (the register, record a payment) · **Expenses** (money out, pay a salary). An expense needs an account to pay it from, so the two belong together. |
| **Reports** `/accounting/reports` | What do the numbers say? | Tabs: **Daily collections** · **Income vs expenses** · **Group collections** (only with `groups`). |

- A **Collect** button sits in the header on every page for a client on receipts whose user may mark
  invoices paid (`CollectQuickAction`). Pick the student, their family's account opens.
- `/accounting/statement` stays as the printable page but is no longer a sidebar item: a statement is an
  action on a family (Arrears row, Overview debtor, family card), not a place.
- The old addresses redirect to the tab that replaced them: `/receipts` → treasury?tab=receipts,
  `/accounting/expenses` → treasury?tab=expenses, `/accounting/daily|income|groups` → reports?tab=….
- Every screen component takes `hero?: boolean`; a hub renders one `PageHero` and the tab strip
  (`AccountingTabs`), and the screen inside puts its actions in a row of its own.
- Non-accounting academies: nothing changed (app-shell tests pin the sidebar; `AccountingGate` and
  `entitled:accounting` still 402 everything).

## F2 as built, part one (2026-10-24): discounts, proof, the desk's asks

- **Discounts are entries, not lower prices.** `payer_discounts`: a family (or one child) carries one
  or more standing discounts — PERCENT (basis points) or FIXED (minor units per charge), a label
  ("sibling", "scholarship"), a scope (ALL / GROUP, optionally one group / PRIVATE), from a day until
  ended. `PayerDiscounts::apply()` is called by every line writer (private lesson, group month /
  lesson / course, package) right before the insert: the line keeps `list_amount_minor`,
  `discount_minor`, `discount_label`, and `amount_minor` stays the NET the ledger always used.
  Percentages come off the list price, fixed amounts after, never more than the charge. Nothing
  already billed moves; ending a discount stops it from that day (the day itself included).
  Only an academy on receipts applies one — `Ledger::enabledFor` — so the classic academies' lines
  are written byte for byte as before (pinned in TreasuryTest). API: `POST/DELETE
  /accounting/family/{guardianId}/discounts`; the family card lists them, adds and ends them; the
  statement and the family card show "was 450 · 45 off (Sibling)".
- **…and, when asked, on what is already billed (2026-10-27, lingo).** A family given a discount
  expected it on this month's bill too. `PayerDiscounts::applyToExisting()` re-prices every line
  of the family (or the child) still on an OPEN bill and in the discount's reach — group charges,
  private lessons, package bills (`lesson_packages.invoice_id`); never a hand-typed bill — from its
  list price under every discount standing on its date, and moves the discount's `starts_on` back to
  the earliest such line so a late mark in that month prices the same. A paid line keeps the money:
  `trg_invoice_line_repriced` trims its allocations and the excess is credit that `afterLinesChanged`
  puts on the next open charge. Group revenue shares are re-synced. A closed bill never moves.
  Idempotent. API: `apply_to_existing` on the POST (the form's checkbox, ticked by default) and
  `POST /accounting/family/{guardianId}/discounts/{id}/apply-existing` (the row's button; 422 once
  ended).
- **A picture of the proof is required for anything but cash** (`POST /receipts`: InstaPay,
  wallet, bank, card). Cash has no receipt to photograph. The Collect screen will not submit
  without it; the API refuses too (422).
- **Paying a salary from the treasury**: search by teacher, each statement says how many lessons it
  holds, and picking one shows what is behind the figure (lessons, rewards, deductions, the lesson
  list) before the amount — which stays editable — is paid.
- **A new expense category is named right in the expense form** ("+ New category…").
- **Treasury ↔ family**: a receipt's payer in the register, the receipt detail and an account's
  ledger opens the family (or the student billed directly).

## Groups, the centre's asks (2026-10-24)

- A group is created **with its students** (the API always took `student_ids`; the form now has the
  picker). Picking a **teacher brings their hourly rate** into "what the teacher earns" (per hour,
  editable; a typed amount is never overwritten). The lesson **length is a list** — 20 / 30 / 40 /
  45 / 60 / 90 / 120 — with "Other".
- **A student alone in the class**: `class_groups.solo_billed_minutes`. For an HOURS group, a lesson
  whose roster (memberships covering that date) holds exactly one member counts this long against
  the student's hours — a 40-minute class alone eats 60 — while the teacher is paid the real 40
  (`GroupPayroll` reads the lesson's own duration). Null = the real length. Pinned in
  ClassGroupMoneyTest ("a student alone in the class…").

## Centre mode (`centre`, 2026-10-24)

The centre's asks that touch screens every academy shares sit behind ONE opt-in capability,
`centre` (`FeatureCatalog::OPT_IN_CAPABILITIES`), OFF for every client until a Super Admin switches
it on from the Features card. A Quran academy without it sees every one of these screens exactly as
before, pinned by tests on each.

| With `centre` | Where |
|---|---|
| A new student starts on a **subscription** (package) rather than monthly, and the tile says "subscription" | Student form |
| Packages are called **subscriptions** in the sidebar and on their pages | app-shell `navLabel`, packages pages |
| A manual lesson from Attendance lists **every** student, not the picked teacher's roster | Create-class modal |
| A teacher's pay statement reads as **blocks** — one per group or private student, opened to see its lessons — instead of a flat line list | Payout detail modal |

Two more asks needed no switch:
- **Attendance with group classes** — a client holding `groups` gets a second tab on the Attendance
  page, the groups' own lessons board (`AttendanceScreen`); the private page is unchanged underneath.
- **A family paused for a while** — `POST /guardians/{id}/suspend` / `resume`
  (`guardians.suspended_at`). Suspend switches the children's active timetables off and flags them
  (`schedules.paused_by_suspension`), the generator takes their future untouched lessons off the
  calendar, and `GroupBilling::billableMembers` raises no group month on them. Everything already
  recorded stays. Resume switches exactly those timetables back on and regenerates. Family page:
  a card and a badge. Pinned in `GuardianSuspendTest`.

**Group subscriptions on the student form** (`centre` + `groups`): the new-student form has a "Group
subscriptions" list — pick one group or several (each row shows the group's price and hours),
and the private subscription tile beside it (or "no private subscription"). On save the student
is created, then enrolled in each group from the start date; a group that refuses leaves the student
made and the form open to say which one.

**The new-student form, for everyone (2026-10-24):** it opens on "active student" (a trial is the
deliberate choice), and while a family is on the record the student's own numbers are folded behind
"the student's own numbers" — the parent's numbers are the ones that matter.

**Academy defaults (everyone, 2026-10-24):** Settings → Academy carries the academy's country and
default currency (`academies.country`, written through `app.update_academy_defaults`, a
security-definer function like the name/timezone one). They travel with the session
(`academy.country`, `academy.defaultCurrency`) and every new-person form opens on them: the student
form's country, dial code and currencies; the parent form's dial code, country and currency.
Found on the way: the definer role only ever had SELECT on `academies`, so the name/timezone card
had 500'd on every save (0 `academy.settings` audit rows on prod); the migration grants it UPDATE
on exactly those columns.

**Subscriptions card on the student** (`centre`): `SubscriptionsCard` on the student page lists the
student's groups (memberships, via `/group-members?student_id=`) and private subscriptions (lesson
packages) with where each stands, and offers "Join a group" and "New private subscription" — the
existing records, read the way a centre thinks. Nothing without `centre`.

**Deliberately NOT built yet — a private subscription keyed to a teacher/subject.** Today a package
is one open block of hours per student (`lesson_packages_one_active_per_student`), consumed by any
of their lessons; the whole packages engine (consume, renew, overdraft, carry-over, return to
monthly) rests on that. Keying packages by teacher is a refactor of that engine, shared with every
Quran academy, not a gated screen. It needs the client's answer on what a private subscription IS
(hours that renew, or a monthly fee) and a session of its own.

Still open: the "attendance shows only lessons after now" report, which the code does not reproduce
and needs a screenshot.

## Decisions needed

1. **Receipts academy-wide (recommended) or groups only?** Groups-only would leave the
   private-lesson invoices on the overwrite-a-number model, and a parent paying for both would
   need two flows.
2. **Teacher % default: of COLLECTED (recommended for centres) or of BILLED?** Both stay
   selectable per group.
3. **A member who leaves mid-month:** nothing back (today), or credit for the lessons left?
4. Still open from 00-OVERVIEW: the default billing mode, and which teacher pay modes clients use.

## Subscriptions you can edit and end (2026-10-25, `centre`)

Every open row on the student profile's subscriptions card (`SubscriptionsCard`, `centre` only) has
**Edit** and **End**, built from the screens that already own those records — no new forms:

- **A group membership.** Edit opens the group page's own member forms (exported from
  `group-members-panel.tsx`) in three tabs: *join date*, *price* (only for `student.set_price` on a
  priced group) and *move to another group*. End is the group page's leave form, now with a reason
  kind — **Paused** / **Stopped** / Other — and a note, stored in `left_reason` as `PAUSED: note`
  (free text stays free text, e.g. "Moved to A2"); `leftReasonText()` says it in the reader's
  language on both screens. A pause is "end this one membership": the other groups carry on, and
  coming back is adding them again. There is still no paused state on a membership, by design.
- **Join date** is new on the API: `PATCH /groups/{id}/members/{studentId}` takes `joined_on`
  (and/or `price_minor`, which now needs `student.set_price` only when it is sent).
  `ClassGroups::changeJoinDate` refuses (422) once the group has HELD a lesson since the earlier of
  the two dates, so no saved sheet rests on it. An earlier date bills what the wider range now owes
  (`GroupBilling::onJoinDateChanged` → joining's own idempotent rule; a member moved in is not billed
  the move month twice); a later date leaves charges already raised as they are — money is never
  rewritten. Both writes run in one nested transaction (a 422 commits the request otherwise).
- **A private subscription.** Edit is `EditPackageForm` in a modal; End is the packages page's own
  close modal, extracted to `ClosePackageModal` (the packages page renders the same component,
  unchanged). On the card it also offers **Cancel** for a package nothing was used from
  (`POST /packages/{id}/cancel`, which voids its untouched bill); a used one can only be closed,
  which bills what was used.
- `GET /group-members` rows now carry `left_reason`, so a former membership reads "Left 1 Jul ·
  Paused — travelling".
- Tests: `subscriptions-card.test.tsx` (edit opens with the row's join date and saves through the
  member endpoint; ending sends the date + `PAUSED: note` and the row greys with the reason; package
  edit/close/cancel; no buttons without `group.manage` / `package.manage`; nothing without
  `centre`), `ClassGroupMoneyTest` ("corrects a join date while nothing was held since…").

## Dues on the parent: a family is one account (2026-10-25)

The arrears page showed a child next to their parent because a package bill was addressed to the
child (`LessonPackages::raiseInvoice`: `guardian_id null, student_id …`), and so was every quick bill
raised on a student and the out-of-hours lessons. Fixed at both ends:

- **New package bills** of an academy on receipts (`Ledger::enabledFor`) are filed the way
  `Invoicing::payerOf` files every other charge — the guardian, unless the academy bills each
  student. The line keeps the child's `student_id`. Every reader of a package bill goes by
  `lesson_packages.invoice_id` or the line's student (packages page, Due page, reminder — which
  already preferred the invoice's guardian —, public page, XPay), so nothing else moved. An academy
  without accounting keeps child-addressed package bills, byte for byte (pinned in
  `LessonPackageTest` "bills ON_START packages the moment they open").
- **Existing child-addressed bills are not rewritten.** Instead the ledger reads a family as one
  account: `Ledger::poolsFamily` (every academy that does not bill PER_STUDENT — all 23 on prod).
  There, a guardian's account (`wherePayer`) is the bills addressed to the guardian **plus** those
  addressed to any of their children, and its credit is the receipts recorded on the guardian plus
  on any child. So the Collect screen for a parent lists the children's own bills and one receipt
  on the parent covers them (no receipt splitting — allocations simply reach those lines); the
  parent's credit pays a child's next bill by itself (`afterLinesChanged` on a child-addressed bill
  also applies the guardian's credit); the statement shows both. A receipt keeps the payer it was
  recorded on; only the reading pools.
- **Readers:** `AccountingController::linesQuery` computes the family once in SQL
  (`coalesce(i.guardian_id, child's guardian_id)`), so arrears, overview debtors and the group
  filter show ONE row per family with the children as its names; the family's last payment counts
  one recorded on a child. `FamilyAccountController::show` reads the guardian's pooled account alone
  (summing each child's as well would now count twice); a PER_STUDENT academy still sums every
  child's own account, and its arrears stay one row per student — that academy chose to bill each
  student separately.
- Prod at deploy: 2 academies on receipts, with 3 and 1 child-addressed bills — those now sit in
  their family's row.
- Tests: `AccountingPagesTest` ("shows a family as ONE payer…": arrears, overview, statement, family
  card), `ReceiptsTest` ("collects for the whole family…": the child's bill on the parent's Collect,
  covered by a parent receipt, credit pays a later child bill, the other family untouched),
  `LessonPackageTest` (new bill on the guardian on receipts and still read/reminded/paid; on the
  student in PER_STUDENT; the classic case pinned).

## Renewal policy: renew freely, or pay first (2026-10-25)

Per family, optional: **FREE** (the default — every academy's behaviour until now) or
**PAY_FIRST** — no new group month and no new package while the previous charge is unpaid.

- **Where it is set.** `guardians.renewal_policy` on the family card (a two-way switch under the
  tiles; `invoice.mark_paid` to change, like discounts) and `students.renewal_policy` on the
  student's subscriptions card (`centre` + `accounting`) for one student — a self-guardian, or a
  single child. Either one saying PAY_FIRST holds that student; a family-wide pay first shows on
  the student locked, with a link to the family's page. API: `PATCH
  /accounting/family/{id}/renewal-policy`, `GET|PATCH /accounting/students/{id}/renewal-policy`
  (`RenewalPolicyController`, behind `entitled:accounting`, audited
  `accounting.renewal_policy_changed`).
- **Only on receipts.** `RenewalPolicy::payingFirst` answers nothing for an academy not kept by
  receipts (`Ledger::keeps`): only allocations say exactly which charge is paid. A classic academy
  can't reach the switch and its renewals are untouched.
- **Groups** (`GroupBilling`): a calendar month is not raised while an earlier line of that group is
  owed (`RenewalPolicy::groupOwes` = line amount > its allocations); an hours group stops at the
  next hour-month the same way. The first month on joining is never held. What was skipped is
  remembered — `class_group_members.renewal_held_from`, the first month held back — and the group's
  Accounts tab says "next month waits for payment" on that row (`awaiting_payment_since`).
- **Packages** (`LessonPackages`): a block that runs out does not renew while one of the student's
  package bills is owed — asked after the finished block's own bill exists, since ON_COMPLETION
  raises it at that moment. The block is marked `renewal_held_at`; the bill was written as if
  renewing, so any overdraft stays for the renewal to absorb. The package card says so
  (`renewal_held`). A manual open is refused with a 422 that says why.
- **Release.** Paying raises exactly what was held back, nothing older: `Ledger::record` (every
  receipt, mark-paid included) and `recordGatewayPayment` call `RenewalPolicy::release` for the
  payer's students → `GroupBilling::releaseHeld` (from `renewal_held_from` to today; a month still
  owed holds again and re-marks itself) and `LessonPackages::releaseHeldRenewal` (renews the
  latest block if it is still the latest, still renewable and nothing is owed). Relaxing the policy
  to FREE releases too, and the nightly `BillGroupMonthsJob` releases held members before raising
  the month, so a payment that arrived some other way is caught next night. A static guard stops a
  release from re-entering itself through the credit it applies.
- Migration `2026_10_25_000001_renewal_policy` (additive: two policy columns with checks, two
  markers).
- Tests: `ClassGroupMoneyTest` ("pay first: no new month while the last is unpaid…", "pay first, by
  hours…"), `LessonPackageTest` ("pay first: a block that runs out waits…", "renews freely by
  default, on receipts too"), `AccountingPagesTest` (policy endpoints: family vs child, the stricter
  winning, audited, supervisor 403; 402 without accounting), web `accounting-treasury.test.tsx`
  (family switch) and `subscriptions-card.test.tsx` (student switch; family-wide shown locked; no
  fetch without accounting).

## Discount presets — بنود الخصم (2026-10-25)

An admin defines the academy's recurring discounts once — name, PERCENT or FIXED, value, notes — and
the family card's "Add discount" offers them.

- **Table** `discount_presets` (tenant RLS, the `payer_discounts` shape; PERCENT in basis points,
  FIXED in minor units; `is_active` — retired, never deleted). `payer_discounts.preset_id` remembers
  which preset a discount came from, for reporting later. Migration
  `2026_10_25_000002_discount_presets` (additive; the hard-delete purge walks the new FK
  leaves-first, `ClientDeleteTest` green).
- **API** (`DiscountPresetController`, behind `entitled:accounting`): `GET
  /accounting/discount-presets` (`invoice.read` — the desk picks from them; answers `can_manage`
  and each preset's `uses`), `POST` / `PATCH …/{id}` (`payment_settings.manage`, an existing
  FINANCIAL capability, so no new catalogue entry). Values go in like the family discount form's
  (whole percent / minor units). Editing or retiring a preset never touches a discount already
  given — a discount copies the preset's kind, value and name when it is made.
- `POST /accounting/family/{id}/discounts` takes `preset_id`: the preset's kind, value and name win
  over anything typed; a retired preset is refused (422). Without it the discount is typed in,
  exactly as before ("exceptional").
- **Screens:** a fourth tab on Treasury & expenses, **بنود الخصم** (`DiscountPresetsScreen`: list,
  add, edit, retire / bring back; read-only without `payment_settings.manage`). The family card's
  discount form gets a "Preset" select above the fields (only when active presets exist): picking
  one fills kind / value / label and locks them; "Exceptional — type it in" keeps the free fields.
- Tests: `TreasuryTest` ("keeps discount presets an admin defines once…": CRUD, validation, a
  discount from a preset carries `preset_id` and the preset's label/value whatever was typed,
  editing the preset leaves the discount alone, a retired preset refused, supervisor 403, 402
  without accounting), web `accounting-treasury.test.tsx` (picking a preset fills the form and sends
  `preset_id`; the presets tab adds in whole percent / minor units and retires; no editing without
  the capability).
- **Fix the same day:** the desk could not find presets — none existed yet, so the family card hid
  the picker, and only owner/manager could define one. Now the discount form always shows the
  preset select (empty = "no presets yet" + a link to manage them), a typed discount can be saved
  as a preset on the way ("also save it as a discount preset"), and managing presets is
  `payment_settings.manage` **or** `receipt.void` — the accountant included, a supervisor never.

## New student on groups only (`centre` + `groups`, 2026-10-25)

The new-student form made a centre name an hourly price even under "No private subscription": that
tile was the monthly branch with a relabel, and the monthly price was required. Now, for a client
with `centre` + `groups` (and `group.manage`), the form reads top-down as the desk thinks:

- **Group subscriptions first.** Each picked group is a row with its own "From" date (a class
  nobody has attended yet defaults to its first lesson, else today; the old form joined every group
  on the private subscription's start date), price summary and Remove. Under the list, always
  visible and full width, a dashed "+ Add a group" / "+ Add another group" picker.
- **Private subscription (optional)** below: "No private subscription" is a real third billing
  state (`none`) — no subscription and no package are sent, the student is created REGULAR (the API
  already allowed it; an open membership is enrolment) and joined to the groups. It needs at least
  one group; otherwise the form asks for a group or a private subscription. "Subscription" opens the
  package fields as before.
- Every other academy sees the form exactly as before (monthly / package tiles, hourly price
  required) — pinned by the existing `student-form.test.tsx` cases; new cases cover groups-only,
  "no group picked" and group + subscription.

## Priced by the lesson (`centre`, 2026-10-25)

A centre quotes "40 minutes for 100", not a block total. Under `centre` the price is asked per
lesson and the total is worked out (`components/packages/lesson-price-fields.tsx`):

- **Private subscription** (`PackageTermsFields` / `usePackageTerms` — packages page, new-student
  form, subscriptions card, trial wizard): total hours + lesson length (60 / 40 / 45 / 30 / 90 / 120)
  + price of one lesson → `price_minor = lesson price × hours×60 / length`, read back as "Total 1,500 —
  15 lessons × 100". The API still receives the total; nothing is stored about the unit. The agreed
  hourly rate, when known, suggests the lesson's price. Every other academy keeps the total-price
  field (pinned).
- **Group, monthly by hours** (group form): hours a month first, then lesson length (defaults to the
  group's own lesson length) and the lesson's price → the month's price. An existing group opens with
  its saved month price read back as a lesson price. A calendar-month group (no hours) keeps its
  monthly price field; per-lesson and course groups are unchanged.

## One private subscription per subject (`centre`, 2026-10-26)

A centre's student takes Maths with one teacher and English with another and pays each block
separately. A lesson package may now be tied to a subject — the student's teacher for it
(`student_teacher_assignments`):

- **Schema** (`2026_10_26_300001_package_subject_teacher`): `lesson_packages.teacher_id` (null =
  untied, "any of the student's lessons" — every package before this, every Quran academy's) and
  `course` (the subject's name when sold, for display). The unique rule is now one open package per
  (student, scope): `lesson_packages_one_active_per_scope` replaces `…_one_active_per_student`, so the
  untied scope is still at most one.
- **Which block a lesson spends** (`LessonPackages::forLesson`): the one tied to its TIMETABLE's
  teacher (a substitute taking a Maths lesson still spends Maths hours; no timetable → the lesson's
  own teacher), else the untied one, else none → billed by the hour as before.
- **Everything per scope:** the duplicate check, carry-over, the absorbed overdraft, the overdraft
  rolled onto the next bill, renewal (a Maths block renews as Maths), pay-first holds and their
  release, importing past lessons (a tied block takes only its subject's lessons), "out of hours"
  (the latest block of its own subject; only that subject's lessons count), the sessions list's
  covering block. Removing a student closes every open block. The unpaid-predecessor alert stays
  per student (it is a warning to the desk).
- **Who may tie one:** only an academy with `centre`, and only to a teacher the student is taking a
  subject with now (422 otherwise). Every other academy keeps exactly one block per student.
- **Screens:** the open-subscription form (packages page, student subscriptions card) gets a
  "Subject" picker once the student has subjects — "any lesson" or one of their subjects, each marked
  "(open)" when it already holds a block; it starts on a free subject. Cards and the subscriptions
  card show the subject. The new-student form's first subscription stays untied (it covers every
  lesson); per-subject ones are added from the student's page.
- Tests: `LessonPackageTest` ("a centre sells one subscription per subject…", "keeps one subscription
  per student where the academy is not a centre"), web `open-package-form.test.tsx`.
- **Fix the same day — a subject the student is only now starting.** Lingo's students had no
  teacher/subject links at all (groups only, no private timetables), so the picker had nothing to
  offer and a second subscription was refused. The picker now shows for every centre student with
  "+ New subject…": a subject name and a teacher; saving opens the block tied to that teacher and makes
  the student↔teacher↔subject link with it (`new_subject` + `course` on `POST /packages`, written only
  after every check passes; the controller wraps the open in one transaction). A student whose "any
  lesson" block is open and who has no free subject starts on "+ New subject…".

## One account, its own page (2026-10-28)

Lingo's desk said the treasury was "not clear at all": a grid of cards, and a "movements" popup
mixing receipts, expenses, transfers and counts in one running table. Now each card (and each
account on the Overview strip) opens `/accounting/treasury/{id}` (`TreasuryAccountScreen`):

- **Period** — this month (default) · last month · since opening · custom. Same
  `GET /treasury/accounts/{id}/ledger?from&to`, no new endpoint.
- **Top strip** — opening balance (labelled *opening* when the period starts the day the account
  opened, *balance at the start* otherwise, with the original opening in the hint) · total
  collected (receipts only) · total spent (expenses only) · balance at the end. Transfers and count
  differences move the balance but are neither, so a one-line note gives their net and the four
  numbers still add up.
- **Two sides** — collected beside spent, newest first, each side's total as its header; the
  spent side has category chips. Transfers / count differences sit apart under each side.
- **Every line opens**: a receipt → the existing `ReceiptDetailModal`; an expense, transfer or
  count → `EntryDetailModal` (void an expense / transfer with a reason, reopen the last counted
  day) — inline, never a second modal.
- **Statement tab** — the old popup's chronological table with the running balance (popup removed).
- Header actions: new expense from this account (`ExpenseModal` now exported, takes `accountId`),
  transfer, close the day.
- Ledger entries gained `category_key`, `has_attachment`, `payout_id`, `by`, `from_name`/`to_name`.
  **Fix:** the ledger used to show a salary's teacher and month to anyone with `invoice.read` —
  supervisors hold it since 2026-10-28 — now blanked without `payout.read` (amount still moves the
  balance). Pinned in TreasuryTest.

**Same day, round 2 — edit, adjust, delete (Ahmed: "delete the treasury, edit the daily amount"; he
picked all three meanings of "amount"):**

- **Edit the account** (`PATCH /treasury/accounts/{id}`, `expense.manage`): name, opening balance,
  opening day. The opening is locked once any day was counted (a closing froze what the books said
  then — moving the start would quietly unbalance it); after that the fix is an adjustment. The
  opening day may not move past the first live movement filed under the account. Audit keeps before.
- **Adjust the balance** — تسوية رصيد (`cash_adjustments`, `POST /treasury/adjustments`,
  `cashbox.close`): the desk types what is really there, the difference from the books is stored
  signed with a required reason; like a count, but the day stays open. Voided with a reason, never
  deleted, refused on a closed day. `balance = … + Σ live adjustments`. Ledger kind `ADJUSTMENT`.
- **Correct an amount** (`PATCH /expenses/{id}`, `PATCH /treasury/transfers/{id}`,
  `expense.manage`): from the line's detail popup; refused on a closed day; a salary never past
  what is left on its statement (and needs `payout.read`). Audit keeps before/after.
- **Delete** (`DELETE /treasury/accounts/{id}`): an account with no history at all (`Treasury::
  hasHistory` — any receipt/expense/transfer/closing/adjustment, voided included, or a mapped
  receipt since its opening day) is deleted for good with its method map; one with history is
  STOPPED instead (`is_active=false`, methods unmapped, records kept) and only when its balance is
  zero. Stopped accounts are listed under the treasury grid and can be reactivated from their page.

## A child's charges follow them to their new family (2026-10-28)

Lingo had two «آيات محسن»; the desk moved the child onto one to delete the other — and the emptied
parent kept every bill (a parent with no children, still owing) while the new one owed nothing.
`PATCH /students/{id}` with a new `guardian_id` re-pointed the child alone.

Now `App\Services\FamilyCharges::carry()` runs inside the move (one transaction) for PER_GUARDIAN
academies, accounting or classic, bill by bill over the old family's bills holding the child:
an OPEN bill → all the child's lines go to the new family's bill for that month (or the bill changes
hands whole if it is only the child's; two AUTO bills for one family+month can't exist, so a running
month joins the twin and the emptied bill stays at zero — never deleted, xpay rows cascade off
invoices); a closed bill only the child's with something owed → changes hands whole (a twin forces it
to MANUAL); a closed bill shared with siblings → cannot split (frozen totals), reported as `stuck`;
fully paid → stays. Receipts never move; allocations follow their lines. The response carries
`charges {lines, invoices, stuck, amounts}`; audit `student.charges_moved`.

Repair for moves made before: `GET /guardians/{id}` returns `moved_away` (invoice.read only) and the
family page shows an amber card per child with "Move the charges" → `POST /students/{id}/carry-charges`
(student.update, idempotent). Tests: tests/Feature/Accounting/FamilyChargesTest.php.

## Discounts: several targets, end and cancel (2026-10-28)

A centre reported two things: a discount it ended (or wanted gone) **stayed on the bill**, and a
discount could be put on **one group only**, never two groups or two subscriptions.

- **Why it stayed.** Ending only set `ends_on = today`; it never touched lines already priced. And
  "apply to existing" moves `starts_on` back to the month's first charge, so this month's group
  line (dated the 1st) was still inside the discount's life after an end "today".
- **End = from a day, and the open bills follow.** `POST /accounting/family/{g}/discounts/{id}/end
  { ends_on? }` (today by default; never before `starts_on`; an earlier end is kept) →
  `PayerDiscounts::end()` re-prices every line in the discount's reach on an OPEN bill dated on or
  after that day. Earlier lines keep it. The row's "إنهاء" opens a date (default today).
- **Cancel = as if never given.** `DELETE /accounting/family/{g}/discounts/{id}` (was "end today")
  → `PayerDiscounts::cancel()`: `ends_on = starts_on`, `cancelled_at/by`, and every line in reach on
  an OPEN bill is re-priced. Closed bills never move. Offered on ended discounts too — that is how a
  discount ended before this change comes off the open bills now. A line going up keeps what was
  paid toward it, and `afterLinesChanged` spends the family's credit (often the credit the discount
  made) on it first. Both return `removed {lines, amount_minor}` and are audited
  (`accounting.discount_ended` / `accounting.discount_cancelled`).
- **Targets.** `payer_discount_targets` (migration 2026_10_28_300001): any number of
  `{class_group_id}` (that group's charges, any child the discount covers) or
  `{student_id, teacher_id?}` (one child's private charges; with a teacher only that subject's — the
  package's `teacher_id`, or the lesson's timetable teacher via `LessonPackages::lessonTeacher`). No
  targets = everything in scope, as before. The POST takes `targets`; the scope follows them (all
  groups → GROUP, all private → PRIVATE, mixed → ALL). The old single `payer_discounts.class_group_id`
  was copied in as a target and is no longer read. `apply()` takes the subject teacher as an
  optional last argument; the private-lesson writer passes a closure, called only when a standing
  discount names a subject. The package writer (`raiseInvoice`) gets the block's `teacher_id`.
- **Form.** "يُطبَّق على": every charge / every group / every private lesson / **chosen groups or
  subscriptions** → a checklist of the chosen child's (or every child's) groups and private
  subscriptions (`children[].private_subscriptions`: all private lessons, plus one entry per open
  subject block). Ticks of another child drop out when the child changes.

Tests: TreasuryTest (end today re-prices July; cancel after a closed May; end from a chosen day;
several groups + one subject + mixed + refusals), accounting-treasury.test.tsx.

## Lessons, not hours; a family suspended and the dues raised ahead (`centre`, 2026-10-29)

Ahmed for the curriculum centres: a subscription is "8 lessons of 40 minutes at 90 each", never
"5h20 at 135 an hour"; suspending a family should suspend its children; and what was billed ahead
must be cancellable — the child may not come back, yet the charge stayed.

- **Private subscription in lessons.** `lesson_packages.lesson_minutes` (migration
  2026_10_29_000001, nullable): the length of one lesson the block was sold in. Display only — the
  engine still runs on minutes and the hourly rate. Under `centre` every form (open / new student /
  trial wizard / subscriptions card / edit) asks **lessons** + length + one lesson's price; the
  server gets `hours = lessons × length / 60`, `price_minor = lessons × price` and `lesson_minutes`.
  Renewal copies it; a NEXT-only edit parks it in `next_terms`. Cards (package card, subscriptions
  card) read "6 lessons left", "2 of 8 lessons", "90/lesson (40 min)" when it is set. Quran
  academies never send it, so their cards are unchanged.
- **Group month in lessons.** A centre's monthly group asks "lessons a month" (× the lesson length
  = `month_minutes`, unchanged on the server); the group page, money tab and new-student group list
  read "450 for every 8 lessons" (`moneyTab.rule.MONTHLY_LESSONS`).
- **Suspend takes the children with it.** On top of timetables off and no new group months
  (2026-10-24), `ClassGroups::roster` now leaves a suspended family's children off every group
  sheet dated from the suspension day (academy tz) — so they are not marked present by default or
  counted for teacher pay. The students list shows "Family suspended" (`family_suspended_at`).
- **Dues raised ahead — إلغاء المستحق.** `invoice_line_items.cancelled_minor / cancelled_at /
  cancelled_by / cancel_reason` (migration 2026_10_29_000002). `ChargeCancellation::cancel()`:
  only on an OPEN bill and only with `accounting`; the unpaid part goes (`amount_minor` → what was
  paid), totals follow, ledger refresh + group revenue share re-sync; the line stays, so
  `BillGroupMonthsJob` never raises it again, discount re-pricing skips it and package re-pricing
  skips its bill. A line of a private subscription's own bill takes the whole bill and ends the
  subscription: unused → `LessonPackages::cancel()` (bill voided if nothing paid), used →
  `auto_renew=false` + `complete(…, 'CHARGE_CANCELLED')`.
  `advanceDues()` = unpaid lines on OPEN bills of the family's children that are a group MONTHLY/
  COURSE charge from this month on, or a running package's bill.
  - `GET /guardians/{id}/advance-dues`, `POST /guardians/{id}/suspend { cancel_line_ids }` (only ids
    in that set; `invoice.mark_paid`) — the suspend card asks first and lists them, nothing ticked.
  - `POST /accounting/family/{g}/charges/{line}/cancel { reason? }` — "إلغاء المستحق" on any charge
    of the family card on an open bill (`bill_open`).

Tests: CancelDuesTest (advance dues + suspend cancel + never re-raised + discount skip; roster;
one charge part-paid; package unused/used; non-accounting; lesson_minutes through edit and renewal),
family-profile / accounting-treasury / subscriptions-card / groups / open-package-form tests.

## A subscription that ends early — the money paid for lessons not taken (2026-10-29)

A curriculum centre asked: a family paid a whole private subscription up front, the child stopped
part-way, and they are owed the rest — how does the system know, even while the child is stopped?
Before, the unused part of a closed ON_START block simply vanished: no credit, no trace.

**Settling a block** (`App\Services\PackageSettlement`, `lesson_packages.settlement`):

- A block billed up front that closes (by hand, the student removed, its bill let go) with lessons
  left on a bill that charges more than they used is **PENDING**. It shows on the family's money
  card — «فلوس للأسرة من اشتراكات انتهت قبل ما تخلص» — the children who left included, until
  someone decides. The close dialog asks in the same step (or "decide later").
- What comes back = what was **paid** on the block's line − what was **used** (the agreed price
  after discount × used minutes ÷ bought minutes). Never more than was paid: a bill let go
  (إلغاء المستحق) or never paid returns nothing.
- **CREDIT** — the line (and its bill, even closed) comes down to what was used. The DB trigger that
  frees allocations above a repriced line gives the excess back to the receipts: the family's credit,
  which pays their next charges by itself.
- **REFUND** — the same, then the credit is paid out of a treasury account: an expense under the new
  category `refunds` («رد مبالغ للأسر»), drawn on the receipts that held it (`receipt_refunds`).
- **KEEP** — nothing moves; the decision, amount and reason are recorded.
- A block settled with money (CREDIT / REFUND) has nothing left to **carry over** into the next one;
  a PENDING block whose minutes are carried over is no longer owed anything.

**Refunds** are a ledger fact now: a receipt's credit = amount − allocated − refunded (a refund
whose expense is voided gives it back, and the settlement turns back to CREDIT). The family card
pays any credit back («رد الرصيد»); the statement shows refunds as their own debit line; a
receipt that was partly paid back cannot be voided, and a refund expense's amount cannot be edited
(void it and pay again). The `refunds` category is not offered in the manual expense form.

**Closed bills**: totals stay frozen except inside a settlement, which names its one invoice in the
transaction-local `app.settling_invoice_id`, and then only downwards.

Endpoints: `GET /packages/{id}/settlement`, `POST /packages/{id}/settle`, `settlement` on
`POST /packages/{id}/close|cancel`, `POST /accounting/family/{guardianId}/refund`. Money moves on
`invoice.mark_paid` (+ `package.manage` to settle); paying out also takes `expense.manage`.

**Scope rule (Ahmed, 2026-10-29): none of the 2026-10-29 work may change anything for the existing
Quran academies.** Everything above — and the prepaid-subscription settlement shipped beside it —
is gated on `centre`, on the server (`Entitlement::hasCapability($academyId, 'centre')`:
`ChargeCancellation::availableFor`, `PackageSettlement::availableFor`, `ClassGroups::roster`) and in
the web (students-list badge, suspend asks first, charge cancel, close-dialog settlement). A Quran
academy on the accounts still suspends on one click, keeps a suspended child on the group sheet,
gets no advance dues / cancel / settlement / refund (pinned: CancelDuesTest "changes nothing for an
academy that is not a centre", family-profile + accounting-treasury tests). The `refunds` expense
category is created on first use, never seeded. Found on the way: the settlement's invoice-freeze
exception read `current_setting('app.settling_invoice_id', true)` bare — NULL on a fresh connection
made the whole IF NULL, so plpgsql skipped the raise and a CLOSED invoice's totals could be lowered
in any academy; now `coalesce(…, '')`, pinned by "never lets a closed bill's total change".
