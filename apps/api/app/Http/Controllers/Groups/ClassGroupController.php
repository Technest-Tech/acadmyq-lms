<?php

declare(strict_types=1);

namespace App\Http\Controllers\Groups;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Groups\Concerns\InteractsWithClassGroups;
use App\Services\ClassGroups;
use App\Services\GroupBilling;
use App\Services\GroupLessonGenerator;
use App\Services\GroupPayroll;
use App\Support\Audit;
use App\Support\TimeHelper;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Group classes (docs/groups) — the group itself, its weekly times, its members and its lessons
 * list. Every route sits behind `entitled:groups`; `group.read` opens the pages (row-scoped for a
 * TEACHER to their own groups) and `group.manage` changes anything. Every save regenerates the
 * group's lessons through {@see GroupLessonGenerator}, which never rewrites history.
 */
final class ClassGroupController extends Controller
{
    use InteractsWithClassGroups;

    private const STATES = ['UPCOMING', 'RUNNING', 'FINISHED', 'ARCHIVED'];

    /** What the student pays — `student.set_price` to change, hidden from anyone who can't see money. */
    private const PRICE_FIELDS = ['billing_mode', 'price_minor', 'currency', 'charge_absent', 'prorate_join', 'month_minutes'];

    /** What the teacher earns — `teacher.set_pay` to change; it or `payout.read` to see. */
    private const TEACHER_PAY_FIELDS = ['teacher_pay_mode', 'teacher_pay_minor', 'teacher_share_bp'];

    public function __construct(
        private readonly ClassGroups $groups,
        private readonly GroupLessonGenerator $generator,
        private readonly GroupBilling $billing,
        private readonly GroupPayroll $payroll,
    ) {}

    /**
     * GET /api/groups?state=&teacher_id=&q= — every group the caller can see, with its seats,
     * weekly times, lesson counters and derived state. `state` filters on the derived state
     * (UPCOMING / RUNNING / FINISHED / ARCHIVED, or ACTIVE = anything not archived); the response
     * also carries the count per state so the tabs never disagree with the list.
     */
    public function index(Request $request): JsonResponse
    {
        Gate::authorize('group.read');

        $data = $request->validate([
            'state' => ['sometimes', 'nullable', Rule::in([...self::STATES, 'ACTIVE'])],
            'teacher_id' => ['sometimes', 'nullable', 'uuid'],
            'q' => ['sometimes', 'nullable', 'string', 'max:120'],
        ]);

        $query = DB::table('class_groups as g')
            ->leftJoin('teachers as te', 'te.id', '=', 'g.teacher_id')
            ->leftJoin('specializations as sp', 'sp.id', '=', 'g.specialization_id')
            ->select(['g.*', 'te.full_name as teacher_name', 'te.currency as teacher_currency', 'sp.name as specialization_name'])
            ->selectRaw("(select count(*) from class_group_members m where m.group_id = g.id and m.status = 'ACTIVE') as member_count")
            ->orderBy('g.name');

        $this->scopeGroupsToCaller($query);

        if (! empty($data['teacher_id'])) {
            $query->where('g.teacher_id', $data['teacher_id']);
        }
        if (! empty($data['q'])) {
            $like = '%'.str_replace(['%', '_'], ['\%', '\_'], trim((string) $data['q'])).'%';
            $query->where(fn ($q) => $q->where('g.name', 'ilike', $like)
                ->orWhere('g.level', 'ilike', $like)
                ->orWhere('te.full_name', 'ilike', $like)
                ->orWhere('sp.name', 'ilike', $like));
        }

        $all = $query->get();
        $ids = $all->pluck('id')->map(fn ($id) => (string) $id)->all();
        $counters = $this->groups->lessonCounters($ids);
        $slots = $this->slotsFor($ids);

        $counts = array_fill_keys(self::STATES, 0);
        $rows = [];
        foreach ($all as $g) {
            $state = ClassGroups::state($g);
            $counts[$state]++;

            $wanted = $data['state'] ?? 'ACTIVE';
            if ($wanted === 'ACTIVE' ? $state === 'ARCHIVED' : $state !== $wanted) {
                continue;
            }

            $rows[] = $this->present($g, $state, $slots[(string) $g->id] ?? [], $counters[(string) $g->id] ?? null);
        }

        return response()->json(['groups' => $rows, 'counts' => $counts]);
    }

