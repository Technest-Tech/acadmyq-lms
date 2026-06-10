<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Sprint 2 — make the `users` RLS policy Super-Admin-aware.
 *
 * Sprint 1 gave every tenant table the identical `tenant_isolation` policy
 * (`academy_id = app.current_academy_id()`). That works for academy-scoped rows but can
 * never admit a SUPER_ADMIN user, whose `academy_id` is NULL (§3.5): `NULL = <anything>`
 * is NULL, so a platform-admin row is neither readable nor insertable under any context.
 * Sprint 2 introduces real Super Admin identity, so the `users` policy must accommodate it.
 *
 * Replacement policy on `users`:
 *
 *   academy_id = app.current_academy_id()                       -- normal academy scoping
 *   OR (academy_id is null and app.is_super_admin())            -- platform-admin rows
 *
 * Why this is still fail-closed and non-leaky:
 *   - No context at all (role NULL): both branches are false → zero rows (fail closed).
 *   - Academy Owner (academy A): sees/writes only A's users; the NULL branch needs
 *     SUPER_ADMIN, which they are not.
 *   - Super Admin at the platform (no academy entered): manages the NULL-academy admin
 *     rows (this is what lets the seeder create the platform admin).
 *   - Super Admin who entered academy A: sees A's users, plus other platform-admin rows —
 *     never another tenant's users.
 *
 * Only `users` and `user_roles` carry NULL-academy (platform Super Admin) rows; the other
 * tenant tables never do, so they keep the plain Sprint 1 policy.
 */
return new class extends Migration
{
    /** Identity tables that must admit NULL-academy Super Admin rows. */
    private const TABLES = ['users', 'user_roles'];

    public function up(): void
    {
        foreach (self::TABLES as $t) {
            DB::unprepared(<<<SQL
                drop policy if exists tenant_isolation on {$t};
                create policy tenant_isolation on {$t}
                  using (
                    academy_id = app.current_academy_id()
                    or (academy_id is null and app.is_super_admin())
                  )
                  with check (
                    academy_id = app.current_academy_id()
                    or (academy_id is null and app.is_super_admin())
                  );
            SQL);
        }
    }

    public function down(): void
    {
        foreach (self::TABLES as $t) {
            DB::unprepared(<<<SQL
                drop policy if exists tenant_isolation on {$t};
                create policy tenant_isolation on {$t}
                  using (academy_id = app.current_academy_id())
                  with check (academy_id = app.current_academy_id());
            SQL);
        }
    }
};
