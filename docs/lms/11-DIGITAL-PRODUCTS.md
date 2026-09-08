# 11 — Digital products (books & PDFs)

> The catalogue's **second shelf**. A course-platform client can now sell a book, a PDF, a workbook
> or an audiobook alongside its courses — with a **free sample chapter** anyone may read before
> paying. Same sales desk, same order queue, same receipts.

The one-line summary of the design: **a book is not a course with no lessons.** It is a bundle of
files and an entitlement to download them. Everything about *selling* it is shared with a course;
everything about *consuming* it is not, and the schema says so.

---

## 1. What a client can do

- Publish a **book** — a **title, a description, a cover and a price**. That is the whole form.
- Attach **files**: the book itself, plus worksheets, plus an audio reading. A bundle, not a blob.
- Mark one (or more) of those files as the **free sample**. It is public: readable by anyone, signed
  in or not.
- Sell it through checkout (the existing InstaPay / wallet / bank flow) or give it away free.
- Hand a copy to a learner by hand — the WhatsApp-sale door — or pull it back.

**Four inputs, deliberately.** The first cut of this shipped a book with a course's whole sales
apparatus — subtitle, kind, author, language, page count, "what's inside", "who it's for". Migration
`..._000002` dropped every one of them. A client listing a PDF wants to name it, describe it, price
it and attach the file; each extra field was a blank input standing between them and a published
book, and a blank field publishes nothing — the storefront hid all of them anyway. Anything a file
can tell us about itself (**format**, **size**) is read off the upload instead of typed.

## 2. The three tables

House conventions throughout (`docs/lms/01`): uuid v7 PK, `academy_id` on every row, FORCE RLS with
the standard `tenant_isolation` policy. Migration `2026_09_11_000001_lms_digital_products`.

### `digital_products` — the thing being sold

Deliberately shaped like `courses`: the same `DRAFT/PUBLISHED/ARCHIVED` lifecycle, the same
slug-unique-per-academy, the same `price_minor` + `checkout_enabled`, the same soft delete. Every
rule staff already learned on the course side transfers unchanged.

```
id, academy_id, title, slug (unique per academy), description, cover_image_path
price_minor  bigint     -- integer minor units, academy currency. 0 = free
checkout_enabled boolean
status, created_by, published_at, created_at, updated_at, deleted_at
```

`checkout_enabled` is the one non-form column: it is not something a client types, it is half of the
"a Buy button needs somewhere to send the money" predicate the catalogue and the sales page read.

### `digital_product_files` — the bundle

```
id, academy_id, product_id
media_asset_id  -- an uploaded file (the normal path)
external_url    -- or a link the client hosts themselves
title, position
format, size_bytes        -- derived from the upload, never typed
is_preview      boolean   -- THE FREE SAMPLE
```

`is_preview` is a boolean on a **row**, not a page range on the product. A client uploads the sample
chapter they are happy to give away and nothing else can leak — no PDF-splitting, no "first 10
pages" heuristic that is wrong for half the books in the world.

### `product_entitlements` — who owns it

Mirrors `enrollments` where it matters and nowhere else. No progress, no resume position, no
certificate: there is nothing to be halfway through.

```
id, academy_id, learner_id, product_id
status ACTIVE | REVOKED
source_order_id           -- bought; null + null = granted by staff
download_count, last_download_at, granted_at
unique (learner_id, product_id)
```

## 3. Files ride the existing media pipeline

`media_assets.kind` widens to admit `DOCUMENT`. That is the whole integration: a book goes through
the same reserve → PUT → confirm flow as a lesson video, counts against the same plan `maxStorageGb`
cap, and is served by the same short-lived signed URLs. `MediaController::KIND_MIME` gains a *list*
of accepted prefixes for `DOCUMENT` (`application/pdf`, `application/epub`, `application/vnd.`, …)
because "a book" has no single MIME prefix the way video/audio/image do.

## 4. One sales desk, not two

`course_orders` becomes an order over an **item**:

```
item_type   COURSE | PRODUCT
course_id   nullable
product_id  nullable
constraint course_orders_item_chk:
  (item_type = 'COURSE'  and course_id  is not null and product_id is null) or
  (item_type = 'PRODUCT' and product_id is not null and course_id  is null)
```

