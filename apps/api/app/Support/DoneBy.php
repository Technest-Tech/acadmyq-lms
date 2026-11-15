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
 *
 * A student, teacher or parent can be HANDED OVER to another supervisor (one who left, their
 * people followed by someone else): `supervisor_assignments` then names who answers for the row,
 * and that wins over the creator everywhere this class is read — the column, the filter, "My
 * lessons". The audit log itself is never rewritten. See {@see ownerSql()}.
 */
final class DoneBy
{
    /**
     * Roles that are not the academy's team. A teacher acts on their own lessons and is shown as
     * the teacher; students and guardians never act on these lists at all.
     */
    private const NOT_TEAM = ['TEACHER', 'STUDENT', 'GUARDIAN', 'SUPER_ADMIN'];

    /**
     * What a supervisor answers for and can hand over: entity type => its table and the audit
     * action that created it.
     */
    public const HANDOVER_ENTITIES = [
        'student' => ['table' => 'students', 'action' => 'student.create'],
        'teacher' => ['table' => 'teachers', 'action' => 'teacher.create'],
        'guardian' => ['table' => 'guardians', 'action' => 'guardian.create'],
    ];

    /**
     * The SQL expression for who answers for a row, with its bindings: the supervisor it was
     * handed over to, else whoever made it (its first `$action` audit entry). `$idColumn` and
     * `$academyColumn` are the caller's own column references — code, never input.
     *
     * @return array{0: string, 1: list<string>}
     */
    public static function ownerSql(string $entityType, string $action, string $idColumn, string $academyColumn): array
    {
        $sql = 'coalesce('
            ."(select dbs.user_id from supervisor_assignments dbs where dbs.academy_id = {$academyColumn} and dbs.entity_type = ? and dbs.entity_id = {$idColumn}), "
            ."(select dba.actor_user_id from audit_log dba where dba.academy_id = {$academyColumn} and dba.entity_type = ? and dba.entity_id = {$idColumn} and dba.action = ? order by dba.created_at limit 1)"
            .')';

        return [$sql, [$entityType, $entityType, $action]];
    }

    /**
     * Add `added_by_user_id` / `added_by_name` to a list query: the login behind the row's
     * `$action` audit entry (its creation). The columns come out of the lateral under those two
     * names only, so an unqualified `full_name` or `id` in the caller's query never turns
     * ambiguous.
     */
    public static function joinCreator(Builder $query, string $entityType, string $action, string $idColumn, string $academyColumn): Builder
    {
        [$owner, $bindings] = self::ownerSql($entityType, $action, $idColumn, $academyColumn);
        $creator = DB::query()
            ->fromRaw("(select {$owner} as uid) as dbo", $bindings)
            ->leftJoin('users as dbu', 'dbu.id', '=', 'dbo.uid')
            ->select(['dbo.uid as added_by_user_id', 'dbu.full_name as added_by_name']);

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
     * Keep only the rows `$userId` answers for — the same answer {@see joinCreator()} reads, as a
     * filter. A supervisor's "my lessons" is the lessons of the students they added or were handed;
     * a row the system created belongs to nobody.
     */
    public static function createdBy(Builder $query, string $userId, string $entityType, string $action, string $idColumn, string $academyColumn): Builder
    {
        [$owner, $bindings] = self::ownerSql($entityType, $action, $idColumn, $academyColumn);

        return $query->whereRaw("{$owner} = ?", [...$bindings, $userId]);
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
