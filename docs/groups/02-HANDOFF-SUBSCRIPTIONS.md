# Handoff: subscriptions you can edit, family-level dues, renewal policy, discount presets

Written 2026-10-25 for the next agent. Read `docs/groups/00-OVERVIEW.md` and `01-ACCOUNTING.md`
first, then the memory notes `accounting-receipts.md`, `group-classes.md`, `lesson-packages.md`,
`prod-deploy-runbook.md`, `api-test-db-harness.md`, `api-test-plan-id-gotcha.md` in
`~/.claude/projects/-Users-ahmedomar-Documents-academiq-sass/memory/`.

## The rules that never move

1. **The Quran / private-lesson academies must not change.** Every screen change for the centre
   client lives behind `centre` (opt-in, `FeatureCatalog::OPT_IN_CAPABILITIES`), `groups` or
   `accounting`. A shared code path that changes behaviour is gated server-side too
   (`Ledger::enabledFor`, `entitled:…`). Pin the old behaviour with a test on every screen you touch
   (see `AccountingPagesTest`, the app-shell tests, `student-form.test.tsx`).
2. **Money is never edited or deleted — it is ended or voided with a reason.** Receipts, lines,
   discounts, memberships: `left_on`, `ends_on`, `voided_at`. What was already billed stays.
