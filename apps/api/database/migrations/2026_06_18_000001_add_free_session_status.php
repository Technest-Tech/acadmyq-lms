<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        // FREE is a real session outcome: the lesson WAS delivered (so it owes a report and
        // occupies the slot) but it's on the house — non-billable to the student and non-paying
        // to the teacher (see App\Domain\SessionClassifier). PostgreSQL ALTER TYPE … ADD VALUE is
        // transactional in PG 14+ with the IF NOT EXISTS guard. Slot it right after ATTENDED so
        // the DB enum order mirrors the PHP enum and the TS contract (SCHEDULED, ATTENDED, FREE, …),
        // keeping introspection and any ordered reads in lockstep across the stack.
        DB::statement("ALTER TYPE session_status ADD VALUE IF NOT EXISTS 'FREE' AFTER 'ATTENDED'");
    }

    public function down(): void
    {
        // Enum values cannot be removed in PostgreSQL without recreating the type.
        // This is intentionally a no-op; the FREE value is harmless if unused.
    }
};
