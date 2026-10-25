<?php

declare(strict_types=1);

namespace App\Services;

use App\Support\Audit;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Group classes (docs/groups) — the rules that are not HTTP: who a lesson expects, how the sheet is
 * saved and taken back, how members come and go, and how the weekly slots are reconciled.
 *
 * MEMBERSHIP IS A HALF-OPEN DATE RANGE: a member is expected on a lesson whose local date d
 * satisfies `joined_on <= d < left_on` (left_on null = still in). Joining in week 3 never makes a
 * student absent for weeks 1–2; leaving today means today's lessons stop expecting them. Whatever a
 * sheet already recorded stays on that sheet — the roster is "members covering the date" UNION
 * "anyone with a row on it", so history never rewrites itself when membership changes.
 *
 * Runs inside the caller's tenant context; RLS is the backstop.
 *
 * ATOMIC ON ITS OWN: the request's tenant transaction does NOT roll back on a refusal — the router
 * renders a ValidationException into a 422 before it gets back to that transaction, which then
 * commits whatever was already written. So each multi-step write here (a sheet and its money,
 * members and their bills) runs in its own nested, savepoint transaction: a refusal anywhere in it
 * undoes all of it.
 */
final class ClassGroups
{
    public function __construct(
        private readonly GroupBilling $billing,
        private readonly GroupPayroll $payroll,
    ) {}

    public const ATTENDANCE_STATUSES = ['PRESENT', 'LATE', 'ABSENT', 'EXCUSED'];

    /** Counted as "came" in every attendance rate. */
    public const ATTENDED_STATUSES = ['PRESENT', 'LATE'];

    /** Today's date in the group's own calendar. */
    public static function localToday(string $timezone): string
    {
        return Carbon::now($timezone)->format('Y-m-d');
    }

    /**
     * UPCOMING / RUNNING / FINISHED / ARCHIVED — derived, never stored (only ARCHIVED is).
     */
    public static function state(object $group): string
    {
        if ($group->status === 'ARCHIVED') {
            return 'ARCHIVED';
        }

        $today = self::localToday((string) $group->timezone);
        $start = Carbon::parse($group->start_date)->format('Y-m-d');
        if ($start > $today) {
            return 'UPCOMING';
        }
        if ($group->end_date !== null && Carbon::parse($group->end_date)->format('Y-m-d') < $today) {
            return 'FINISHED';
        }

        return 'RUNNING';
    }

    // ── Slots ────────────────────────────────────────────────────────────────

    /**
     * Reconcile the weekly slots to `$desired`, keyed by (weekday, start time). A kept slot keeps
     * its id, so its generated lessons stay matched. A removed slot first loses its FUTURE
     * UNTOUCHED lessons — after the row is gone they would carry slot_id = null and the generator
     * could no longer recognise them as its own — then the row; its past and touched lessons are
     * detached by the FK (on delete set null) and stay exactly as they were.
     *
     * @param  list<array{weekday:int, start_time_local:string, duration_minutes:int}>  $desired
     */
    public function reconcileSlots(string $academyId, string $groupId, array $desired): void
    {
        $key = fn ($weekday, $time): string => $weekday.'|'.substr((string) $time, 0, 5);

        $desiredByKey = [];
        foreach ($desired as $slot) {
            $desiredByKey[$key($slot['weekday'], $slot['start_time_local'])] = $slot;
        }

        $currentByKey = [];
        foreach (DB::table('class_group_slots')->where('group_id', $groupId)->get() as $slot) {
            $currentByKey[$key($slot->weekday, $slot->start_time_local)] = $slot;
        }

        foreach ($currentByKey as $k => $slot) {
            if (isset($desiredByKey[$k])) {
                continue;
            }

            DB::table('class_group_lessons')
                ->where('slot_id', $slot->id)
                ->where('status', 'SCHEDULED')
                ->whereNull('moved_at')
                ->where('scheduled_at_utc', '>=', now()->utc()->format('Y-m-d H:i:sP'))
                ->whereNotExists(function ($q): void {
                    $q->select(DB::raw(1))
                        ->from('class_group_attendance as a')
                        ->whereColumn('a.lesson_id', 'class_group_lessons.id');
                })
                ->delete();

            DB::table('class_group_slots')->where('id', $slot->id)->delete();
        }

        foreach ($desiredByKey as $k => $slot) {
            if (isset($currentByKey[$k])) {
                if ((int) $currentByKey[$k]->duration_minutes !== (int) $slot['duration_minutes']) {
                    DB::table('class_group_slots')->where('id', $currentByKey[$k]->id)->update([
                        'duration_minutes' => $slot['duration_minutes'],
                        'updated_at' => now(),
                    ]);
                }

                continue;
            }

            DB::table('class_group_slots')->insert([
                'id' => (string) Str::uuid(),
                'academy_id' => $academyId,
                'group_id' => $groupId,
                'weekday' => $slot['weekday'],
                'start_time_local' => substr_count($slot['start_time_local'], ':') === 1
                    ? $slot['start_time_local'].':00'
                    : $slot['start_time_local'],
                'duration_minutes' => $slot['duration_minutes'],
            ]);
        }
    }

