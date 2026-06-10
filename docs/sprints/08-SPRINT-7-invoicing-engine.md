# Sprint 7 — Invoicing Engine

> **Status:** Detailed / Ready to execute
> **Depends on:** Sprint 1 (invoices/invoice_line_items schema, immutability triggers, public_token, money-as-minor-units), Sprint 2 (Sanctum auth, Gates/RBAC, `TenantContextMiddleware`), Sprint 3 (academy `invoice_grouping`, `billing_day`, currency), Sprint 4 (guardians, subscription price/currency/basis), Sprint 6 (the billing hook `onSessionBillable`/`onSessionUnbilled`, `classify()`, `billed` guard)
> **Blocks:** Sprint 9 (plan gating + hardening reads invoices), partially overlaps Sprint 8 (payroll)
> **References:** Master Spec §5.5 (R-INV-1..7 — central), §5.4 (classify), §6.3 (money/idempotency); Sprint 1 §6.6 (invoice tables + triggers, §7.5 immutability), Sprint 6 §5 (hook contract)

> **This is the money sprint.** It turns billable sessions into invoices, snapshots prices so closed invoices never change, groups per your academy's choice, closes automatically at month end, and exposes a public invoice page with a WhatsApp-sendable link and a payment placeholder. Money correctness and immutability are non-negotiable; the test suite is exhaustive on purpose.

---

## 1. Goal

Implement the automatic, incremental, **immutable** monthly invoice exactly as you described: a billable session lands on the student's/guardian's **open** invoice as a line item the moment it's marked, prices are **snapshotted** so later changes don't rewrite history, the invoice **closes automatically at month end**, and ولي الأمر can open a **public invoice page** via a WhatsApp link, see every session's detail, and pay — with a **payment-gateway placeholder** now and the ability to mark it **paid outside the system** with a recorded method/reason.

The deliverable is judged on: *does every billable session appear exactly once with the correct snapshotted price; does grouping (per-guardian vs per-student) behave per the academy's config; does month-end close make the invoice truly immutable; does the public link show the right invoice to the right payer and nothing else; and can mark-paid-outside-system be recorded accurately?*

## 2. Scope

### In scope
- **`onSessionBillable` / `onSessionUnbilled`** — the concrete consumers of Sprint 6's hook: create/remove a line item on the relevant **OPEN** invoice, with the **price snapshotted** at that moment (R-INV-3), idempotently (R-BIL-1).
- **Open-invoice accumulation** (R-INV-1): line items accrue throughout the month; invoice `subtotal_minor`/`total_minor` stay in sync.
- **Per-academy grouping** (R-INV-4): one invoice **per guardian** (aggregating all children) or **per student**, driven by `academies.invoice_grouping`. Per-guardian invoices break down line items by child.
- **Price resolution** from the subscription (Sprint 4): `price_basis` PER_SESSION vs PER_MONTH determines the per-session amount snapshotted onto each line item.
- **Automatic month-end close** (R-INV-2): a scheduled job closes the period's OPEN invoices → `CLOSED`, immutable thereafter (Sprint 1 trigger backstops). Manual close also available to the owner.
- **Public invoice page** (R-INV-5): a server-rendered page at an unguessable `public_token` URL; shows academy name, payer, period, per-session line items (with the report-derived description), totals, currency; **no auth required**, **read-only**, leaks nothing else.
- **WhatsApp-sendable link** (R-INV-5): build the message + deep link to the guardian's E.164; mark sent (manual, like Sprint 6; automation is Sprint 10).
- **Payment button placeholder** (R-INV-5): present but inert in MVP (gateways are Sprint 11); clicking explains payment is arranged with the academy.
- **Mark paid outside the system** (R-INV-6): owner records `payment_method` (CASH/BANK_TRANSFER/OTHER) + `payment_reason`, flips status to PAID (or PARTIALLY_PAID), audited.
- **Multi-currency, no FX** (R-INV-7): each invoice in its payer's currency; per-guardian grouping requires all the guardian's children share a currency (validated) — otherwise fall back to per-student for that guardian (documented rule).
- Invoice list (DataTable) + detail (internal) for the owner.
- Audit for line add/remove, close, mark-paid, link-sent.

