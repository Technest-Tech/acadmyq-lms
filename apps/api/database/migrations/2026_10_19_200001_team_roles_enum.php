<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Add the three new shared built-in roles to the `app_role` enum: MANAGER (the whole academy),
 * ACCOUNTANT (the money desk) and CUSTOMER_SERVICE (the front desk). See the next migration for
 * what each resolves to.
 *
 * Same two-file split as STAFF and SUPERVISOR: `role_permissions.role` is still the enum, and
 * PostgreSQL will not let a value added in a transaction be used in that same transaction, so the
 * grants live in a separate migration.
 */
return new class extends Migration
{
    public function up(): void
    {
        foreach (['MANAGER', 'ACCOUNTANT', 'CUSTOMER_SERVICE'] as $role) {
            DB::statement("ALTER TYPE app_role ADD VALUE IF NOT EXISTS '{$role}'");
        }
    }

    public function down(): void
    {
        // Enum values cannot be removed in PostgreSQL without recreating the type. Intentionally a
        // no-op; unused values are harmless.
    }
};
