<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Add SUPERVISOR to the `app_role` enum — the academy manager who runs everything except the
 * money (see the next migration for what that resolves to).
 *
 * `role_permissions.role` is still the enum (only system roles ever live there; custom academy
 * roles moved to TEXT in the custom_roles migration), so the value has to exist before any grant
 * can reference it. PostgreSQL will not let a value added by a transaction be USED in that same
 * transaction, which is why the grants are a SEPARATE migration file rather than a second
 * statement here — the same split the STAFF role needed.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement("ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'SUPERVISOR'");
    }

    public function down(): void
    {
        // Enum values cannot be removed in PostgreSQL without recreating the type. Intentionally
        // a no-op; an unused SUPERVISOR value is harmless.
    }
};
