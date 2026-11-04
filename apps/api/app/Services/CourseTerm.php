<?php

declare(strict_types=1);

namespace App\Services;

use App\Support\Audit;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * A group as a course term (docs/centre-profile, Phase 2 §2): how far the term has run against
 * the lessons it promised, the "this course is ending" signal, and the three things a centre does
 * when a term ends — RENEW it for a new term, PROMOTE its students to the next level, or CLOSE it.
 *
 * The successor of a renewal or a promotion is a new `class_groups` row that carries everything
 * the old one was (name, level, teacher, weekly times, seats, room, how it bills and pays) and
 * points back through `continues_group_id`; the old one is archived with a `closed_reason`. The
 * people move through the SAME calls the members tab uses — {@see ClassGroups::addMembers} and
 * {@see ClassGroups::removeMember}, and a promotion through {@see StudentLevels::promote} — so the
 * billing that comes with joining, the seat limit and the level history are the real ones, never a
 * copy. Each lifecycle step is ONE transaction: a refused seat anywhere undoes the whole thing.
 *
 * The progress numbers are data-driven: a group with no `lessons_planned` and no `end_date` reads
 * null / false, so a Quran academy's group payload only gains nullable keys and nothing else.
 */
final class CourseTerm
{
    /** A term is "ending soon" within this many days of its end date … */
    public const ENDING_SOON_DAYS = 14;

    /** … or with this many planned lessons (or fewer) still to hold. */
    public const ENDING_SOON_LESSONS = 2;

    public const RENEWED = 'RENEWED';

    public const PROMOTED = 'PROMOTED';

    public const CLOSED = 'CLOSED';

    /** What a successor copies from the term it continues — everything but the dates and the plan. */
    private const INHERITED = [
        'specialization_id', 'level', 'level_id', 'teacher_id', 'capacity', 'mode', 'location', 'meeting_url',
        'timezone', 'notes', 'billing_mode', 'price_minor', 'currency', 'charge_absent', 'prorate_join',
        'month_minutes', 'solo_billed_minutes', 'teacher_pay_mode', 'teacher_pay_minor', 'teacher_share_bp',
    ];

    public function __construct(
        private readonly ClassGroups $groups,
        private readonly GroupLessonGenerator $generator,
        private readonly StudentLevels $levels,
        private readonly GroupWaitlist $waitlist,
    ) {}

    // ── The payload ──────────────────────────────────────────────────────────

    /**
     * The term's keys on a group payload. `$held` is the group's HELD count (the caller already has
     * it from the lesson counters); `$extra` is this group's slice of {@see extrasFor}.
     *
     * @return array<string,mixed>
     */
    public static function progress(object $g, string $state, int $held, array $extra = []): array
    {
        $planned = $g->lessons_planned !== null ? (int) $g->lessons_planned : null;
        $remaining = $planned !== null ? max(0, $planned - $held) : null;
        $endsIn = null;
        if ($g->end_date !== null) {
            $today = Carbon::parse(ClassGroups::localToday((string) $g->timezone));
            $endsIn = (int) $today->diffInDays(Carbon::parse($g->end_date)->startOfDay(), false);
        }

        return [
            'lessons_planned' => $planned,
            'lessons_held' => $held,
            'lessons_remaining' => $remaining,
            'ends_in_days' => $endsIn,
            'ending_soon' => self::isEndingSoon($state, $endsIn, $remaining),
            'waiting_count' => (int) ($extra['waiting_count'] ?? 0),
            'continues_group_id' => $g->continues_group_id !== null ? (string) $g->continues_group_id : null,
            'continues_group_name' => $extra['continues_group_name'] ?? null,
            'closed_reason' => $g->closed_reason ?? null,
        ];
    }

    /** Only a RUNNING term ends soon: one that has not started is not ending, one that ended has. */
    public static function isEndingSoon(string $state, ?int $endsInDays, ?int $lessonsRemaining): bool
    {
        if ($state !== 'RUNNING') {
            return false;
        }

        return ($endsInDays !== null && $endsInDays >= 0 && $endsInDays <= self::ENDING_SOON_DAYS)
            || ($lessonsRemaining !== null && $lessonsRemaining <= self::ENDING_SOON_LESSONS);
    }

    /**
     * Per group, in two queries: how many are WAITING at its door, and the name of the term it
     * continues.
     *
     * @param  list<string>  $groupIds
     * @return array<string, array{waiting_count:int, continues_group_name:?string}>
     */
    public function extrasFor(array $groupIds): array
    {
        if ($groupIds === []) {
            return [];
        }

        $out = array_fill_keys($groupIds, ['waiting_count' => 0, 'continues_group_name' => null]);
        foreach ($this->waitlist->waitingCounts($groupIds) as $id => $n) {
            $out[$id]['waiting_count'] = $n;
        }

        $rows = DB::table('class_groups as g')
            ->join('class_groups as p', 'p.id', '=', 'g.continues_group_id')
            ->whereIn('g.id', $groupIds)
            ->get(['g.id', 'p.name']);
        foreach ($rows as $r) {
            $out[(string) $r->id]['continues_group_name'] = (string) $r->name;
        }

        return $out;
    }

