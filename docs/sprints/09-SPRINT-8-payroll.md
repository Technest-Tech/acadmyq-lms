# Sprint 8 — Payroll

> **Status:** Detailed / Ready to execute
> **Depends on:** Sprint 1 (payouts/payout_line_items schema, `sessions.paid_to_teacher` guard, money-as-minor-units), Sprint 2 (Sanctum auth, Gates/RBAC, teacher self-scope `payout.read_own`, `TenantContextMiddleware`), Sprint 4 (teacher `session_rate_minor`/currency), Sprint 6 (`classify()` → `countsForTeacher`, ATTENDED sessions), Sprint 7 (parallel money document; shares money/snapshot discipline)
> **Blocks:** Sprint 9 (profit summary + plan gating reads payouts)
> **References:** Master Spec §5.7 (R-PAY-1..3 — central), §5.4 (classify), §6.3 (money/idempotency); Sprint 1 §6.7 (payout tables), §6.5 (`paid_to_teacher`); Sprint 6 §4 (classify, countsForTeacher); Sprint 7 §3 (snapshot discipline)

> **This is the second money document.** Where Sprint 7 bills students, this pays teachers — from the **same** session data and the **same** `classify()` function. A session that is `ATTENDED` pays the teacher; everything else does not (your rule: "مرتب المدرس على عدد الحصص اللي أدّاها"). Reuse Sprint 7's disciplines: integer minor units, rate snapshot, immutability after finalize, idempotent guards.

---

## 1. Goal

Compute each teacher's monthly **payout** as the sum of (delivered sessions × that teacher's session rate), in the teacher's currency, exactly as you specified — and present it as a finalizable statement with line items. Give the teacher a read-only view of **their own** payout, and the owner a view of all payouts plus an **academy profit summary** (revenue − payouts).

The deliverable is judged on: *does every `ATTENDED` session pay the assigned teacher exactly once at the rate snapshotted at attendance time; do non-attended outcomes never pay; does finalize seal the statement immutably; and is the profit summary (Sprint-7 revenue − payouts) correct and currency-aware?*

## 2. Scope

### In scope
- **Payout accrual**: when a session is `ATTENDED` (Sprint 6 classify → `countsForTeacher=true`), create a payout line item for the session's teacher on the period's **open** payout statement, with the **rate snapshotted** at attendance time, idempotently via `sessions.paid_to_teacher` (R-PAY-1/2).
- **Rate resolution + snapshot**: copy the teacher's `session_rate_minor` + currency (Sprint 4) onto the line item at accrual time, so later rate changes don't rewrite past payouts (mirrors Sprint 7 §3.1).
- **Reversal before finalize**: if a session's status later changes away from ATTENDED (Sprint 6 correction) **before the payout is finalized**, remove the payout line and clear the guard; after finalize, reject (immutability).
- **Period statement**: one payout per teacher per period (`unique(academy_id, teacher_id, period_year, period_month)` — Sprint 1); totals maintained transactionally.
- **Finalize (month-end)**: a scheduled job (and manual owner action) finalizes the period's payouts → immutable; sets `finalized_at`. (Payout immutability enforced analogously to invoices.)
- **Teacher self-view**: a teacher sees only their own payout statements and line items (`payout.read_own`, Sprint 2 §3.6).
- **Owner view**: all teachers' payouts (DataTable), payout detail, and the **profit summary**: per-period academy revenue (from Sprint 7 PAID/closed invoices) minus payouts, **per currency** (no FX).
- **Multi-currency**: payouts in the teacher's currency; the profit summary groups by currency (no conversion, R-INV-7 analogue).
- Audit for line accrue/reverse, finalize, rate snapshot.

### Out of scope (deferred)
- Actually **paying** teachers (bank transfer/disbursement) — the statement records what is owed; money movement is out of platform scope (consistent with the platform-not-a-wallet stance, Master Spec §1.2).
- Bonuses, deductions, taxes, advances — post-MVP backlog (the line-item model can absorb them later).
- Per-student or tiered teacher rates — MVP uses a single rate per teacher (Sprint 4). Variable rates are backlog.
- Plan-based gating of payroll features (Sprint 9).
- Cross-currency consolidated profit (needs FX — post-MVP).

---

## 3. Design decisions (locked for this sprint)

