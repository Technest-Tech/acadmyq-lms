<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Support\Facades\DB;

/**
 * The single place that writes the three RLS session GUCs (§4 contract):
 *
 *   app.current_user_id    uuid of the authenticated user
 *   app.current_academy_id uuid of the academy the request operates within
 *   app.current_role       'SUPER_ADMIN' | 'ACADEMY_OWNER' | 'TEACHER'
 *
 * RLS policies read these via app.current_*(). A NULL/empty value makes the policies
 * match nothing → fail closed. There is no in-app filtering: the database is the only
 * arbiter of tenant visibility.
 *
 * Scope:
 *   - TenantContextMiddleware uses transaction-local scope (SET LOCAL semantics, the
 *     `true` flag): the context lives for exactly the request's transaction and cannot
 *     leak across pooled connections — which is why the app must use the SESSION-mode
 *     (not transaction-mode) Supabase pooler.
 *   - Seeders / one-off scripts that are not inside a managed transaction use session
 *     scope and must clear() when done.
 */
final class TenantContext
{
    /**
     * Set all three GUCs at once. Pass null to leave a value unset (→ NULL → fail closed).
     *
     * @param  bool  $local  true = transaction-local (request path); false = session-level.
     */
    public static function apply(
        ?string $userId,
        ?string $academyId,
        ?string $role,
        bool $local = true,
        ?string $connection = null,
    ): void {
        $db = DB::connection($connection);
        $db->statement('select set_config(?, ?, ?)', ['app.current_user_id', $userId ?? '', $local]);
        $db->statement('select set_config(?, ?, ?)', ['app.current_academy_id', $academyId ?? '', $local]);
        $db->statement('select set_config(?, ?, ?)', ['app.current_role', $role ?? '', $local]);
    }

    /** Clear all three GUCs (session scope). Call after a seeding/script block. */
    public static function clear(?string $connection = null): void
    {
        self::apply(null, null, null, local: false, connection: $connection);
    }
}