    /**
     * The centre dashboard's two numbers: terms ending soon (the same rule as the payload, applied
     * to every running group) and names waiting across all groups.
     *
     * @return array{ending_soon:int, waiting:int}
     */
    public function dashboardCounts(): array
    {
        $groups = DB::table('class_groups')->where('status', 'ACTIVE')->get();
        $held = $this->groups->lessonCounters($groups->pluck('id')->map(fn ($id) => (string) $id)->all());

        $endingSoon = 0;
        foreach ($groups as $g) {
            $state = ClassGroups::state($g);
            $p = self::progress($g, $state, $held[(string) $g->id]['held'] ?? 0);
            if ($p['ending_soon']) {
                $endingSoon++;
            }
        }

        return [
            'ending_soon' => $endingSoon,
            'waiting' => $this->waitlist->waitingTotal(),
        ];
    }

    // ── The lifecycle ────────────────────────────────────────────────────────

    /**
     * Renew: a new term of the same course from `start_date`, with the chosen members (all of
     * them with `keep_members`) joining on that day, and the old term archived RENEWED. The
     * waiting list follows the course to the new term — those names wait for "English A2 Sat/Tue",
     * which carries on.
     *
     * @param  array{start_date:string, end_date?:?string, lessons_planned?:?int, price_minor?:?int, name?:?string, keep_members?:bool, member_ids?:list<string>}  $data
     * @return string the successor's id
     */
    public function renew(object $group, array $data, string $actorUserId, string $actorRole): string
    {
        $this->assertCanEnd($group);
        $memberIds = $this->chosenMembers($group, (bool) ($data['keep_members'] ?? false), $data['member_ids'] ?? []);

        return DB::transaction(function () use ($group, $data, $memberIds, $actorUserId, $actorRole): string {
            $newId = $this->createSuccessor($group, $data, [], $actorUserId, $actorRole);
            $new = DB::table('class_groups')->where('id', $newId)->first();

            // Leave the old term first, join the new one from its first day. A MONTHLY course whose
            // new term starts in a month already paid in the old one is not billed for it twice.
            $leftOn = $this->leaveDate($group);
            foreach ($this->activeMemberIds($group) as $studentId) {
                $this->groups->removeMember($group, $studentId, $leftOn, 'Renewed into '.$new->name, $actorUserId, $actorRole);
            }
            if ($memberIds !== []) {
                $this->groups->addMembers($new, $memberIds, (string) $data['start_date'], false, $actorUserId, $actorRole, movedFromGroup: (string) $group->id);
            }

            $this->waitlist->moveQueue((string) $group->id, $newId);
            $this->archiveAs($group, self::RENEWED, $actorUserId, $actorRole, ['successor_id' => $newId, 'members' => count($memberIds)]);

            return $newId;
        });
    }

