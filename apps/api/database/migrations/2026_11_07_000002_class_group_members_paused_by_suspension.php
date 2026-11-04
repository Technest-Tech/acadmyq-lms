<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * A suspended family's children leave their groups explicitly (docs/centre-profile/02-COHERENCE-AUDIT.md
 * §3): the membership is closed with `left_reason = 'SUSPENDED'` and remembered here, so resuming the
 * family re-adds exactly those memberships — the same flag `schedules.paused_by_suspension` carries
 * for the private timetables. Additive; nothing else changes.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            alter table class_group_members
              add column paused_by_suspension boolean not null default false;
            create index class_group_members_paused_idx
              on class_group_members (academy_id, student_id) where paused_by_suspension;
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            drop index if exists class_group_members_paused_idx;
            alter table class_group_members drop column if exists paused_by_suspension;
        SQL);
    }
};
