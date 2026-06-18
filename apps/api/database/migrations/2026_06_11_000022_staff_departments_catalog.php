<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Platform-level staff-department catalog managed by Super Admin.
 * No academy_id — this is a shared catalog like `academy_types` or `plans`.
 * Staff rows store the department name as TEXT (not FK) so historical records
 * survive a rename or deletion — same pattern as `teachers.specialization`.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement(<<<'SQL'
            CREATE TABLE staff_departments (
                id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
                name       TEXT        NOT NULL,
                is_active  BOOLEAN     NOT NULL DEFAULT TRUE,
                sort_order INTEGER     NOT NULL DEFAULT 0,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT staff_departments_name_unique UNIQUE (name)
            )
        SQL);

        // Platform catalog: every authenticated user can read it for the dropdown.
        DB::statement('ALTER TABLE staff_departments ENABLE ROW LEVEL SECURITY');
        DB::statement(<<<'SQL'
            CREATE POLICY catalog_select ON staff_departments
                FOR SELECT USING (TRUE)
        SQL);

        // Drop the hardcoded CHECK constraint from the staff table so departments
        // become free-text validated against the catalog at the application layer.
        DB::statement('ALTER TABLE staff DROP CONSTRAINT IF EXISTS staff_department_check');

        // Seed the 8 default departments in display order.
        $defaults = [
            ['ADMINISTRATION', 0],
            ['SUPPORT',        1],
            ['ACCOUNTING',     2],
            ['RECEPTION',      3],
            ['HR',             4],
            ['MARKETING',      5],
            ['IT',             6],
            ['OTHER',          7],
        ];

        foreach ($defaults as [$name, $order]) {
            DB::table('staff_departments')->insert([
                'id'         => (string) Str::uuid(),
                'name'       => $name,
                'sort_order' => $order,
                'is_active'  => true,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
    }

    public function down(): void
    {
        DB::statement('DROP TABLE IF EXISTS staff_departments');
        // Restore the CHECK constraint (approximate — exact list matches the original migration).
        DB::statement(<<<'SQL'
            ALTER TABLE staff ADD CONSTRAINT staff_department_check
                CHECK (department IN (
                    'SUPPORT','ACCOUNTING','RECEPTION','MARKETING',
                    'HR','IT','ADMINISTRATION','OTHER'
                ))
        SQL);
    }
};