    /** POST /api/groups — create a group with its weekly times (and members), then generate. */
    public function store(Request $request): JsonResponse
    {
        Gate::authorize('group.manage');

        $academyId = $this->currentAcademyId();
        $data = $this->validateGroup($request, creating: true);
        $this->assertActiveTeacher($data['teacher_id']);

        $groupId = (string) Str::uuid();

        // All or nothing (see ClassGroups): a refused member — the group is full — must not leave a
        // half-made group behind the 422.
        $counts = DB::transaction(function () use ($groupId, $academyId, $data): array {
            DB::table('class_groups')->insert([
                'id' => $groupId,
                'academy_id' => $academyId,
                'name' => trim($data['name']),
                'specialization_id' => $data['specialization_id'] ?? null,
                'level' => $data['level'] ?? null,
                'teacher_id' => $data['teacher_id'],
                'capacity' => $data['capacity'] ?? null,
                'mode' => $data['mode'] ?? 'ONLINE',
                'location' => $data['location'] ?? null,
                'meeting_url' => $data['meeting_url'] ?? null,
                'timezone' => $data['timezone'] ?? $this->academyTimezone($academyId),
                'start_date' => $data['start_date'],
                'end_date' => $data['end_date'] ?? null,
                'notes' => $data['notes'] ?? null,
                'status' => 'ACTIVE',
                'created_by' => $this->ctx()->userId,
            ] + array_intersect_key($data, array_flip([...self::PRICE_FIELDS, ...self::TEACHER_PAY_FIELDS])));

            $this->groups->reconcileSlots($academyId, $groupId, $data['slots']);

            // Lessons BEFORE members: a MONTHLY group pro-rates and bills by the month's lessons.
            $counts = $this->generator->regenerate($groupId, backfill: true);

            if (! empty($data['student_ids'])) {
                $group = DB::table('class_groups')->where('id', $groupId)->first();
                $this->groups->addMembers($group, $data['student_ids'], $data['start_date'],
                    (bool) ($data['allow_over_capacity'] ?? false), $this->ctx()->userId, $this->ctx()->role);
            }

            Audit::log('class_group.created', 'class_group', $groupId, $academyId, $this->ctx()->userId, $this->ctx()->role, after: [
                'name' => trim($data['name']),
                'teacher_id' => $data['teacher_id'],
                'start_date' => $data['start_date'],
                'end_date' => $data['end_date'] ?? null,
                'capacity' => $data['capacity'] ?? null,
                'slots' => $data['slots'],
                'members' => count($data['student_ids'] ?? []),
                'generated' => $counts,
            ]);

            return $counts;
        });

        return response()->json(['group' => $this->detail($groupId), 'generated' => $counts], 201);
    }

    /** GET /api/groups/{id} — the group, its weekly times, its members and their attendance. */
    public function show(string $id): JsonResponse
    {
        Gate::authorize('group.read');
        $this->findGroup($id);

        return response()->json(['group' => $this->detail($id)]);
    }

    /**
     * PATCH /api/groups/{id} — edit any detail, the weekly times (`slots`, the full set) or the
     * teacher, then regenerate. Future untouched lessons follow the edit; held, cancelled, moved
     * and past lessons never do. Moving the start date earlier back-fills the lessons since then.
     */
    public function update(Request $request, string $id): JsonResponse
    {
        Gate::authorize('group.manage');

        $academyId = $this->currentAcademyId();
        $group = $this->findGroup($id);
        $data = $this->validateGroup($request, creating: false, current: $group);

        if (isset($data['teacher_id'])) {
            $this->assertActiveTeacher($data['teacher_id']);
        }

        $fields = array_intersect_key($data, array_flip([
            'name', 'specialization_id', 'level', 'teacher_id', 'capacity', 'mode', 'location',
            'meeting_url', 'timezone', 'start_date', 'end_date', 'notes',
            ...self::PRICE_FIELDS, ...self::TEACHER_PAY_FIELDS,
        ]));
        if (isset($fields['name'])) {
            $fields['name'] = trim($fields['name']);
        }
        // A monthly group moving between calendar months and hours: the month already paid under
        // the old rule runs out first, and the new rule bills from the 1st of next month.
        if (array_key_exists('month_minutes', $fields) || array_key_exists('billing_mode', $fields)) {
            $switch = $this->billing->ruleSwitchDate($group, $fields);
            if ($switch !== null) {
                $fields['billing_rule_from'] = $switch;
            }
        }

        // One unit, so a failure part-way never leaves the times edited and the lessons not.
        $counts = DB::transaction(function () use ($id, $fields, $data, $academyId, $group): array {
            if ($fields !== []) {
                DB::table('class_groups')->where('id', $id)->update($fields + ['updated_at' => now()]);
            }
            if (array_key_exists('slots', $data)) {
                $this->groups->reconcileSlots($academyId, $id, $data['slots']);
            }

            $startMoved = isset($fields['start_date'])
                && $fields['start_date'] !== Carbon::parse($group->start_date)->format('Y-m-d');
            $counts = $this->generator->regenerate($id, backfill: $startMoved);

            // Money moves forward only: a new price bills what is owed from now and has not been billed;
            // a new pay rule prices the lessons held from now. The month's revenue share follows the
            // group's current rule and teacher.
            $fresh = DB::table('class_groups')->where('id', $id)->first();
            if (array_intersect(array_keys($fields), self::PRICE_FIELDS) !== []) {
                $this->billing->onPricingChanged($fresh);
            }
            if (array_intersect(array_keys($fields), [...self::TEACHER_PAY_FIELDS, 'teacher_id']) !== []) {
                $today = Carbon::now((string) $fresh->timezone);
                $this->payroll->syncRevenueShare($fresh, (int) $today->year, (int) $today->month);
            }

            return $counts;
        });

        Audit::log('class_group.updated', 'class_group', $id, $academyId, $this->ctx()->userId, $this->ctx()->role,
            after: $fields + (array_key_exists('slots', $data) ? ['slots' => $data['slots']] : []) + ['generated' => $counts],
            before: array_intersect_key((array) $group, $fields));

        return response()->json(['group' => $this->detail($id), 'generated' => $counts]);
    }

