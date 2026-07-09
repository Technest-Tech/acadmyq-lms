<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Extend the teacher approval queue (`session_cancellation_requests`) to also carry FREE-lesson
 * requests, so the Notifications "Classes" tab drives BOTH flows through one table + one owner
 * decision popup.
 *
 * Like a cancellation, a TEACHER can no longer mark a lesson FREE directly — the per-academy
 * billing decision (charge the student? pay the teacher?) is the owner's — so they raise a PENDING
 * request the owner approves (→ status FREE, with the same charge/pay override) or rejects.
 *
 *  - `request_type` distinguishes a cancel from a free request (existing rows are all cancels).
 *  - `cancel_type` is dropped to NULLable: it identifies WHO cancelled (teacher/student) and is
 *    meaningless for a free request. The existing check constraint already tolerates NULL
 *    (`cancel_type in ('teacher','student')` is UNKNOWN, not FALSE, for NULL — so CHECK passes).
 *
 * The "one PENDING request per session" unique index is unchanged and intentionally spans both
 * types: a session should never have a cancel AND a free request pending at the same time.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            alter table session_cancellation_requests
              add column if not exists request_type text not null default 'CANCEL';
            alter table session_cancellation_requests
              add constraint scr_request_type_chk check (request_type in ('CANCEL','FREE'));
            alter table session_cancellation_requests
              alter column cancel_type drop not null;
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            -- Restore NOT NULL only if no free requests (which have a null cancel_type) remain.
            delete from session_cancellation_requests where request_type = 'FREE';
            alter table session_cancellation_requests
              alter column cancel_type set not null;
            alter table session_cancellation_requests
              drop constraint if exists scr_request_type_chk;
            alter table session_cancellation_requests
              drop column if exists request_type;
        SQL);
    }
};
