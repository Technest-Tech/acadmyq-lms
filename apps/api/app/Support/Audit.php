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
     * The synthetic actor id background jobs run under (see the SYSTEM_USER_ID const each job
     * declares). It is NOT a row in `users`, and `audit_log.actor_user_id` carries a foreign key
     * to that table — so writing it raises a 23503 that rolls back the job's whole transaction.
     *
     * That is not theoretical: it silently destroyed two months of session generation on prod.
     * RollSessionWindowJob generated 711 lessons for one academy, then died on this very insert,
     * and the rollback took the lessons with it. Nothing appeared in `failed_jobs` because the
     * scheduler cron was also missing, so the job was never even dispatched — the two faults hid
     * each other. {@see log()} maps this sentinel to null: an audited system action has no human
     * behind it, and null is exactly how the audit readers already render that.
     */
    public const SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000000';

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
            // Never write the system sentinel into a column that FKs to `users`.
            'actor_user_id' => $actorUserId === self::SYSTEM_ACTOR_ID ? null : $actorUserId,
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