    /** POST /api/groups/{id}/archive — stop the group: its future untouched lessons go, history stays. */
    public function archive(string $id): JsonResponse
    {
        Gate::authorize('group.manage');

        $group = $this->findGroup($id);
        if ($group->status === 'ARCHIVED') {
            return response()->json(['group' => $this->detail($id), 'generated' => ['created' => 0, 'removed' => 0]]);
        }

        DB::table('class_groups')->where('id', $id)->update([
            'status' => 'ARCHIVED',
            'archived_at' => now()->toIso8601String(),
            'updated_at' => now(),
        ]);
        $counts = $this->generator->regenerate($id);

        Audit::log('class_group.archived', 'class_group', $id, (string) $group->academy_id, $this->ctx()->userId, $this->ctx()->role,
            after: ['status' => 'ARCHIVED', 'generated' => $counts], before: ['status' => $group->status]);

        return response()->json(['group' => $this->detail($id), 'generated' => $counts]);
    }

    /**
     * POST /api/groups/{id}/restore — bring an archived group back. Lessons resume from now; the
     * weeks it spent archived are not back-filled, because nobody taught them.
     */
    public function restore(string $id): JsonResponse
    {
        Gate::authorize('group.manage');

        $group = $this->findGroup($id);
        if ($group->status !== 'ARCHIVED') {
            return response()->json(['group' => $this->detail($id), 'generated' => ['created' => 0, 'removed' => 0]]);
        }

        DB::table('class_groups')->where('id', $id)->update([
            'status' => 'ACTIVE',
            'archived_at' => null,
            'updated_at' => now(),
        ]);
        $counts = $this->generator->regenerate($id);

        Audit::log('class_group.restored', 'class_group', $id, (string) $group->academy_id, $this->ctx()->userId, $this->ctx()->role,
            after: ['status' => 'ACTIVE', 'generated' => $counts], before: ['status' => 'ARCHIVED']);

        return response()->json(['group' => $this->detail($id), 'generated' => $counts]);
    }

    /**
     * DELETE /api/groups/{id} — remove a group created by mistake. Refused once anything has been
     * recorded on it (a held lesson, a sheet row): that is history, and history is archived, not
     * deleted.
     */
    public function destroy(string $id): JsonResponse
    {
        Gate::authorize('group.manage');

        $group = $this->findGroup($id);
        $recorded = DB::table('class_group_lessons')->where('group_id', $id)->where('status', 'HELD')->exists()
            || DB::table('class_group_attendance')->where('group_id', $id)->exists()
            || DB::table('invoice_line_items')->where('class_group_id', $id)->exists()
            || DB::table('payout_line_items')->where('class_group_id', $id)->exists();
        if ($recorded) {
            throw ValidationException::withMessages([
                'group' => ['Lessons were already held in this group; archive it instead. / تم عقد حصص في هذه المجموعة؛ قم بأرشفتها بدلاً من حذفها.'],
            ]);
        }

        DB::table('class_groups')->where('id', $id)->delete(); // slots, members, lessons cascade

        Audit::log('class_group.deleted', 'class_group', $id, (string) $group->academy_id, $this->ctx()->userId, $this->ctx()->role,
            before: ['name' => $group->name, 'teacher_id' => (string) $group->teacher_id]);

        return response()->json(['ok' => true]);
    }

    // ── Members ──────────────────────────────────────────────────────────────

    /** POST /api/groups/{id}/members — add students from `joined_on` (default: today). */
    public function addMembers(Request $request, string $id): JsonResponse
    {
        Gate::authorize('group.manage');

        $group = $this->findGroup($id);
        $data = $request->validate([
            'student_ids' => ['required', 'array', 'min:1', 'max:200'],
            'student_ids.*' => ['uuid'],
            'joined_on' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            'allow_over_capacity' => ['sometimes', 'boolean'],
        ]);

        $joinedOn = $data['joined_on'] ?? ClassGroups::localToday((string) $group->timezone);
        $added = $this->groups->addMembers($group, $data['student_ids'], $joinedOn,
            (bool) ($data['allow_over_capacity'] ?? false), $this->ctx()->userId, $this->ctx()->role);

        return response()->json(['added' => count($added), 'group' => $this->detail($id)], 201);
    }

