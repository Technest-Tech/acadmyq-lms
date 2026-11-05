<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Group defaults (docs/centre-profile/02-COHERENCE-AUDIT §3; the "open questions" of
 * docs/groups/00-OVERVIEW.md). A centre types the same lesson length, billing mode, lessons a month
 * and teacher pay into every group it opens; from here it sets them once (Settings) and the group
 * form opens on them. One row per academy, every column nullable (null = no default, the form keeps
 * its own). Nothing reads them server-side: a group still stores its own values, so changing a
 * default never moves an existing group.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            create table if not exists academy_group_defaults (
              academy_id         uuid primary key references academies(id),
              lesson_minutes     int,
              billing_mode       text,
              month_lessons      int,
              teacher_pay_mode   text,
              teacher_pay_minor  bigint,
              teacher_share_bp   int,
              mode               text,
              created_at         timestamptz not null default now(),
              updated_at         timestamptz not null default now(),
              constraint academy_group_defaults_minutes_chk check (lesson_minutes is null or lesson_minutes between 1 and 600),
              constraint academy_group_defaults_billing_chk check (billing_mode is null or billing_mode in ('MONTHLY','PER_LESSON','COURSE')),
              constraint academy_group_defaults_lessons_chk check (month_lessons is null or month_lessons between 1 and 500),
              constraint academy_group_defaults_pay_mode_chk
                check (teacher_pay_mode is null or teacher_pay_mode in ('PER_LESSON','PER_HOUR','PER_STUDENT','REVENUE_SHARE')),
              constraint academy_group_defaults_pay_chk check (teacher_pay_minor is null or teacher_pay_minor >= 0),
              constraint academy_group_defaults_share_chk check (teacher_share_bp is null or teacher_share_bp between 0 and 10000),
              constraint academy_group_defaults_mode_chk check (mode is null or mode in ('ONLINE','OFFLINE'))
            );

            alter table academy_group_defaults enable row level security;
            alter table academy_group_defaults force row level security;
            drop policy if exists tenant_isolation on academy_group_defaults;
            create policy tenant_isolation on academy_group_defaults
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop policy if exists tenant_isolation on academy_group_defaults;
            drop table if exists academy_group_defaults;
        SQL);
    }
};