    /** @return list<array{weekday:int, start_time_local:string, duration_minutes:int}> */
    public function slotsOf(string $groupId): array
    {
        return DB::table('class_group_slots')
            ->where('group_id', $groupId)
            ->orderBy('weekday')->orderBy('start_time_local')
            ->get(['weekday', 'start_time_local', 'duration_minutes'])
            ->map(fn ($s) => [
                'weekday' => (int) $s->weekday,
                'start_time_local' => substr((string) $s->start_time_local, 0, 5),
                'duration_minutes' => (int) $s->duration_minutes,
            ])->all();
    }

    // ── Members ──────────────────────────────────────────────────────────────

    public function activeMemberCount(string $groupId): int
    {
        return DB::table('class_group_members')->where('group_id', $groupId)->where('status', 'ACTIVE')->count();
    }

    /**
     * Add students to a group from `$joinedOn`. Refuses a student already in it, a removed student,
     * and — unless `$allowOverCapacity` — more students than seats left.
     *
     * @param  list<string>  $studentIds
     * @return list<string> the ids added
     */
    public function addMembers(object $group, array $studentIds, string $joinedOn, bool $allowOverCapacity, string $actorUserId, string $actorRole, ?string $movedFromGroup = null): array
    {
        return DB::transaction(fn (): array => $this->insertMembers($group, $studentIds, $joinedOn, $allowOverCapacity, $actorUserId, $actorRole, $movedFromGroup));
    }

    /** @return list<string> */
    private function insertMembers(object $group, array $studentIds, string $joinedOn, bool $allowOverCapacity, string $actorUserId, string $actorRole, ?string $movedFromGroup): array
    {
        $studentIds = array_values(array_unique($studentIds));
        if ($studentIds === []) {
            return [];
        }

        $live = DB::table('students')->whereIn('id', $studentIds)->whereNull('deleted_at')->pluck('id')->map(fn ($id) => (string) $id)->all();
        $missing = array_values(array_diff($studentIds, $live));
        if ($missing !== []) {
            throw ValidationException::withMessages([
                'student_ids' => ['Unknown or removed student. / طالب غير موجود أو تم حذفه.'],
            ]);
        }

        $already = DB::table('class_group_members')
            ->where('group_id', $group->id)->where('status', 'ACTIVE')
            ->whereIn('student_id', $studentIds)
            ->pluck('student_id')->map(fn ($id) => (string) $id)->all();
        if ($already !== []) {
            throw ValidationException::withMessages([
                'student_ids' => ['This student is already in the group. / هذا الطالب موجود في المجموعة بالفعل.'],
            ]);
        }

        if ($group->capacity !== null && ! $allowOverCapacity) {
            $after = $this->activeMemberCount((string) $group->id) + count($studentIds);
            if ($after > (int) $group->capacity) {
                throw ValidationException::withMessages([
                    'student_ids' => ['The group is full ('.$group->capacity.' seats). / المجموعة مكتملة ('.$group->capacity.' مقاعد).'],
                ]);
            }
        }

        if (Carbon::parse($joinedOn)->format('Y-m-d') < Carbon::parse($group->start_date)->format('Y-m-d')) {
            $joinedOn = Carbon::parse($group->start_date)->format('Y-m-d');
        }

        foreach ($studentIds as $studentId) {
            DB::table('class_group_members')->insert([
                'id' => (string) Str::uuid(),
                'academy_id' => (string) $group->academy_id,
                'group_id' => (string) $group->id,
                'student_id' => $studentId,
                'joined_on' => $joinedOn,
                'status' => 'ACTIVE',
                'added_by' => $this->userOrNull($actorUserId),
            ]);
        }

        Audit::log('class_group.members_added', 'class_group', (string) $group->id, (string) $group->academy_id, $actorUserId, $actorRole,
            after: ['student_ids' => $studentIds, 'joined_on' => $joinedOn]);

        // Joining is what a MONTHLY or COURSE group bills on (a moved member already paid this month
        // in the group they came from). Read fresh: the caller's copy may predate a price edit.
        $this->billing->onMembersAdded(DB::table('class_groups')->where('id', $group->id)->first(), $studentIds, $movedFromGroup);

        return $studentIds;
    }

