# Sprint 9 — Audit Log, Plan Gating & MVP Hardening

> **Status:** Detailed / Ready to execute
> **Depends on:** ALL prior sprints (0–8). This sprint hardens and gates what they built.
> **Blocks:** Nothing in MVP — this is the **last MVP sprint**. After it, the product is sellable.
> **References:** Master Spec §2 (business model — the plans are the revenue), §5.8 (R-AUD-1/2 audit), §5.10 (branding reserved), §6 (architecture/RLS); every prior sprint's audit entries and the `plans.features` from Sprint 1/3

> **This is the sprint that makes you money and lets you sleep.** Plan gating is literally your revenue model — without it, every academy gets every feature for free. The security pass is what stands between you and a cross-tenant data leak on a live, paying system. Treat both as release-blocking.

---

## 1. Goal

Turn the feature-complete system into a **Minimum Sellable Product**: make every sensitive action **traceable** (surface the audit log that prior sprints have been writing), **enforce the plan/tier feature gating and add-ons** that are your business model, run a **security review** of tenant isolation and the public invoice page, and complete the **empty/error-state and bilingual polish** pass so the product feels finished to a paying owner.

The deliverable is judged on: *can you onboard a paying academy on a chosen plan, have the platform actually restrict them to what that plan unlocks, show the owner a trustworthy audit trail, and pass a deliberate attempt to break tenant isolation or the public invoice page?* After this sprint, **you can take payment from your first academy.**

## 2. Scope

### In scope
- **Audit log surfacing** (R-AUD-1/2): a read UI for the append-only `audit_log` that Sprints 2–8 have been populating. Owner sees their academy's trail; Super Admin sees all. Filter by actor, action, entity, date; show before/after diffs. (Writing was done all along; this sprint **reads/presents** it and fills any gaps where a sensitive action wasn't yet audited.)
- **Plan/tier feature gating** (Master Spec §2): enforce `plans.features` (set/selected in Sprint 1/3 but **not enforced** until now). A central `entitlement(feature)` check gates features per the academy's plan; **add-ons** unlock extra `feature_key`s on top. Over-limit and locked-feature states are handled gracefully (upgrade prompts, not crashes).
- **Quotas/limits**: enforce plan-defined numeric limits (e.g. max students, max teachers) with clear, bilingual at-limit messaging and an upgrade path.
- **Security review & hardening**:
  - Re-verify RLS on **every** table (the parameterized isolation suite from Sprint 1 re-run against the now-full schema, including any tables added in Sprints 5–8 migrations).
  - Penetration-style checks on the **public invoice page** (token entropy, enumeration, no data leak, rate limiting, noindex).
  - Authorization matrix audit: every endpoint has an explicit allowed/denied test for each role.
  - Verify the `TenantContextMiddleware` auth→GUC bridge no-leakage guarantee (Sprint 2) under load/pooling.
  - Input validation / injection review (sort/filter allowlists, jsonb report values, money inputs).
- **UX hardening pass**: empty states (every list and dashboard), error states (failed loads, network), loading skeletons, 403/404/500 pages — all bilingual and RTL-correct. Consistency of action labels (the "Publish → Published" discipline from the design skill).
- **Bilingual completeness**: no hardcoded strings; ar/en parity check; RTL layout audit across all screens; Arabic-Indic numerals where locale=ar.
- **Operational readiness**: backups verified, migration rollback rehearsed, health/monitoring on the scheduled jobs (session generation, invoice close, payout finalize), and a smoke-test suite for the critical money paths.
- Audit entries for plan changes, add-on grants, and entitlement overrides.

### Out of scope (deferred)
- Building **new** features — this sprint hardens existing ones. (Anything missing becomes a fast-follow, not scope creep here.)
- Automated WhatsApp / payment gateways / branding / self-signup / analytics — Sprints 10–14.
- Platform billing of academies (collecting your subscription fee online) — the plan is selected and enforced; **charging** the academy for it is a post-MVP integration (you can invoice them manually at first, consistent with the platform-not-a-wallet stance).

---

## 3. Design decisions (locked for this sprint)