    /** DELETE /api/groups/{id}/members/{studentId} — the student leaves (from `left_on`, default today). */
    public function removeMember(Request $request, string $id, string $studentId): JsonResponse
    {
        Gate::authorize('group.manage');

        $group = $this->findGroup($id);
        $data = $request->validate([
            'left_on' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            'reason' => ['sometimes', 'nullable', 'string', 'max:300'],
        ]);

        $this->groups->removeMember($group, $studentId, $data['left_on'] ?? ClassGroups::localToday((string) $group->timezone),
            $data['reason'] ?? null, $this->ctx()->userId, $this->ctx()->role);

        return response()->json(['group' => $this->detail($id)]);
    }

    /**
     * POST /api/groups/{id}/members/{studentId}/move — leave this group and join another on the
     * same day. Both halves or neither: a refused join (the other group is full) undoes the leave.
     */
    public function moveMember(Request $request, string $id, string $studentId): JsonResponse
    {
        Gate::authorize('group.manage');

        $from = $this->findGroup($id);
        $data = $request->validate([
            'to_group_id' => ['required', 'uuid'],
            'on' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            'allow_over_capacity' => ['sometimes', 'boolean'],
        ]);
        if ($data['to_group_id'] === $id) {
            throw ValidationException::withMessages(['to_group_id' => ['The student is already in this group. / الطالب في هذه المجموعة بالفعل.']]);
        }
        $to = $this->findGroup($data['to_group_id']);
        if ($to->status === 'ARCHIVED') {
            throw ValidationException::withMessages(['to_group_id' => ['That group is archived. / هذه المجموعة مؤرشفة.']]);
        }

        $on = $data['on'] ?? ClassGroups::localToday((string) $from->timezone);
        DB::transaction(function () use ($from, $to, $studentId, $on, $data, $id): void {
            $this->groups->removeMember($from, $studentId, $on, 'Moved to '.$to->name, $this->ctx()->userId, $this->ctx()->role);
            $this->groups->addMembers($to, [$studentId], $on, (bool) ($data['allow_over_capacity'] ?? false), $this->ctx()->userId, $this->ctx()->role, movedFromGroup: $id);
        });

        return response()->json(['group' => $this->detail($id), 'to_group_id' => (string) $to->id]);
    }

    /**
     * PATCH /api/groups/{id}/members/{studentId} — this member's own price (null = the group's): a
     * sibling discount, a scholarship. Forward only — a charge already raised keeps its price.
     */
    public function updateMember(Request $request, string $id, string $studentId): JsonResponse
    {
        Gate::authorize('group.manage');
        Gate::authorize('student.set_price');

        $group = $this->findGroup($id);
        $data = $request->validate(['price_minor' => ['present', 'nullable', 'integer', 'min:0', 'max:1000000000000']]);

        $member = DB::table('class_group_members')
            ->where('group_id', $id)->where('student_id', $studentId)->where('status', 'ACTIVE')->first();
        if ($member === null) {
            abort(404, 'This student is not in the group.');
        }

        DB::table('class_group_members')->where('id', $member->id)->update([
            'price_minor' => $data['price_minor'],
            'updated_at' => now(),
        ]);

        Audit::log('class_group.member_price_changed', 'class_group', $id, (string) $group->academy_id, $this->ctx()->userId, $this->ctx()->role,
            after: ['student_id' => $studentId, 'price_minor' => $data['price_minor']],
            before: ['price_minor' => $member->price_minor !== null ? (int) $member->price_minor : null]);

        return response()->json(['group' => $this->detail($id)]);
    }

