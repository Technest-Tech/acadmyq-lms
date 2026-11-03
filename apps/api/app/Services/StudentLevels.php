<?php

declare(strict_types=1);

namespace App\Services;

use App\Support\Audit;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Levels / grades (docs/centre-profile, Phase 2.1): the academy's own ordered list of levels, the
 * level a student stands at, and the promotion that moves them up with a history line.
 *
 * This is the one seam the shared student and group controllers call: "is this level one of
 * ours and switched on?" and "what is it called?". A Quran academy has no level rows, so the
 * checks refuse any level id and the names come back null — nothing else about those controllers
 * changes. The promotion itself reuses the group membership moves of {@see ClassGroups} (leave
 * on the day, join on the day, the billing that comes with each), never a copy of them.
 */
final class StudentLevels
{
    public function __construct(private readonly ClassGroups $groups) {}

    /** Refuse a level id that is not one of this academy's active levels (null passes: "no level"). */
    public function assertUsable(?string $levelId, string $field = 'level_id'): void
    {
        if ($levelId === null) {
            return;
        }
        $ok = DB::table('academy_levels')->where('id', $levelId)->where('is_active', true)->exists();
        if (! $ok) {
            throw ValidationException::withMessages([$field => ['Unknown or inactive level. / مستوى غير موجود أو موقوف.']]);
        }
    }

    public function nameOf(?string $levelId): ?string
    {
        if ($levelId === null) {
            return null;
        }
        $name = DB::table('academy_levels')->where('id', $levelId)->value('name');

        return $name !== null ? (string) $name : null;
    }

    /** How many students and groups point at a level — what stops a delete. */
    public function usage(string $levelId): array
    {
        return [
            'students' => DB::table('students')->where('level_id', $levelId)->whereNull('deleted_at')->count(),
            'groups' => DB::table('class_groups')->where('level_id', $levelId)->count(),
        ];
    }

    /**
     * Move a student to `to_level_id` from `effective_on`, optionally into `to_group_id`. Writes the
     * history line (from the level and group they stand in today) and, when a group is named,
     * leaves the group of the old level on the day and joins the new one on the day — through the
     * same service calls the group page's "move" uses, so seats, bills and the audit trail behave
     * exactly as there. One transaction: a full group undoes the promotion with it.
     *
     * @param  array{to_level_id:string, to_group_id?:?string, effective_on?:?string, note?:?string, allow_over_capacity?:bool}  $data
     * @return array{history_id:string, from_level_id:?string, to_level_id:string, from_group_id:?string, to_group_id:?string, effective_on:string}
     */
    public function promote(object $student, array $data, string $actorUserId, string $actorRole): array
    {
        $toLevelId = (string) $data['to_level_id'];
        $this->assertUsable($toLevelId, 'to_level_id');

        $toGroup = null;
        if (! empty($data['to_group_id'])) {
            $toGroup = DB::table('class_groups')->where('id', $data['to_group_id'])->first();
            if ($toGroup === null || $toGroup->status === 'ARCHIVED') {
                throw ValidationException::withMessages(['to_group_id' => ['Unknown or archived group. / مجموعة غير موجودة أو مؤرشفة.']]);
            }
        }

        return DB::transaction(function () use ($student, $data, $toLevelId, $toGroup, $actorUserId, $actorRole): array {
            $fromLevelId = $student->level_id !== null ? (string) $student->level_id : null;
            $on = ! empty($data['effective_on'])
                ? Carbon::parse((string) $data['effective_on'])->format('Y-m-d')
                : ClassGroups::localToday($this->academyTimezone((string) $student->academy_id));

            $fromGroupId = null;
            if ($toGroup !== null) {
                $leaving = $this->groupToLeave((string) $student->id, $fromLevelId, (string) $toGroup->id);
                if ($leaving !== null) {
                    $fromGroupId = (string) $leaving->id;
                    $this->groups->removeMember($leaving, (string) $student->id, $on, 'Promoted to '.$toGroup->name, $actorUserId, $actorRole);
                }
                $this->groups->addMembers($toGroup, [(string) $student->id], $on, (bool) ($data['allow_over_capacity'] ?? false),
                    $actorUserId, $actorRole, movedFromGroup: $fromGroupId);
            }

            DB::table('students')->where('id', $student->id)->update(['level_id' => $toLevelId, 'updated_at' => now()]);

            $historyId = (string) Str::uuid();
            DB::table('student_level_history')->insert([
                'id' => $historyId,
                'academy_id' => (string) $student->academy_id,
                'student_id' => (string) $student->id,
                'from_level_id' => $fromLevelId,
                'to_level_id' => $toLevelId,
                'from_group_id' => $fromGroupId,
                'to_group_id' => $toGroup !== null ? (string) $toGroup->id : null,
                'effective_on' => $on,
                'note' => isset($data['note']) && trim((string) $data['note']) !== '' ? trim((string) $data['note']) : null,
                'changed_by' => DB::table('users')->where('id', $actorUserId)->exists() ? $actorUserId : null,
            ]);

            Audit::log('student.promoted', 'student', (string) $student->id, (string) $student->academy_id, $actorUserId, $actorRole,
                after: ['level_id' => $toLevelId, 'group_id' => $toGroup !== null ? (string) $toGroup->id : null, 'effective_on' => $on],
                before: ['level_id' => $fromLevelId, 'group_id' => $fromGroupId]);

            return [
                'history_id' => $historyId,
                'from_level_id' => $fromLevelId,
                'to_level_id' => $toLevelId,
                'from_group_id' => $fromGroupId,
                'to_group_id' => $toGroup !== null ? (string) $toGroup->id : null,
                'effective_on' => $on,
            ];
        });
    }

