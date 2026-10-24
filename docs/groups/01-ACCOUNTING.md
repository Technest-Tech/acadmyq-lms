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
