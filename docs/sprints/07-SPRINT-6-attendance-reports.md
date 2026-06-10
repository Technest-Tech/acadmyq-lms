# Sprint 6 — Attendance & Custom Session Reports

> **Status:** Detailed / Ready to execute
> **Depends on:** Sprint 1 (sessions, session_reports, report_field_definitions, billing guards), Sprint 2 (Sanctum auth, Gates/RBAC, teacher scoping, `TenantContextMiddleware`), Sprint 3 (per-academy report-field config + deactivate-not-delete), Sprint 4 (students, teachers, subscription price), Sprint 5 (generated SCHEDULED sessions, the "touched" rule)
> **Blocks:** Sprint 7 (invoicing reads the billable status + consumes the billing hook), Sprint 8 (payroll reads ATTENDED)
> **References:** Master Spec §5.4 (the status→billing matrix — central), §5.6 (R-CRF custom fields), §6.3 (idempotency); Sprint 1 §6.5 (`sessions.billed`/`status_reason`), §6.4 (report fields); Sprint 5 §4.5 (touched), §3 (status boundary)

> **This is the heart of the system.** It implements the exact rule you defined: after each session the teacher (or support) marks attendance and writes the report; whether the session counts on the student's invoice depends on *who* was absent and *whether* notice was given. The billing classification here is what the whole money side rests on. Get §4 (the matrix) and §5 (the billing hook) exactly right.

---

## 1. Goal

Let a teacher (or academy support) **mark a session's outcome** and **fill a structured, academy-specific report** after each lesson, and have the system **classify the session for billing and payroll** according to the rules you specified. Replace the manual hand-typed WhatsApp report with an archived, structured record. WhatsApp sending stays **manual** in the MVP (compose + open/copy); automation is Sprint 10.

The deliverable is judged on: *for every one of the five outcomes, is the session billed-to-student / counted-for-teacher exactly as the rule says, is the right academy-specific report captured and archived, and is the billing hook fired exactly once (idempotent) when — and only when — the session is billable?*

## 2. Scope

