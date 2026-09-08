<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Trim `digital_products` back to what a client actually fills in (docs/lms/11 §1).
 *
 * The first cut of this feature shipped a book with the same sales apparatus a course has —
 * subtitle, kind, author, language, category, page count, "what's inside", "who it's for". In
 * practice a client listing a PDF wants to type a title, a description and a price, attach the
 * file, and be done. Every other field was a blank input standing between them and a published
 * book, and a blank field publishes nothing: the storefront hid all of them anyway.
 *
 * So they go. Not hidden — dropped, because a column no form can write and no page can read is
 * exactly the clutter this removes from the screen, just relocated into the schema.
 *
 * What stays: title, description, cover, price, status, and `checkout_enabled` — the last because
 * it is not form content, it is the "a Buy button needs somewhere to send the money" predicate the
 * catalogue and the sales page both read.
 *
 * Written as a second migration rather than an edit to `..._000001` because that one has already
 * run: rolling it back would take the unrelated migrations batched with it along for the ride.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            alter table digital_products
              drop column if exists subtitle,
              drop column if exists kind,
              drop column if exists author,
              drop column if exists language,
              drop column if exists category,
              drop column if exists page_count,
              drop column if exists highlights,
              drop column if exists audience;

            -- Manual metadata on a file, for the same reason: nothing asked for it and nothing
            -- printed it. `format` and `size_bytes` stay — those are read off the upload itself.
            alter table digital_product_files
              drop column if exists page_count;
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            alter table digital_products
              add column subtitle   text,
              add column kind       text not null default 'EBOOK'
                check (kind in ('EBOOK','PDF','AUDIOBOOK','WORKBOOK','BUNDLE')),
              add column author     text,
              add column language   text,
              add column category   text,
              add column page_count int check (page_count is null or page_count > 0),
              add column highlights jsonb not null default '[]'::jsonb,
              add column audience   jsonb not null default '[]'::jsonb;

            alter table digital_product_files add column page_count int;
        SQL);
    }
};
