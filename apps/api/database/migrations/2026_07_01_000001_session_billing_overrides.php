<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Per-session billing overrides for cancellations.
 *
 * Until now billing was DERIVED purely from a session's status (SessionClassifier is "the one
 * place the matrix lives"). Cancellations (CANCELLED_BY_TEACHER / CANCELLED_BY_STUDENT) were
 * always non-billable. The academy now decides, per cancellation, whether to still charge the
 * student and/or pay the teacher — a late-cancel fee, say — together with a reason the parent
 * sees on the invoice line.
 *
 * These two columns hold that decision. NULL means "no override" → fall back to the status's
 * default verdict (so ATTENDED/FREE are unaffected). They are only ever set for cancellations;
 * SessionClassifier reads them on top of the status matrix.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('alter table sessions add column if not exists bill_override boolean');
        DB::statement('alter table sessions add column if not exists teacher_override boolean');

        DB::statement("comment on column sessions.bill_override is 'Cancellation override: true=charge the student, false=do not, null=use status default'");
        DB::statement("comment on column sessions.teacher_override is 'Cancellation override: true=pay the teacher, false=do not, null=use status default'");
    }

    public function down(): void
    {
        DB::statement('alter table sessions drop column if exists bill_override');
        DB::statement('alter table sessions drop column if exists teacher_override');
    }
};
