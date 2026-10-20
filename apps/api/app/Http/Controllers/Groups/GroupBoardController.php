<?php

declare(strict_types=1);

namespace App\Http\Controllers\Groups;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Groups\Concerns\InteractsWithClassGroups;
use App\Services\Ledger;
use Illuminate\Database\Query\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

/**
 * The group-class section's cross-group pages (docs/groups §Screens) — every lesson, every member,
 * the month's money and the reports, across ALL the caller's groups at once. The per-group pages
 * live in ClassGroupController; these answer "what does the academy have to do today?".
 *
 * Scoped like everything else in the module: RLS to the academy, and a TEACHER to the groups they
 * teach (scopeGroupsToCaller). Money is only ever shown to money roles: the payments page needs
 * `invoice.read`, teacher cost `payout.read`, and the reports' billed column `invoice.read`.
 */
final class GroupBoardController extends Controller
{
    use InteractsWithClassGroups;

    /** How many recent marks make an absence streak worth flagging. */
    private const STREAK = 3;

    /** Below this attendance rate a member is flagged. */
    private const LOW_RATE = 0.75;

    /**
     * GET /api/group-lessons?view=day|owed|week&date=&group_id=&teacher_id= — group lessons across
     * every group: one day (default today), the week starting `date`, or every lesson still owed
     * its sheet (its time has passed, nothing recorded) whatever its date, oldest first.
     */
    public function lessons(Request $request): JsonResponse
    {
        Gate::authorize('group.read');

        $data = $request->validate([
            'view' => ['sometimes', Rule::in(['day', 'week', 'owed'])],
            'date' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            'group_id' => ['sometimes', 'nullable', 'uuid'],
            'teacher_id' => ['sometimes', 'nullable', 'uuid'],
        ]);
        $view = $data['view'] ?? 'day';
        $tz = $this->academyTimezone($this->currentAcademyId());
        $date = $data['date'] ?? Carbon::now($tz)->format('Y-m-d');
        $to = $view === 'week' ? Carbon::parse($date)->addDays(6)->format('Y-m-d') : $date;

        $query = $this->lessonQuery($data);
        if ($view === 'owed') {
            $query->where('l.status', 'SCHEDULED')
                ->where('l.scheduled_at_utc', '<', now()->utc()->format('Y-m-d H:i:sP'))
                ->orderBy('l.scheduled_at_utc');
        } else {
            $query->whereRaw('(l.scheduled_at_utc at time zone g.timezone)::date between ?::date and ?::date', [$date, $to])
                ->orderBy('l.scheduled_at_utc');
        }

        $rows = $query->limit(500)->get();
        $counts = $this->lessonCounts($rows->pluck('id')->map(fn ($v) => (string) $v)->all());

        return response()->json([
            'view' => $view,
            'from' => $date,
            'to' => $to,
            'timezone' => $tz,
            'lessons' => $rows->map(fn ($l) => $this->presentLesson($l, $counts[(string) $l->id] ?? null) + [
                'group' => [
                    'id' => (string) $l->group_id,
                    'name' => (string) $l->group_name,
                    'level' => $l->group_level,
                    'timezone' => (string) $l->group_timezone,
                    'mode' => (string) $l->group_mode,
                    'location' => $l->group_location,
                ],
            ])->values(),
        ]);
    }

    /** GET /api/group-lessons/summary — the sidebar's counter: sheets owed, and today's lessons. */
    public function lessonsSummary(): JsonResponse
    {
        Gate::authorize('group.read');

        $tz = $this->academyTimezone($this->currentAcademyId());
        $today = Carbon::now($tz)->format('Y-m-d');

        $owed = $this->lessonQuery([])
            ->where('l.status', 'SCHEDULED')
            ->where('l.scheduled_at_utc', '<', now()->utc()->format('Y-m-d H:i:sP'))
            ->count();
        $todayCount = $this->lessonQuery([])
            ->where('l.status', '!=', 'CANCELLED')
            ->whereRaw('(l.scheduled_at_utc at time zone g.timezone)::date = ?::date', [$today])
            ->count();

        return response()->json(['owed' => $owed, 'today' => $todayCount]);
    }

