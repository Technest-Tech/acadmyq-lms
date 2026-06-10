<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * SPIKE (temporary) — proves the RLS-on-Laravel pattern end to end on a single table
 * before it is replicated across the real schema (§12, last risk). It locks:
 *   - the app connects as a role for which FORCE RLS is enforced (academiq_app, the owner),
 *   - the standard tenant policy shape (using + with check on academy_id),
 *   - the test harness setting GUCs transaction-locally in the same tx as the query.
 *
 * Removed once the real tables exist; the locked pattern lives on in §6/§7 migrations.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            create table spike_widgets (
              id uuid primary key default uuid_generate_v7(),
              academy_id uuid not null,
              label text not null,
              created_at timestamptz not null default now(),
              updated_at timestamptz not null default now()
            );

            alter table spike_widgets enable row level security;
            alter table spike_widgets force row level security;

            create policy tenant_isolation on spike_widgets
              using      (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());
        SQL);
    }

    public function down(): void
    {
        DB::unprepared('drop table if exists spike_widgets;');
    }
};
