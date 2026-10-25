<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Renewal policy (docs/groups/01-ACCOUNTING.md): may a family start a new group month or package
 * while the last one is unpaid? FREE (the default, what every academy does today) or PAY_FIRST — the
 * next charge waits until the previous one is settled. Set on the family (guardian) or on one
 * student; either one saying PAY_FIRST holds that student's renewals.
 *
 * What a hold skipped is remembered, so paying raises exactly that and nothing older:
 *   class_group_members.renewal_held_from  the first month (or hour-month date) held back
 *   lesson_packages.renewal_held_at        this finished block's renewal is waiting for payment
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            alter table guardians
              add column renewal_policy text not null default 'FREE',
              add constraint guardians_renewal_policy_chk check (renewal_policy in ('FREE','PAY_FIRST'));
            alter table students
              add column renewal_policy text not null default 'FREE',
              add constraint students_renewal_policy_chk check (renewal_policy in ('FREE','PAY_FIRST'));
            alter table class_group_members
              add column renewal_held_from date;
            alter table lesson_packages
              add column renewal_held_at timestamptz;
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            alter table lesson_packages drop column if exists renewal_held_at;
            alter table class_group_members drop column if exists renewal_held_from;
            alter table students drop constraint if exists students_renewal_policy_chk, drop column if exists renewal_policy;
            alter table guardians drop constraint if exists guardians_renewal_policy_chk, drop column if exists renewal_policy;
        SQL);
    }
};