1. **One entitlement check, like `$user->can()` for permissions.** `entitlement(ctx, 'feature.key') → boolean` (e.g. `App\Support\Entitlement::check`) resolves from the academy's `plan.features` ∪ granted add-on `feature_key`s. Business logic asks `entitlement(...)`, never hardcodes plan codes. This mirrors the Gate-based RBAC discipline (Sprint 2 §3.2) and keeps plans editable as data.
2. **Gating is layered on top of RBAC, not merged with it.** A Gate (`$user->can()`) answers "is this role allowed?"; `entitlement()` answers "does this academy's plan include it?". A feature requires **both**. Keeping them separate avoids confusing "you can't" (permission) with "your plan doesn't include this" (upsell) — different messages, different UX.
3. **Fail closed on entitlement too.** Unknown/misconfigured feature key → treated as not entitled; the owner sees a clear locked state, never a silent allow.
4. **Audit is read-only here and forever.** This sprint never adds UPDATE/DELETE to `audit_log` (Sprint 1 §7.5). The UI is presentation only; any "gap" found (a sensitive action not yet audited) is fixed by adding the **write** at its source, not by post-hoc editing.
5. **Security review is adversarial.** Tests deliberately *attempt* the attacks (cross-tenant read, token enumeration, forced-role calls, injection) and assert they fail — not just that the happy path works. The Sprint-1 parameterized isolation test is re-run against the final schema as a release gate.
6. **No new tenant tables without RLS — enforced by CI.** The introspection test from Sprint 1 (every tenant table has the standard policy with both `using` and `with check`) is a hard CI gate now, catching anything Sprints 3–8 migrations added.
7. **"Sellable" has a definition** (§9 AC-9.x), and the sprint isn't done until each criterion passes. Sellable ≠ feature-rich; it = trustworthy, gated, and finished-feeling for the first paying customer.

---

## 4. Plan gating model

### 4.1 Resolution
```
entitlement(ctx, featureKey):
  plan = academy.plan            # Sprint 3 selection
  granted = plan.features ∪ { addon.feature_key for active add-ons of academy }
  return featureKey ∈ granted    # unknown key → false (fail closed)

withinLimit(ctx, limitKey, currentCount):
  limit = plan.features.limits[limitKey]   # e.g. maxStudents
  return limit is null (unlimited) or currentCount < limit
```

### 4.2 Example plan matrix (illustrative — final values are data, set by Super Admin in Sprint 3)
| Capability / limit | BASIC | PRO |
|---|---|---|
| Students (max) | 30 | unlimited |
| Teachers (max) | 3 | unlimited |
| Custom report fields | core set | full custom (`report_field.custom`) |
| Audit log access | last 30 days | full history (`audit.full`) |
| Public invoice page | ✅ | ✅ |
| Multi-currency | ✅ | ✅ |
| (add-on) Automated WhatsApp | — | add-on `whatsapp.auto` (Sprint 10) |
| (add-on) Payment gateway | — | add-on `payments.gateway` (Sprint 11) |

> The matrix is **data**, not code (decision §3.1). Adding a tier or moving a feature between tiers is a `plans.features` edit, not a deploy. The add-on rows show how future paid features (your "بعد كده خصائص زيادة بالدفع") attach without re-architecture.

### 4.3 Enforcement points
- Server: an `entitled:feature.key` route middleware (parallel to the `can:` Gate middleware) — `requireEntitlement(ctx, key)` — on gated endpoints, returning a distinct "upgrade required" response (e.g. 402/422 with an upgrade payload, not a 403-forbidden).
- UI: locked features show an upgrade prompt with what the plan unlocks; at-limit actions explain the limit and the upgrade path.
- Limits checked at create time (e.g. adding the 31st student on BASIC is blocked with an upgrade message).

## 5. Audit log surfacing

- **Read UI** over the append-only `audit_log`: columns actor, role, action, entity, timestamp; expandable before/after diff.
- **Filters**: actor, action type, entity type, date range; academy-scoped (owner) or global (Super Admin).
- **Plan-gated depth**: BASIC sees last 30 days (`audit.full` add-on/PRO unlocks full history) — an example of gating applied to an existing feature.
- **Gap fill**: verify each sensitive action across Sprints 2–8 writes an entry (login, role change, academy config, price change, teacher reassignment, schedule edit, session status change, invoice line/close/mark-paid, payout accrue/finalize, plan change). Add any missing **writes** at their source.
- **Prefer a single audit path over scattered manual writes.** Route audit writes through one `Audit::record(...)` service and/or **Eloquent model observers** (`updated`/`deleted` events) so a new sensitive mutation can't silently skip auditing. This makes the §5 gap-fill structural rather than a one-time sweep — and is far more robust across the 8 sprints that produce entries.