    /**
     * The student's level history, newest first, with the names the ids stand for. A deleted level
     * or group leaves its name null — the line itself stays.
     *
     * @return list<array<string,mixed>>
     */
    public function history(string $studentId): array
    {
        return DB::table('student_level_history as h')
            ->leftJoin('academy_levels as fl', 'fl.id', '=', 'h.from_level_id')
            ->leftJoin('academy_levels as tl', 'tl.id', '=', 'h.to_level_id')
            ->leftJoin('class_groups as fg', 'fg.id', '=', 'h.from_group_id')
            ->leftJoin('class_groups as tg', 'tg.id', '=', 'h.to_group_id')
            ->leftJoin('users as u', 'u.id', '=', 'h.changed_by')
            ->where('h.student_id', $studentId)
            ->orderByDesc('h.effective_on')->orderByDesc('h.created_at')
            ->get([
                'h.id', 'h.from_level_id', 'h.to_level_id', 'h.from_group_id', 'h.to_group_id', 'h.effective_on', 'h.note', 'h.created_at',
                'fl.name as from_level_name', 'tl.name as to_level_name', 'fg.name as from_group_name', 'tg.name as to_group_name',
                'u.full_name as changed_by_name',
            ])
            ->map(fn ($h) => [
                'id' => (string) $h->id,
                'from_level_id' => $h->from_level_id !== null ? (string) $h->from_level_id : null,
                'from_level_name' => $h->from_level_name,
                'to_level_id' => $h->to_level_id !== null ? (string) $h->to_level_id : null,
                'to_level_name' => $h->to_level_name,
                'from_group_id' => $h->from_group_id !== null ? (string) $h->from_group_id : null,
                'from_group_name' => $h->from_group_name,
                'to_group_id' => $h->to_group_id !== null ? (string) $h->to_group_id : null,
                'to_group_name' => $h->to_group_name,
                'effective_on' => Carbon::parse($h->effective_on)->format('Y-m-d'),
                'note' => $h->note,
                'changed_by_name' => $h->changed_by_name,
                'created_at' => Carbon::parse($h->created_at)->utc()->toIso8601String(),
            ])
            ->values()
            ->all();
    }

    /**
     * Which open membership the promotion closes: the group of the level they are leaving when
     * they sit in one; failing that their only open group; two or more of other levels and none —
     * the promotion then only joins. Never the destination itself.
     */
    private function groupToLeave(string $studentId, ?string $fromLevelId, string $toGroupId): ?object
    {
        $open = DB::table('class_group_members as m')
            ->join('class_groups as g', 'g.id', '=', 'm.group_id')
            ->where('m.student_id', $studentId)->where('m.status', 'ACTIVE')
            ->where('g.id', '!=', $toGroupId)
            ->get(['g.*']);

        if ($open->isEmpty()) {
            return null;
        }
        if ($fromLevelId !== null) {
            $sameLevel = $open->first(fn ($g) => (string) $g->level_id === $fromLevelId);
            if ($sameLevel !== null) {
                return $sameLevel;
            }
        }

        return $open->count() === 1 ? $open->first() : null;
    }

    private function academyTimezone(string $academyId): string
    {
        return (string) (DB::table('academies')->where('id', $academyId)->value('timezone') ?? 'UTC');
    }
}