    /**
     * Promote: the students who passed move up a level — each through the single-student
     * promotion, so their level, history line and seat are written exactly as there — into a new
     * term at that level; the rest leave the old term and keep their level. The old term is
     * archived PROMOTED and its waiting list let go (those names waited for the OLD level).
     *
     * @param  array{to_level_id?:?string, start_date:string, end_date?:?string, lessons_planned?:?int, price_minor?:?int, name?:?string, member_ids:list<string>}  $data
     * @return array{group_id:string, to_level_id:string, promoted:list<string>, not_promoted:list<array{student_id:string, full_name:string}>}
     */
    public function promote(object $group, array $data, string $actorUserId, string $actorRole): array
    {
        $this->assertCanEnd($group);
        $toLevelId = $data['to_level_id'] ?? $this->nextLevelId($group);
        if ($toLevelId === null) {
            throw ValidationException::withMessages(['to_level_id' => ['Choose the level to promote to — this group\'s level has no next one. / اختر المستوى الجديد — لا يوجد مستوى بعد مستوى هذه المجموعة.']]);
        }
        $this->levels->assertUsable($toLevelId, 'to_level_id');
        $memberIds = $this->chosenMembers($group, false, $data['member_ids'] ?? []);

        return DB::transaction(function () use ($group, $data, $toLevelId, $memberIds, $actorUserId, $actorRole): array {
            $newId = $this->createSuccessor($group, $data, ['level_id' => $toLevelId, 'level' => $this->levels->nameOf($toLevelId)], $actorUserId, $actorRole);
            $new = DB::table('class_groups')->where('id', $newId)->first();

            $leftOn = $this->leaveDate($group);
            $notPromoted = [];
            foreach ($this->activeMembers($group) as $m) {
                $studentId = (string) $m->student_id;
                if (in_array($studentId, $memberIds, true)) {
                    // The seam leaves the old level's group itself when it can tell which one that is;
                    // a student it could not place (no level, several groups) is taken out below.
                    $student = DB::table('students')->where('id', $studentId)->first();
                    $this->levels->promote($student, [
                        'to_level_id' => $toLevelId,
                        'to_group_id' => $newId,
                        'effective_on' => (string) $data['start_date'],
                        'note' => 'Promoted with '.$group->name,
                    ], $actorUserId, $actorRole);
                    if ($this->isActiveMember($group, $studentId)) {
                        $this->groups->removeMember($group, $studentId, $leftOn, 'Promoted to '.$new->name, $actorUserId, $actorRole);
                    }
                    // The seam dates the leave on the promotion day (the new start); a term that had
                    // already ended lost its members the day it ended, like everyone else leaving here.
                    DB::table('class_group_members')->where('group_id', $group->id)->where('student_id', $studentId)
                        ->where('status', 'LEFT')->where('left_on', '>', $leftOn)->update(['left_on' => $leftOn, 'updated_at' => now()]);

                    continue;
                }

                $this->groups->removeMember($group, $studentId, $leftOn, 'Course ended', $actorUserId, $actorRole);
                $notPromoted[] = ['student_id' => $studentId, 'full_name' => (string) $m->full_name];
            }

            $this->waitlist->removeQueue((string) $group->id);
            $this->archiveAs($group, self::PROMOTED, $actorUserId, $actorRole, [
                'successor_id' => $newId, 'to_level_id' => $toLevelId, 'promoted' => count($memberIds), 'not_promoted' => count($notPromoted),
            ]);

            return ['group_id' => $newId, 'to_level_id' => $toLevelId, 'promoted' => $memberIds, 'not_promoted' => $notPromoted];
        });
    }

    /** Close: the course ended for good. Everyone leaves, the queue is let go, the term is archived CLOSED. */
    public function close(object $group, ?string $reason, string $actorUserId, string $actorRole): void
    {
        $this->assertCanEnd($group);

        DB::transaction(function () use ($group, $reason, $actorUserId, $actorRole): void {
            $leftOn = $this->leaveDate($group);
            foreach ($this->activeMemberIds($group) as $studentId) {
                $this->groups->removeMember($group, $studentId, $leftOn, 'Course closed', $actorUserId, $actorRole);
            }
            $this->waitlist->removeQueue((string) $group->id);
            $this->archiveAs($group, self::CLOSED, $actorUserId, $actorRole, ['reason' => $reason]);
        });
    }

    /** The level after the group's own, by the academy's order — null when it has none or is last. */
    public function nextLevelId(object $group): ?string
    {
        if ($group->level_id === null) {
            return null;
        }
        $current = DB::table('academy_levels')->where('id', $group->level_id)->first(['sort_order', 'id']);
        if ($current === null) {
            return null;
        }
        $next = DB::table('academy_levels')
            ->where('is_active', true)
            ->where(fn ($q) => $q->where('sort_order', '>', $current->sort_order)
                ->orWhere(fn ($t) => $t->where('sort_order', $current->sort_order)->where('id', '>', $current->id)))
            ->orderBy('sort_order')->orderBy('id')
            ->value('id');

        return $next !== null ? (string) $next : null;
    }

    // ── internals ────────────────────────────────────────────────────────────

    /** Only a term that is running or has finished can end; an archived one already has. */
    private function assertCanEnd(object $group): void
    {
        $state = ClassGroups::state($group);
        if (! in_array($state, ['RUNNING', 'FINISHED'], true)) {
            throw ValidationException::withMessages(['group' => [match ($state) {
                'ARCHIVED' => 'This group is already archived. / هذه المجموعة مؤرشفة بالفعل.',
                default => 'This course has not started yet. / هذا الكورس لم يبدأ بعد.',
            }]]);
        }
    }

