<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Support\Facades\DB;

/**
 * Thin writer for the append-only audit_log (Sprint 1 §6.8, R-AUD-1). The table's RLS
 * insert policy is `with check (true)`, so an entry can be recorded from any context
 * (including the no-context login path); reads remain tenant-scoped. `id` and `created_at`
 * fall back to their column defaults when omitted.
 */
final class Audit
{
    /**
     * @param  array<string,mixed>|null  $after
     * @param  array<string,mixed>|null  $before  prior state of the changed fields
     *                                            (AC-3.10/TC-3.30: configure records before/after)
     */
    public static function log(
        string $action,
        string $entityType,
        ?string $entityId,
        ?string $academyId,
        ?string $actorUserId,
        ?string $actorRole,
        ?array $after = null,
        ?array $before = null,
    ): void {
        DB::table('audit_log')->insert([
            'academy_id' => $academyId,
            'actor_user_id' => $actorUserId,
            'actor_role' => $actorRole,
            'action' => $action,
            'entity_type' => $entityType,
            'entity_id' => $entityId,
            'before' => $before !== null ? json_encode($before) : null,
            'after' => $after !== null ? json_encode($after) : null,
            'created_at' => now(),
        ]);
    }
}
