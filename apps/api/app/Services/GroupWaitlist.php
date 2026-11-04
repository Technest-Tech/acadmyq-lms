<?php

declare(strict_types=1);

namespace App\Services;

use App\Support\Audit;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * The waiting list of a full group (docs/centre-profile, Phase 2 §2) — the notebook the front desk
 * kept, as rows: who asked for a seat (a student of the academy, or a walk-in's name and phone),
 * in what order. Seating someone goes through {@see ClassGroups::addMembers}, so the seat limit and
 * the joining bill are the real ones; a walk-in has to become a student first. Nothing seats itself:
 * when a member leaves, the group's `waiting_count` is how the page knows to offer the next name.
 *
 * Multi-step writes run in their own transaction (a refused seat must not leave a half-seated row).
 */
final class GroupWaitlist
{
    public function __construct(private readonly ClassGroups $groups) {}

    /**
     * The WAITING queue in order, with the student's name and phone when the entry is one.
     *
     * @return list<array<string,mixed>>
     */
    public function queue(string $groupId): array
    {
        return DB::table('class_group_waitlist as w')
            ->leftJoin('students as st', 'st.id', '=', 'w.student_id')
            ->leftJoin('guardians as gu', 'gu.id', '=', 'st.guardian_id')
            ->leftJoin('users as u', 'u.id', '=', 'w.added_by')
            ->where('w.group_id', $groupId)->where('w.status', 'WAITING')
            ->orderBy('w.position')->orderBy('w.created_at')
            ->get(['w.*', 'st.full_name as student_name', 'st.whatsapp_phone as student_phone', 'gu.whatsapp_phone as guardian_phone', 'u.full_name as added_by_name'])
            ->map(fn ($w) => $this->present($w))
            ->values()
            ->all();
    }

    /**
     * Append to the end. A student already sitting in the group, or already waiting, is refused.
     *
     * @param  array{student_id?:?string, name?:?string, phone?:?string, note?:?string}  $data
     */
    public function add(object $group, array $data, string $actorUserId, string $actorRole): string
    {
        if ($group->status === 'ARCHIVED') {
            throw ValidationException::withMessages(['group' => ['This group is archived. / هذه المجموعة مؤرشفة.']]);
        }
        $studentId = ! empty($data['student_id']) ? (string) $data['student_id'] : null;
        $name = isset($data['name']) ? trim((string) $data['name']) : '';
        if ($studentId === null && $name === '') {
            throw ValidationException::withMessages(['student_id' => ['Pick a student or enter a name. / اختر طالبًا أو اكتب اسمًا.']]);
        }

        return DB::transaction(function () use ($group, $data, $studentId, $name, $actorUserId, $actorRole): string {
            if ($studentId !== null) {
                if (DB::table('students')->where('id', $studentId)->whereNull('deleted_at')->doesntExist()) {
                    throw ValidationException::withMessages(['student_id' => ['Unknown or removed student. / طالب غير موجود أو تم حذفه.']]);
                }
                $inGroup = DB::table('class_group_members')->where('group_id', $group->id)->where('student_id', $studentId)->where('status', 'ACTIVE')->exists();
                if ($inGroup) {
                    throw ValidationException::withMessages(['student_id' => ['This student is already in the group. / هذا الطالب موجود في المجموعة بالفعل.']]);
                }
                $waiting = DB::table('class_group_waitlist')->where('group_id', $group->id)->where('student_id', $studentId)->where('status', 'WAITING')->exists();
                if ($waiting) {
                    throw ValidationException::withMessages(['student_id' => ['This student is already on the waiting list. / هذا الطالب في قائمة الانتظار بالفعل.']]);
                }
            }

            $position = (int) DB::table('class_group_waitlist')->where('group_id', $group->id)->where('status', 'WAITING')->max('position') + 1;
            $id = (string) Str::uuid();
            DB::table('class_group_waitlist')->insert([
                'id' => $id,
                'academy_id' => (string) $group->academy_id,
                'group_id' => (string) $group->id,
                'student_id' => $studentId,
                'name' => $studentId === null ? $name : ($name !== '' ? $name : null),
                'phone' => isset($data['phone']) && trim((string) $data['phone']) !== '' ? trim((string) $data['phone']) : null,
                'note' => isset($data['note']) && trim((string) $data['note']) !== '' ? trim((string) $data['note']) : null,
                'position' => $position,
                'status' => 'WAITING',
                'added_by' => $actorUserId === Audit::SYSTEM_ACTOR_ID ? null : $actorUserId,
            ]);

            Audit::log('class_group.waitlist_added', 'class_group', (string) $group->id, (string) $group->academy_id, $actorUserId, $actorRole,
                after: ['entry_id' => $id, 'student_id' => $studentId, 'name' => $studentId === null ? $name : null, 'position' => $position]);

            return $id;
        });
    }

    /** Take a name off the list (REMOVED); the rows behind it close up. */
    public function remove(object $group, string $entryId, string $actorUserId, string $actorRole): void
    {
        DB::transaction(function () use ($group, $entryId, $actorUserId, $actorRole): void {
            $entry = $this->waitingEntry($group, $entryId);
            DB::table('class_group_waitlist')->where('id', $entry->id)->update([
                'status' => 'REMOVED',
                'removed_at' => now()->toIso8601String(),
                'updated_at' => now(),
            ]);
            $this->compact((string) $group->id);

            Audit::log('class_group.waitlist_removed', 'class_group', (string) $group->id, (string) $group->academy_id, $actorUserId, $actorRole,
                after: ['entry_id' => (string) $entry->id, 'student_id' => $entry->student_id !== null ? (string) $entry->student_id : null]);
        });
    }

    /**
     * Give the next name its seat: the student joins through the members path (a full group refuses
     * as it does on the members tab) and the entry is SEATED. A walk-in has no student row to seat.
     */
    public function seat(object $group, string $entryId, ?string $joinedOn, string $actorUserId, string $actorRole): void
    {
        DB::transaction(function () use ($group, $entryId, $joinedOn, $actorUserId, $actorRole): void {
            $entry = $this->waitingEntry($group, $entryId);
            if ($entry->student_id === null) {
                throw ValidationException::withMessages(['student_id' => ['Create this person as a student first, then seat them. / أضف هذا الشخص كطالب أولًا ثم أجلسه في المجموعة.']]);
            }
            if ($group->status === 'ARCHIVED') {
                throw ValidationException::withMessages(['group' => ['This group is archived. / هذه المجموعة مؤرشفة.']]);
            }

            $on = $joinedOn !== null ? Carbon::parse($joinedOn)->format('Y-m-d') : ClassGroups::localToday((string) $group->timezone);
            $this->groups->addMembers($group, [(string) $entry->student_id], $on, false, $actorUserId, $actorRole);

            DB::table('class_group_waitlist')->where('id', $entry->id)->update([
                'status' => 'SEATED',
                'seated_at' => now()->toIso8601String(),
                'updated_at' => now(),
            ]);
            $this->compact((string) $group->id);

            Audit::log('class_group.waitlist_seated', 'class_group', (string) $group->id, (string) $group->academy_id, $actorUserId, $actorRole,
                after: ['entry_id' => (string) $entry->id, 'student_id' => (string) $entry->student_id, 'joined_on' => $on]);
        });
    }

    /**
     * Put the queue in the given order — the ids must be exactly the WAITING set, so a stale page
     * cannot silently drop a name.
     *
     * @param  list<string>  $ids
     */
    public function reorder(object $group, array $ids, string $actorUserId, string $actorRole): void
    {
        DB::transaction(function () use ($group, $ids, $actorUserId, $actorRole): void {
            $current = DB::table('class_group_waitlist')->where('group_id', $group->id)->where('status', 'WAITING')
                ->pluck('id')->map(fn ($id) => (string) $id)->all();
            $ids = array_values(array_unique(array_map('strval', $ids)));
            sort($current);
            $sorted = $ids;
            sort($sorted);
            if ($sorted !== $current) {
                throw ValidationException::withMessages(['ids' => ['The list changed — reload and try again. / تغيّرت القائمة — أعد التحميل وحاول مرة أخرى.']]);
            }

            foreach ($ids as $i => $id) {
                DB::table('class_group_waitlist')->where('id', $id)->update(['position' => $i + 1, 'updated_at' => now()]);
            }

            Audit::log('class_group.waitlist_reordered', 'class_group', (string) $group->id, (string) $group->academy_id, $actorUserId, $actorRole,
                after: ['ids' => $ids]);
        });
    }

    /**
     * How many wait at each group's door.
     *
     * @param  list<string>  $groupIds
     * @return array<string,int>
     */
    public function waitingCounts(array $groupIds): array
    {
        if ($groupIds === []) {
            return [];
        }

        return DB::table('class_group_waitlist')
            ->whereIn('group_id', $groupIds)->where('status', 'WAITING')
            ->groupBy('group_id')
            ->selectRaw('group_id, count(*) as n')
            ->pluck('n', 'group_id')
            ->mapWithKeys(fn ($n, $id) => [(string) $id => (int) $n])
            ->all();
    }

    /** Names waiting across the whole academy (the dashboard's number). */
    public function waitingTotal(): int
    {
        return DB::table('class_group_waitlist')->where('status', 'WAITING')->count();
    }

    /** A renewed term keeps its queue: the names move to the successor, in the same order. */
    public function moveQueue(string $fromGroupId, string $toGroupId): int
    {
        return DB::table('class_group_waitlist')
            ->where('group_id', $fromGroupId)->where('status', 'WAITING')
            ->update(['group_id' => $toGroupId, 'updated_at' => now()]);
    }

    /** A closed or promoted term lets its queue go. */
    public function removeQueue(string $groupId): int
    {
        return DB::table('class_group_waitlist')
            ->where('group_id', $groupId)->where('status', 'WAITING')
            ->update(['status' => 'REMOVED', 'removed_at' => now()->toIso8601String(), 'updated_at' => now()]);
    }

    // ── internals ────────────────────────────────────────────────────────────

    private function waitingEntry(object $group, string $entryId): object
    {
        $entry = DB::table('class_group_waitlist')->where('id', $entryId)->where('group_id', $group->id)->where('status', 'WAITING')->lockForUpdate()->first();
        if ($entry === null) {
            abort(404, 'Waiting-list entry not found.');
        }

        return $entry;
    }

    /** Positions 1..n again after a row left the queue. */
    private function compact(string $groupId): void
    {
        $ids = DB::table('class_group_waitlist')->where('group_id', $groupId)->where('status', 'WAITING')
            ->orderBy('position')->orderBy('created_at')->pluck('id');
        foreach ($ids as $i => $id) {
            DB::table('class_group_waitlist')->where('id', $id)->update(['position' => $i + 1]);
        }
    }

    /** @return array<string,mixed> */
    private function present(object $w): array
    {
        $student = $w->student_id !== null;

        return [
            'id' => (string) $w->id,
            'position' => (int) $w->position,
            'student_id' => $student ? (string) $w->student_id : null,
            'name' => $student ? (string) $w->student_name : (string) $w->name,
            'phone' => $w->phone ?? ($student ? ($w->student_phone ?? $w->guardian_phone) : null),
            'note' => $w->note,
            'status' => (string) $w->status,
            'added_by_name' => $w->added_by_name,
            'created_at' => Carbon::parse($w->created_at)->utc()->toIso8601String(),
        ];
    }
}