3. **Migrations are additive only** (new columns / tables). Roll back = switch off + git revert.
4. One commit per feature, `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Deploy =
   commit + push, pre-deploy dump, the exact allow-listed deploy command (runbook), verify
   `/api/health`, services, row counts. `hero.png` and `marketing-ads/` at the repo root stay
   untracked (never `git add -A .` at the root).
5. Tests: API suites run isolated (`vendor/bin/pest tests/Feature/<dir>`), never the whole tree;
   `php artisan migrate --env=testing` first. Web: `npx tsc --noEmit`, `npx eslint src`,
   `npx vitest run`. One flaky pre-existing web failure (payroll "narrows the statements list").

## Where things are today

- Student profile page = `components/students/student-profile.tsx` (NOT `student-detail.tsx`, which
  is the list's drawer). Its subscription tab renders `SubscriptionsCard`
  (`components/students/subscriptions-card.tsx`): groups via `GET /api/group-members?student_id=`
  (`GroupBoardController::members`) and private subscriptions via `GET /api/packages?student_id=`.
- Group membership API: `POST /groups/{id}/members`, `PATCH …/members/{studentId}` (price
  override only), `DELETE …/members/{studentId}` (= leaves from `left_on`, default today),
  `POST …/members/{studentId}/move`. Service `App\Services\ClassGroups` (`addMembers`,
  `leaveAllFor`, roster rule `joined_on <= d < left_on`). Billing `App\Services\GroupBilling`
  (MONTHLY calendar / MONTHLY by hours `month_minutes` / PER_LESSON / COURSE; `solo_billed_minutes`).
- Packages (private subscriptions): `App\Services\LessonPackages` (~1800 lines; `open`, `edit`,
  `complete`, `cancel`, `renew`, `billOverdraft`, auto-renew on exhaustion). ONE open package per
  student (`lesson_packages_one_active_per_student`). Package invoices are raised ON THE STUDENT
  (`LessonPackages::raiseInvoice`, `guardian_id => null, student_id => …`) even in a
  PER_GUARDIAN academy — this is why the arrears page shows a child beside their parent.
- Family card = guardian page → `FamilyAccountsCard` (`components/accounting/family-accounts-card.tsx`,
  API `FamilyAccountController::show` + `/discounts` endpoints, `App\Services\PayerDiscounts`).
  Discounts: `payer_discounts` (kind PERCENT bp / FIXED minor, label, scope ALL/GROUP/PRIVATE,
  class_group_id, starts_on, ends_on), applied by every line writer via `PayerDiscounts::apply()`.
- Arrears / statement / overview: `AccountingController` (`openLines`, `payerKey` = guardian or
  student or named invoice).

## Build these, in this order

### 1. Edit / end any subscription from the student profile (`centre`)

Goal: from the subscriptions card, each row has **Edit** and **End** (pause / cancel), because
students pause or drop one group while keeping others.

- Group row → Edit: join date (only while the group has held nothing after it), member price
  override (exists: `PATCH …/members/{studentId}` `price_minor`), move to another group (exists).
  End: `DELETE …/members/{studentId}` with `left_on` (date picker, default today) and a reason —
  the endpoint takes `left_on`/`left_reason` already (check `removeMember`). Show former
  memberships greyed with "غادر {date}" (already rendered).
- Private subscription row → Edit: reuse `EditPackageForm` (`components/packages/edit-package-form.tsx`)
  in a modal; End: `close` (keeps what was used, bills/credits per existing rules) or `cancel`;
  reuse the packages page's own modals (`packages-manager.tsx` has them) rather than new ones.
- A **pause** on one group = end the membership with reason PAUSED and a note; re-joining later
  = add again (the join-date rule from b061a90 handles a fresh group; otherwise today). Do NOT
  build a paused state on memberships — hour balances already carry across a move
  (`carried_minutes`), and the client's three-groups-renew-two case is "end the third".
- Tests: web `subscriptions-card.test.tsx` (edit opens with the row's values, end calls the API
  with the date/reason); API nothing new unless you add fields.

### 2. Dues on the PARENT, with every child's subscriptions

Goal: the arrears page, overview debtors, the family card and the Collect screen show ONE row per
family holding all its children's charges; today a child's package invoice appears as a separate
"student" payer next to the parent.

- Root cause: `LessonPackages::raiseInvoice` puts the package invoice on the student. Fix it at
  the source for new invoices: resolve the payer the way `Invoicing::payerOf` does
  (PER_GUARDIAN → guardian unless the student is self-guardian; PER_STUDENT → student). Check
  every reader of `lesson_packages.invoice_id` / `payer-account?invoice_id` still works with a
  guardian invoice (the package card's pay link, `useInvoiceUrl`, XPay session, reminders).
- Existing student-side invoices: do NOT rewrite history. Instead make the family readers roll
  child payers into the parent row: `AccountingController::arrears/overview` — group `payerKey`
  by `students.guardian_id` when the student has a guardian (keep the child's name as a sub-line);
  `FamilyAccountController::show` already sums guardian + each child (keep); the Collect modal
  opened for the guardian should list the children's student-side lines too (`Ledger::openLines`
  with the family's payers — see how `FamilyAccountController` builds `$payers`) and allocate a
  receipt recorded on the guardian across them (today a receipt's allocations are limited to
  the payer's own lines — extend `Ledger::record` with an explicit family payer set, carefully:
  allocations and credit stay per payer; the simplest safe route is one receipt per payer
  behind one Collect screen, split in the UI, and say so in the receipt list).
- Tests: `AccountingPagesTest` (one arrears row for a family with a child-side package invoice),
  `ReceiptsTest` (collect from the family covers the child's package line), `LessonPackageTest`
  (new package invoice lands on the guardian in a PER_GUARDIAN academy, on the student in
  PER_STUDENT / self-guardian).

### 3. Renewal policy per family: "new subscription before the old is paid?"

Goal: per guardian (and per student for self-guardians) a switch: **renew freely** (a new group
month / package opens even with the old unpaid) vs **pay first** (block the new charge until the
previous one is settled). Optional, default = today's behaviour (renew freely).

- Column `guardians.renewal_policy text default 'FREE'` (`FREE` | `PAY_FIRST`) and the same on
  `students` for self-guardians; editable on the family card (accounting cap) and the student
  profile (centre).
- Enforce in `GroupBilling` (monthly / hour-month raise: skip the member with an unpaid earlier
  line on that group when PAY_FIRST — and surface it on the group Accounts tab as "awaiting
  payment") and in `LessonPackages::renew` / `open` (refuse / skip auto-renew while the previous
  package's invoice is unpaid, with a clear 422 for a manual open; the packages page already
  shows unpaid flags via `flagUnpaidPredecessors`).
- Tests: `ClassGroupMoneyTest` (PAY_FIRST: no second hour-month until the first is paid; FREE
  unchanged), `LessonPackageTest` (auto-renew held back under PAY_FIRST, released on payment —
  `Ledger::afterLinesChanged` / receipt allocation is the hook to re-run the raise).

### 4. Discount presets (بنود الخصم) an admin defines once

Goal: Settings → (accounting) a list of presets — name, PERCENT or FIXED, value, notes — and the
family card's "Add discount" offers them in a picker (fills kind/value/label) or "exceptional"
(type it, as today).

- Table `discount_presets (id, academy_id, name, kind, value, notes, is_active, created_by,
  created_at, updated_at)` under tenant RLS (copy the `payer_discounts` migration shape).
- API: `GET/POST/PATCH /accounting/discount-presets` behind `entitled:accounting`, cap
  `payment_settings.manage` or `receipt.void` (FINANCIAL — file it in `PermissionCatalog::AREAS`
  + `FEATURE_BY_DOMAIN` if you add a new one). `payer_discounts.preset_id uuid null` so a
  discount remembers where it came from (reporting later).
- UI: a "بنود الخصم" card on the Accounting pages (Treasury hub → a fourth tab, or Settings →
  Accounting section); the family card's discount form gets a preset select above the fields,
  "استثنائي" keeps the free fields.
- Tests: `TreasuryTest` (preset CRUD, discount from preset carries `preset_id` and the preset's
  label/value), web `accounting-treasury.test.tsx` (picking a preset fills the form).

## After each feature

Docs: append an "as built" paragraph to `docs/groups/01-ACCOUNTING.md`; update the memory notes
(`accounting-receipts.md`, `group-classes.md`, `lesson-packages.md`) with what changed and any
trap you hit. Then commit, dump, deploy, verify — one feature at a time, so each can be reverted
alone.

## Open items the client still owes us

- A private subscription keyed to a teacher/subject (needs their definition: hours that renew vs
  a monthly fee) — deliberately not built; it reshapes the shared packages engine.
- The "attendance shows only lessons after now" report — not reproducible from the code; needs a
  screenshot with date and filters.
