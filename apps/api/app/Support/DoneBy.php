<?php

declare(strict_types=1);

namespace App\Support;

use Closure;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * "Done by" — which login performed an action, for the list screens of an academy that runs
 * several supervisors at once. The owner wants to see who added a student, who booked a trial,
 * and narrow a list to one supervisor's work.
 *
 * Who CREATED a row is read from the audit trail, not from a column on each table: every create
 * path already writes its `*.create` entry with the actor (the forms, the trial booking, the
 * legacy import), so the answer is complete for rows made long before this screen existed, and
 * no future write path has to remember to fill a new column. The lookup is a lateral join on
 * `audit_log_academy_entity_idx` (academy_id, entity_type, entity_id), one index probe per row.
 *
 * A row whose creator was the system (an import, a job) has a null actor and reads as "—".
 */
final class DoneBy
{
    /**
     * Roles that are not the academy's team. A teacher acts on their own lessons and is shown as
     * the teacher; students and guardians never act on these lists at all.
     */
    private const NOT_TEAM = ['TEACHER', 'STUDENT', 'GUARDIAN', 'SUPER_ADMIN'];

    /**
     * Add `added_by_user_id` / `added_by_name` to a list query: the login behind the row's
     * `$action` audit entry (its creation). The columns come out of the lateral under those two
     * names only, so an unqualified `full_name` or `id` in the caller's query never turns
     * ambiguous.
     */
    public static function joinCreator(Builder $query, string $entityType, string $action, string $idColumn, string $academyColumn): Builder
    {
        $creator = DB::table('audit_log as dba')
            ->leftJoin('users as dbu', 'dbu.id', '=', 'dba.actor_user_id')
            ->whereColumn('dba.academy_id', $academyColumn)
            ->where('dba.entity_type', $entityType)
            ->whereColumn('dba.entity_id', $idColumn)
            ->where('dba.action', $action)
            ->orderBy('dba.created_at')
            ->limit(1)
            ->select(['dba.actor_user_id as added_by_user_id', 'dbu.full_name as added_by_name']);

        return $query
            ->leftJoinLateral($creator, 'dbl')
            ->addSelect(['dbl.added_by_user_id', 'dbl.added_by_name']);
    }

    /**
     * The `filter[added_by]=<user id>` DataTable filter for a query joined with {@see joinCreator()}.
     * A value that is not a uuid matches nothing rather than reaching Postgres as a bad cast (500).
     */
    public static function addedByFilter(): Closure
    {
        return fn (Builder $q, $value) => Str::isUuid((string) $value)
            ? $q->where('dbl.added_by_user_id', (string) $value)
            : $q->whereRaw('false');
    }

    /**
     * The academy's team logins — owners, supervisors, every staff and custom role — for the
     * "Done by" filter. A switched-off login stays on the list: their past work is still theirs
     * to filter by. One entry per person even when they hold two roles.
     *
     * @return Collection<int, array{id: string, name: string, role: string, role_name: ?string, is_active: bool}>
     */
    public static function team(string $academyId): Collection
    {
        return DB::table('user_roles as ur')
            ->join('users as u', 'u.id', '=', 'ur.user_id')
            ->leftJoin('academy_roles as ar', 'ar.code', '=', 'ur.role')
            ->where('ur.academy_id', $academyId)
            ->whereNotIn('ur.role', self::NOT_TEAM)
            ->orderBy('u.full_name')
            ->orderBy('ur.created_at')
            ->get(['u.id', 'u.full_name', 'u.is_active', 'ur.role', 'ar.name as role_name'])
            ->unique('id')
            ->map(fn (object $r): array => [
                'id' => (string) $r->id,
                'name' => (string) $r->full_name,
                'role' => (string) $r->role,
                'role_name' => $r->role_name,
                'is_active' => (bool) $r->is_active,
            ])
            ->values();
    }
}