    /**
     * GET /api/groups/{id}/money?month=YYYY-MM — the group's month in money: what each member was
     * charged and whether their invoice is paid, and what the group cost in teacher pay. Owner-side
     * (`invoice.read`); the teacher-cost half only for `payout.read`.
     */
    public function money(Request $request, string $id): JsonResponse
    {
        Gate::authorize('invoice.read');

        $group = $this->findGroup($id);
        $data = $request->validate(['month' => ['sometimes', 'nullable', 'date_format:Y-m']]);
        $month = Carbon::parse(($data['month'] ?? Carbon::now((string) $group->timezone)->format('Y-m')).'-01');
        $from = $month->format('Y-m-d');
        $to = $month->copy()->endOfMonth()->format('Y-m-d');

        $lines = DB::table('invoice_line_items as li')
            ->join('invoices as inv', 'inv.id', '=', 'li.invoice_id')
            ->leftJoin('students as st', 'st.id', '=', 'li.student_id')
            ->where('li.class_group_id', $id)
            ->whereBetween('li.group_period', [$from, $to])
            ->orderBy('st.full_name')->orderBy('li.group_period')
            ->get([
                'li.id', 'li.student_id', 'st.full_name', 'li.description', 'li.amount_minor', 'li.currency',
                'li.group_charge', 'li.group_period', 'li.invoice_id', 'inv.status as invoice_status',
            ]);

        $byCurrency = [];
        foreach ($lines as $l) {
            $c = (string) $l->currency;
            $byCurrency[$c] ??= ['currency' => $c, 'billed_minor' => 0, 'paid_minor' => 0, 'outstanding_minor' => 0];
            $byCurrency[$c]['billed_minor'] += (int) $l->amount_minor;
            $byCurrency[$c][$l->invoice_status === 'PAID' ? 'paid_minor' : 'outstanding_minor'] += (int) $l->amount_minor;
        }

        $teacherCost = null;
        if (Gate::allows('payout.read')) {
            $teacherCost = DB::table('payout_line_items as pl')
                ->leftJoin('class_group_lessons as l', 'l.id', '=', 'pl.class_group_lesson_id')
                ->where(fn ($q) => $q->where('l.group_id', $id)->orWhere('pl.class_group_id', $id))
                ->whereBetween('pl.session_date', [$from, $to])
                ->groupBy('pl.currency')
                ->get(['pl.currency', DB::raw('sum(pl.amount_minor) as amount_minor'), DB::raw('count(pl.class_group_lesson_id) as lessons')])
                ->map(fn ($r) => ['currency' => (string) $r->currency, 'amount_minor' => (int) $r->amount_minor, 'lessons' => (int) $r->lessons])
                ->values();
        }

        return response()->json([
            'month' => $month->format('Y-m'),
            'lines' => $lines->map(fn ($l) => [
                'id' => (string) $l->id,
                'student_id' => $l->student_id !== null ? (string) $l->student_id : null,
                'student_name' => $l->full_name,
                'description' => (string) $l->description,
                'amount_minor' => (int) $l->amount_minor,
                'currency' => (string) $l->currency,
                'charge' => (string) $l->group_charge,
                'period' => Carbon::parse($l->group_period)->format('Y-m-d'),
                'invoice_id' => (string) $l->invoice_id,
                'invoice_status' => (string) $l->invoice_status,
            ])->values(),
            'totals' => array_values($byCurrency),
            'teacher_cost' => $teacherCost,
        ]);
    }

    // ── Lessons ──────────────────────────────────────────────────────────────

    /**
     * GET /api/groups/{id}/lessons?from=&to= — the group's lessons with their sheet counts.
     * Defaults to sixty days either side of today.
     */
    public function lessons(Request $request, string $id): JsonResponse
    {
        Gate::authorize('group.read');

        $group = $this->findGroup($id);
        $data = $request->validate([
            'from' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            'to' => ['sometimes', 'nullable', 'date_format:Y-m-d', 'after_or_equal:from'],
        ]);

        $today = Carbon::parse(ClassGroups::localToday((string) $group->timezone));
        $from = $data['from'] ?? $today->copy()->subDays(60)->format('Y-m-d');
        $to = $data['to'] ?? $today->copy()->addDays(60)->format('Y-m-d');

        $lessons = DB::table('class_group_lessons as l')
            ->leftJoin('teachers as te', 'te.id', '=', 'l.teacher_id')
            ->where('l.group_id', $id)
            ->whereBetween('l.occurrence_local_date', [$from, $to])
            ->orderBy('l.scheduled_at_utc')
            ->get(['l.*', 'te.full_name as teacher_name']);

        $counts = $this->lessonCounts($lessons->pluck('id')->map(fn ($v) => (string) $v)->all());

        return response()->json([
            'lessons' => $lessons->map(fn ($l) => $this->presentLesson($l, $counts[(string) $l->id] ?? null))->values(),
            'from' => $from,
            'to' => $to,
        ]);
    }