### Out of scope (deferred)
- Real payment gateways / online checkout (Sprint 11) — the button is a placeholder.
- Automated WhatsApp delivery (Sprint 10) — link built + marked sent manually.
- Teacher payroll (Sprint 8) — separate money document; may overlap in time.
- Platform-level billing of academies (their own subscription payment) — post-MVP.
- Credit notes / partial refunds / proration beyond the price_basis rule — post-MVP backlog (PARTIALLY_PAID is supported as a status; refund workflow is not).
- Plan-based feature gating of invoicing (Sprint 9).

---

## 3. Design decisions (locked for this sprint)

1. **Snapshot at billing time, never reference live price.** A line item stores its own `amount_minor` + `currency` copied from the subscription when the session became billable. Subsequent price changes (Sprint 4) do **not** touch existing line items. This is the concrete enforcement of R-INV-3 at the line level (Sprint 1 made the columns independent; here we populate them by copy).
2. **One open invoice per payer per period.** Keyed by `(academy_id, payer, period_year, period_month)` (Sprint 1 unique constraint). "Payer" = guardian (PER_GUARDIAN) or student (PER_STUDENT). The first billable session of a period **lazily creates** the OPEN invoice; later ones append.
3. **Totals are maintained, not recomputed ad hoc.** `subtotal_minor`/`total_minor` are updated transactionally as line items change, and a verification query (and test) asserts they always equal the sum of line items while OPEN.
4. **Close is a hard boundary.** At close, the invoice becomes immutable (Sprint 1 trigger). After close: no line add/remove, no total change; the only permitted transitions are CLOSED→PAID / PARTIALLY_PAID / VOID with payment metadata. Sprint 6's un-bill is rejected post-close.
5. **Public page is read-only, scoped, and unguessable.** Access is solely via `public_token` (high-entropy, not sequential). The page renders only that invoice; it never accepts mutations; it never exposes other invoices, students, or academy internals. No tenant data beyond what the payer should see.
6. **Multi-currency safety for per-guardian.** Per-guardian aggregation only sums same-currency children. If a guardian has children in different currencies, that guardian is billed **per child** (one invoice per currency/child), with a documented, tested fallback. (Avoids inventing FX.)
7. **Lazy invoice creation + idempotency.** Creating the period invoice on first billable session is idempotent (unique constraint); the line item is idempotent per session (unique `(invoice_id, session_id)`); `billed` guard from Sprint 6 prevents re-fire.
8. **Description is derived, snapshotted text.** Each line item's `description` is built at billing time from the session (date) and, if present, the report (e.g. surah range) — stored as text so the closed invoice reads correctly forever even if the report changes later (it can't, post-close, but the snapshot guarantees it regardless).

---

## 4. The billing functions (concrete implementation of Sprint 6's hook)

PHP service methods (e.g. `App\Services\Invoicing`), called by Sprint 6's attendance controller already inside the tenant-context transaction.
```
onSessionBillable(S):   # called by Sprint 6 when classify(S.status).billableToStudent && !S.billed
  within the active tenant-context transaction (TenantContextMiddleware / Tenancy::withContext):
    payer   = resolvePayer(S.student, academy.invoice_grouping)   # guardian or student
    currency = resolveCurrency(S.student.subscription, payer)     # §3.6 safety
    invoice = getOrCreateOpenInvoice(academy, payer, period(S.scheduled_at_utc), currency)
    if line exists for (invoice, S): return            # idempotent (unique constraint)
    amount = resolvePerSessionAmount(S.student.subscription)      # PER_SESSION | PER_MONTH/quota
    desc   = buildDescription(S, report_of(S))                    # snapshotted text
    insert invoice_line_items(invoice, S, S.student, desc, amount, currency)
    invoice.subtotal_minor += amount ; invoice.total_minor = recompute
    audit(invoice.line_added)

onSessionUnbilled(S):   # called when status changes away from billable, invoice still OPEN
  within the active tenant-context transaction:
    invoice = open invoice for payer/period
    if invoice.status != OPEN: reject("cannot un-bill: invoice closed")   # R-INV-3
    delete line for (invoice, S)
    invoice.subtotal_minor -= amount ; recompute total
    audit(invoice.line_removed)

resolvePerSessionAmount(sub):
  PER_SESSION → sub.price_minor
  PER_MONTH   → round(sub.price_minor / sub.sessions_per_month)   # documented rounding rule
```

- **Rounding rule (PER_MONTH):** integer minor units; remainder handled deterministically (e.g. last session of the month absorbs the rounding remainder) so the month's line items sum exactly to the monthly price. Tested (TC-7.10).
- All money in integer minor units; currency carried on every line (R-INV-7).

## 5. Month-end close

