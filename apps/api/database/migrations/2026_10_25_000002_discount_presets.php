<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Discount presets (بنود الخصم, docs/groups/01-ACCOUNTING.md): the discounts an academy gives over
 * and over — "Sibling 10 %", "Scholarship 200 EGP" — defined once by an admin, so the family card's
 * "Add discount" picks one instead of the desk typing it every time. A preset is only a template:
 * a discount made from it copies its kind, value and label and remembers where it came from
 * (`payer_discounts.preset_id`); editing or retiring the preset never touches a discount already
 * given. Retired, never deleted (`is_active`). Same value units as `payer_discounts`: PERCENT in
 * basis points, FIXED in minor units per charge.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            create table discount_presets (
              id          uuid primary key default uuid_generate_v7(),
              academy_id  uuid not null references academies(id),
              name        text not null,
              kind        text not null,                -- PERCENT (value = basis points) | FIXED (value = minor units per charge)
              value       integer not null,
              notes       text,
              is_active   boolean not null default true,
              created_by  uuid references users(id),
              created_at  timestamptz not null default now(),
              updated_at  timestamptz not null default now(),
              constraint discount_presets_kind_chk check (kind in ('PERCENT', 'FIXED')),
              constraint discount_presets_value_chk check (value > 0 and (kind <> 'PERCENT' or value <= 10000)),
              constraint discount_presets_name_chk check (length(trim(name)) > 0)
            );
            create index discount_presets_academy_idx on discount_presets (academy_id);

            alter table discount_presets enable row level security;
            alter table discount_presets force row level security;
            create policy tenant_isolation on discount_presets
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());

            alter table payer_discounts
              add column preset_id uuid references discount_presets(id);
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            alter table payer_discounts drop column if exists preset_id;
            drop table if exists discount_presets;
        SQL);
    }
};