    /**
     * GET /api/group-members?status=ACTIVE|LEFT|ALL&flag=&group_id=&teacher_id=&q= — every
     * membership across the groups, with each student's attendance there, their last marks, and —
     * for money roles — what this month's charge is and whether it is paid. `flag` narrows to the
     * ones that need someone: an absence streak, a low rate, an unpaid charge.
     */
    public function members(Request $request): JsonResponse
    {
        Gate::authorize('group.read');

        $data = $request->validate([
            'status' => ['sometimes', Rule::in(['ACTIVE', 'LEFT', 'ALL'])],
            'flag' => ['sometimes', 'nullable', Rule::in(['absent_streak', 'low_attendance', 'unpaid'])],
            'group_id' => ['sometimes', 'nullable', 'uuid'],
            'teacher_id' => ['sometimes', 'nullable', 'uuid'],
            'q' => ['sometimes', 'nullable', 'string', 'max:120'],
        ]);
        $status = $data['status'] ?? 'ACTIVE';
        $seesMoney = Gate::allows('invoice.read');

        $query = DB::table('class_group_members as m')
            ->join('class_groups as g', 'g.id', '=', 'm.group_id')
            ->join('students as st', 'st.id', '=', 'm.student_id')
            ->leftJoin('guardians as gu', 'gu.id', '=', 'st.guardian_id')
            ->leftJoin('teachers as te', 'te.id', '=', 'g.teacher_id')
            ->when($status !== 'ALL', fn ($q) => $q->where('m.status', $status))
            ->when(! empty($data['group_id']), fn ($q) => $q->where('g.id', $data['group_id']))
            ->when(! empty($data['teacher_id']), fn ($q) => $q->where('g.teacher_id', $data['teacher_id']))
            ->orderBy('st.full_name')->orderBy('g.name');
        $this->scopeGroupsToCaller($query);

        if (! empty($data['q'])) {
            $like = '%'.str_replace(['%', '_'], ['\%', '\_'], trim((string) $data['q'])).'%';
            $query->where(fn ($q) => $q->where('st.full_name', 'ilike', $like)
                ->orWhere('gu.full_name', 'ilike', $like)
                ->orWhere('g.name', 'ilike', $like));
        }

        $rows = $query->limit(2000)->get([
            'm.id', 'm.group_id', 'm.student_id', 'm.joined_on', 'm.left_on', 'm.status', 'm.price_minor',
            'st.full_name', 'st.deleted_at as student_deleted_at', 'gu.full_name as guardian_name',
            'g.name as group_name', 'g.level as group_level', 'g.teacher_id', 'g.timezone',
            'te.full_name as teacher_name',
        ]);

        $pairs = $rows->map(fn ($r) => [(string) $r->group_id, (string) $r->student_id]);
        $stats = $this->attendanceByPair($pairs->pluck(0)->unique()->values()->all());
        $recent = $this->recentMarks($pairs->pluck(0)->unique()->values()->all());
        $charges = $seesMoney ? $this->monthCharges($pairs->pluck(0)->unique()->values()->all()) : [];

        $out = [];
        foreach ($rows as $r) {
            $key = $r->group_id.'|'.$r->student_id;
            $a = $stats[$key] ?? ['present' => 0, 'late' => 0, 'absent' => 0, 'excused' => 0, 'marked' => 0];
            $marks = $recent[$key] ?? [];
            $streak = 0;
            foreach ($marks as $mark) {
                if ($mark !== 'ABSENT') {
                    break;
                }
                $streak++;
            }
            $rate = $a['marked'] > 0 ? round(($a['present'] + $a['late']) / $a['marked'], 4) : null;
            $charge = $charges[$key] ?? null;

            $row = [
                'id' => (string) $r->id,
                'group_id' => (string) $r->group_id,
                'group_name' => (string) $r->group_name,
                'group_level' => $r->group_level,
                'teacher_id' => (string) $r->teacher_id,
                'teacher_name' => $r->teacher_name,
                'student_id' => (string) $r->student_id,
                'full_name' => (string) $r->full_name,
                'guardian_name' => $r->guardian_name,
                'student_removed' => $r->student_deleted_at !== null,
                'joined_on' => Carbon::parse($r->joined_on)->format('Y-m-d'),
                'left_on' => $r->left_on !== null ? Carbon::parse($r->left_on)->format('Y-m-d') : null,
                'status' => (string) $r->status,
                'attendance' => $a + ['rate' => $rate],
                'recent' => $marks,
                'absent_streak' => $streak,
                'charge' => $charge,
            ];

            $flag = $data['flag'] ?? null;
            if ($flag === 'absent_streak' && $streak < self::STREAK) {
                continue;
            }
            if ($flag === 'low_attendance' && ($rate === null || $rate >= self::LOW_RATE)) {
                continue;
            }
            if ($flag === 'unpaid' && ($charge === null || $charge['outstanding_minor'] === 0)) {
                continue;
            }
            $out[] = $row;
        }

        return response()->json([
            'members' => $out,
            'thresholds' => ['streak' => self::STREAK, 'low_rate' => self::LOW_RATE],
            'sees_money' => $seesMoney,
        ]);
    }

