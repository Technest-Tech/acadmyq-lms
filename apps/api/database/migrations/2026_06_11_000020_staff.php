<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::statement(<<<'SQL'
            CREATE TABLE staff (
                id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                academy_id  UUID        NOT NULL REFERENCES academies(id) ON DELETE CASCADE,
                user_id     UUID        REFERENCES users(id) ON DELETE SET NULL,
                full_name   TEXT        NOT NULL,
                department  TEXT        NOT NULL DEFAULT 'OTHER',
                phone       TEXT,
                salary_minor BIGINT     DEFAULT 0,
                currency    CHAR(3)     NOT NULL DEFAULT 'USD',
                notes       TEXT,
                is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
                deleted_at  TIMESTAMPTZ,
                created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        SQL);

        DB::statement(<<<'SQL'
            ALTER TABLE staff ADD CONSTRAINT staff_department_check
                CHECK (department IN (
                    'SUPPORT','ACCOUNTING','RECEPTION','MARKETING',
                    'HR','IT','ADMINISTRATION','OTHER'
                ))
        SQL);

        // RLS: restrict reads/writes to the caller's own academy (same pattern as other people tables).
        DB::statement('ALTER TABLE staff ENABLE ROW LEVEL SECURITY');

        DB::statement(<<<'SQL'
            CREATE POLICY tenant_isolation ON staff
                USING      (academy_id = current_setting('app.current_academy_id', TRUE)::UUID)
                WITH CHECK (academy_id = current_setting('app.current_academy_id', TRUE)::UUID)
        SQL);

        DB::statement('CREATE INDEX idx_staff_academy_id ON staff (academy_id)');
        DB::statement('CREATE INDEX idx_staff_deleted_at ON staff (academy_id, deleted_at)');
    }

    public function down(): void
    {
        DB::statement('DROP TABLE IF EXISTS staff');
    }
};