```
closeInvoices(period):   # Laravel-scheduled job, wrapped per academy in Tenancy::withContext
  for each OPEN invoice in period for academy:
    verify total == sum(line items)        # integrity check before sealing
    status = CLOSED ; closed_at = now()
    audit(invoice.closed, totals)
  # Sprint 1 trigger now forbids any total/line mutation
```
- Runs automatically at month end via the Laravel scheduler (`routes/console.php` → `Schedule::job(...)`), per `academies.billing_day`/timezone, each academy's work inside `Tenancy::withContext`. Manual "close now" available to owner with `invoice.read`+close capability.
- After close, the public page still works (read-only) and the invoice can be sent and marked paid.
- Idempotent: closing an already-CLOSED invoice is a no-op.

## 6. Public invoice page

This page is **split across the two apps** (the decoupled-architecture nuance):
- **Data:** a public, no-auth Laravel JSON endpoint `GET /api/i/{public_token}` returns only that one invoice's display payload (academy display name, payer name, period, line items, totals, currency, status). It is **not** behind `TenantContextMiddleware` — and because FORCE RLS would return zero rows with no tenant context, it must **not** issue a raw `select` on `invoices`. Instead it calls Sprint 1's `app.public_invoice_by_token(token)` (`SECURITY DEFINER`, §7.6), refined here via `create or replace` to add the `session_date` ordering and payer-name resolution. The function returns a curated payload (never raw tenant rows) or NULL → 404.
- **Render:** the **Next.js** app serves the human-facing page at `/i/{public_token}` via **SSR** (Master Spec §6.2's "SSR/SEO for public invoice pages"), fetching the payload from the Laravel endpoint server-side. Bilingual, mobile-first, brand-neutral in MVP (branding reserved for Sprint 12). Shows the line items and a **payment button placeholder**.
- **Security (both sides):** token is high-entropy; the API returns **404 (not 403)** on unknown/wrong token to avoid enumeration; the Next page sets `noindex`; the endpoint exposes **GET only** (no mutations) and is **rate-limited** (Laravel `throttle` middleware); it never returns sibling invoices or any other tenant data — only the curated DTO for the matched token.
- The WhatsApp action (owner side) builds a message containing the `/i/{token}` link to the guardian's number and marks it sent.

## 7. Schema / Data deltas

Sprint 1 created the invoice tables, triggers, and `public_token`. This sprint adds small fields:

- **`invoices.sent_at`** `timestamptz null`, **`invoices.sent_channel`** `text null` — when/how the link was sent (manual now).
- **`invoices.amount_paid_minor`** `bigint not null default 0` — supports PARTIALLY_PAID.
- **`invoice_line_items.session_date`** `date null` — denormalized snapshot for display ordering on the public page.
- Confirm `public_token` default is high-entropy (e.g. 32+ url-safe bytes); strengthen if Sprint 1 used a weak default.
- Confirm unique `(invoice_id, session_id)` on line items and the immutability triggers exist (Sprint 1).

A Laravel migration `..._invoicing_engine` (with `down()`): adds the fields above; hardens `public_token` generation (e.g. `Str::random(40)` / a 32-byte url-safe token set at model creation).

## 8. API surface

| Method & path | Permission | Purpose |
|---|---|---|
| (internal) `Invoicing::onSessionBillable/Unbilled` | system (called by Sprint 6) | Line item create/remove with snapshot |
| `GET /api/invoices` | `invoice.read` | DataTable list (filter by status/period/payer) |
| `GET /api/invoices/{id}` | `invoice.read` | Internal detail (line items, audit) |
| `POST /api/invoices/close` | `invoice.read`+close | Manual close for a period (idempotent) |
| `POST /api/invoices/{id}/mark-paid` | `invoice.mark_paid` | Record outside-system payment (method, reason, amount) |
| `POST /api/invoices/{id}/send-link` | `invoice.send_link` | Build WhatsApp message + `/i/{token}` link; mark sent |
| `GET /api/i/{public_token}` | **public** (throttled) | Curated read-only invoice DTO (consumed by the Next.js `/i/{token}` SSR page) |

Internal endpoints run through `TenantContextMiddleware` + `Gate::authorize`. The public endpoint runs **outside** tenant auth (no `TenantContextMiddleware`) and is strictly scoped by the token to a single invoice's DTO (no tenant context, no raw rows).

## 9. Definition of Done / Acceptance Criteria

- **AC-7.1** A billable session creates exactly one line item on the correct OPEN invoice, with the **snapshotted** per-session amount and currency. (R-INV-1, R-INV-3, R-BIL-1)
- **AC-7.2** Changing the subscription price later does **not** alter existing line items or any closed invoice. (R-INV-3)
- **AC-7.3** Grouping = PER_GUARDIAN aggregates all the guardian's children onto one invoice, broken down by child; PER_STUDENT yields one invoice per student. (R-INV-4)
- **AC-7.4** Open-invoice totals always equal the sum of their line items while OPEN. (R-INV-1, decision §3.3)
- **AC-7.5** Un-billing (Sprint 6 correction) before close removes the line and adjusts totals; after close it is rejected. (R-INV-3)
- **AC-7.6** Month-end close flips OPEN→CLOSED, sets `closed_at`, and makes the invoice immutable (no line/total changes thereafter). (R-INV-2, R-INV-3)
- **AC-7.7** PER_MONTH price basis splits into per-session line items that sum exactly to the monthly price (deterministic rounding). (decision §4)
- **AC-7.8** The public page at `/i/{token}` (Next.js SSR over `GET /api/i/{token}`) shows the correct invoice read-only, returns 404 on bad token, is `noindex`, and never exposes any other invoice or tenant data. (R-INV-5)
- **AC-7.9** The WhatsApp link action builds a message with the public link to the guardian's E.164 and marks sent; no automated send. (R-INV-5)
- **AC-7.10** The payment button is a present-but-inert placeholder; clicking explains payment is arranged with the academy. (R-INV-5)
- **AC-7.11** Mark-paid-outside-system records method + reason (+ amount for partial), flips status to PAID/PARTIALLY_PAID, and is audited. (R-INV-6)
- **AC-7.12** Multi-currency: invoices are per payer currency; a guardian with mixed-currency children falls back to per-child invoicing (documented, tested); no FX is performed. (R-INV-7)
- **AC-7.13** All invoice operations are RLS-isolated (internal) and audited; the public page carries no tenant session. (R-TEN, R-AUD-1)

## 10. Test Cases

> `TC-7.<n>`, mapped to ACs. Money and immutability cases are exhaustive by design.

### Line item creation & snapshot
- **TC-7.1** Mark a session ATTENDED → one line item on the period's OPEN invoice; amount = subscription per-session price; currency matches. *(AC-7.1)*
- **TC-7.2** Mark ABSENT_UNEXCUSED → also billed (charged) per the matrix; one line item. *(AC-7.1, Sprint 6 §4)*
- **TC-7.3** Re-mark the same session → no duplicate line (unique constraint + `billed` guard). *(AC-7.1)*
- **TC-7.4** Change subscription price after a line exists → existing line `amount_minor` unchanged; new sessions use the new price. *(AC-7.2)*
- **TC-7.5** Description snapshots the report (surah range) at billing time; editing the report before close does not change a closed invoice's text (and snapshot keeps it stable regardless). *(AC-7.1, decision §3.8)*

### Grouping
- **TC-7.6** PER_GUARDIAN: two children's billable sessions land on **one** guardian invoice, with per-child breakdown. *(AC-7.3)*
- **TC-7.7** PER_STUDENT: the same scenario yields **two** invoices. *(AC-7.3)*
- **TC-7.8** Switching an academy's grouping affects only **future** periods, not already-created invoices. *(AC-7.3)*

### Totals & price basis
- **TC-7.9** Open invoice total equals sum of its line items after each add/remove. *(AC-7.4)*
- **TC-7.10** PER_MONTH basis, 8 sessions/month at a monthly price not divisible by 8 → 8 line items summing **exactly** to the monthly price (rounding remainder absorbed deterministically). *(AC-7.7)*
- **TC-7.11** PER_SESSION basis → each line equals the per-session price; total = count × price. *(AC-7.4)*

### Un-bill & immutability
- **TC-7.12** ATTENDED→ABSENT_EXCUSED before close → line removed, total reduced. *(AC-7.5)*
- **TC-7.13** Same un-bill after close → rejected by hook + DB trigger. *(AC-7.5, AC-7.6)*
- **TC-7.14** After close, attempt to add a new line item → DB trigger rejects. *(AC-7.6)*
- **TC-7.15** After close, attempt to modify `total_minor` directly → trigger rejects. *(AC-7.6)*
- **TC-7.16** Close is idempotent: closing an already-CLOSED invoice is a no-op, no double audit. *(AC-7.6)*
- **TC-7.17** Pre-close integrity check: if totals ≠ sum(lines), close fails loudly (should never happen, but guarded). *(AC-7.4, AC-7.6)*

### Month-end close timing
- **TC-7.18** Sessions in June land on the June invoice; a July session opens a new July invoice (period boundary by `scheduled_at_utc` in academy tz). *(AC-7.6)*
- **TC-7.19** Scheduled close at month end closes June invoices; July remains OPEN. *(AC-7.6)*

### Public page security
- **TC-7.20** `GET /api/i/{valid_token}` returns the right invoice DTO and the Next.js `/i/{token}` page renders it read-only, bilingual, with line items and totals. *(AC-7.8)*
- **TC-7.21** Unknown/forged token → 404 (not 403; no enumeration signal). *(AC-7.8)*
- **TC-7.22** The public page never exposes another invoice, other students, or academy internals; response contains only that invoice's data. *(AC-7.8, AC-7.13)*
- **TC-7.23** Page sets `noindex`; is rate-limited; no tenant session/cookie is required or set. *(AC-7.8, AC-7.13)*
- **TC-7.24** POST/mutation to the public route → rejected (read-only). *(AC-7.8)*

### Send link & payment
- **TC-7.25** Send-link builds a message containing the `/i/{token}` URL targeting the guardian's E.164; marks `sent_at`/`channel`; no automated send. *(AC-7.9)*
- **TC-7.26** Payment button is inert; clicking shows the "arrange with academy" explanation; no charge occurs. *(AC-7.10)*
- **TC-7.27** Mark-paid CASH with reason → status PAID, `paid_at`/method/reason set, audited. *(AC-7.11)*
- **TC-7.28** Mark partial payment (amount < total) → PARTIALLY_PAID, `amount_paid_minor` set. *(AC-7.11)*

### Multi-currency
- **TC-7.29** Guardian with two EGP children → one EGP invoice (same-currency aggregation). *(AC-7.12)*
- **TC-7.30** Guardian with one EGP and one SAR child → fallback to per-child invoices (one EGP, one SAR); no FX, documented behavior. *(AC-7.12)*

### Isolation & audit
- **TC-7.31** Owner of A cannot read/close/mark-paid B's invoices (RLS + permission). *(AC-7.13)*
- **TC-7.32** Teacher role cannot access invoice endpoints (403). *(Sprint 2)*
- **TC-7.33** Line add/remove, close, mark-paid, send-link each write audit entries. *(AC-7.13)*

## 11. Risks & mitigations
- **Risk (highest):** Mutating a closed invoice (data corruption / disputes). **Mitigation:** Sprint 1 DB triggers are the hard backstop; hook checks status; TC-7.13/7.14/7.15.
- **Risk:** Double-billing. **Mitigation:** `billed` guard (Sprint 6) + unique `(invoice_id, session_id)`; TC-7.3.
- **Risk:** Totals drifting from line items. **Mitigation:** transactional maintenance + pre-close integrity check + TC-7.9/7.17.
- **Risk:** Rounding errors in PER_MONTH split. **Mitigation:** deterministic remainder absorption; TC-7.10.
- **Risk:** Public page leaking data or being enumerated. **Mitigation:** high-entropy token, 404-on-miss, noindex, rate-limit, read-only, no tenant context; TC-7.20–7.24.
- **Risk:** Inventing FX implicitly via per-guardian mixed currencies. **Mitigation:** same-currency-only aggregation + per-child fallback; TC-7.29/7.30.

## 12. Estimate
**Large.** This is money + immutability + a public surface. Build the billing functions (`onSessionBillable/Unbilled`, `resolvePerSessionAmount`) as transactional, exhaustively-tested units; treat the close boundary and public-page scoping as security-critical. Do not declare done until every immutability (TC-7.13–7.17) and public-page (TC-7.20–7.24) test passes.

## 13. Handoffs to later sprints
- **Sprint 8** (payroll) is the parallel money document; it reuses `classify()` and the same money/minor-unit and snapshot disciplines.
- **Sprint 9** enforces plan gating on invoicing features and reviews the public page in the security pass; reads the audit trail produced here.
- **Sprint 10** replaces manual send-link with automated WhatsApp delivery, reusing the message + token link.
- **Sprint 11** replaces the payment placeholder with real gateway checkout + webhook reconciliation that flips invoices to PAID automatically.
- **Sprint 12** applies per-academy branding to the public invoice page (reserved fields from Sprint 3).