    /**
     * Close a student's open membership on `$leftOn` (they are no longer expected from that date).
     * A leave dated before they joined is clamped to the join date — they were simply never in.
     */
    public function removeMember(object $group, string $studentId, string $leftOn, ?string $reason, string $actorUserId, string $actorRole): void
    {
        $member = DB::table('class_group_members')
            ->where('group_id', $group->id)->where('student_id', $studentId)->where('status', 'ACTIVE')
            ->first();
        if ($member === null) {
            abort(404, 'This student is not in the group.');
        }

        $joined = Carbon::parse($member->joined_on)->format('Y-m-d');
        $leftOn = max($joined, Carbon::parse($leftOn)->format('Y-m-d'));

        DB::table('class_group_members')->where('id', $member->id)->update([
            'status' => 'LEFT',
            'left_on' => $leftOn,
            'left_reason' => $reason,
            'updated_at' => now(),
        ]);

        Audit::log('class_group.member_left', 'class_group', (string) $group->id, (string) $group->academy_id, $actorUserId, $actorRole,
            after: ['student_id' => $studentId, 'left_on' => $leftOn, 'reason' => $reason]);
    }

    /**
     * Correct the day an open membership started. Only while the group has held nothing since the
     * earlier of the two dates, so no saved sheet, attendance or per-lesson charge rests on it. An
     * earlier date bills what the wider range now owes (joining's own rule, idempotent); a charge
     * already raised keeps its amount — money is never rewritten.
     */
    public function changeJoinDate(object $group, string $studentId, string $joinedOn, string $actorUserId, string $actorRole): void
    {
        $member = DB::table('class_group_members')
            ->where('group_id', $group->id)->where('student_id', $studentId)->where('status', 'ACTIVE')
            ->first();
        if ($member === null) {
            abort(404, 'This student is not in the group.');
        }

        $old = Carbon::parse($member->joined_on)->format('Y-m-d');
        $new = max(Carbon::parse($joinedOn)->format('Y-m-d'), Carbon::parse($group->start_date)->format('Y-m-d'));
        if ($new === $old) {
            return;
        }

        $since = min($old, $new);
        $held = DB::table('class_group_lessons')
            ->where('group_id', $group->id)->where('status', 'HELD')
            ->where('occurrence_local_date', '>=', $since)
            ->exists();
        if ($held) {
            throw ValidationException::withMessages([
                'joined_on' => ["A lesson was already held since {$since}, so the join date can no longer change. / عُقدت حصة بالفعل منذ {$since}، لذلك لا يمكن تغيير تاريخ الانضمام."],
            ]);
        }

        // A member moved here already paid the month in the group they left (the move dates both
        // halves the same day); the correction must not bill it a second time.
        $movedFrom = DB::table('class_group_members')
            ->where('student_id', $studentId)->where('group_id', '!=', $group->id)
            ->where('status', 'LEFT')->where('left_on', $old)
            ->where('left_reason', 'like', 'Moved to %')
            ->value('group_id');

        DB::table('class_group_members')->where('id', $member->id)->update([
            'joined_on' => $new,
            'updated_at' => now(),
        ]);

        Audit::log('class_group.member_join_date_changed', 'class_group', (string) $group->id, (string) $group->academy_id, $actorUserId, $actorRole,
            after: ['student_id' => $studentId, 'joined_on' => $new],
            before: ['joined_on' => $old]);

        $this->billing->onJoinDateChanged(DB::table('class_groups')->where('id', $group->id)->first(), $studentId, $movedFrom !== null ? (string) $movedFrom : null);
    }