    /**
     * The new term's row: everything inherited, the given dates, plan, price and name, and the link
     * back. Its weekly times are copied and its lessons generated from the start date.
     *
     * @param  array<string,mixed>  $data
     * @param  array<string,mixed>  $override  what the successor does differently (a promotion's level)
     */
    private function createSuccessor(object $group, array $data, array $override, string $actorUserId, string $actorRole): string
    {
        $start = Carbon::parse((string) $data['start_date'])->format('Y-m-d');
        $end = ! empty($data['end_date']) ? Carbon::parse((string) $data['end_date'])->format('Y-m-d') : null;
        if ($end !== null && $end < $start) {
            throw ValidationException::withMessages(['end_date' => ['The end date must be on or after the start date. / يجب أن يكون تاريخ الانتهاء بعد تاريخ البدء.']]);
        }

        $row = [];
        foreach (self::INHERITED as $col) {
            $row[$col] = $group->{$col} ?? null;
        }
        if (array_key_exists('price_minor', $data) && $data['price_minor'] !== null) {
            $row['price_minor'] = (int) $data['price_minor'];
            $row['currency'] ??= DB::table('academies')->where('id', $group->academy_id)->value('default_currency');
        }

        $newId = (string) Str::uuid();
        // array_merge, not `+`: what the successor does differently must win over what it inherits.
        DB::table('class_groups')->insert(array_merge($row, $override, [
            'id' => $newId,
            'academy_id' => (string) $group->academy_id,
            'name' => isset($data['name']) && trim((string) $data['name']) !== '' ? trim((string) $data['name']) : (string) $group->name,
            'start_date' => $start,
            'end_date' => $end,
            'lessons_planned' => array_key_exists('lessons_planned', $data) ? $data['lessons_planned'] : $group->lessons_planned,
            'continues_group_id' => (string) $group->id,
            'status' => 'ACTIVE',
            'created_by' => $actorUserId === Audit::SYSTEM_ACTOR_ID ? null : $actorUserId,
        ]));

        $this->groups->reconcileSlots((string) $group->academy_id, $newId, $this->groups->slotsOf((string) $group->id));
        $generated = $this->generator->regenerate($newId, backfill: true);

        Audit::log('class_group.created', 'class_group', $newId, (string) $group->academy_id, $actorUserId, $actorRole,
            after: ['continues_group_id' => (string) $group->id, 'start_date' => $start, 'end_date' => $end, 'generated' => $generated]);

        return $newId;
    }

    /** Archive the way the group page does, plus why — and drop its future untouched lessons. */
    private function archiveAs(object $group, string $reason, string $actorUserId, string $actorRole, array $after): void
    {
        DB::table('class_groups')->where('id', $group->id)->update([
            'status' => 'ARCHIVED',
            'archived_at' => now()->toIso8601String(),
            'closed_reason' => $reason,
            'updated_at' => now(),
        ]);
        $generated = $this->generator->regenerate((string) $group->id);

        Audit::log('class_group.'.strtolower($reason), 'class_group', (string) $group->id, (string) $group->academy_id, $actorUserId, $actorRole,
            after: $after + ['status' => 'ARCHIVED', 'closed_reason' => $reason, 'generated' => $generated],
            before: ['status' => $group->status]);
    }

    /**
     * The day the old term's members leave it: the day it ended when that has passed, else today —
     * an archive stops a running term today, whatever its end date said.
     */
    private function leaveDate(object $group): string
    {
        $today = ClassGroups::localToday((string) $group->timezone);
        if ($group->end_date !== null) {
            $end = Carbon::parse($group->end_date)->format('Y-m-d');
            if ($end < $today) {
                return $end;
            }
        }

        return $today;
    }

    /**
     * Who moves on: every active member with `$all`, else the ids given — each of which must be an
     * active member (a stranger to the group is a mistake, not a new enrolment).
     *
     * @param  list<string>  $ids
     * @return list<string>
     */
    private function chosenMembers(object $group, bool $all, array $ids): array
    {
        $active = $this->activeMemberIds($group);
        if ($all) {
            return $active;
        }
        $ids = array_values(array_unique(array_map('strval', $ids)));
        $strangers = array_diff($ids, $active);
        if ($strangers !== []) {
            throw ValidationException::withMessages(['member_ids' => ['A chosen student is not in this group. / أحد الطلاب المختارين ليس في هذه المجموعة.']]);
        }

        return $ids;
    }

    /** @return list<string> */
    private function activeMemberIds(object $group): array
    {
        return $this->activeMembers($group)->pluck('student_id')->map(fn ($id) => (string) $id)->all();
    }

    private function activeMembers(object $group)
    {
        return DB::table('class_group_members as m')
            ->join('students as st', 'st.id', '=', 'm.student_id')
            ->where('m.group_id', $group->id)->where('m.status', 'ACTIVE')
            ->orderBy('st.full_name')
            ->get(['m.student_id', 'st.full_name']);
    }

    private function isActiveMember(object $group, string $studentId): bool
    {
        return DB::table('class_group_members')->where('group_id', $group->id)->where('student_id', $studentId)->where('status', 'ACTIVE')->exists();
    }
}
