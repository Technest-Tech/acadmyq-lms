<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Digital products — the LMS's second sellable thing (docs/lms/11). A client who already sells
 * courses can now sell BOOKS: a PDF, an EPUB, an audiobook, a printable workbook. The product is a
 * bundle of downloadable files, one or more of which may be marked as a FREE PREVIEW — the sample
 * chapter every ebook shop offers, readable by anyone without an account.
 *
 * Three decisions this schema encodes, all of them reuse rather than parallel machinery:
 *
 *  1. **Files ride `media_assets`.** A book is an upload like any other, so it goes through the same
 *     reserve → PUT → confirm pipeline, counts against the same `maxStorageGb` cap and is served by
 *     the same signed-URL delivery. The `kind` check simply widens to admit 'DOCUMENT'.
 *  2. **Orders are shared, not duplicated.** `course_orders` becomes an order over an ITEM — a
 *     course or a product — because a client wants ONE sales desk, one receipt inbox and one order
 *     numbering sequence, not two of each. `item_type` says which column is meaningful and a CHECK
 *     makes "both" and "neither" unrepresentable.
 *  3. **Ownership is its own table.** A product is not an enrollment: there is no progress, no
 *     certificate, no lessons — just access to files. `product_entitlements` mirrors `enrollments`
 *     row-for-row where it matters (ACTIVE/REVOKED, provenance, one row per learner+product) so a
 *     refund pulls a book exactly the way it pulls a course.
 *
 * Every table is tenant-scoped with the standard FORCE-RLS `tenant_isolation` policy: staff read it
 * under a normal tenant context and learners under ResolveAcademyContext, and both are the same
 * academy, so one predicate covers the whole feature. Capability checks stay the controller's job.
 */
