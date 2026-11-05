<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Two questions the accounting reports could not answer (docs/groups/01-ACCOUNTING.md):
 *
 *   - `expenses.class_group_id`: which group an expense was spent on, so a group's profit can take it
 *     off. Optional, and an expense with none stays an expense of the academy.
 *   - `class_groups.teacher_share_basis`: is a revenue share a share of what the group BILLED (what it
 *     always was, and stays the default) or of what it COLLECTED.
 *
 * Additive: nothing already written moves.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            alter table expenses
              add column class_group_id uuid references class_groups(id) on delete set null;
            create index expenses_group_idx on expenses (class_group_id, spent_on) where class_group_id is not null;

            alter table class_groups
              add column teacher_share_basis text not null default 'BILLED',
              add constraint class_groups_share_basis_chk check (teacher_share_basis in ('BILLED', 'COLLECTED'));
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            alter table class_groups
              drop constraint if exists class_groups_share_basis_chk,
              drop column if exists teacher_share_basis;
            drop index if exists expenses_group_idx;
            alter table expenses drop column if exists class_group_id;
        SQL);
    }
};