    /**
     * A student leaving the academy leaves every group they are in, from today (each group's own
     * calendar). Part of the student wind-down, so a removed student is never "expected" again.
     */
    public function leaveAllFor(string $studentId, string $reason): int
    {
        $rows = DB::table('class_group_members as m')
            ->join('class_groups as g', 'g.id', '=', 'm.group_id')
            ->where('m.student_id', $studentId)
            ->where('m.status', 'ACTIVE')
            ->get(['m.id', 'm.joined_on', 'g.timezone']);

        foreach ($rows as $row) {
            $today = self::localToday((string) $row->timezone);
            DB::table('class_group_members')->where('id', $row->id)->update([
                'status' => 'LEFT',
                'left_on' => max(Carbon::parse($row->joined_on)->format('Y-m-d'), $today),
                'left_reason' => $reason,
                'updated_at' => now(),
            ]);
        }

        return $rows->count();
    }

    // ── The sheet ────────────────────────────────────────────────────────────

    /**
     * Who the lesson expects, with what the sheet says about each of them (status null = not
     * marked yet). Members covering the lesson's date, plus anyone already on its sheet.
     *
     * @return Collection<int, object{student_id:string, full_name:string, status:?string, note:?string, member:bool}>
     */
    public function roster(object $lesson): Collection
    {
        $date = Carbon::parse($lesson->occurrence_local_date)->format('Y-m-d');

        $members = DB::table('class_group_members as m')
            ->join('students as st', 'st.id', '=', 'm.student_id')
            ->where('m.group_id', $lesson->group_id)
            ->where('m.joined_on', '<=', $date)
            ->where(fn ($q) => $q->whereNull('m.left_on')->orWhere('m.left_on', '>', $date))
            ->whereNull('st.deleted_at')
            ->get(['m.student_id', 'st.full_name']);

        $marked = DB::table('class_group_attendance as a')
            ->join('students as st', 'st.id', '=', 'a.student_id')
            ->where('a.lesson_id', $lesson->id)
            ->get(['a.student_id', 'st.full_name', 'a.status', 'a.note'])
            ->keyBy(fn ($r) => (string) $r->student_id);

        $roster = [];
        foreach ($members as $m) {
            $row = $marked->get((string) $m->student_id);
            $roster[(string) $m->student_id] = (object) [
                'student_id' => (string) $m->student_id,
                'full_name' => (string) $m->full_name,
                'status' => $row?->status,
                'note' => $row?->note,
                'member' => true,
            ];
        }
        foreach ($marked as $id => $row) {
            if (! isset($roster[$id])) {
                $roster[$id] = (object) [
                    'student_id' => $id,
                    'full_name' => (string) $row->full_name,
                    'status' => (string) $row->status,
                    'note' => $row->note,
                    'member' => false,
                ];
            }
        }

        return collect(array_values($roster))->sortBy('full_name', SORT_NATURAL | SORT_FLAG_CASE)->values();
    }

    /**
     * Save the sheet and mark the lesson HELD. Everyone the lesson expects who is not in
     * `$entries` is PRESENT — the "all present, tap the exceptions" default the sheet is built on.
     * Re-saving edits the sheet in place (Phase 1 carries no money, so nothing is frozen yet).
     *
     * @param  list<array{student_id:string, status:string, note?:?string}>  $entries
     * @param  array{topic?:?string, homework?:?string, notes?:?string}  $extras
     */
    public function saveAttendance(object $lesson, array $entries, array $extras, string $actorUserId, string $actorRole): void
    {
        DB::transaction(fn () => $this->recordSheet($lesson, $entries, $extras, $actorUserId, $actorRole));
    }