    /**
     * POST /api/groups/{id}/lessons — an extra lesson the timetable never produced (حصة تعويض).
     * Returns the soft conflict warnings for its teacher, never a block.
     */
    public function addLesson(Request $request, string $id): JsonResponse
    {
        Gate::authorize('group.manage');

        $group = $this->findGroup($id);
        if ($group->status === 'ARCHIVED') {
            throw ValidationException::withMessages(['group' => ['This group is archived. / هذه المجموعة مؤرشفة.']]);
        }

        $data = $request->validate([
            'local_datetime' => ['required', 'date_format:Y-m-d H:i'],
            'timezone' => ['sometimes', 'nullable', 'string', 'max:64', 'timezone'],
            'duration_minutes' => ['required', 'integer', 'min:1', 'max:600'],
            'teacher_id' => ['sometimes', 'nullable', 'uuid'],
            'topic' => ['sometimes', 'nullable', 'string', 'max:2000'],
        ]);

        $tz = $data['timezone'] ?? (string) $group->timezone;
        $start = TimeHelper::toUtc($data['local_datetime'].':00', $tz);
        $teacherId = $data['teacher_id'] ?? (string) $group->teacher_id;
        $this->assertActiveTeacher($teacherId);

        $lessonId = (string) Str::uuid();
        DB::table('class_group_lessons')->insert([
            'id' => $lessonId,
            'academy_id' => (string) $group->academy_id,
            'group_id' => $id,
            'teacher_id' => $teacherId,
            'slot_id' => null,
            'is_extra' => true,
            'occurrence_local_date' => $start->copy()->setTimezone((string) $group->timezone)->format('Y-m-d'),
            'scheduled_at_utc' => $start->format('Y-m-d H:i:sP'),
            'duration_minutes' => $data['duration_minutes'],
            'status' => 'SCHEDULED',
            'topic' => $data['topic'] ?? null,
        ]);

        Audit::log('class_group_lesson.added', 'class_group_lesson', $lessonId, (string) $group->academy_id, $this->ctx()->userId, $this->ctx()->role,
            after: ['group_id' => $id, 'scheduled_at_utc' => $start->toIso8601String(), 'duration_minutes' => $data['duration_minutes'], 'teacher_id' => $teacherId]);

        $lesson = DB::table('class_group_lessons')->where('id', $lessonId)->first();

        return response()->json([
            'lesson' => $this->presentLesson($lesson, $this->lessonCounts([$lessonId])[$lessonId] ?? null),
            'warnings' => $this->schedulingWarnings($teacherId, $start, (int) $data['duration_minutes'], $tz, excludeGroupLessonId: $lessonId),
        ], 201);
    }

    // ── internals ────────────────────────────────────────────────────────────

    /** The full group payload: the list row plus members, attendance and notes. */
    private function detail(string $id): array
    {
        $g = DB::table('class_groups as g')
            ->leftJoin('teachers as te', 'te.id', '=', 'g.teacher_id')
            ->leftJoin('specializations as sp', 'sp.id', '=', 'g.specialization_id')
            ->where('g.id', $id)
            ->select(['g.*', 'te.full_name as teacher_name', 'te.currency as teacher_currency', 'te.meeting_url as teacher_meeting_url', 'sp.name as specialization_name'])
            ->selectRaw("(select count(*) from class_group_members m where m.group_id = g.id and m.status = 'ACTIVE') as member_count")
            ->first();

        $counters = $this->groups->lessonCounters([$id])[$id] ?? null;
        $attendance = $this->groups->memberAttendance($id);
        $seesPrices = $this->seesPrices();
        // An hours group: where each member is in their month (bought vs used), for whoever sees money.
        $hours = $seesPrices ? $this->billing->hourMonthBalances($g) : [];

        $members = DB::table('class_group_members as m')
            ->join('students as st', 'st.id', '=', 'm.student_id')
            ->leftJoin('guardians as gu', 'gu.id', '=', 'st.guardian_id')
            ->where('m.group_id', $id)
            ->orderByRaw("case when m.status = 'ACTIVE' then 0 else 1 end")
            ->orderBy('st.full_name')
            ->get([
                'm.id', 'm.student_id', 'm.joined_on', 'm.left_on', 'm.status', 'm.left_reason', 'm.price_minor',
                'st.full_name', 'st.deleted_at as student_deleted_at', 'gu.full_name as guardian_name',
            ])
            ->map(fn ($m) => [
                'id' => (string) $m->id,
                'student_id' => (string) $m->student_id,
                'full_name' => (string) $m->full_name,
                'guardian_name' => $m->guardian_name,
                'joined_on' => Carbon::parse($m->joined_on)->format('Y-m-d'),
                'left_on' => $m->left_on !== null ? Carbon::parse($m->left_on)->format('Y-m-d') : null,
                'status' => (string) $m->status,
                'left_reason' => $m->left_reason,
                'student_removed' => $m->student_deleted_at !== null,
                'attendance' => $attendance[(string) $m->student_id] ?? null,
                // The member's own price (null = the group's); hidden like the group's.
                'price_minor' => $seesPrices && $m->price_minor !== null ? (int) $m->price_minor : null,
                'hour_month' => $m->status === 'ACTIVE' ? ($hours[(string) $m->student_id] ?? null) : null,
            ])->values();

        // The group's own rate: everyone who came, over every mark on a held lesson.
        $marked = array_sum(array_column($attendance, 'marked'));
        $came = array_sum(array_map(fn ($a) => $a['present'] + $a['late'], $attendance));

        return $this->present($g, ClassGroups::state($g), $this->groups->slotsOf($id), $counters) + [
            'notes' => $g->notes,
            'effective_meeting_url' => $g->meeting_url ?? $g->teacher_meeting_url,
            'members' => $members,
            'attendance_rate' => $marked > 0 ? round($came / $marked, 4) : null,
        ];
    }