## 6. Security review checklist (executed, not just documented)

1. **Tenant isolation:** re-run Sprint-1 parameterized RLS suite against the final schema; assert every tenant table denies cross-tenant read/write and fails closed with no context.
2. **Public invoice page:** token entropy ≥ 128 bits; 404 on miss; no enumeration; noindex; rate-limited; read-only; renders only its own invoice; no tenant cookie set.
3. **Authorization matrix:** for every endpoint × role, an explicit allowed/denied test; no endpoint lacks the `can:`/`Gate::authorize` (or `entitled:`) guard where applicable.
4. **GUC no-leakage:** concurrent multi-tenant requests under pooling never cross GUCs (re-assert Sprint 2 TC-2.9 at scale).
5. **Injection:** sort/filter allowlists (Sprint 4), parameterized queries/Eloquent bindings everywhere, jsonb report values validated against field defs, money inputs are integer-minor and range-checked.
6. **Secrets/config:** no secrets in the Next.js client bundle (only `NEXT_PUBLIC_*` are public); env separation; the Laravel `.env` (DB credentials, `APP_KEY`) and the Postgres connection string are server-only — never shipped to the browser.
7. **Immutability:** closed invoices and finalized payouts cannot be mutated (re-assert Sprint 7/8 triggers).
8. **Rate limiting & abuse:** auth endpoints, public invoice page, and link-send are rate-limited.

## 7. Schema / Data deltas

Mostly additive/operational:

- **`academy_addons`** table (if not present): `academy_id`, `add_on_id`, `granted_at`, `is_active` — which add-ons an academy has (unlocks extra `feature_key`s). RLS-scoped.
- **`plans.features`** shape finalized: a documented JSON schema `{ capabilities: string[], limits: { maxStudents?: number, maxTeachers?: number, ... } }`.
- **`audit_log` read indexes**: confirm `(academy_id, created_at desc)` and add `(academy_id, action)`, `(academy_id, entity_type, entity_id)` for the filter UI.
- Any **missing audit writes** discovered in §5 are added at their source (code, not schema).

A Laravel migration `..._plan_gating_and_audit_indexes` (with `down()`): `academy_addons` (+ its RLS policy via `DB::unprepared`), audit filter indexes; documents `plans.features` schema.

## 8. API surface

| Method & path | Permission / entitlement | Purpose |
|---|---|---|
| `GET /api/audit` | `audit.read` (+ `audit.full` for full history) | Audit log read UI (filtered) |
| `GET /api/entitlements` | authenticated | Current academy's resolved features + limits (for UI gating) |
| `POST /api/admin/academies/{id}/plan` | `plan.manage` (Super Admin) | Change an academy's plan (audited) |
| `POST /api/admin/academies/{id}/addons` | `plan.manage` | Grant/revoke an add-on (audited) |
| (cross-cutting) `entitled:` middleware / `requireEntitlement(ctx,key)` | — | Server gate on plan-gated endpoints |

All internal endpoints run through `TenantContextMiddleware` + `Gate::authorize` (+ the `entitled:` middleware where gated).

## 9. Definition of Done / Acceptance Criteria (the "sellable" bar)

