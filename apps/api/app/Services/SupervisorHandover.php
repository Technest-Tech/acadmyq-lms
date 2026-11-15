<?php

declare(strict_types=1);

namespace App\Services;

use App\Support\Audit;
use App\Support\DoneBy;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Hand one supervisor's students, teachers and parents to another — the supervisor left, or the
 * work is being split differently. Afterwards the new supervisor is who the "Done by / Supervisor"
 * column names, who that list filter finds, and whose "My lessons" carries those students' lessons.
 *
 * Only live records move (a removed student or teacher stays with whoever had them), and only what
 * the supervisor answers for at that moment — whether they added it or were handed it before.
 * Nothing else changes: the teachers' own logins, their lessons, the audit log. Recorded once in the
 * audit log as `supervisor.handover`.
 *
 * The one handing over need not be on the team any more — a supervisor whose login was switched
 * off, whose role was taken away or whose account is gone still "has" the people they added, and
 * those are exactly the ones to move. {@see NOBODY} stands for records nobody on the team added (an
 * import, the system), which can be given a supervisor the same way.
 */
final class SupervisorHandover
{
    /** The "from" for records with no supervisor at all. */
    public const NOBODY = 'none';

    /**
     * Everyone who answers for live students, teachers or parents — on the team or not — and
     * how many of each, the gone ones first: the academy-wide handover list.
     *
     * @return list<array{user_id: ?string, name: ?string, role: ?string, state: string, counts: array{student: int, teacher: int, guardian: int}}>
     *         state: active | inactive (switched off) | gone (no longer on the team, or no account) | nobody
     */
    public function owners(string $academyId): array
    {
        $byOwner = [];
        foreach (DoneBy::HANDOVER_ENTITIES as $type => $entity) {
            [$owner, $bindings] = DoneBy::ownerSql($type, $entity['action'], 'e.id', 'e.academy_id');
            $rows = DB::table($entity['table'].' as e')
                ->where('e.academy_id', $academyId)
                ->whereNull('e.deleted_at')
                ->selectRaw("{$owner} as uid, count(*) as n", $bindings)
                ->groupByRaw('1')
                ->get();
            foreach ($rows as $row) {
                $key = $row->uid !== null ? (string) $row->uid : self::NOBODY;
                $byOwner[$key] ??= ['student' => 0, 'teacher' => 0, 'guardian' => 0];
                $byOwner[$key][$type] = (int) $row->n;
            }
        }

        $team = DoneBy::team($academyId)->keyBy('id');
        $names = DB::table('users')->whereIn('id', array_values(array_filter(array_keys($byOwner), fn ($k) => $k !== self::NOBODY)))
            ->pluck('full_name', 'id');

        $out = [];
        foreach ($byOwner as $key => $counts) {
            $member = $team->get($key);
            $out[] = [
                'user_id' => $key === self::NOBODY ? null : $key,
                'name' => $key === self::NOBODY ? null : ($names[$key] ?? null),
                'role' => $member['role_name'] ?? $member['role'] ?? null,
                'state' => match (true) {
                    $key === self::NOBODY => 'nobody',
                    $member === null => 'gone',
                    ! $member['is_active'] => 'inactive',
                    default => 'active',
                },
                'counts' => $counts,
            ];
        }

        $rank = ['gone' => 0, 'inactive' => 1, 'nobody' => 2, 'active' => 3];
        usort($out, fn (array $a, array $b) => [$rank[$a['state']], (string) $a['name']] <=> [$rank[$b['state']], (string) $b['name']]);

        return $out;
    }

    /**
     * How many live records `$userId` answers for, per type.
     *
     * @return array{student: int, teacher: int, guardian: int}
     */
    public function counts(string $academyId, string $userId): array
    {
        $out = [];
        foreach (DoneBy::HANDOVER_ENTITIES as $type => $_) {
            $out[$type] = $this->owned($academyId, $type, $userId)->count();
        }

        /** @var array{student: int, teacher: int, guardian: int} $out */
        return $out;
    }

    /**
     * Move what `$fromUserId` answers for to `$toUserId`.
     *
     * @param  list<string>  $types  any of student / teacher / guardian
     * @return array{student: int, teacher: int, guardian: int} how many of each moved
     */
    public function transfer(string $academyId, string $fromUserId, string $toUserId, array $types, ?string $actorUserId, ?string $actorRole): array
    {
        $team = DoneBy::team($academyId)->keyBy('id');
        $to = $team->get($toUserId);
        if ($to === null || ! $to['is_active']) {
            throw ValidationException::withMessages(['to_user_id' => ['Pick an active member of the team to hand over to.']]);
        }
        if ($toUserId === $fromUserId) {
            throw ValidationException::withMessages(['to_user_id' => ['Pick someone other than the supervisor handing over.']]);
        }

        $moved = ['student' => 0, 'teacher' => 0, 'guardian' => 0];
        DB::transaction(function () use ($academyId, $fromUserId, $toUserId, $types, $actorUserId, &$moved): void {
            $now = now();
            foreach ($types as $type) {
                $ids = $this->owned($academyId, $type, $fromUserId)->all();
                foreach (array_chunk($ids, 500) as $chunk) {
                    DB::table('supervisor_assignments')->upsert(
                        array_map(fn (string $id): array => [
                            'academy_id' => $academyId,
                            'entity_type' => $type,
                            'entity_id' => $id,
                            'user_id' => $toUserId,
                            'assigned_by' => $actorUserId,
                            'created_at' => $now,
                            'updated_at' => $now,
                        ], $chunk),
                        ['academy_id', 'entity_type', 'entity_id'],
                        ['user_id', 'assigned_by', 'updated_at'],
                    );
                }
                $moved[$type] = count($ids);
            }
        });

        Audit::log('supervisor.handover', 'user', $fromUserId === self::NOBODY ? null : $fromUserId, $academyId, $actorUserId, $actorRole, after: [
            'from' => $fromUserId,
            'to_user_id' => $toUserId,
            'to_name' => $to['name'],
            'students' => $moved['student'],
            'teachers' => $moved['teacher'],
            'guardians' => $moved['guardian'],
        ]);

        return $moved;
    }

    /**
     * The live records of one type that `$userId` answers for now.
     *
     * @return Collection<int, string>
     */
    private function owned(string $academyId, string $type, string $userId): Collection
    {
        $entity = DoneBy::HANDOVER_ENTITIES[$type];
        [$owner, $bindings] = DoneBy::ownerSql($type, $entity['action'], 'e.id', 'e.academy_id');

        return DB::table($entity['table'].' as e')
            ->where('e.academy_id', $academyId)
            ->whereNull('e.deleted_at')
            ->when(
                $userId === self::NOBODY,
                fn ($q) => $q->whereRaw("{$owner} is null", $bindings),
                fn ($q) => $q->whereRaw("{$owner} = ?", [...$bindings, $userId]),
            )
            ->pluck('e.id')
            ->map(fn ($id): string => (string) $id);
    }
}
