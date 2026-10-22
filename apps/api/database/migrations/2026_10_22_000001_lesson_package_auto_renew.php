<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Packages renew themselves (docs/lesson-packages).
 *
 * A block that runs out — exhausted by its lessons, not closed by hand — opens the student's next
 * one on the same terms, so the finished page is about collecting money and nobody has to remember
 * to sell the next block. `auto_renew` is per package and ON by default (every running package
 * included): an academy turns it off for a family that is stopping, rather than on for each one
 * that is staying.
 *
 * The last lesson of a block still never splits. When it overdraws, the overdrawn minutes are
 * ABSORBED by the next package instead of being billed as "extra hours": the new block starts
 * with them already used (`absorbed_overdraft_minutes`, counted inside `minutes_consumed`) and the
 * old one records where they went (`overdraft_absorbed_by`). An overdraft is settled by exactly one
 * of `overdraft_invoice_id` or `overdraft_absorbed_by`, never both.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            alter table lesson_packages
              add column auto_renew                 boolean not null default true,
              add column opened_automatically       boolean not null default false,
              add column absorbed_overdraft_minutes integer not null default 0,
              add column overdraft_absorbed_by      uuid references lesson_packages(id),
              add constraint lesson_packages_absorbed_chk check (absorbed_overdraft_minutes >= 0),
              add constraint lesson_packages_overdraft_once_chk
                check (overdraft_invoice_id is null or overdraft_absorbed_by is null);
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            alter table lesson_packages
              drop constraint if exists lesson_packages_overdraft_once_chk,
              drop constraint if exists lesson_packages_absorbed_chk,
              drop column if exists overdraft_absorbed_by,
              drop column if exists absorbed_overdraft_minutes,
              drop column if exists opened_automatically,
              drop column if exists auto_renew;
        SQL);
    }
};