- **AC-9.1** A feature included in PRO but not BASIC is **usable on PRO and blocked on BASIC**, with an upgrade message (not a generic error). (Master Spec §2)
- **AC-9.2** Plan limits are enforced (e.g. BASIC blocked at its student cap) with clear bilingual at-limit messaging and an upgrade path. (§4)
- **AC-9.3** An **add-on** grant unlocks its `feature_key` on top of the plan; revoking re-locks it. (§4)
- **AC-9.4** `entitlement()` fails closed: an unknown/misconfigured feature key is treated as not entitled, never silently allowed. (§3.3)
- **AC-9.5** Permission vs entitlement are distinct: a permitted-but-not-entitled action shows "upgrade", a not-permitted action shows "forbidden". (§3.2)
- **AC-9.6** The audit log UI shows every sensitive action across Sprints 2–8 with actor/time/before-after; owner sees own academy, Super Admin sees all; depth is plan-gated. (R-AUD-1/2)
- **AC-9.7** The Sprint-1 parameterized RLS isolation suite passes against the **final** schema; a tenant table missing the standard policy fails CI. (R-TEN, §3.6)
- **AC-9.8** The public invoice page passes the security checklist (entropy, 404-on-miss, no enumeration, noindex, rate-limit, read-only, no leak). (Sprint 7 §6)
- **AC-9.9** Every endpoint has an explicit allowed/denied test per role; none lacks the appropriate `can:`/`Gate::authorize` (or `entitled:`) guard. (§6.3)
- **AC-9.10** Closed invoices and finalized payouts remain immutable under adversarial attempts. (Sprints 7/8)
- **AC-9.11** Every list/dashboard has an empty state; failures show actionable error states; 403/404/500 pages exist — all bilingual and RTL-correct. (UX hardening)
- **AC-9.12** No hardcoded user-facing strings; ar/en parity verified; RTL audit clean; Arabic-Indic numerals when locale=ar. (R-LOC)
- **AC-9.13** Scheduled jobs (session generation, invoice close, payout finalize) have monitoring/alerting; migration rollback rehearsed; critical money-path smoke tests green. (operational readiness)
- **AC-9.14** Plan changes and add-on grants/revokes are audited. (R-AUD-1)

## 10. Test Cases

> `TC-9.<n>`, mapped to ACs. Security tests are adversarial (attempt the attack, assert it fails).

### Plan gating & limits
- **TC-9.1** PRO academy uses a PRO-only feature → allowed; same feature on a BASIC academy → blocked with upgrade message (distinct from 403). *(AC-9.1, AC-9.5)*
- **TC-9.2** BASIC academy at student limit adds one more → blocked with at-limit/upgrade message; PRO (unlimited) is not blocked. *(AC-9.2)*
- **TC-9.3** Grant add-on `whatsapp.auto` to a PRO academy → `entitlement('whatsapp.auto')` true; revoke → false. *(AC-9.3)*
- **TC-9.4** `entitlement()` with an unknown key → false (fail closed); UI shows locked state, no silent allow. *(AC-9.4)*
- **TC-9.5** Move a feature from PRO to BASIC by editing `plans.features` (data only) → BASIC academies gain it with no deploy. *(§3.1)*
- **TC-9.6** A not-permitted action (wrong role) shows "forbidden"; a permitted-but-not-entitled action shows "upgrade" — different responses. *(AC-9.5)*

### Audit surfacing
- **TC-9.7** Perform one of each sensitive action (price change, teacher reassign, schedule edit, session status change, invoice close, mark-paid, payout finalize, plan change) → each appears in the audit UI with correct actor/time/diff. *(AC-9.6)*
- **TC-9.8** Owner sees only their academy's audit; Super Admin sees all; cross-academy entries never leak to an owner. *(AC-9.6)*
- **TC-9.9** BASIC audit depth limited to 30 days; PRO/`audit.full` shows full history. *(AC-9.6)*
- **TC-9.10** Attempt to UPDATE/DELETE an audit entry via any path → denied (append-only). *(R-AUD-1, AC-9.6)*

### Security — tenant isolation (adversarial)
- **TC-9.11** Re-run the full parameterized RLS suite against the final schema (all tables incl. Sprint 5–8 additions) → all pass. *(AC-9.7)*
- **TC-9.12** Add a throwaway tenant table without the standard policy → CI introspection test fails (proves the gate works), then remove it. *(AC-9.7, §3.6)*
- **TC-9.13** Owner of A attempts, by crafted id, to read/close/mark-paid B's invoice or read B's payouts/audit → all denied. *(AC-9.7)*
- **TC-9.14** Concurrent requests from A and B under connection pooling → no GUC leakage; each sees only its own data. *(AC-9.7)*

### Security — public invoice page (adversarial)
- **TC-9.15** Enumerate sequential/guessed tokens → all 404; no signal distinguishing "exists" from "doesn't". *(AC-9.8)*
- **TC-9.16** Valid token renders only its own invoice; response inspected for any other tenant/student/invoice data → none present. *(AC-9.8)*
- **TC-9.17** Mutation attempt on the public route → rejected; page sets noindex; rate limit triggers under rapid requests. *(AC-9.8)*
- **TC-9.18** Token entropy verified ≥ 128 bits. *(AC-9.8)*