"Both" and "neither" are unrepresentable, so every read that switches on `item_type` switches on
something the database already guaranteed. The old `course_orders_one_open_idx` becomes two partial
unique indexes — one per item column — so a double-click still cannot mint two pending purchases.

`App\Services\Lms\CourseOrders` stays the ONLY writer of `course_orders.status`. Placing, receipts,
approval, rejection, refund and cancellation are all identical for a book; the two methods that
branch are `grantAccess()` and `revokeAccess()`, which write an `enrollments` row or a
`product_entitlements` row. A refund pulls the book back exactly as it pulls a course, unless the
client explicitly keeps it.

**Why not a separate `product_orders` table?** Because a client wants one queue, one receipt inbox
and one order-number sequence. Two of each would mean two places to miss a sale.

## 5. The access rule

> A file's bytes leave the API only when it is a **free preview**, or when the caller holds an
> **ACTIVE entitlement** to the product.

- `GET /api/learn/products` and `/products/{slug}` are **public** and ship a resolvable URL for
  preview files and `null` for everything else — the visitor sees every file's *title* (that is what
  a table of contents is for) and can open only the sample.
- `GET /api/learn/products/{slug}/preview/{fileId}` is **public** too, and filters on `is_preview`
  *in the query*, not in a check afterwards. Requiring a sign-up to read a sample chapter is exactly
  the friction that loses the sale.
- `GET /api/learn/products/{slug}/access` is the single gated door that mints download links. It
  answers `owned: false` rather than 403 for a visitor who has not bought it, because the sales page
  calls it to choose between **Download** and **Buy** and an error there would look like a bug.

## 6. Permissions & entitlement

Plan-gated by the existing `entitled:lms` module. **No new capabilities**: authoring uses
`course.read` / `course.manage`, selling uses `course_order.read` / `course_order.manage`, and the
manual grant uses `access_code.manage` (the "who may get in" capability). A client that trusts
someone to publish courses is not meaningfully protected by withholding books from them, and a third
pair of capabilities would be delegation theatre.

## 7. Surfaces

**Staff — `/lms/books`.** One screen, not a list plus an editor route: a book has no sections and no
lessons, so the whole thing fits in one dialog. The metadata form saves on **Save**; the **files save
immediately** on every add / remove / reorder / preview-toggle, because an upload that only landed
when you remembered to press Save is the worst kind of data loss. The nav item sits between Courses
and Quizzes and is part of `LMS_ONLY_KEYS`, so a book-selling client keeps it.

**Storefront — `/learn/{academy}/books` and `/b/{slug}`.** The nav link appears only when
`commerce.books.any` is true, and that block travels with `GET /api/learn/site` so the header is
right on the first frame instead of the link flickering in after a catalogue fetch. Card covers are
3:4 — a book is a portrait object — and the free-sample badge is pinned to the cover, because "read
a bit before paying" is the strongest reason a stranger clicks through. The card carries a cover, a
title, a price and that badge; there is nothing else, because there is nothing else to carry.

The sales page's CTA is computed from real facts, in order, so it is never a button that cannot
work: **owned → Download**, **free → Get it free**, **`sells_online` → Buy**, otherwise say it is not
on sale and point at the contact page.

**Checkout.** `/checkout/book/{slug}` and `/checkout/{slug}` render the *same* component
(`components/learn/checkout-screen.tsx`), parameterised by `kind`. Everything a buyer does is
identical — same order, same receipt, same queue — and two copies of that flow would drift on exactly
the details (consent, resumability) that matter.

**Library.** `/learn/{academy}/me` grows a "My library" tab, offered only once the learner owns
something — an empty tab is a question the page cannot answer.

## 8. Deliberately not built

- **Access codes for books.** Codes scope to courses through `access_code_courses`; extending them is
  a real feature, not a column. The manual grant covers the offline sale meanwhile.
- **In-browser reading / DRM.** Files download. A watermarked reader is a different product.
- **Per-page previews.** See §2 — the sample is a file the client chose, not a slice of one.
- **Bundling a book with a course** as a single purchase.
- **Richer listing metadata** (author, category, "what's inside"). Removed on purpose, see §1. If it
  comes back it comes back as a column *and* an input, never as one without the other.
