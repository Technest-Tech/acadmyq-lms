# 10 — Orders, checkout & manual payments

> Phase 5 of the LMS module. Turns the course site from *"ask us for a code"* into a real shop: a
> learner buys a course, pays by InstaPay / Vodafone Cash / bank transfer, uploads the transfer
> receipt, and the client approves it — which enrolls them automatically.

The access-code system built in phase 2 is **not replaced**. It stays, in full, as the offline-sales
channel — and it becomes **per-course optional**, alongside checkout, so a client can sell a course
by checkout only, by code only, by both, or give it away free.

---

## 1. The decision: one order, many ways to pay

Today a paid course has exactly one door: someone hands the learner a code out-of-band. That door
works (it is how offline/cash sales actually happen in Egypt) but it cannot be the *main* one — it
puts a human in the loop before the learner can even try to buy.

So we add an **Order** — one row per purchase attempt — and make the code path one of several ways an
order can be settled:

| Channel | Order created? | How it settles |
|---|---|---|
| **MANUAL** (InstaPay / Vodafone Cash / bank transfer) | yes | learner uploads a receipt → client approves → enrolled |
| **GATEWAY** (XPay — later) | yes | webhook settles the order → enrolled |
| **CODE** | no | code redemption enrolls directly, exactly as today |
| **FREE** (`price_minor = 0`) | no | one-click self-enroll, exactly as today |

An order is the record of a *sale*; a code redemption is the record of an *entitlement grant*. They
stay separate on purpose: a code has no buyer, no price and no money attached to it, and forcing one
through the order table would make every sales number a lie.

`enrollments` gains `source_order_id` next to the existing `source_code_id`. Exactly one of the two
is set — that column pair *is* the provenance of every enrollment, and the learners screen reads it
to say "bought" vs. "redeemed a code" vs. "granted by staff" (both null).

### Per-course channel switches

Two booleans on `courses`, both defaulting to **true** so nothing existing changes behaviour:

- `checkout_enabled` — show the **Buy** button. A course with no price (`price_minor = 0`) is free
  and the button never appears regardless; a client with **no active payment method** also gets no
  button, so the flag alone can never strand a learner on a checkout with nowhere to pay.
- `code_enabled` — show **"I have a code"** and accept redemptions for this course.