1. **Same `classify()`, same truth.** Payroll uses the identical `classify(status).countsForTeacher` from Sprint 6 — never a second copy of the matrix. Only `ATTENDED` pays (per Master Spec §5.4: unexcused-absent bills the student but does **not** pay the teacher; teacher/student cancellations and excused absence pay nothing). Tested against every enum value.
2. **Rate snapshot at attendance time.** The line item stores its own `amount_minor`+currency copied from the teacher then; later rate edits (Sprint 4) don't change historical payouts (R-PAY-1/3, mirrors Sprint 7).
3. **`paid_to_teacher` guard = idempotency, not classification.** As with `billed` (Sprint 6), the boolean prevents a duplicate payout line; classification stays derived from status. Unique `(payout_id, session_id)` (Sprint 1) is the DB backstop.
4. **Teacher attribution = the session's teacher.** The payout goes to `sessions.teacher_id` (the teacher who actually delivered it), which already reflects reschedules/reassignments captured at generation time (Sprint 5). Not the student's "current" teacher.
5. **Open until finalize; immutable after.** Accrual/reversal allowed only while the payout is open; finalize seals it. After finalize, an ATTENDED→other correction is rejected for payroll (the statement is already paid out in the real world).
6. **Profit summary reads, never writes.** It's a computed view: Sprint-7 revenue (closed/paid invoices) − payouts, grouped by currency. It does not create or mutate any money document.
7. **Reuse Sprint 7's money discipline verbatim.** Integer minor units everywhere; totals maintained transactionally with a pre-finalize integrity check; no floats; currency on every line.

---

## 4. The payroll functions (parallel to Sprint 7's billing functions)

PHP service methods (e.g. `App\Services\Payroll`), hooked off the same Sprint 6 status-change transaction.
```
onSessionAttended(S):   # called when classify(S.status).countsForTeacher && !S.paid_to_teacher
  within the active tenant-context transaction (TenantContextMiddleware / Tenancy::withContext):
    payout = getOrCreateOpenPayout(academy, S.teacher_id, period(S.scheduled_at_utc), teacher.currency)
    if line exists for (payout, S): return                  # idempotent (unique constraint)
    amount = teacher.session_rate_minor ; currency = teacher.currency   # snapshot now
    insert payout_line_items(payout, S, amount, currency)
    payout.total_minor += amount
    S.paid_to_teacher = true                                # guard (Sprint 1)
    audit(payout.line_accrued)

onSessionUnattended(S): # status changed away from ATTENDED, payout still OPEN
  within the active tenant-context transaction:
    payout = open payout for teacher/period
    if payout.finalized_at is not null: reject("cannot reverse: payout finalized")  # R-PAY immutability
    delete line for (payout, S)
    payout.total_minor -= amount
    S.paid_to_teacher = false
    audit(payout.line_reversed)
```

- Hooked off the **same** Sprint 6 status-change transaction that fires the billing hook: one status change can affect both the student invoice (Sprint 7) and the teacher payout (here), each guarded independently (`billed` vs `paid_to_teacher`).
- Example consistency check (your rule): a session marked **ABSENT_UNEXCUSED** → Sprint 7 **bills the student**, Sprint 8 **does not pay the teacher**. Tested (TC-8.5).

## 5. Finalize (month-end)

```
finalizePayouts(period):   # Laravel-scheduled job (Tenancy::withContext per academy) + manual owner action
  for each OPEN payout in period:
    verify total == sum(line items)        # integrity check
    finalized_at = now()
    audit(payout.finalized, total)
  # immutable thereafter; ATTENDED-reversals for this period rejected
```
- Runs at month end via the Laravel scheduler (`routes/console.php` → `Schedule::job(...)`), aligned to the academy's billing boundary (reuse Sprint 7's period logic for consistency).
- Idempotent (finalizing an already-finalized payout is a no-op).

## 6. Profit summary (owner)

- A read-only per-period view: for each currency present in the academy,
  `profit[currency] = revenue[currency] − payouts[currency]`
  where `revenue` = sum of Sprint-7 invoices that are CLOSED/PAID for the period in that currency, and `payouts` = sum of payout totals for the period in that currency.
- **Per currency, never summed across currencies** (no FX). The UI shows one row per currency.
- Matches the prototype's "صافي ربح الأكاديمية = الإيراد − المستحقات".