    /** The list row. */
    private function present(object $g, string $state, array $slots, ?array $counters): array
    {
        return [
            'id' => (string) $g->id,
            'name' => (string) $g->name,
            'specialization_id' => $g->specialization_id !== null ? (string) $g->specialization_id : null,
            'specialization_name' => $g->specialization_name ?? null,
            'level' => $g->level,
            'teacher_id' => (string) $g->teacher_id,
            'teacher_name' => $g->teacher_name ?? null,
            'capacity' => $g->capacity !== null ? (int) $g->capacity : null,
            'member_count' => (int) ($g->member_count ?? 0),
            'mode' => (string) $g->mode,
            'location' => $g->location,
            'meeting_url' => $g->meeting_url,
            'timezone' => (string) $g->timezone,
            'start_date' => Carbon::parse($g->start_date)->format('Y-m-d'),
            'end_date' => $g->end_date !== null ? Carbon::parse($g->end_date)->format('Y-m-d') : null,
            'status' => (string) $g->status,
            'state' => $state,
            'slots' => $slots,
            'lessons' => $counters ?? ['held' => 0, 'cancelled' => 0, 'upcoming' => 0, 'overdue' => 0, 'next_lesson_at' => null],
            // Money is null for whoever may not see it — a supervisor runs the group, not its prices.
            'pricing' => $this->seesPrices() ? [
                'billing_mode' => (string) $g->billing_mode,
                'price_minor' => $g->price_minor !== null ? (int) $g->price_minor : null,
                'currency' => $g->currency,
                'charge_absent' => (bool) $g->charge_absent,
                'prorate_join' => (bool) $g->prorate_join,
                'month_minutes' => $g->month_minutes !== null ? (int) $g->month_minutes : null,
            ] : null,
            'teacher_pay' => Gate::allows('teacher.set_pay') || Gate::allows('payout.read') ? [
                'mode' => $g->teacher_pay_mode,
                'amount_minor' => $g->teacher_pay_minor !== null ? (int) $g->teacher_pay_minor : null,
                'share_bp' => $g->teacher_share_bp !== null ? (int) $g->teacher_share_bp : null,
                'currency' => $g->teacher_currency ?? DB::table('teachers')->where('id', $g->teacher_id)->value('currency'),
            ] : null,
        ];
    }

    /** Whoever may set a student's price, or read the invoices it lands on, may see it. */
    private function seesPrices(): bool
    {
        return Gate::allows('student.set_price') || Gate::allows('invoice.read');
    }

    /**
     * Every group's weekly times in one query.
     *
     * @param  list<string>  $ids
     * @return array<string, list<array{weekday:int, start_time_local:string, duration_minutes:int}>>
     */
    private function slotsFor(array $ids): array
    {
        if ($ids === []) {
            return [];
        }

        $out = [];
        foreach (DB::table('class_group_slots')->whereIn('group_id', $ids)->orderBy('weekday')->orderBy('start_time_local')
            ->get(['group_id', 'weekday', 'start_time_local', 'duration_minutes']) as $s) {
            $out[(string) $s->group_id][] = [
                'weekday' => (int) $s->weekday,
                'start_time_local' => substr((string) $s->start_time_local, 0, 5),
                'duration_minutes' => (int) $s->duration_minutes,
            ];
        }

        return $out;
    }

    /**
     * The money fields, checked against what the group already holds: a price needs a currency (the
     * academy's by default), a fixed / hourly / per-student pay rule needs its amount, a revenue share
     * needs its percent — and is only possible when the group bills in the teacher's own currency,
     * since a share of pounds cannot be paid in riyals.
     *
     * @param  array<string,mixed>  $data
     */
    private function validateMoney(array &$data, ?object $current): void
    {
        $get = fn (string $k) => array_key_exists($k, $data) ? $data[$k] : ($current->{$k} ?? null);

        if (isset($data['currency'])) {
            $data['currency'] = strtoupper((string) $data['currency']);
        }
        if ($get('price_minor') !== null && $get('currency') === null) {
            $data['currency'] = (string) DB::table('academies')->where('id', $this->currentAcademyId())->value('default_currency');
        }
        // Hours describe a month, so only a monthly group keeps them.
        if ($get('billing_mode') !== GroupBilling::MONTHLY && $get('month_minutes') !== null) {
            $data['month_minutes'] = null;
        }

        $mode = $get('teacher_pay_mode');
        if (in_array($mode, ['PER_LESSON', 'PER_HOUR', 'PER_STUDENT'], true) && $get('teacher_pay_minor') === null) {
            throw ValidationException::withMessages(['teacher_pay_minor' => ['Enter what the teacher earns. / أدخل ما يتقاضاه المدرس.']]);
        }
        if ($mode === 'REVENUE_SHARE') {
            if ($get('teacher_share_bp') === null) {
                throw ValidationException::withMessages(['teacher_share_bp' => ['Enter the teacher\'s share. / أدخل نسبة المدرس.']]);
            }
            $teacherCurrency = DB::table('teachers')->where('id', $get('teacher_id'))->value('currency');
            $currency = $get('currency');
            if ($currency !== null && $teacherCurrency !== null && strtoupper((string) $currency) !== strtoupper((string) $teacherCurrency)) {
                throw ValidationException::withMessages(['teacher_pay_mode' => ['A revenue share needs the group to bill in the teacher\'s currency ('.$teacherCurrency.'). / نسبة الإيراد تتطلب أن تكون عملة المجموعة هي عملة المدرس.']]);
            }
        }
    }