    /**
     * @param  list<array{student_id:string, status:string, note?:?string}>  $entries
     * @param  array{topic?:?string, homework?:?string, notes?:?string}  $extras
     */
    private function recordSheet(object $lesson, array $entries, array $extras, string $actorUserId, string $actorRole): void
    {
        if ($lesson->status === 'CANCELLED') {
            throw ValidationException::withMessages([
                'status' => ['This lesson was cancelled; undo the cancellation first. / هذه الحصة ملغاة؛ تراجع عن الإلغاء أولاً.'],
            ]);
        }

        $roster = $this->roster($lesson)->keyBy('student_id');
        $byStudent = [];
        foreach ($entries as $entry) {
            $id = (string) $entry['student_id'];
            if (! $roster->has($id)) {
                throw ValidationException::withMessages([
                    'entries' => ['A student on the sheet is not in this group on that date. / أحد الطلاب ليس في المجموعة في هذا التاريخ.'],
                ]);
            }
            $byStudent[$id] = $entry;
        }

        $actor = $this->userOrNull($actorUserId);
        $now = now();
        $counts = array_fill_keys(self::ATTENDANCE_STATUSES, 0);

        foreach ($roster as $id => $row) {
            $status = (string) ($byStudent[$id]['status'] ?? 'PRESENT');
            $note = $byStudent[$id]['note'] ?? null;
            $counts[$status]++;

            DB::table('class_group_attendance')->upsert(
                [[
                    'id' => (string) Str::uuid(),
                    'academy_id' => (string) $lesson->academy_id,
                    'lesson_id' => (string) $lesson->id,
                    'group_id' => (string) $lesson->group_id,
                    'student_id' => $id,
                    'status' => $status,
                    'note' => $note,
                    'marked_by' => $actor,
                    'marked_at' => $now->toIso8601String(),
                    'updated_at' => $now,
                ]],
                ['lesson_id', 'student_id'],
                ['status', 'note', 'marked_by', 'marked_at', 'updated_at'],
            );
        }

        $wasHeld = $lesson->status === 'HELD';

        DB::table('class_group_lessons')->where('id', $lesson->id)->update([
            'status' => 'HELD',
            'cancel_reason' => null,
            'topic' => array_key_exists('topic', $extras) ? $extras['topic'] : $lesson->topic,
            'homework' => array_key_exists('homework', $extras) ? $extras['homework'] : $lesson->homework,
            'notes' => array_key_exists('notes', $extras) ? $extras['notes'] : $lesson->notes,
            // An explicit offset: bound naked this instant lands in the Postgres session's zone.
            'outcome_set_at' => $now->toIso8601String(),
            'outcome_set_by' => $actor,
            'updated_at' => $now,
        ]);

        // The money follows the sheet (docs/groups §Money): who is charged for this lesson, and the
        // teacher's one line for it. Either may refuse (a closed invoice, a finalized statement) —
        // the savepoint around this method undoes the sheet with it, so the two never disagree.
        $this->syncMoney($lesson->id);

        Audit::log($wasHeld ? 'class_group_lesson.attendance_updated' : 'class_group_lesson.attendance_saved',
            'class_group_lesson', (string) $lesson->id, (string) $lesson->academy_id, $actorUserId, $actorRole,
            after: ['counts' => $counts, 'group_id' => (string) $lesson->group_id],
            before: ['status' => $lesson->status]);
    }

    /** Put a held or cancelled lesson back to SCHEDULED and clear its sheet. */
    public function revert(object $lesson, string $actorUserId, string $actorRole): void
    {
        DB::transaction(fn () => $this->undoSheet($lesson, $actorUserId, $actorRole));
    }

    private function undoSheet(object $lesson, string $actorUserId, string $actorRole): void
    {
        if ($lesson->status === 'SCHEDULED') {
            throw ValidationException::withMessages([
                'status' => ['This lesson is already pending — there is nothing to undo. / هذه الحصة معلّقة بالفعل، لا يوجد ما يمكن التراجع عنه.'],
            ]);
        }

        $cleared = DB::table('class_group_attendance')->where('lesson_id', $lesson->id)->delete();

        DB::table('class_group_lessons')->where('id', $lesson->id)->update([
            'status' => 'SCHEDULED',
            'cancel_reason' => null,
            'outcome_set_at' => null,
            'outcome_set_by' => null,
            'updated_at' => now(),
        ]);

        $this->syncMoney($lesson->id);

        Audit::log('class_group_lesson.reverted', 'class_group_lesson', (string) $lesson->id, (string) $lesson->academy_id, $actorUserId, $actorRole,
            after: ['status' => 'SCHEDULED', 'cleared_rows' => $cleared],
            before: ['status' => $lesson->status, 'cancel_reason' => $lesson->cancel_reason]);
    }

