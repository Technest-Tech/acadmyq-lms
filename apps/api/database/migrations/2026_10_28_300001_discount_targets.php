<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * A discount on several groups and private subscriptions, and a discount that can be taken back
 * (docs/groups/01-ACCOUNTING.md, "Discounts: several targets, end and cancel").
 *
 * A centre gave a child a discount on two of their three groups and could only pick one: a
 * discount named a single `class_group_id`. It now names any number of targets:
 *
 *   class_group_id            that group's charges, for any child the discount covers
 *   student_id (+teacher_id)  that child's private subscription with this subject teacher — a
 *                             package tied to them, or a lesson on their timetable; no teacher =
 *                             every private charge of that child
 *
 * No target = everything in the discount's scope, as before. `class_group_id` on the discount is
 * copied in as its one target and no longer read (left in place so a rollback finds it).
 *
 * `cancelled_at`: a discount cancelled outright — taken off every charge still on an open bill, as
 * if it was never given — as opposed to one that ended on a day and kept what it took before it.
 * Tenant tables are under FORCE row-level security, so the copy runs academy by academy with the
 * tenant GUC set (the pattern of 2026_10_22_000002_private_reminders_off).
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            create table payer_discount_targets (
              id             uuid primary key default uuid_generate_v7(),
              academy_id     uuid not null references academies(id),
              discount_id    uuid not null references payer_discounts(id) on delete cascade,
              class_group_id uuid references class_groups(id),
              student_id     uuid references students(id),
              teacher_id     uuid references teachers(id),
              created_at     timestamptz not null default now(),
              constraint payer_discount_targets_kind_chk check ((class_group_id is null) <> (student_id is null)),
              constraint payer_discount_targets_teacher_chk check (teacher_id is null or student_id is not null)
            );
            create index payer_discount_targets_discount_idx on payer_discount_targets (discount_id);

            alter table payer_discount_targets enable row level security;
            alter table payer_discount_targets force row level security;
            create policy tenant_isolation on payer_discount_targets
              using (academy_id = app.current_academy_id())
              with check (academy_id = app.current_academy_id());

            alter table payer_discounts
              add column cancelled_at timestamptz,
              add column cancelled_by uuid references users(id);
        SQL);

        DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");
        foreach (DB::table('academies')->pluck('id')->all() as $id) {
            DB::statement("select set_config('app.current_academy_id', ?, true)", [(string) $id]);
            DB::statement(<<<'SQL'
                insert into payer_discount_targets (academy_id, discount_id, class_group_id)
                select academy_id, id, class_group_id from payer_discounts
                 where class_group_id is not null
                   and academy_id = app.current_academy_id()
            SQL);
        }
        DB::statement("select set_config('app.current_academy_id', '', true)");
        DB::statement("select set_config('app.current_role', '', true)");
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop table if exists payer_discount_targets;
            alter table payer_discounts drop column if exists cancelled_by, drop column if exists cancelled_at;
        SQL);
    }
};