    /**
     * GET /api/group-payments?month=YYYY-MM — the month's group money, group by group: billed, paid,
     * outstanding, teacher cost and what is left, plus every charge not yet paid. Money roles only.
     */
    public function payments(Request $request): JsonResponse
    {
        Gate::authorize('invoice.read');

        $data = $request->validate(['month' => ['sometimes', 'nullable', 'date_format:Y-m']]);
        $tz = $this->academyTimezone($this->currentAcademyId());
        $month = Carbon::parse(($data['month'] ?? Carbon::now($tz)->format('Y-m')).'-01');
        $from = $month->format('Y-m-d');
        $to = $month->copy()->endOfMonth()->format('Y-m-d');

        $groups = $this->scopeGroupsToCaller(DB::table('class_groups as g')->leftJoin('teachers as te', 'te.id', '=', 'g.teacher_id'))
            ->orderBy('g.name')
            ->get(['g.id', 'g.name', 'g.level', 'g.status', 'g.billing_mode', 'g.price_minor', 'g.currency', 'te.full_name as teacher_name'])
            ->keyBy(fn ($g) => (string) $g->id);
        $ids = $groups->keys()->all();

        // A receipt-kept academy (Ledger) knows what each line has been paid, partial payments
        // included; otherwise a line is paid when its whole invoice is.
        $keeps = Ledger::keeps($this->currentAcademyId());
        $allocated = DB::table('receipt_allocations')->selectRaw('invoice_line_id, sum(amount_minor) as paid')->groupBy('invoice_line_id');
        $lines = $ids === [] ? collect() : DB::table('invoice_line_items as li')
            ->join('invoices as inv', 'inv.id', '=', 'li.invoice_id')
            ->leftJoin('students as st', 'st.id', '=', 'li.student_id')
            ->leftJoinSub($allocated, 'pa', 'pa.invoice_line_id', '=', 'li.id')
            ->whereIn('li.class_group_id', $ids)
            ->whereBetween('li.group_period', [$from, $to])
            ->where('inv.status', '<>', 'VOID')
            ->get(['li.id', 'li.class_group_id', 'li.student_id', 'st.full_name', 'li.description', 'li.amount_minor', 'li.currency', 'li.group_charge', 'inv.status as invoice_status', DB::raw('coalesce(pa.paid, 0) as paid')]);

        $cost = [];
        if (Gate::allows('payout.read') && $ids !== []) {
            foreach (DB::table('payout_line_items as pl')
                ->leftJoin('class_group_lessons as l', 'l.id', '=', 'pl.class_group_lesson_id')
                ->whereRaw('coalesce(l.group_id, pl.class_group_id) in ('.implode(',', array_fill(0, count($ids), '?')).')', $ids)
                ->whereBetween('pl.session_date', [$from, $to])
                ->groupBy(DB::raw('coalesce(l.group_id, pl.class_group_id)'), 'pl.currency')
                ->get([DB::raw('coalesce(l.group_id, pl.class_group_id) as group_id'), 'pl.currency', DB::raw('sum(pl.amount_minor) as amount_minor')]) as $c) {
                $cost[(string) $c->group_id][(string) $c->currency] = (int) $c->amount_minor;
            }
        }

        $per = [];
        $totals = [];
        $unpaid = [];
        foreach ($lines as $l) {
            $gid = (string) $l->class_group_id;
            $cur = (string) $l->currency;
            $amount = (int) $l->amount_minor;
            $paidPart = $keeps ? min((int) $l->paid, $amount) : ($l->invoice_status === 'PAID' ? $amount : 0);
            $left = $amount - $paidPart;
            $per[$gid][$cur] ??= ['billed_minor' => 0, 'paid_minor' => 0, 'outstanding_minor' => 0, 'charges' => 0];
            $per[$gid][$cur]['billed_minor'] += $amount;
            $per[$gid][$cur]['paid_minor'] += $paidPart;
            $per[$gid][$cur]['outstanding_minor'] += $left;
            $per[$gid][$cur]['charges']++;
            $totals[$cur] ??= ['currency' => $cur, 'billed_minor' => 0, 'paid_minor' => 0, 'outstanding_minor' => 0, 'teacher_cost_minor' => 0];
            $totals[$cur]['billed_minor'] += $amount;
            $totals[$cur]['paid_minor'] += $paidPart;
            $totals[$cur]['outstanding_minor'] += $left;
            if ($left > 0) {
                $unpaid[] = [
                    'line_id' => (string) $l->id,
                    'group_id' => $gid,
                    'group_name' => (string) ($groups[$gid]->name ?? ''),
                    'student_id' => $l->student_id !== null ? (string) $l->student_id : null,
                    'student_name' => $l->full_name,
                    'description' => (string) $l->description,
                    'amount_minor' => $amount,
                    'paid_minor' => $paidPart,
                    'remaining_minor' => $left,
                    'currency' => $cur,
                    'invoice_status' => (string) $l->invoice_status,
                ];
            }
        }
        foreach ($cost as $byCurrency) {
            foreach ($byCurrency as $cur => $amount) {
                $totals[$cur] ??= ['currency' => $cur, 'billed_minor' => 0, 'paid_minor' => 0, 'outstanding_minor' => 0, 'teacher_cost_minor' => 0];
                $totals[$cur]['teacher_cost_minor'] += $amount;
            }
        }

        $rows = [];
        foreach ($groups as $gid => $g) {
            $money = $per[$gid] ?? [];
            $groupCost = $cost[$gid] ?? [];
            if ($money === [] && $groupCost === [] && $g->status === 'ARCHIVED') {
                continue; // an archived group with nothing this month is not part of the month
            }
            $currencies = array_unique([...array_keys($money), ...array_keys($groupCost)]);
            $rows[] = [
                'id' => $gid,
                'name' => (string) $g->name,
                'level' => $g->level,
                'teacher_name' => $g->teacher_name,
                'billing_mode' => (string) $g->billing_mode,
                'price_minor' => $g->price_minor !== null ? (int) $g->price_minor : null,
                'currency' => $g->currency,
                'money' => array_values(array_map(fn ($c) => [
                    'currency' => $c,
                    'billed_minor' => $money[$c]['billed_minor'] ?? 0,
                    'paid_minor' => $money[$c]['paid_minor'] ?? 0,
                    'outstanding_minor' => $money[$c]['outstanding_minor'] ?? 0,
                    'charges' => $money[$c]['charges'] ?? 0,
                    'teacher_cost_minor' => Gate::allows('payout.read') ? ($groupCost[$c] ?? 0) : null,
                ], $currencies)),
            ];
        }

        usort($unpaid, fn ($a, $b) => [$a['group_name'], $a['student_name']] <=> [$b['group_name'], $b['student_name']]);

        return response()->json([
            'month' => $month->format('Y-m'),
            'groups' => $rows,
            'totals' => array_values($totals),
            'unpaid' => $unpaid,
            'sees_teacher_cost' => Gate::allows('payout.read'),
            'accounting' => $keeps,
        ]);
    }