return new class extends Migration
{
    public function up(): void
    {
        // ── A book is an upload: widen the media pipeline to admit documents ─────────────────────
        DB::unprepared(<<<'SQL'
            alter table media_assets drop constraint if exists media_assets_kind_check;
            alter table media_assets
              add constraint media_assets_kind_check
              check (kind in ('VIDEO','AUDIO','IMAGE','DOCUMENT'));
        SQL);

        // ── The product ─────────────────────────────────────────────────────────────────────────
        // Deliberately shaped like `courses`: same status lifecycle, same slug-per-academy, same
        // price/checkout/code switches, same soft delete — so every rule staff already learned on
        // the course side ("draft until you publish it", "0 means free") transfers unchanged.
        DB::unprepared(<<<'SQL'
            create table digital_products (
              id               uuid primary key default uuid_generate_v7(),
              academy_id       uuid not null references academies(id) on delete cascade,
              title            text not null,
              slug             text not null,
              subtitle         text,
              description      text,
              cover_image_path text,
              -- What the buyer is getting. Closed set: the catalogue prints it as a chip and the
              -- storefront filters on it, so it cannot be free text.
              kind             text not null default 'EBOOK'
                check (kind in ('EBOOK','PDF','AUDIOBOOK','WORKBOOK','BUNDLE')),
              author           text,
              language         text,
              category         text,
              page_count       int check (page_count is null or page_count > 0),
              -- The sales blocks, same jsonb-array-of-short-strings shape as courses.outcomes.
              highlights       jsonb not null default '[]'::jsonb,
              audience         jsonb not null default '[]'::jsonb,
              price_minor      bigint not null default 0 check (price_minor >= 0),
              -- Show the Buy button. A free product, or a client with no live receiving account,
              -- never shows it regardless — the same honesty rule courses apply (docs/lms/10 §1).
              checkout_enabled boolean not null default true,
              status           text not null default 'DRAFT'
                check (status in ('DRAFT','PUBLISHED','ARCHIVED')),
              created_by       uuid,
              published_at     timestamptz,
              created_at       timestamptz not null default now(),
              updated_at       timestamptz not null default now(),
              deleted_at       timestamptz,
              unique (academy_id, slug)
            );
            create index digital_products_academy_status_idx
              on digital_products (academy_id, status, published_at desc)
              where deleted_at is null;

            alter table digital_products enable row level security;
            alter table digital_products force row level security;
            create policy tenant_isolation on digital_products
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());

            comment on column digital_products.kind is
              'What the buyer downloads. Presentational + a catalogue facet; the FILES decide what actually arrives.';
        SQL);

        // ── Its files ───────────────────────────────────────────────────────────────────────────
        // A product is a bundle, not a single blob: the book, plus the worksheets, plus the audio
        // reading. `is_preview` is the free sample — the ONE thing an anonymous visitor may open,
        // which is why the whole preview decision is a boolean on a row and not a page range: a
        // client uploads the sample chapter they are happy to give away, and nothing else leaks.
        DB::unprepared(<<<'SQL'
            create table digital_product_files (
              id               uuid primary key default uuid_generate_v7(),
              academy_id       uuid not null references academies(id) on delete cascade,
              product_id       uuid not null references digital_products(id) on delete cascade,
              media_asset_id   uuid references media_assets(id) on delete set null,
              title            text not null,
              -- Belt and braces next to media_asset_id: an external url (a client hosting their own
              -- PDF) is a legitimate file too, exactly as courses.cover_image_path allows one.
              external_url     text,
              format           text,
              size_bytes       bigint,
              page_count       int,
              is_preview       boolean not null default false,
              position         int not null default 0,
              created_at       timestamptz not null default now(),
              updated_at       timestamptz not null default now()
            );
            create index digital_product_files_product_idx
              on digital_product_files (product_id, position, created_at);
            create index digital_product_files_preview_idx
              on digital_product_files (product_id) where is_preview;

            alter table digital_product_files enable row level security;
            alter table digital_product_files force row level security;
            create policy tenant_isolation on digital_product_files
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());

            comment on column digital_product_files.is_preview is
              'A FREE sample: served to anyone, signed-in or not. Everything else needs an ACTIVE product_entitlement.';
        SQL);

        // ── Ownership ───────────────────────────────────────────────────────────────────────────
        DB::unprepared(<<<'SQL'
            create table product_entitlements (
              id              uuid primary key default uuid_generate_v7(),
              academy_id      uuid not null references academies(id) on delete cascade,
              learner_id      uuid not null references learners(id) on delete cascade,
              product_id      uuid not null references digital_products(id) on delete cascade,
              status          text not null default 'ACTIVE' check (status in ('ACTIVE','REVOKED')),
              -- Provenance, mirroring enrollments: bought, or handed over by staff (both null).
              source_order_id uuid,
              download_count  int not null default 0,
              last_download_at timestamptz,
              granted_at      timestamptz not null default now(),
              unique (learner_id, product_id)
            );
            create index product_entitlements_academy_product_idx
              on product_entitlements (academy_id, product_id);

            alter table product_entitlements enable row level security;
            alter table product_entitlements force row level security;
            create policy tenant_isolation on product_entitlements
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());
        SQL);

        // ── One sales desk: teach `course_orders` to carry either kind of item ───────────────────
        // `course_id` loses its NOT NULL and gains a sibling. The CHECK is what makes this safe:
        // a row is a COURSE order with a course and no product, or a PRODUCT order with a product
        // and no course — "both" and "neither" cannot be written, so every read that switches on
        // `item_type` is switching on something the database already guaranteed.
        DB::unprepared(<<<'SQL'
            alter table course_orders
              add column item_type  text not null default 'COURSE',
              add column product_id uuid references digital_products(id) on delete cascade,
              alter column course_id drop not null;

            alter table course_orders
              add constraint course_orders_item_type_chk check (item_type in ('COURSE','PRODUCT')),
              add constraint course_orders_item_chk check (
                (item_type = 'COURSE'  and course_id is not null and product_id is null)
                or
                (item_type = 'PRODUCT' and product_id is not null and course_id is null)
              );

            create index course_orders_product_idx on course_orders (academy_id, product_id)
              where product_id is not null;

            comment on column course_orders.item_type is
              'What was bought: a COURSE (course_id) or a digital PRODUCT (product_id). Exactly one is set (docs/lms/11).';
        SQL);

        // The open-order guarantee, restated per item type. The old index was over (learner, course)
        // and is now half the promise: a product needs the same protection against a double-click
        // minting two pending orders, and a partial index per column keeps both NULL-safe.
        DB::unprepared(<<<'SQL'
            drop index if exists course_orders_one_open_idx;

            create unique index course_orders_one_open_course_idx
              on course_orders (learner_id, course_id)
              where course_id is not null and status in ('AWAITING_PAYMENT', 'UNDER_REVIEW');

            create unique index course_orders_one_open_product_idx
              on course_orders (learner_id, product_id)
              where product_id is not null and status in ('AWAITING_PAYMENT', 'UNDER_REVIEW');
        SQL);

        // Provenance the other way round, so a refund can find the entitlement it must pull.
        DB::unprepared(<<<'SQL'
            alter table product_entitlements
              add constraint product_entitlements_source_order_fk
              foreign key (source_order_id) references course_orders(id) on delete set null;
            create index product_entitlements_source_order_idx
              on product_entitlements (source_order_id) where source_order_id is not null;
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop index if exists course_orders_one_open_course_idx;
            drop index if exists course_orders_one_open_product_idx;

            -- Product orders have nowhere to live once the table goes; they are the only rows a
            -- rollback can legitimately lose, and leaving them would break the restored NOT NULL.
            delete from course_orders where item_type = 'PRODUCT';

            alter table course_orders
              drop constraint if exists course_orders_item_chk,
              drop constraint if exists course_orders_item_type_chk;
            drop index if exists course_orders_product_idx;
            alter table course_orders
              drop column if exists product_id,
              drop column if exists item_type,
              alter column course_id set not null;

            create unique index course_orders_one_open_idx
              on course_orders (learner_id, course_id)
              where status in ('AWAITING_PAYMENT', 'UNDER_REVIEW');

            drop table if exists product_entitlements;
            drop table if exists digital_product_files;
            drop table if exists digital_products;

            delete from media_assets where kind = 'DOCUMENT';
            alter table media_assets drop constraint if exists media_assets_kind_check;
            alter table media_assets
              add constraint media_assets_kind_check check (kind in ('VIDEO','AUDIO','IMAGE'));
        SQL);
    }
};
