<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * How much of a cancelled (or free) lesson the teacher is paid, when the office chose to pay them
 * at all (`teacher_override = true`): a quarter, a half or the whole lesson. Integer basis points
 * (10000 = the whole lesson), like every other percentage that multiplies money. NULL = the whole
 * lesson, which is what every lesson recorded before this column meant.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('alter table sessions add column if not exists teacher_pay_share_bp smallint');
        DB::statement('alter table sessions drop constraint if exists sessions_teacher_pay_share_bp_chk');
        DB::statement('alter table sessions add constraint sessions_teacher_pay_share_bp_chk check (teacher_pay_share_bp between 0 and 10000)');
        DB::statement("comment on column sessions.teacher_pay_share_bp is 'Share of the lesson pay a cancelled/free lesson earns the teacher, in basis points; NULL = whole lesson.'");
    }

    public function down(): void
    {
        DB::statement('alter table sessions drop constraint if exists sessions_teacher_pay_share_bp_chk');
        DB::statement('alter table sessions drop column if exists teacher_pay_share_bp');
    }
};