    /**
     * GET /api/group-reports?from=&to= — how the groups are doing over a window (default this
     * month): seats used, lessons held / cancelled / still owed, attendance — per group and per
     * teacher. Money roles also get what each group billed in the window.
     */
    public function reports(Request $request): JsonResponse
    {
        Gate::authorize('group.read');

        $tz = $this->academyTimezone($this->currentAcademyId());
        $data = $request->validate([
            'from' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            'to' => ['sometimes', 'nullable', 'date_format:Y-m-d', 'after_or_equal:from'],
        ]);
        $from = $data['from'] ?? Carbon::now($tz)->startOfMonth()->format('Y-m-d');
        $to = $data['to'] ?? Carbon::now($tz)->endOfMonth()->format('Y-m-d');
        $nowUtc = now()->utc()->format('Y-m-d H:i:sP');

        $groups = $this->scopeGroupsToCaller(DB::table('class_groups as g')->leftJoin('teachers as te', 'te.id', '=', 'g.teacher_id'))
            ->selectRaw("g.id, g.name, g.level, g.capacity, g.status, g.teacher_id, te.full_name as teacher_name,
                (select count(*) from class_group_members m where m.group_id = g.id and m.status = 'ACTIVE') as members")
            ->orderBy('g.name')
            ->get();
        $ids = $groups->pluck('id')->map(fn ($v) => (string) $v)->all();

        $lessonStats = [];
        $teacherStats = [];
        if ($ids !== []) {
            $lessons = DB::table('class_group_lessons as l')
                ->join('class_groups as g', 'g.id', '=', 'l.group_id')
                ->leftJoin('teachers as te', 'te.id', '=', 'l.teacher_id')
                ->whereIn('l.group_id', $ids)
                ->whereRaw('(l.scheduled_at_utc at time zone g.timezone)::date between ?::date and ?::date', [$from, $to])
                ->selectRaw("l.group_id, l.teacher_id, te.full_name as teacher_name,
                    count(*) filter (where l.status = 'HELD') as held,
                    count(*) filter (where l.status = 'CANCELLED') as cancelled,
                    count(*) filter (where l.status = 'SCHEDULED' and l.scheduled_at_utc < ?) as owed,
                    count(*) filter (where l.status = 'SCHEDULED' and l.scheduled_at_utc >= ?) as upcoming,
                    coalesce(sum(l.duration_minutes) filter (where l.status = 'HELD'), 0) as minutes", [$nowUtc, $nowUtc])
                ->groupBy('l.group_id', 'l.teacher_id', 'te.full_name')
                ->get();

            $marks = DB::table('class_group_attendance as a')
                ->join('class_group_lessons as l', 'l.id', '=', 'a.lesson_id')
                ->join('class_groups as g', 'g.id', '=', 'l.group_id')
                ->whereIn('l.group_id', $ids)
                ->where('l.status', 'HELD')
                ->whereRaw('(l.scheduled_at_utc at time zone g.timezone)::date between ?::date and ?::date', [$from, $to])
                ->selectRaw("l.group_id, l.teacher_id,
                    count(*) as marked,
                    count(*) filter (where a.status in ('PRESENT','LATE')) as came,
                    count(*) filter (where a.status = 'ABSENT') as absent,
                    count(*) filter (where a.status = 'EXCUSED') as excused")
                ->groupBy('l.group_id', 'l.teacher_id')
                ->get();

            $zero = ['held' => 0, 'cancelled' => 0, 'owed' => 0, 'upcoming' => 0, 'minutes' => 0, 'marked' => 0, 'came' => 0, 'absent' => 0, 'excused' => 0];
            foreach ($lessons as $r) {
                foreach (['held', 'cancelled', 'owed', 'upcoming', 'minutes'] as $k) {
                    $lessonStats[(string) $r->group_id][$k] = ($lessonStats[(string) $r->group_id][$k] ?? 0) + (int) $r->{$k};
                    $teacherStats[(string) $r->teacher_id][$k] = ($teacherStats[(string) $r->teacher_id][$k] ?? 0) + (int) $r->{$k};
                }
                $teacherStats[(string) $r->teacher_id]['name'] = $r->teacher_name;
                $teacherStats[(string) $r->teacher_id]['groups'][(string) $r->group_id] = true;
            }
            foreach ($marks as $r) {
                foreach (['marked', 'came', 'absent', 'excused'] as $k) {
                    $lessonStats[(string) $r->group_id][$k] = ($lessonStats[(string) $r->group_id][$k] ?? 0) + (int) $r->{$k};
                    $teacherStats[(string) $r->teacher_id][$k] = ($teacherStats[(string) $r->teacher_id][$k] ?? 0) + (int) $r->{$k};
                }
            }
            foreach ($lessonStats as $k => $v) {
                $lessonStats[$k] = $v + $zero;
            }
            foreach ($teacherStats as $k => $v) {
                $teacherStats[$k] = $v + $zero;
            }
        }

        $billed = [];
        if (Gate::allows('invoice.read') && $ids !== []) {
            foreach (DB::table('invoice_line_items')
                ->whereIn('class_group_id', $ids)
                ->whereBetween('group_period', [$from, $to])
                ->groupBy('class_group_id', 'currency')
                ->get(['class_group_id', 'currency', DB::raw('sum(amount_minor) as amount_minor')]) as $b) {
                $billed[(string) $b->class_group_id][] = ['currency' => (string) $b->currency, 'amount_minor' => (int) $b->amount_minor];
            }
        }

        $rate = fn (array $s): ?float => ($s['marked'] ?? 0) > 0 ? round($s['came'] / $s['marked'], 4) : null;

        $groupRows = $groups->map(function ($g) use ($lessonStats, $billed, $rate) {
            $s = $lessonStats[(string) $g->id] ?? ['held' => 0, 'cancelled' => 0, 'owed' => 0, 'upcoming' => 0, 'minutes' => 0, 'marked' => 0, 'came' => 0, 'absent' => 0, 'excused' => 0];

            return [
                'id' => (string) $g->id,
                'name' => (string) $g->name,
                'level' => $g->level,
                'teacher_name' => $g->teacher_name,
                'status' => (string) $g->status,
                'members' => (int) $g->members,
                'capacity' => $g->capacity !== null ? (int) $g->capacity : null,
                'occupancy' => $g->capacity ? round(((int) $g->members) / (int) $g->capacity, 4) : null,
                'lessons' => array_intersect_key($s, array_flip(['held', 'cancelled', 'owed', 'upcoming', 'minutes'])),
                'attendance' => array_intersect_key($s, array_flip(['marked', 'came', 'absent', 'excused'])) + ['rate' => $rate($s)],
                'billed' => $billed[(string) $g->id] ?? (Gate::allows('invoice.read') ? [] : null),
            ];
        })->filter(fn ($r) => $r['status'] === 'ACTIVE' || $r['lessons']['held'] + $r['lessons']['owed'] > 0)->values();

        $teacherRows = collect($teacherStats)->map(fn ($s, $id) => [
            'id' => (string) $id,
            'name' => $s['name'] ?? null,
            'groups' => count($s['groups'] ?? []),
            'lessons' => array_intersect_key($s, array_flip(['held', 'cancelled', 'owed', 'upcoming', 'minutes'])),
            'attendance' => array_intersect_key($s, array_flip(['marked', 'came', 'absent', 'excused'])) + ['rate' => $rate($s)],
        ])->sortBy('name')->values();

        $all = array_reduce($lessonStats, function ($c, $s) {
            foreach ($s as $k => $v) {
                $c[$k] = ($c[$k] ?? 0) + $v;
            }

            return $c;
        }, ['held' => 0, 'cancelled' => 0, 'owed' => 0, 'upcoming' => 0, 'minutes' => 0, 'marked' => 0, 'came' => 0, 'absent' => 0, 'excused' => 0]);
        $members = (int) $groups->where('status', 'ACTIVE')->sum('members');
        $capacity = (int) $groups->where('status', 'ACTIVE')->whereNotNull('capacity')->sum('capacity');

        return response()->json([
            'from' => $from,
            'to' => $to,
            'totals' => [
                'groups' => $groups->where('status', 'ACTIVE')->count(),
                'members' => $members,
                'capacity' => $capacity > 0 ? $capacity : null,
                'lessons' => array_intersect_key($all, array_flip(['held', 'cancelled', 'owed', 'upcoming', 'minutes'])),
                'attendance' => array_intersect_key($all, array_flip(['marked', 'came', 'absent', 'excused'])) + ['rate' => $rate($all)],
            ],
            'groups' => $groupRows,
            'teachers' => $teacherRows,
        ]);
    }

    // ── internals ────────────────────────────────────────────────────────────

    /** Group lessons joined to their group and teacher, narrowed to the caller's groups. */
    private function lessonQuery(array $data): Builder
    {
        $query = DB::table('class_group_lessons as l')
            ->join('class_groups as g', 'g.id', '=', 'l.group_id')
            ->leftJoin('teachers as te', 'te.id', '=', 'l.teacher_id')
            ->select([
                'l.*', 'te.full_name as teacher_name',
                'g.name as group_name', 'g.level as group_level', 'g.timezone as group_timezone',
                'g.mode as group_mode', 'g.location as group_location',
            ])
            ->when(! empty($data['group_id']), fn ($q) => $q->where('l.group_id', $data['group_id']))
            ->when(! empty($data['teacher_id']), fn ($q) => $q->where('l.teacher_id', $data['teacher_id']));

        // A TEACHER: the lessons they take, and every lesson of a group they teach.
        if ($this->isTeacher()) {
            $teacherId = $this->ownTeacherId();
            $query->where(fn ($q) => $q->where('l.teacher_id', $teacherId)->orWhere('g.teacher_id', $teacherId));
        }

        return $query;
    }

    /**
     * Attendance per (group, student) over held lessons.
     *
     * @param  list<string>  $groupIds
     * @return array<string, array{present:int, late:int, absent:int, excused:int, marked:int}>
     */
    private function attendanceByPair(array $groupIds): array
    {
        if ($groupIds === []) {
            return [];
        }

        $out = [];
        foreach (DB::table('class_group_attendance as a')
            ->join('class_group_lessons as l', 'l.id', '=', 'a.lesson_id')
            ->whereIn('a.group_id', $groupIds)
            ->where('l.status', 'HELD')
            ->groupBy('a.group_id', 'a.student_id')
            ->selectRaw("a.group_id, a.student_id,
                count(*) filter (where a.status = 'PRESENT') as present,
                count(*) filter (where a.status = 'LATE') as late,
                count(*) filter (where a.status = 'ABSENT') as absent,
                count(*) filter (where a.status = 'EXCUSED') as excused,
                count(*) as marked")
            ->get() as $r) {
            $out[$r->group_id.'|'.$r->student_id] = [
                'present' => (int) $r->present,
                'late' => (int) $r->late,
                'absent' => (int) $r->absent,
                'excused' => (int) $r->excused,
                'marked' => (int) $r->marked,
            ];
        }

        return $out;
    }

    /**
     * Each (group, student)'s last few marks, newest first — what an absence streak is read from.
     *
     * @param  list<string>  $groupIds
     * @return array<string, list<string>>
     */
    private function recentMarks(array $groupIds): array
    {
        if ($groupIds === []) {
            return [];
        }

        $ranked = DB::table('class_group_attendance as a')
            ->join('class_group_lessons as l', 'l.id', '=', 'a.lesson_id')
            ->whereIn('a.group_id', $groupIds)
            ->where('l.status', 'HELD')
            ->selectRaw('a.group_id, a.student_id, a.status, row_number() over (partition by a.group_id, a.student_id order by l.scheduled_at_utc desc) as rn');

        $out = [];
        foreach (DB::query()->fromSub($ranked, 'r')->where('rn', '<=', 5)->orderBy('rn')->get() as $r) {
            $out[$r->group_id.'|'.$r->student_id][] = (string) $r->status;
        }

        return $out;
    }

    /**
     * This month's group charges per (group, student): what was charged and what is still unpaid.
     *
     * @param  list<string>  $groupIds
     * @return array<string, array{currency:string, billed_minor:int, outstanding_minor:int}>
     */
    private function monthCharges(array $groupIds): array
    {
        if ($groupIds === []) {
            return [];
        }

        $tz = $this->academyTimezone($this->currentAcademyId());
        $from = Carbon::now($tz)->startOfMonth()->format('Y-m-d');
        $to = Carbon::now($tz)->endOfMonth()->format('Y-m-d');

        $out = [];
        foreach (DB::table('invoice_line_items as li')
            ->join('invoices as inv', 'inv.id', '=', 'li.invoice_id')
            ->whereIn('li.class_group_id', $groupIds)
            ->whereBetween('li.group_period', [$from, $to])
            ->get(['li.class_group_id', 'li.student_id', 'li.amount_minor', 'li.currency', 'inv.status']) as $l) {
            $key = $l->class_group_id.'|'.$l->student_id;
            $out[$key] ??= ['currency' => (string) $l->currency, 'billed_minor' => 0, 'outstanding_minor' => 0];
            $out[$key]['billed_minor'] += (int) $l->amount_minor;
            if ($l->status !== 'PAID') {
                $out[$key]['outstanding_minor'] += (int) $l->amount_minor;
            }
        }

        return $out;
    }
}