### Security — authz matrix & injection
- **TC-9.19** Automated matrix: every endpoint × {SuperAdmin, Owner, Teacher, unauth} has an explicit allowed/denied result; any endpoint missing a guard fails the suite. *(AC-9.9)*
- **TC-9.20** Injection attempts via sort/filter keys, jsonb report values, and money fields → all rejected by allowlists/validation; no SQL executes. *(§6.5)*

### Immutability (adversarial re-assert)
- **TC-9.21** Adversarial attempts to mutate a closed invoice (line add, total change, un-bill) → all rejected. *(AC-9.10)*
- **TC-9.22** Adversarial attempts to mutate a finalized payout → all rejected. *(AC-9.10)*

### UX, i18n, ops
- **TC-9.23** Every list/dashboard renders a correct empty state on no data; a forced load failure shows an actionable error state; 403/404/500 pages render bilingually + RTL. *(AC-9.11)*
- **TC-9.24** Locale parity check: no missing ar/en keys; switch to ar → RTL layout correct across all screens, Arabic-Indic numerals; switch to en → LTR correct. *(AC-9.12)*
- **TC-9.25** Scheduled jobs emit success/failure signals; a simulated job failure raises an alert; migration rollback rehearsal succeeds. *(AC-9.13)*
- **TC-9.26** Critical money-path smoke test (attend session → line item → close invoice → mark paid; attend session → payout line → finalize) runs green end-to-end. *(AC-9.13)*
- **TC-9.27** Plan change and add-on grant/revoke each write audit entries. *(AC-9.14)*

## 11. Risks & mitigations
- **Risk (revenue):** Gating gaps let academies use unpaid features → lost revenue. **Mitigation:** central `requireEntitlement` on every gated endpoint; matrix test TC-9.19 extended to entitlement; fail-closed (TC-9.4).
- **Risk (existential):** A cross-tenant leak on a live paying system. **Mitigation:** adversarial RLS suite as release gate (TC-9.11–9.14); CI policy-coverage gate (TC-9.12); public-page pen tests (TC-9.15–9.18).
- **Risk:** Confusing "forbidden" with "upgrade" frustrates buyers. **Mitigation:** separate permission/entitlement layers and messages (TC-9.6).
- **Risk:** Audit gaps (a sensitive action not recorded). **Mitigation:** §5 gap-fill checklist + TC-9.7 covering one of each action type.
- **Risk:** Silent job failure (invoices never close) on a live system. **Mitigation:** monitoring/alerting on scheduled jobs + smoke tests (TC-9.25/9.26).
- **Risk:** RTL/i18n regressions making it look unfinished. **Mitigation:** parity + RTL audit (TC-9.24).

## 12. Estimate
**Medium–Large.** Little new feature code; the weight is in **plan-gating enforcement across all endpoints** and the **adversarial security pass** (which may surface fixes in earlier sprints' code). Budget real time for the security review — it is the release gate. Treat AC-9.1, AC-9.7, AC-9.8, and AC-9.9 as non-negotiable for "sellable".

## 13. Definition of "Sellable" (exit criteria for the MVP)
After Sprint 9, all true:
- A paying academy can be onboarded on a plan, and the platform **enforces** that plan (gating + limits). ✅ revenue model works.
- Tenant isolation is **adversarially verified** across the full schema; the public invoice page is **pen-tested**. ✅ safe to host real customers.
- Every sensitive action is **audited and visible**. ✅ trustworthy/disputable.
- The product **feels finished**: empty/error states, bilingual RTL polish, no dead ends. ✅ first-customer ready.
- Critical money paths have **smoke tests** and scheduled jobs are **monitored**. ✅ operable.

## 14. Handoffs (post-MVP, Sprints 10–14)
- **Sprint 10** (Automated WhatsApp) attaches as the `whatsapp.auto` **add-on** gated here — the gating hook already exists.
- **Sprint 11** (Payment gateways) attaches as the `payments.gateway` add-on; replaces Sprint 7's placeholder.
- **Sprint 12** (Branding) activates the reserved fields (Sprint 3) on the public invoice page and shell.
- **Sprint 13** (Self-service signup) reuses the Sprint-3 provisioning transaction and assigns a default (e.g. TRIAL) plan gated here.
- **Sprint 14** (Analytics) builds on the audited, gated, multi-tenant data this sprint certified.
