<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Enrollment terms and per-academy custom report fields (§6.4).
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            -- Per-student enrollment terms; the agreed price LIVES HERE (R-STU-4, R-INV-7).
            create table subscriptions (
              id                 uuid primary key default uuid_generate_v7(),
              academy_id         uuid not null references academies(id),
              student_id         uuid not null references students(id),
              plan_label         text not null,                    -- e.g. '8 sessions/month' (display)
              sessions_per_month smallint,                         -- quota if applicable
              price_minor        bigint not null,                  -- agreed per-student price
              currency           char(3) not null,
              price_basis        text not null default 'PER_SESSION', -- 'PER_SESSION' | 'PER_MONTH'
              status             subscription_status not null default 'ACTIVE',
              start_date         date not null,
              deleted_at         timestamptz,
              created_at         timestamptz not null default now(),
              updated_at         timestamptz not null default now(),
              constraint subscriptions_price_basis_chk
                check (price_basis in ('PER_SESSION','PER_MONTH'))
            );
            create index subscriptions_academy_idx on subscriptions (academy_id);
            create index subscriptions_student_idx on subscriptions (student_id);

            -- Each academy designs its own session-report fields (R-CRF-1/2).
            create table report_field_definitions (
              id          uuid primary key default uuid_generate_v7(),
              academy_id  uuid not null references academies(id),
              key         text not null,                           -- machine key, unique per academy
              label_ar    text not null,
              label_en    text not null,
              field_type  report_field_type not null,
              options     jsonb,                                   -- for SELECT
              sort_order  int not null default 0,
              is_required boolean not null default false,
              is_active   boolean not null default true,
              created_at  timestamptz not null default now(),
              updated_at  timestamptz not null default now(),
              unique (academy_id, key)
            );
            create index rfd_academy_idx on report_field_definitions (academy_id);
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop table if exists report_field_definitions;
            drop table if exists subscriptions;
        SQL);
    }
};
