<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        // Add STAFF to the app_role enum. PostgreSQL ALTER TYPE … ADD VALUE is
        // transactional in PG 14+ only with the IF NOT EXISTS guard.
        DB::statement("ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'STAFF'");
    }

    public function down(): void
    {
        // Enum values cannot be removed in PostgreSQL without recreating the type.
        // This is intentionally a no-op; the STAFF value is harmless if unused.
    }
};