### In scope
- **Attendance status workflow** on a SCHEDULED session, producing one of the billable/non-billable outcomes (Master Spec §5.4):
  - `ATTENDED` — billable to student, counts for teacher.
  - `ABSENT_UNEXCUSED` (student didn't show, no prior notice) — billable to student, **not** for teacher.
  - `ABSENT_EXCUSED` (student gave prior notice) — not billable, not for teacher.
  - `CANCELLED_BY_TEACHER` — not billable, not for teacher.
  - (`CANCELLED_BY_STUDENT` with notice already settable in Sprint 5; treated as non-billable here too.)
- **Dynamic custom-report engine**: render the academy's `report_field_definitions` (Sprint 3) as a form; validate required fields and types (TEXT/TEXTAREA/NUMBER/SELECT/RATING); store values in `session_reports.values` (jsonb keyed by stable field `key`). Tolerates added/deactivated fields (R-CRF-3, Sprint 3 deactivate-not-delete).
- **The billing hook** (the critical integration point): when a session becomes billable, mark it and hand off to invoicing (Sprint 7) **idempotently** via the `sessions.billed` guard — without duplicating line items, and reversible if the status later changes before the invoice closes.
- **Entry surfaces**: the attendance/report screen for the **Teacher** (own sessions) and the **Owner/support** (any session) — matching your "المعلم أو الدعم بيخشوا يثبتوا حضور الطالب ويكتبوا التقرير" requirement (R-BIL-4).
- **Status change & correction**: change an outcome before the invoice closes (e.g. marked absent by mistake → attended); the billing classification updates accordingly and the hook reconciles.
- **Manual WhatsApp report**: build the report message (bilingual, from the structured fields) and a compose/copy/open action; record that it was sent. No automated delivery.
- **Report archive**: per-student history of past sessions + reports (the archive that replaces scattered WhatsApp messages).
- Audit entries for status set/change, report fill/edit, billing-hook fire/reverse, WhatsApp marked-sent.

### Out of scope (deferred)
- Invoice creation/close, line-item money math (Sprint 7) — this sprint **fires the hook and sets `billed`**, but the invoice/line-item creation and totals live in Sprint 7. (The hook's contract is defined here; the consumer is Sprint 7.)
- Payout computation (Sprint 8) — this sprint produces correctly-classified ATTENDED sessions; Sprint 8 aggregates them.
- Automated WhatsApp sending / templates (Sprint 10).
- Editing a report after its invoice has **closed** (immutable period — Sprint 7's close logic; here we respect it by blocking edits to sessions in a closed period).

---

## 3. Design decisions (locked for this sprint)

1. **Status is the single source of truth for billing.** Billable/payable are **derived** from `session.status` via one pure PHP function `classify(SessionStatus): { billableToStudent, countsForTeacher }` (e.g. `App\Domain\SessionClassifier::classify`). We never store the booleans as independent truth; `sessions.billed`/`paid_to_teacher` are **idempotency guards**, not classification (Sprint 1 §6.5). One function, used by this sprint, Sprint 7, and Sprint 8 — so the matrix can never disagree across the codebase.
2. **The classification matrix is defined once, here, mirroring Master Spec §5.4** (§4 below). Tests assert every row.
3. **Billing hook is idempotent and reconciling.** Setting a billable status fires `onSessionBillable(session)`; the `billed` guard prevents a second line item. Changing to a non-billable status **before invoice close** fires `onSessionUnbilled(session)` to remove the pending line item and clears the guard. After close, edits are blocked (immutability).
4. **Reports are keyed by stable field `key`, not by position or label.** Adding or deactivating a field never corrupts existing reports (Sprint 3 contract). Deactivated fields are hidden for new entry but still rendered read-only in historical reports that have their values.
5. **Required-field validation is enforced at submit, per the field definition's `is_required` at the time of entry.** A later change to `is_required` does not retroactively invalidate archived reports.
6. **Teacher scoping is enforced (Sprint 2 §3.6).** A teacher may set status/write reports only for **their own** sessions; the owner/support can act on any session in the academy.
7. **Attendance is only valid on a session whose time has arrived/passed** (configurable grace), to prevent marking future lessons attended. Owner override allowed with audit (real-world corrections).
8. **No money math here.** This sprint classifies and fires the hook; all currency/price snapshotting is Sprint 7. Keeps the heart logic clean and the money logic in one place.

---

## 4. The classification matrix (canonical — mirrors Master Spec §5.4)

```
classify(status):
  ATTENDED               → { billableToStudent: true,  countsForTeacher: true  }
  ABSENT_UNEXCUSED       → { billableToStudent: true,  countsForTeacher: false }
  ABSENT_EXCUSED         → { billableToStudent: false, countsForTeacher: false }
  CANCELLED_BY_TEACHER   → { billableToStudent: false, countsForTeacher: false }
  CANCELLED_BY_STUDENT   → { billableToStudent: false, countsForTeacher: false }
  SCHEDULED | RESCHEDULED → { billableToStudent: false, countsForTeacher: false }  # not yet outcome
```

| Outcome | Plain meaning | Bills student? | Pays teacher? |
|---|---|---|---|
| ATTENDED | Showed up, lesson happened | ✅ | ✅ |
| ABSENT_UNEXCUSED | No-show, no prior notice | ✅ (charged) | ❌ |
| ABSENT_EXCUSED | Absent but gave notice | ❌ | ❌ |
| CANCELLED_BY_TEACHER | Teacher cancelled | ❌ | ❌ |
| CANCELLED_BY_STUDENT | Student cancelled with notice | ❌ | ❌ |

> This table is the literal encoding of what you described: "ممكن يغيب من غير ما يبلغ فتتحسب عليه؛ ممكن المعلم يغيب أو يلغي فتتسجل بس متتحسبش عليه؛ ممكن الطالب يغيب بس يبلغ قبلها فمتتحسبش؛ ممكن يحضر فتتحسب." Every test in §10 references a row here.

---

## 5. The billing hook (integration contract with Sprint 7)

This sprint owns *when* a session becomes billable; Sprint 7 owns *the money*. The contract:

```
on status set/changed for session S, within TenantContextMiddleware's request transaction:
  prev = S.status (before)
  next = new status
  S.status = next ;  S.status_reason = reason (if any)
  c = classify(next)

  if c.billableToStudent and not S.billed:
      onSessionBillable(S)        # Sprint 7 creates a line item on the OPEN invoice
      S.billed = true             # idempotency guard (Sprint 1)
  if (not c.billableToStudent) and S.billed:
      # status changed away from billable BEFORE invoice close
      if invoice_for(S) is OPEN:
          onSessionUnbilled(S)    # Sprint 7 removes the pending line item
          S.billed = false
      else:
          reject("cannot un-bill a session whose invoice is closed")   # immutability

  # teacher payout guard is set by Sprint 8 at period close, not here;
  # this sprint only ensures status is correct (countsForTeacher derivable)
  audit(session.status_changed, prev→next, billing action taken)
```

- **Idempotency:** the `billed` guard + Sprint 1's unique `(invoice_id, session_id)` on line items guarantees at most one line item per session (R-BIL-1).
- **Reversibility before close:** correcting a mistake (absent→attended or vice-versa) reconciles the open invoice.
- **Immutability after close:** once the month's invoice is CLOSED (Sprint 7), status edits that would change billing are blocked here (respecting R-INV-3).
- In MVP, `onSessionBillable`/`onSessionUnbilled` are concrete Sprint-7 functions; this sprint defines and tests the **firing conditions and guards**, with Sprint-7 stubs verified by the boundary tests.

---

## 6. The dynamic report engine

### 6.1 Rendering
- Load active `report_field_definitions` for the academy, ordered by `sort_order`.
- Render each by `field_type`: TEXT (input), TEXTAREA (multiline), NUMBER (numeric), SELECT (options from `options`), RATING (e.g. 1–5 / labelled).
- Bilingual labels (`label_ar`/`label_en`) follow the user locale (R-LOC).
- For the Qur'an academy this produces exactly the prototype's fields: surah-from, surah-to, tajweed rating, next assignment, notes.

### 6.2 Validation
- `is_required` fields must be present on submit; NUMBER must parse; SELECT value must be one of `options`.
- Validation messages are field-level, bilingual, actionable.

### 6.3 Storage & evolution
- Values stored in `session_reports.values` jsonb, keyed by field `key`.
- Adding a field later: old reports simply lack that key (rendered as empty/—).
- Deactivating a field: hidden for new entry; still shown read-only where a value exists.
- `filled_by_user_id` + `filled_at` capture who/when (teacher or support, R-BIL-4).

### 6.4 WhatsApp message build (manual)
- A bilingual summary is generated from the structured values (e.g. "تقرير حصة عبد الله — اليوم: من آل عمران 85 إلى 92، التجويد: ممتاز، الوِرد القادم: ...").
- Action: copy text / open WhatsApp deep link to the guardian's E.164 number (Sprint 4 normalized it).
- Mark "report sent" (records timestamp + channel). **No automated send** — Sprint 10.

---

## 7. Schema / Data deltas

Sprint 1 created `session_reports` and the billing guard. This sprint adds small fields:

- **`session_reports.whatsapp_sent_at`** `timestamptz null` — when the manual report was marked sent.
- **`session_reports.whatsapp_channel`** `text null` — e.g. 'MANUAL_WHATSAPP' (future channels in Sprint 10).
- **`sessions.outcome_set_at`** `timestamptz null` — when a billable/absent/cancel outcome was recorded (distinct from row creation).
- **`sessions.outcome_set_by`** `uuid null → users(id)` — who recorded the outcome (teacher/support, R-BIL-4).
- Confirm `session_reports.session_id` is UNIQUE (one report per session — Sprint 1).

A Laravel migration `..._attendance_reports` (with `down()`): adds the four columns above.

## 8. API surface

| Method & path | Permission | Purpose |
|---|---|---|
| `GET /api/sessions/{id}` | `session.read` | Session + its report (if any) + active report-field defs |
| `POST /api/sessions/{id}/attendance` | `session.mark_attendance` | Set outcome status (+reason); fires billing hook |
| `PUT /api/sessions/{id}/report` | `session.write_report` | Create/update report values (validated) |
| `POST /api/sessions/{id}/report/whatsapp-sent` | `session.write_report` | Mark manual WhatsApp report sent; build message |
| `GET /api/students/{id}/reports` | `session.read` | Report archive (DataTable, paginated) |
| `GET /api/sessions/pending-attendance` | `session.read` | Sessions past their time still needing an outcome (teacher: own) |

All run through `TenantContextMiddleware` + `Gate::authorize`; teacher endpoints additionally filter to own sessions (Sprint 2 §3.6). Attendance + report are typically submitted together but are separable endpoints.

## 9. Definition of Done / Acceptance Criteria

- **AC-6.1** Each of the five outcomes sets the correct status and, via the single `classify()` function, the correct billable/payable classification (matches §4 exactly). (Master Spec §5.4)
- **AC-6.2** Marking a session billable fires the billing hook **once** and sets `sessions.billed=true`; re-submitting the same outcome does not create a second line item (idempotent). (R-BIL-1)
- **AC-6.3** Changing a billable session to non-billable **before the invoice closes** reverses the line item and clears `billed`; doing so **after close** is blocked. (R-INV-3)
- **AC-6.4** The report form renders the academy's active fields by type, in order, bilingually; for a Qur'an academy it shows surah-from/to, tajweed rating, next assignment, notes. (R-CRF-1/2)
- **AC-6.5** Required-field, number, and select validation are enforced at submit with field-level bilingual messages. (R-CRF-2)
- **AC-6.6** Report values persist keyed by field `key`; adding/deactivating a field never corrupts existing reports; deactivated fields with values render read-only. (R-CRF-3, Sprint 3 contract)
- **AC-6.7** Both Teacher (own sessions) and Owner/support (any session) can record attendance and reports; `filled_by`/`outcome_set_by` capture who. (R-BIL-4)
- **AC-6.8** A Teacher cannot record attendance/reports for another teacher's session (403); cross-academy is impossible (RLS). (Sprint 2 §3.6, R-TEN)
- **AC-6.9** Attendance cannot be set on a future session beyond the configured grace, except by an audited owner override. (decision §3.7)
- **AC-6.10** The manual WhatsApp message is built from structured values, openable/copyable, and marking "sent" records timestamp + channel; no automated send occurs. (MVP boundary)
- **AC-6.11** The per-student report archive lists past sessions + reports, paginated, within RLS scope.
- **AC-6.12** All actions (status set/change, report fill/edit, hook fire/reverse, whatsapp-sent) are audited with before/after. (R-AUD-1)
- **AC-6.13** No invoice totals or payout amounts are computed in this sprint; only the hook/guard and status. (boundary with Sprints 7/8)

## 10. Test Cases

> `TC-6.<n>`, mapped to ACs. Every classification test cites the §4 row it verifies.

### Classification matrix (one test per outcome — the core)
- **TC-6.1** Mark ATTENDED → classify = {bill:true, teacher:true}; status persisted; `outcome_set_at`/`by` set. *(AC-6.1, §4)*
- **TC-6.2** Mark ABSENT_UNEXCUSED → {bill:true, teacher:false}. *(AC-6.1, §4)*
- **TC-6.3** Mark ABSENT_EXCUSED → {bill:false, teacher:false}. *(AC-6.1, §4)*
- **TC-6.4** Mark CANCELLED_BY_TEACHER → {bill:false, teacher:false}. *(AC-6.1, §4)*
- **TC-6.5** Mark CANCELLED_BY_STUDENT → {bill:false, teacher:false}. *(AC-6.1, §4)*
- **TC-6.6** `classify()` is the only place the matrix is defined; a property test feeds all enum values and asserts no other code path overrides it. *(decision §3.1)*

### Billing hook & idempotency
- **TC-6.7** ATTENDED fires `onSessionBillable` once; `billed=true`; exactly one line item requested for that session. *(AC-6.2)*
- **TC-6.8** Re-POST the same ATTENDED outcome → no second hook fire, no duplicate line item (guard + unique constraint). *(AC-6.2)*
- **TC-6.9** ABSENT_UNEXCUSED also fires billable hook (it charges the student). *(AC-6.2, §4)*
- **TC-6.10** Correct a mistake: ABSENT_UNEXCUSED → ATTENDED while invoice OPEN → reconciles (still one billable line, no duplicate). *(AC-6.3)*
- **TC-6.11** ATTENDED → ABSENT_EXCUSED while invoice OPEN → `onSessionUnbilled` removes the line; `billed=false`. *(AC-6.3)*
- **TC-6.12** Attempt the same un-bill after the invoice is CLOSED → rejected (immutability). *(AC-6.3, R-INV-3)*
- **TC-6.13** Non-billable outcomes (excused/cancelled) never fire the billable hook. *(AC-6.2, §4)*

### Dynamic report engine
- **TC-6.14** Qur'an academy report form renders surah-from (TEXT, required), surah-to (TEXT, required), tajweed (SELECT 3 options), next assignment (TEXT), notes (TEXTAREA), in `sort_order`, bilingually. *(AC-6.4)*
- **TC-6.15** Submit missing a required field → field-level bilingual error; nothing saved. *(AC-6.5)*
- **TC-6.16** SELECT value not in options → rejected; NUMBER non-numeric → rejected. *(AC-6.5)*
- **TC-6.17** Save valid report → values stored keyed by `key`; `filled_by`/`filled_at` set. *(AC-6.6, AC-6.7)*
- **TC-6.18** Deactivate a field (Sprint 3) that has values in past reports → new form hides it; historical report still shows it read-only. *(AC-6.6)*
- **TC-6.19** Add a new field after some reports exist → old reports render the new field as empty; no corruption. *(AC-6.6)*
- **TC-6.20** A different academy type (e.g. LANGUAGES from Sprint 3 TC-3.28) renders its own fields with **no code change**. *(AC-6.4, generalization)*

### Roles, scoping, timing
- **TC-6.21** Teacher records attendance+report for **their own** session → success; `outcome_set_by` = teacher. *(AC-6.7)*
- **TC-6.22** Teacher attempts attendance on **another** teacher's session → 403. *(AC-6.8)*
- **TC-6.23** Owner/support records attendance for any session in the academy → success; `outcome_set_by` = that user. *(AC-6.7)*
- **TC-6.24** Cross-academy attendance attempt → blocked by RLS. *(AC-6.8)*
- **TC-6.25** Mark attendance on a future session beyond grace → blocked; owner override succeeds and is audited. *(AC-6.9)*

### Manual WhatsApp & archive
- **TC-6.26** Build WhatsApp message from a Qur'an report → bilingual summary contains the surah range, tajweed, next assignment; deep link targets the guardian's E.164. *(AC-6.10)*
- **TC-6.27** Mark report sent → `whatsapp_sent_at`/`channel` set; no automated send is performed. *(AC-6.10)*
- **TC-6.28** Student report archive lists past sessions+reports, paginated, own-academy only. *(AC-6.11)*

### Boundary & audit
- **TC-6.29** No invoice total or payout amount is computed/changed by any action in this sprint (only hook + guard + status). *(AC-6.13)*
- **TC-6.30** Status set/change, report fill/edit, hook fire/reverse, and whatsapp-sent each write audit entries with before/after. *(AC-6.12)*

## 11. Risks & mitigations
- **Risk (highest):** Classification logic duplicated/diverging across sprints → student billed wrong. **Mitigation:** single `classify()` function (decision §3.1); property test TC-6.6 asserts no override; Sprints 7/8 import the same function.
- **Risk:** Double-billing on re-submit or race. **Mitigation:** `billed` guard + Sprint 1 unique `(invoice_id, session_id)`; TC-6.7/6.8.
- **Risk:** Un-billing after close violating immutability. **Mitigation:** hook checks invoice status; blocks post-close (TC-6.12).
- **Risk:** Report corruption when fields change. **Mitigation:** key-based jsonb storage + deactivate-not-delete; TC-6.18/6.19.
- **Risk:** Teacher acting on others' sessions. **Mitigation:** own-session filter + RLS; TC-6.22/6.24.
- **Risk:** Marking future lessons attended inflates billing. **Mitigation:** time-gate with audited override; TC-6.25.

## 12. Estimate
**Large.** The schema delta is tiny; the value is in the **exact classification matrix, the idempotent/reversible billing hook, and the dynamic report engine**. Build `classify()` and the hook as small, exhaustively unit-tested pure/transactional units first, then wire the UI. Do not declare done until every §4 row (TC-6.1–6.6) and the hook reconciliation tests (TC-6.7–6.13) pass.

## 13. Handoffs to later sprints
- **Sprint 7** implements the concrete `onSessionBillable`/`onSessionUnbilled` (line item with **price snapshot** from the subscription), the OPEN-invoice accumulation, month-end close (making edits here immutable), and the public invoice page. It imports `classify()`.
- **Sprint 8** aggregates `ATTENDED` sessions (via `classify().countsForTeacher`) into payouts and sets `paid_to_teacher`. It imports `classify()`.
- **Sprint 10** replaces the manual WhatsApp build/mark-sent with automated templated delivery, reusing the message builder from §6.4.