## 7. Schema / Data deltas

Sprint 1 created the payout tables and the guard. This sprint adds small fields and an immutability trigger:

- **`payout_line_items.session_date`** `date null` — denormalized snapshot for statement ordering/display.
- **`payouts.notes`** `text null` — optional owner note on a statement.
- **Immutability trigger** on `payouts`/`payout_line_items` (parallel to Sprint 1's invoice trigger): once `finalized_at` is set, forbid line add/remove and total changes. (If not added in Sprint 1, add here.)
- Confirm unique `(payout_id, session_id)` on line items and `(academy_id, teacher_id, period_year, period_month)` on payouts (Sprint 1).

A Laravel migration `..._payroll_engine` (with `down()`): adds the fields above and the finalize-immutability trigger (`DB::unprepared` for the trigger/function DDL).

## 8. API surface

| Method & path | Permission | Purpose |
|---|---|---|
| (internal) `Payroll::onSessionAttended/Unattended` | system (called by Sprint 6) | Payout line accrue/reverse with snapshot |
| `GET /api/payouts` | `payout.read` | Owner: all teachers' payouts (DataTable, by period/teacher/status) |
| `GET /api/payouts/{id}` | `payout.read` (owner) / `payout.read_own` (own) | Payout detail + line items |
| `GET /api/me/payouts` | `payout.read_own` | Teacher: own payout statements |
| `POST /api/payouts/finalize` | `payout.read`+finalize | Finalize a period (idempotent) |
| `GET /api/reports/profit-summary` | `payout.read` (owner) | Per-period, per-currency revenue − payouts |

Internal functions run within the tenant-context transaction (`TenantContextMiddleware`); teacher endpoints filtered to own `teacher_id` (Sprint 2 §3.6) and gated with `Gate::authorize`. Owner endpoints require owner-level permissions.

## 9. Definition of Done / Acceptance Criteria

- **AC-8.1** An `ATTENDED` session accrues exactly one payout line to the session's teacher, at the rate **snapshotted** at attendance time, in the teacher's currency. (R-PAY-1/2/3)
- **AC-8.2** No non-attended outcome ever pays the teacher; specifically `ABSENT_UNEXCUSED` bills the student (Sprint 7) but pays the teacher **nothing**. (Master Spec §5.4)
- **AC-8.3** Changing a teacher's rate later does not alter existing payout line items or any finalized payout. (R-PAY-3, snapshot)
- **AC-8.4** Re-marking the same session ATTENDED does not create a duplicate payout line (`paid_to_teacher` guard + unique constraint). (R-PAY idempotency)
- **AC-8.5** ATTENDED→other before finalize removes the payout line and adjusts the total; after finalize it is rejected. (immutability)
- **AC-8.6** Finalize seals the payout immutable (no line/total changes thereafter), sets `finalized_at`, and is idempotent. (immutability)
- **AC-8.7** Open payout totals always equal the sum of their line items. (integrity)
- **AC-8.8** A teacher can read only their **own** payouts; cannot see other teachers' or the academy profit summary. (Sprint 2 §3.6)
- **AC-8.9** The owner sees all payouts and a **per-currency** profit summary = revenue − payouts, with no cross-currency summing. (R-INV-7 analogue)
- **AC-8.10** Payout attribution follows `sessions.teacher_id` (actual deliverer), reflecting reschedules/reassignments. (decision §4)
- **AC-8.11** All payroll operations are RLS-isolated and audited (accrue/reverse, finalize). (R-TEN, R-AUD-1)
- **AC-8.12** Payroll uses the same `classify()` as Sprints 6/7 (no duplicated matrix). (decision §3.1)

## 10. Test Cases

> `TC-8.<n>`, mapped to ACs.

### Accrual & snapshot
- **TC-8.1** Mark a session ATTENDED → one payout line for that teacher; amount = teacher rate; currency matches; `paid_to_teacher=true`. *(AC-8.1)*
- **TC-8.2** Two ATTENDED sessions for the same teacher in a period → two lines on one payout; total = 2 × rate. *(AC-8.1, AC-8.7)*
- **TC-8.3** Change teacher rate after a line exists → existing line amount unchanged; a new ATTENDED session uses the new rate. *(AC-8.3)*
- **TC-8.4** Re-mark the same session ATTENDED → no duplicate line. *(AC-8.4)*

### Classification consistency (the core rule)
- **TC-8.5** ABSENT_UNEXCUSED → Sprint 7 bills the student **and** Sprint 8 pays the teacher **nothing** (no payout line). *(AC-8.2)*
- **TC-8.6** ABSENT_EXCUSED, CANCELLED_BY_TEACHER, CANCELLED_BY_STUDENT → no payout line for any. *(AC-8.2)*
- **TC-8.7** Property test: feed every `session_status` to `classify().countsForTeacher`; only ATTENDED is true; payroll honors exactly that. *(AC-8.12, AC-8.2)*

### Reversal & immutability
- **TC-8.8** ATTENDED→ABSENT_EXCUSED before finalize → payout line removed, total reduced, guard cleared. *(AC-8.5)*
- **TC-8.9** Same reversal after finalize → rejected (trigger + function). *(AC-8.5, AC-8.6)*
- **TC-8.10** After finalize, attempt to add a payout line → trigger rejects. *(AC-8.6)*
- **TC-8.11** After finalize, modify `total_minor` directly → trigger rejects. *(AC-8.6)*
- **TC-8.12** Finalize is idempotent (no double audit, no change). *(AC-8.6)*
- **TC-8.13** Pre-finalize integrity check: totals ≠ sum(lines) → finalize fails loudly. *(AC-8.7)*

### Attribution
- **TC-8.14** Reschedule a session to a successor delivered by the same teacher → payout attributed correctly to that teacher. *(AC-8.10)*
- **TC-8.15** After a Sprint-4 teacher reassignment, future sessions' ATTENDED payouts go to the **new** teacher; past sessions stay with the original. *(AC-8.10)*

### Roles, isolation, profit
- **TC-8.16** Teacher `GET /api/me/payouts` returns only their own; `GET /api/payouts` (all) → 403; cannot open another teacher's payout. *(AC-8.8)*
- **TC-8.17** Teacher cannot access `/api/reports/profit-summary` → 403. *(AC-8.8)*
- **TC-8.18** Owner profit summary: revenue (closed/paid invoices) − payouts, computed correctly for a period. *(AC-8.9)*
- **TC-8.19** Mixed currencies: an academy with EGP and SAR teachers/students shows separate per-currency profit rows; nothing is summed across currencies. *(AC-8.9)*
- **TC-8.20** Owner of A cannot read B's payouts or profit (RLS). *(AC-8.11)*

### Audit
- **TC-8.21** Accrue, reverse, and finalize each write audit entries with the relevant totals/before-after. *(AC-8.11)*

## 11. Risks & mitigations
- **Risk:** Matrix divergence (paying for non-attended, or not paying for attended). **Mitigation:** single `classify()` reused; property test TC-8.7.
- **Risk:** Double payout on re-mark/race. **Mitigation:** `paid_to_teacher` guard + unique `(payout_id, session_id)`; TC-8.4.
- **Risk:** Reversing a finalized (already-paid-in-real-life) payout. **Mitigation:** finalize trigger + function check; TC-8.9–8.11.
- **Risk:** Rate change rewriting history. **Mitigation:** snapshot at accrual; TC-8.3.
- **Risk:** Cross-currency profit confusion. **Mitigation:** per-currency grouping, no FX; TC-8.19.
- **Risk:** Wrong teacher paid after reassignment. **Mitigation:** attribute to `sessions.teacher_id`; TC-8.14/8.15.

## 12. Estimate
**Medium.** Structurally parallel to Sprint 7 (reuse its money discipline, period logic, and immutability pattern), so much is mirrored. The care goes into the **classification consistency with Sprint 7** (same status, opposite-but-coordinated effects) and the **finalize immutability**. Build `onSessionAttended/Unattended` as transactional units alongside the Sprint-7 hooks so a single status change coordinates both documents.

## 13. Handoffs to later sprints
- **Sprint 9** surfaces the profit summary on dashboards, enforces plan gating on payroll features, and reviews payroll in the hardening/security pass; reads the audit trail produced here.
- Disbursement integrations (actually paying teachers) remain post-MVP backlog; the finalized statement is the hand-off artifact.