    /** @return array<string,mixed> */
    private function validateGroup(Request $request, bool $creating, ?object $current = null): array
    {
        $req = $creating ? 'required' : 'sometimes';

        $data = $request->validate([
            'name' => [$req, 'string', 'min:1', 'max:120'],
            'teacher_id' => [$req, 'uuid'],
            'specialization_id' => ['sometimes', 'nullable', 'uuid', Rule::exists('specializations', 'id')],
            'level' => ['sometimes', 'nullable', 'string', 'max:60'],
            'capacity' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:1000'],
            'mode' => ['sometimes', Rule::in(['ONLINE', 'OFFLINE'])],
            'location' => ['sometimes', 'nullable', 'string', 'max:200'],
            'meeting_url' => ['sometimes', 'nullable', 'url', 'max:500'],
            'timezone' => ['sometimes', 'nullable', 'string', 'max:64', 'timezone'],
            'start_date' => [$req, 'date_format:Y-m-d'],
            'end_date' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            'notes' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'slots' => [$req, 'array', 'min:1', 'max:21'],
            'slots.*.weekday' => ['required', 'integer', 'between:0,6'],
            'slots.*.start_time_local' => ['required', 'string', 'regex:/^\d{2}:\d{2}(:\d{2})?$/'],
            'slots.*.duration_minutes' => ['required', 'integer', 'min:1', 'max:600'],
            'student_ids' => ['sometimes', 'array', 'max:200'],
            'student_ids.*' => ['uuid'],
            'allow_over_capacity' => ['sometimes', 'boolean'],
            // Money (docs/groups §Money) — each half behind its own money capability, below.
            'billing_mode' => ['sometimes', Rule::in([GroupBilling::MONTHLY, GroupBilling::PER_LESSON, GroupBilling::COURSE])],
            'price_minor' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:1000000000000'],
            'currency' => ['sometimes', 'nullable', 'string', 'size:3'],
            'charge_absent' => ['sometimes', 'boolean'],
            'prorate_join' => ['sometimes', 'boolean'],
            // MONTHLY only: the hours one month buys (null = the calendar month).
            'month_minutes' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:60000'],
            'teacher_pay_mode' => ['sometimes', 'nullable', Rule::in(['PER_LESSON', 'PER_HOUR', 'PER_STUDENT', 'REVENUE_SHARE'])],
            'teacher_pay_minor' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:1000000000000'],
            'teacher_share_bp' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:10000'],
        ]);

        // Setting what a student pays is a money decision (student.set_price, never a supervisor's);
        // setting what the teacher earns is the same call as setting their rate (teacher.set_pay).
        if (array_intersect(array_keys($data), self::PRICE_FIELDS) !== []) {
            Gate::authorize('student.set_price');
        }
        if (array_intersect(array_keys($data), self::TEACHER_PAY_FIELDS) !== []) {
            Gate::authorize('teacher.set_pay');
        }
        $this->validateMoney($data, $current);

        // A null timezone on an edit means "leave it", not "erase it" (the column is NOT NULL).
        if (! $creating && array_key_exists('timezone', $data) && $data['timezone'] === null) {
            unset($data['timezone']);
        }

        $start = $data['start_date'] ?? ($current !== null ? Carbon::parse($current->start_date)->format('Y-m-d') : null);
        $end = array_key_exists('end_date', $data)
            ? $data['end_date']
            : ($current?->end_date !== null ? Carbon::parse($current->end_date)->format('Y-m-d') : null);
        if ($start !== null && $end !== null && $end < $start) {
            throw ValidationException::withMessages(['end_date' => ['The end date must be on or after the start date. / يجب أن يكون تاريخ الانتهاء بعد تاريخ البدء.']]);
        }

        // The same weekly time twice is one slot, not two lessons.
        if (isset($data['slots'])) {
            $seen = [];
            foreach ($data['slots'] as $slot) {
                $k = $slot['weekday'].'|'.substr($slot['start_time_local'], 0, 5);
                if (isset($seen[$k])) {
                    throw ValidationException::withMessages(['slots' => ['The same day and time is listed twice. / نفس اليوم والوقت مكرر.']]);
                }
                $seen[$k] = true;
            }
        }

        if (isset($data['capacity']) && $current !== null && $data['capacity'] < $this->groups->activeMemberCount((string) $current->id)) {
            throw ValidationException::withMessages(['capacity' => ['The group already has more students than that. / عدد طلاب المجموعة أكبر من ذلك بالفعل.']]);
        }

        return $data;
    }
}