Both off + a price set = the course is visible but not sellable (the sales page says "not currently
available"), which is the honest rendering of that configuration rather than a dead button.

---

## 2. Data model

All tables follow the house conventions (`docs/lms/01`): uuid v7 PK, `academy_id` on every row,
FORCE RLS with the standard `tenant_isolation` policy, `created_at/updated_at`.

### `lms_payment_methods` — the client's receiving accounts
One row per method a client accepts. Only `is_active` rows are ever shown to a learner.

```
id             uuid pk
academy_id     uuid not null → academies (cascade)
type           text not null      -- INSTAPAY | VODAFONE_CASH | BANK_TRANSFER | OTHER
label          text               -- display override ("محفظة الحساب الرئيسي")
account_name   text               -- اسم صاحب الحساب — the single most-asked question at transfer time
account_number text               -- InstaPay handle / wallet number / IBAN
bank_name      text               -- BANK_TRANSFER only
instructions   text               -- free-text steps shown on the payment screen
is_active      boolean not null default false
position       int not null default 0
created_at / updated_at
unique (academy_id, type)
```

`unique (academy_id, type)` is deliberate: a client has *one* InstaPay handle, not five. `OTHER` is
the escape hatch for anything we have not modelled (a payment link, a physical office).

**Currency** is not here. A client sells in `academies.default_currency` — one client, one currency
(01 already made that call for `courses.price_minor`) — and the payments screen edits that academy
column rather than inventing a second source of truth.

### `course_orders` — the purchase
```
id                  uuid pk
academy_id          uuid not null → academies (cascade)
order_number        text not null                  -- ORD-000123, per academy, human-quotable
learner_id          uuid not null → learners (cascade)
course_id           uuid not null → courses (cascade)
price_minor         bigint not null                -- SNAPSHOT: a later price change never rewrites history
currency            text not null                  -- SNAPSHOT
status              text not null default 'AWAITING_PAYMENT'
channel             text not null default 'MANUAL' -- MANUAL | GATEWAY
payment_method_id   uuid → lms_payment_methods (set null)
payment_method_type text                           -- snapshot, survives the method being deleted
buyer_name / buyer_email / buyer_phone  text        -- snapshot of the learner at order time
terms_accepted_at   timestamptz                    -- §7: consent is recorded, not assumed
submitted_at        timestamptz                    -- when the learner attached a receipt
confirmed_at        timestamptz                    -- وقت التأكيد — when it became PAID
decided_by          uuid → users                   -- the staff member who approved/rejected
rejection_reason    text
refunded_at         timestamptz
refund_reason       text
staff_note          text                           -- private
created_at / updated_at
unique (academy_id, order_number)
index (academy_id, status, created_at desc)
index (academy_id, course_id)
index (academy_id, learner_id)
```

**Status machine** — the five states the brief asked for, plus `UNDER_REVIEW`, which the brief's own
"طلبك قيد المراجعة" screen requires as a distinct state (an order with a receipt waiting on a human
is *not* the same as one still waiting for the learner to pay):

```
AWAITING_PAYMENT ──receipt uploaded──▶ UNDER_REVIEW ──approve──▶ PAID ──refund──▶ REFUNDED
        │                                    │
        │                                    └──reject──▶ REJECTED ──(learner re-uploads)──▶ UNDER_REVIEW
        └──learner or staff cancels──▶ CANCELLED
```

- **PAID is the only state that enrolls**, and it is written in the same transaction as the
  enrollment. There is no window where a paid order has no access.
- **REJECTED is not terminal.** The learner sees the reason and can attach a corrected receipt —
  a fat-fingered screenshot must not cost them the order.
- **REFUNDED** revokes the enrollment by default (the staff popup can keep access, for a goodwill
  refund).
- **CANCELLED** is the learner's own out, or a staff cleanup of a stale unpaid order.

**Order numbers** come from `app.next_course_order_number(academy)`, backed by a per-academy counter
row updated with `insert … on conflict do update … returning` — atomic under concurrency, and
per-academy so client A's numbering never leaks client B's sales volume.

### `course_order_receipts` — the transfer proof
One order can have several: a rejected receipt is kept and a new one is added, so the review history
survives.

```
id               uuid pk
academy_id       uuid not null → academies (cascade)
order_id         uuid not null → course_orders (cascade)
method_id        uuid → lms_payment_methods (set null)
method_type      text not null
file_path        text not null                  -- PRIVATE disk key, never a public URL
sender_name      text                           -- who the transfer came from (often ≠ the learner)
sender_reference text                           -- transaction / reference number
amount_minor     bigint
paid_at          timestamptz                    -- when the learner says they transferred
note             text
review_status    text not null default 'PENDING'  -- PENDING | APPROVED | REJECTED
reviewed_by      uuid → users
reviewed_at      timestamptz
rejection_reason text
created_at / updated_at
index (academy_id, review_status)
index (order_id)
```

The file lives on the **private** disk and is streamed through a capability-gated endpoint — exactly
how `academy_payment_submissions.screenshot_path` is handled for platform bills
(`AcademySubscriptionController::screenshot`). A receipt is a photo of someone's bank app; it never
gets a public URL.

### `learner_notifications` — the learner's side of §5
Learners are not `users`, so the staff `notifications` table cannot address them (its
`recipient_user_id` FKs `users`). A parallel, deliberately tiny table:

```
id          uuid pk
academy_id  uuid not null → academies (cascade)
learner_id  uuid not null → learners (cascade)
type        text not null    -- ORDER_RECEIVED | RECEIPT_RECEIVED | ORDER_APPROVED | ORDER_REJECTED | ORDER_REFUNDED
title       text not null
body        text
data        jsonb not null default '{}'   -- { order_number, course_slug, course_title, reason }
read_at     timestamptz
created_at  timestamptz not null default now()
index (academy_id, learner_id, created_at desc)
```

Staff-side notifications reuse the existing `notifications` table with a new
`category = 'LMS_SALES'` and `audience_role = 'ACADEMY_OWNER'` — the Notifications page already
renders any category, and `subject_id` carries the order id.

### `learner_password_resets` — §5's last bullet
```
id          uuid pk
academy_id  uuid not null → academies (cascade)
learner_id  uuid not null → learners (cascade)
token_hash  text not null            -- sha256 of the emailed token; the plaintext is never stored
channel     text not null            -- EMAIL | WHATSAPP
expires_at  timestamptz not null     -- 60 minutes
used_at     timestamptz
created_at  timestamptz not null default now()
index (academy_id, learner_id)
index (token_hash)
```

Reset is **enumeration-safe**: `POST /learn/auth/forgot-password` always answers `202` whether or not
the address exists. Delivery prefers **WhatsApp** (the academy's own session, via the existing
`WhatsAppSender` — mail is `log` in this deployment and Egyptian learners live on WhatsApp) and falls
back to email when the learner has no phone.

---

## 3. Checkout (learner site)

```
course page ──[اشترِ الكورس]──▶ sign in / register ──▶ /checkout/<slug>
                                                            │
                          ┌── pick a method ──┬── MANUAL ────┴──▶ instructions + amount + account
                          │                   └── GATEWAY (later) ──▶ redirect to XPay
                          ▼
                 accept the terms (§7)  ──▶ upload the receipt ──▶ /orders/<number>
                                                                        │
                              «طلبك قيد المراجعة» ──approve──▶ «تم تفعيل الكورس» ──▶ player
                                                  └─reject──▶ reason + re-upload
```

Rules the API enforces (the UI mirrors them, but the server is the authority):

1. **You cannot order what you already own.** An ACTIVE enrollment → 409 with a link to the player.
2. **One open order per learner+course.** A second attempt returns the existing open order rather
   than creating a duplicate — the partial unique index `(learner_id, course_id) where status in
   ('AWAITING_PAYMENT','UNDER_REVIEW')` makes that a database guarantee, not a race.
3. **Price is snapshotted at order time.** The client raising the price mid-review does not change
   what the learner owes.
4. **Consent is recorded.** No `terms_accepted_at`, no order.
5. **Free and unpriced courses never reach checkout** — they enroll on one click, as today.

---

## 4. Sales dashboard (client)

`/lms/sales`, gated `course_order.read` (+ `course_order.manage` to decide anything):

- **Headline**: total collected (PAID only), orders this month, **receipts awaiting review** (the
  number that actually demands action), approved / rejected counts.
- **Per-course sales**: units + revenue, sorted by revenue.
- **The queue**: every order with buyer name/email/phone, course, amount, method, status and age;
  free-text search across order number / buyer / course, filters by status + course + date range,
  and **Excel export** through the existing `export-excel.ts` helper (real .xlsx, bilingual-safe —
  the house pattern, not CSV).
- **The review drawer**: the receipt image full-size, the buyer's stated amount/reference, and the
  three decisions — **approve** (→ PAID + enroll + notify), **reject with a reason** (required; the
  learner is shown it verbatim), **refund**.
- **Access control** without an order: grant or revoke a course for any learner, straight from the
  drawer — the existing `learner.read`-gated `setEnrollment` endpoint, surfaced where sales staff
  actually stand.

---

## 5. Notifications

| Event | Client (staff) | Learner |
|---|---|---|
| Order created | `notifications` · `LMS_SALES_ORDER` | — |
| Receipt uploaded | `notifications` · `LMS_SALES_RECEIPT` | `RECEIPT_RECEIVED` ("we got your transfer") |
| Approved | — | `ORDER_APPROVED` + the course is live |
| Rejected | — | `ORDER_REJECTED` + **the reason** |
| Refunded | — | `ORDER_REFUNDED` |
| Password reset | — | WhatsApp (preferred) / email link |

Learner notifications render as a bell in the site header and in full on `/orders`. Every one of them
is *also* implied by the order's own status page, so a missed notification never hides the truth.

---

## 6. Legal & trust pages (§7 of the brief)

Three documents per client, edited in `/lms/site` under a new **Legal** tab and stored in the same
`lms_site_profiles.content` blob (`legal.terms`, `legal.refund`, `legal.privacy`, plus
`legal.contact_note` and the `legal.show_*` switches). `App\Support\LmsSiteProfile` stays the schema
of record and sanitises them like every other field.

They render at `/legal/terms`, `/legal/refund`, `/legal/privacy`, are linked from the footer, and the
checkout consent checkbox links to them by name. Each page carries a standing line — rendered from
the template's i18n, not editable — stating that **the course owner, not the platform, is responsible
for the content and for honouring refunds**. That line is the platform's liability position and is
therefore not a client-editable field.

A client who has written nothing gets the template's sensible Arabic/English default text, in keeping
with the "unconfigured client still has a finished site" promise from 09.

---

## 7. What is deliberately not in this phase

- **Card payments.** `channel = 'GATEWAY'` and the XPay service already in the repo are the seam;
  wiring the redirect + webhook is the next slice, and no table changes are needed for it.
- **Coupons / discounts.** A price is a price. Codes already cover "give it to them cheaper".
- **Instalments, subscriptions, bundles.** One course, one payment.
- **Automated bank reconciliation.** A human reads the receipt. That is the whole point of "دفع يدوي
  سريع" — fast to *ship*, not automated.