    /** Cancel one lesson for the whole class. Only a pending lesson; a held one is reverted first. */
    public function cancel(object $lesson, ?string $reason, string $actorUserId, string $actorRole): void
    {
        if ($lesson->status !== 'SCHEDULED') {
            throw ValidationException::withMessages([
                'status' => ['Only a pending lesson can be cancelled; undo its attendance first. / يمكن إلغاء الحصة المعلّقة فقط؛ تراجع عن الحضور أولاً.'],
            ]);
        }

        DB::table('class_group_lessons')->where('id', $lesson->id)->update([
            'status' => 'CANCELLED',
            'cancel_reason' => $reason,
            'outcome_set_at' => now()->toIso8601String(),
            'outcome_set_by' => $this->userOrNull($actorUserId),
            'updated_at' => now(),
        ]);

        Audit::log('class_group_lesson.cancelled', 'class_group_lesson', (string) $lesson->id, (string) $lesson->academy_id, $actorUserId, $actorRole,
            after: ['status' => 'CANCELLED', 'reason' => $reason]);
    }

    /** Re-read the lesson and bring its charges and its payout line in line with it. */
    private function syncMoney(string $lessonId): void
    {
        $fresh = DB::table('class_group_lessons')->where('id', $lessonId)->first();
        if ($fresh === null) {
            return;
        }

        $this->billing->syncLessonCharges($fresh);
        $this->payroll->syncLessonPay($fresh);
    }

    // ── Numbers ──────────────────────────────────────────────────────────────

    /**
     * Per-group lesson counters, for every group id given, in one query.
     *
     * @param  list<string>  $groupIds
     * @return array<string, array{held:int, cancelled:int, upcoming:int, overdue:int, next_lesson_at:?string}>
     */
    public function lessonCounters(array $groupIds): array
    {
        if ($groupIds === []) {
            return [];
        }

        $now = now()->utc()->format('Y-m-d H:i:sP');
        $rows = DB::table('class_group_lessons')
            ->whereIn('group_id', $groupIds)
            ->groupBy('group_id')
            ->selectRaw("group_id,
                count(*) filter (where status = 'HELD') as held,
                count(*) filter (where status = 'CANCELLED') as cancelled,
                count(*) filter (where status = 'SCHEDULED' and scheduled_at_utc >= ?) as upcoming,
                count(*) filter (where status = 'SCHEDULED' and scheduled_at_utc < ?) as overdue,
                min(scheduled_at_utc) filter (where status = 'SCHEDULED' and scheduled_at_utc >= ?) as next_lesson_at", [$now, $now, $now])
            ->get();

        $out = [];
        foreach ($rows as $r) {
            $out[(string) $r->group_id] = [
                'held' => (int) $r->held,
                'cancelled' => (int) $r->cancelled,
                'upcoming' => (int) $r->upcoming,
                'overdue' => (int) $r->overdue,
                'next_lesson_at' => $r->next_lesson_at !== null ? Carbon::parse($r->next_lesson_at)->utc()->toIso8601String() : null,
            ];
        }

        return $out;
    }

    /**
     * Each student's attendance over the group's held lessons.
     *
     * @return array<string, array{present:int, late:int, absent:int, excused:int, marked:int, rate:?float}>
     */
    public function memberAttendance(string $groupId): array
    {
        $rows = DB::table('class_group_attendance as a')
            ->join('class_group_lessons as l', 'l.id', '=', 'a.lesson_id')
            ->where('a.group_id', $groupId)
            ->where('l.status', 'HELD')
            ->groupBy('a.student_id')
            ->selectRaw("a.student_id,
                count(*) filter (where a.status = 'PRESENT') as present,
                count(*) filter (where a.status = 'LATE') as late,
                count(*) filter (where a.status = 'ABSENT') as absent,
                count(*) filter (where a.status = 'EXCUSED') as excused,
                count(*) as marked")
            ->get();

        $out = [];
        foreach ($rows as $r) {
            $marked = (int) $r->marked;
            $came = (int) $r->present + (int) $r->late;
            $out[(string) $r->student_id] = [
                'present' => (int) $r->present,
                'late' => (int) $r->late,
                'absent' => (int) $r->absent,
                'excused' => (int) $r->excused,
                'marked' => $marked,
                'rate' => $marked > 0 ? round($came / $marked, 4) : null,
            ];
        }

        return $out;
    }

    /** The system actor is not a `users` row; writing it into an FK column would fail. */
    private function userOrNull(string $userId): ?string
    {
        return $userId === Audit::SYSTEM_ACTOR_ID ? null : $userId;
    }
}
