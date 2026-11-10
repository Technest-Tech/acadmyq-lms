<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * A student's current subscription, for lists that show one row per student.
 *
 * A student is meant to hold exactly one ACTIVE subscription (writeSubscription ends the old one
 * before inserting), but nothing in the schema enforces it, and some students have two — a monthly
 * one and an "Hours package" one left by the package flow before it learned to flip the existing
 * subscription in place. A plain left join on ACTIVE turned each of those students into two rows:
 * listed twice, React keys clashing, the page count off. This joins the NEWEST active one, the
 * same subscription the student's own profile shows (StudentController::activeSubscription).
 */
final class CurrentSubscription
{
    /** Left-join the newest ACTIVE, not-deleted subscription of `$studentColumn` as `$alias`. */
    public static function join(Builder $query, string $alias = 'sub', string $studentColumn = 's.id'): Builder
    {
        $current = DB::table('subscriptions as cur_sub')
            ->whereColumn('cur_sub.student_id', $studentColumn)
            ->where('cur_sub.status', 'ACTIVE')
            ->whereNull('cur_sub.deleted_at')
            ->orderByDesc('cur_sub.created_at')
            ->orderByDesc('cur_sub.id')
            ->limit(1)
            ->select('cur_sub.*');

        return $query->leftJoinLateral($current, $alias);
    }
}
