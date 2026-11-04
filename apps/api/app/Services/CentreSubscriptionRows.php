<?php

declare(strict_types=1);

namespace App\Services;

use App\Support\AuthContext;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Reading centre subscriptions the way the screens list them — the `SubscriptionRow` of the API
 * contract (docs/centre-profile/01-PRIVATE-SUBSCRIPTION-SPLIT.md), the four views, the summary and
 * the student picker. Reads only; every write is {@see CentreSubscriptions}'.
 */
final class CentreSubscriptionRows
{
    public const VIEWS = ['open', 'due', 'finished', 'outside'];

    private const ENDING_LESSONS = 2;

    private const NIL = '00000000-0000-0000-0000-000000000000';

    public function __construct(private readonly SubscriptionSettlement $settlement) {}

    /**
     * GET /subscriptions.
     *
     * @param  array{view?: ?string, student_id?: ?string, teacher_id?: ?string, q?: ?string, page?: int, per_page?: int}  $f
     * @return array{rows: list<array<string, mixed>>, summary: array<string, mixed>, meta: array<string, int>, outside: list<array<string, mixed>>}
     */
    public function listing(array $f): array
    {
        $view = in_array($f['view'] ?? null, self::VIEWS, true) ? $f['view'] : null;
        $q = $this->query();
        match ($view) {
            'open' => $q->where('cs.status', 'OPEN'),
            'due' => $this->whereDue($q),
            'finished' => $q->whereIn('cs.status', ['FINISHED', 'CLOSED']),
            'outside' => $q->whereIn('cs.id', $this->latestOfOutsideStudents()),
            default => null,
        };
        if (($f['student_id'] ?? null) !== null) {
            $q->where('cs.student_id', (string) $f['student_id']);
        }
        if (($f['teacher_id'] ?? null) !== null) {
            $q->where('cs.teacher_id', (string) $f['teacher_id']);
        }
        if (trim((string) ($f['q'] ?? '')) !== '') {
            $like = '%'.trim((string) $f['q']).'%';
            $q->where(fn ($w) => $w->where('s.full_name', 'ilike', $like)->orWhere('g.full_name', 'ilike', $like)->orWhere('cs.label', 'ilike', $like));
        }
        if ($view === 'finished') {
            // Unrenewed first — the ones the desk still has to sell the next block for.
            $q->orderByRaw('(not exists ('.$this->renewedSql().')) desc')->orderByRaw('coalesce(cs.finished_at, cs.closed_at) desc nulls last');
        } else {
            $q->orderBy('s.full_name')->orderByDesc('cs.sequence_no');
        }

        $perPage = max(1, min(200, (int) ($f['per_page'] ?? 50)));
        $page = max(1, (int) ($f['page'] ?? 1));
        $total = (int) (clone $q)->getCountForPagination();
        $rows = $this->present($q->forPage($page, $perPage)->get());

        return [
            'rows' => $rows,
            'summary' => $this->summary(),
            'meta' => ['page' => $page, 'per_page' => $perPage, 'total' => $total],
            'outside' => $view === 'outside' ? $this->outsideStudents() : [],
        ];
    }

    /** @return list<array<string, mixed>> */
    public function forStudent(string $studentId): array
    {
        return $this->present($this->query()->where('cs.student_id', $studentId)->orderByDesc('cs.sequence_no')->get());
    }

    /** @return array<string, mixed>|null */
    public function one(string $id): ?array
    {
        $rows = $this->present($this->query()->where('cs.id', $id)->get());

        return $rows[0] ?? null;
    }

    /**
     * The lessons that sat on a block, oldest first — LessonRow[].
     *
     * @return list<array<string, mixed>>
     */
    public function lessons(string $id): array
    {
        $n = 0;

        return DB::table('centre_subscription_lessons as l')
            ->join('sessions as se', 'se.id', '=', 'l.session_id')
            ->leftJoin('teachers as t', 't.id', '=', 'se.teacher_id')
            ->where('l.subscription_id', $id)
            ->orderBy('se.scheduled_at_utc')
            ->get(['l.session_id', 'l.counted_at', 'se.scheduled_at_utc', 'se.duration_minutes', 'se.status', 't.full_name as teacher_name'])
            ->map(function ($l) use (&$n): array {
                return [
                    'session_id' => (string) $l->session_id,
                    'scheduled_at_utc' => Carbon::parse($l->scheduled_at_utc)->utc()->toIso8601String(),
                    'duration_minutes' => (int) $l->duration_minutes,
                    'teacher_name' => $l->teacher_name,
                    'status' => (string) $l->status,
                    'counted_at' => $l->counted_at !== null ? Carbon::parse($l->counted_at)->utc()->toIso8601String() : null,
                    'number' => ++$n,
                ];
            })->values()->all();
    }

    /** @return array{open: int, finished_unrenewed: int, outside_students: int, due_count: int, outstanding: list<array{currency: string, minor: int}>, ending: int} */
    public function summary(): array
    {
        $open = DB::table('centre_subscriptions as cs')->where('cs.status', 'OPEN')
            ->selectRaw('count(*) as open')
            ->selectRaw('count(*) filter (where cs.lessons_sold - ('.$this->usedSql().') <= ?) as ending', [self::ENDING_LESSONS])
            ->first();
        $unrenewed = (int) DB::table('centre_subscriptions as cs')->join('students as s', 's.id', '=', 'cs.student_id')
            ->whereNull('s.deleted_at')->whereIn('cs.status', ['FINISHED', 'CLOSED'])
            ->whereRaw('not exists ('.$this->renewedSql().')')->count();
        $due = $this->whereDue(DB::table('centre_subscriptions as cs')->join('invoices as i', 'i.id', '=', 'cs.invoice_id'))
            ->groupBy('i.currency')->selectRaw('i.currency, count(*) as n, sum(i.total_minor - i.amount_paid_minor) as minor')->get();
        $outside = (int) DB::table('centre_subscription_lessons as l')->join('students as s', 's.id', '=', 'l.student_id')
            ->whereNull('l.subscription_id')->whereNull('s.deleted_at')->distinct()->count('l.student_id');

        return [
            'open' => (int) $open->open,
            'finished_unrenewed' => $unrenewed,
            'outside_students' => $outside,
            'due_count' => (int) $due->sum('n'),
            'outstanding' => $due->map(fn ($r) => ['currency' => (string) $r->currency, 'minor' => (int) $r->minor])->values()->all(),
            'ending' => (int) $open->ending,
        ];
    }

    /**
     * GET /subscriptions/students — every active student, their subjects, which hold an open block.
     *
     * @return list<array<string, mixed>>
     */
    public function studentPicks(?string $q): array
    {
        $students = DB::table('students as s')->leftJoin('guardians as g', 'g.id', '=', 's.guardian_id')
            ->whereNull('s.deleted_at')
            ->when(trim((string) $q) !== '', fn ($w) => $w->where(fn ($x) => $x->where('s.full_name', 'ilike', '%'.trim((string) $q).'%')->orWhere('g.full_name', 'ilike', '%'.trim((string) $q).'%')))
            ->orderBy('s.full_name')->limit(500)
            ->get(['s.id', 's.full_name', 's.status', 'g.full_name as guardian_name', 'g.currency']);
        $ids = $students->pluck('id')->map(fn ($v) => (string) $v)->all() ?: [self::NIL];

        $links = DB::table('student_teacher_assignments as a')->join('teachers as t', 't.id', '=', 'a.teacher_id')
            ->whereIn('a.student_id', $ids)->whereNull('a.ended_at')->orderBy('t.full_name')
            ->get(['a.student_id', 'a.teacher_id', 't.full_name as teacher_name', 'a.course'])->groupBy(fn ($a) => (string) $a->student_id);
        $open = DB::table('centre_subscriptions')->whereIn('student_id', $ids)->where('status', 'OPEN')
            ->get(['id', 'student_id', 'teacher_id', 'course'])->groupBy(fn ($b) => (string) $b->student_id);
        $timetables = DB::table('schedules')->whereIn('student_id', $ids)->where('is_active', true)->whereNull('deleted_at')
            ->get(['student_id', 'teacher_id'])->groupBy(fn ($t) => (string) $t->student_id);
        $outside = DB::table('centre_subscription_lessons')->whereIn('student_id', $ids)->whereNull('subscription_id')
            ->groupBy('student_id')->selectRaw('student_id, count(*) as n')->pluck('n', 'student_id');

        return $students->map(function ($s) use ($links, $open, $timetables, $outside): array {
            $id = (string) $s->id;
            $blocks = $open->get($id, collect());
            $subjects = $links->get($id, collect())->map(function ($a) use ($blocks): array {
                $key = CentreSubscriptions::courseKey($a->course);
                $block = $blocks->first(fn ($b) => (string) $b->teacher_id === (string) $a->teacher_id && CentreSubscriptions::courseKey($b->course) === $key)
                    ?? $blocks->first(fn ($b) => (string) $b->teacher_id === (string) $a->teacher_id && trim((string) $a->course) === '');

                return ['teacher_id' => (string) $a->teacher_id, 'teacher_name' => $a->teacher_name, 'course' => $a->course,
                    'open_subscription_id' => $block !== null ? (string) $block->id : null];
            })->values()->all();
            // A subject sold on a block but not on the links (a second subject with one teacher).
            foreach ($blocks->whereNotNull('teacher_id') as $b) {
                if (! collect($subjects)->contains(fn ($x) => $x['teacher_id'] === (string) $b->teacher_id && CentreSubscriptions::courseKey($x['course']) === CentreSubscriptions::courseKey($b->course))) {
                    $subjects[] = ['teacher_id' => (string) $b->teacher_id, 'teacher_name' => DB::table('teachers')->where('id', $b->teacher_id)->value('full_name'),
                        'course' => $b->course, 'open_subscription_id' => (string) $b->id];
                }
            }
            $untied = $blocks->first(fn ($b) => $b->teacher_id === null);

            return [
                'id' => $id, 'full_name' => (string) $s->full_name, 'guardian_name' => $s->guardian_name, 'status' => (string) $s->status,
                'currency' => $s->currency !== null ? (string) $s->currency : null,
                'subjects' => $subjects,
                'untied_open_subscription_id' => $untied !== null ? (string) $untied->id : null,
                'has_timetable_for' => $timetables->get($id, collect())->pluck('teacher_id')->filter()->map(fn ($v) => (string) $v)->unique()->values()->all(),
                'outside_count' => (int) ($outside[$id] ?? 0),
            ];
        })->values()->all();
    }

    /**
     * The students with lessons outside any block, with those lessons — the "outside" tab.
     *
     * @return list<array<string, mixed>>
     */
    public function outsideStudents(): array
    {
        return DB::table('centre_subscription_lessons as l')
            ->join('students as s', 's.id', '=', 'l.student_id')
            ->leftJoin('guardians as g', 'g.id', '=', 's.guardian_id')
            ->leftJoin('teachers as t', 't.id', '=', 'l.teacher_id')
            ->whereNull('l.subscription_id')->whereNull('s.deleted_at')
            ->orderBy('s.full_name')->orderBy('l.lesson_on')
            ->get(['l.student_id', 's.full_name as student_name', 's.guardian_id', 'g.full_name as guardian_name', 'l.teacher_id', 't.full_name as teacher_name', 'l.course', 'l.lesson_on', 'l.session_id'])
            ->groupBy(fn ($l) => (string) $l->student_id.'|'.(string) $l->teacher_id.'|'.CentreSubscriptions::courseKey($l->course))
            ->map(fn (Collection $of) => [
                'student' => ['id' => (string) $of->first()->student_id, 'full_name' => (string) $of->first()->student_name,
                    'guardian_id' => $of->first()->guardian_id !== null ? (string) $of->first()->guardian_id : null, 'guardian_name' => $of->first()->guardian_name],
                'teacher' => $of->first()->teacher_id !== null ? ['id' => (string) $of->first()->teacher_id, 'full_name' => $of->first()->teacher_name] : null,
                'course' => $of->first()->course,
                'count' => $of->count(),
                'first_on' => Carbon::parse($of->first()->lesson_on)->format('Y-m-d'),
                'last_on' => Carbon::parse($of->last()->lesson_on)->format('Y-m-d'),
                'session_ids' => $of->pluck('session_id')->map(fn ($v) => (string) $v)->values()->all(),
            ])->values()->all();
    }

    // ── the query ───────────────────────────────────────────────────────────

    public function query(): Builder
    {
        $renewed = $this->renewedSql();
        $outsideOf = "select count(*) from centre_subscription_lessons o where o.subscription_id is null and o.student_id = cs.student_id"
            ." and (cs.teacher_id is null or (o.teacher_id = cs.teacher_id and (o.course is null or lower(trim(o.course)) = lower(trim(coalesce(cs.course, ''))))))";
        $ofSubject = '(cs.teacher_id is null or (coalesce((select sc.teacher_id from schedules sc where sc.id = {a}.schedule_id), {a}.teacher_id) = cs.teacher_id'
            ." and ({a}.course is null or lower(trim({a}.course)) = lower(trim(coalesce(cs.course, ''))))))";

        return DB::table('centre_subscriptions as cs')
            ->join('students as s', 's.id', '=', 'cs.student_id')
            ->leftJoin('guardians as g', 'g.id', '=', 's.guardian_id')
            ->leftJoin('teachers as t', 't.id', '=', 'cs.teacher_id')
            ->leftJoin('invoices as i', 'i.id', '=', 'cs.invoice_id')
            ->leftJoin('users as cu', 'cu.id', '=', 'cs.closed_by')
            ->leftJoin('users as ou', 'ou.id', '=', 'cs.opened_by')
            ->select(['cs.*', 's.full_name as student_name', 's.guardian_id', 's.is_self_guardian', 's.deleted_at as student_deleted_at',
                'g.full_name as guardian_name', 't.full_name as teacher_name',
                'i.status as invoice_status', 'i.total_minor as invoice_total_minor', 'i.amount_paid_minor as invoice_paid_minor', 'i.public_token as invoice_token',
                'cu.full_name as closed_by_name', 'ou.full_name as opened_by_name'])
            ->selectRaw('('.$this->usedSql().') as lessons_used')
            ->selectRaw("({$outsideOf}) as outside_count")
            ->selectRaw("(select x.id from ({$renewed}) x limit 1) as renewed_by")
            ->selectRaw("(select count(*) from sessions up where up.student_id = cs.student_id and up.status in ('SCHEDULED','RESCHEDULED') and up.hidden_at is null and up.scheduled_at_utc >= now() and ".str_replace('{a}', 'up', $ofSubject).') as upcoming_lesson_count')
            ->selectRaw("(select min(nx.scheduled_at_utc) from sessions nx where nx.student_id = cs.student_id and nx.status in ('SCHEDULED','RESCHEDULED') and nx.hidden_at is null and nx.scheduled_at_utc >= now() and ".str_replace('{a}', 'nx', $ofSubject).') as next_lesson_at');
    }

    private function usedSql(): string
    {
        return 'select count(*) from centre_subscription_lessons u where u.subscription_id = cs.id';
    }

    /** An OPEN block of the same student and subject, sold after this one. */
    private function renewedSql(): string
    {
        return "select n.id from centre_subscriptions n where n.student_id = cs.student_id and n.status = 'OPEN' and n.sequence_no > cs.sequence_no"
            ." and n.teacher_id is not distinct from cs.teacher_id and lower(trim(coalesce(n.course, ''))) = lower(trim(coalesce(cs.course, '')))";
    }

    private function whereDue(Builder $q): Builder
    {
        return $q->where('cs.status', '<>', 'CANCELLED')->whereNotNull('cs.invoice_id')->where('i.status', '<>', 'VOID')->whereColumn('i.total_minor', '>', 'i.amount_paid_minor');
    }

    /** @return list<string> the latest block of each student with outside lessons */
    private function latestOfOutsideStudents(): array
    {
        return DB::table('centre_subscriptions as cs')
            ->whereIn('cs.student_id', fn ($w) => $w->select('student_id')->from('centre_subscription_lessons')->whereNull('subscription_id'))
            ->whereRaw('cs.sequence_no = (select max(m.sequence_no) from centre_subscriptions m where m.student_id = cs.student_id)')
            ->pluck('cs.id')->map(fn ($v) => (string) $v)->all() ?: [self::NIL];
    }

    /**
     * @param  Collection<int, object>  $rows
     * @return list<array<string, mixed>>
     */
    private function present(Collection $rows): array
    {
        if ($rows->isEmpty()) {
            return [];
        }
        $academyId = (string) app(AuthContext::class)->academyId;
        $payFirst = RenewalPolicy::payingFirst($academyId, $rows->pluck('student_id')->map(fn ($v) => (string) $v)->unique()->all());

        return $rows->map(function ($r) use ($payFirst): array {
            $used = (int) $r->lessons_used;
            $sold = (int) $r->lessons_sold;
            $billed = $r->invoice_status !== null && $r->invoice_status !== 'VOID';
            $paid = $billed ? (int) $r->invoice_paid_minor : 0;
            $outstanding = $billed ? max(0, (int) $r->invoice_total_minor - $paid) : 0;
            $settlementMinor = $r->settled_minor !== null ? (int) $r->settled_minor
                : ($r->settlement === 'PENDING' ? ($this->settlement->preview($r)['owed_back_minor'] ?? null) : null);

            return [
                'id' => (string) $r->id,
                'sequence_no' => (int) $r->sequence_no,
                'student' => ['id' => (string) $r->student_id, 'full_name' => (string) $r->student_name,
                    'guardian_id' => $r->guardian_id !== null ? (string) $r->guardian_id : null, 'guardian_name' => $r->guardian_name,
                    'is_self_guardian' => (bool) $r->is_self_guardian, 'deleted' => $r->student_deleted_at !== null],
                'teacher' => $r->teacher_id !== null ? ['id' => (string) $r->teacher_id, 'full_name' => $r->teacher_name] : null,
                'course' => $r->course,
                'label' => (string) $r->label,
                'lessons_sold' => $sold,
                'lessons_used' => $used,
                'lessons_left' => max(0, $sold - $used),
                'lesson_minutes' => $r->lesson_minutes !== null ? (int) $r->lesson_minutes : null,
                'lesson_price_minor' => (int) $r->lesson_price_minor,
                'price_minor' => (int) $r->price_minor,
                'currency' => (string) $r->currency,
                'starts_on' => Carbon::parse($r->starts_on)->format('Y-m-d'),
                'status' => (string) $r->status,
                'finished_at' => $r->finished_at !== null ? Carbon::parse($r->finished_at)->utc()->toIso8601String() : null,
                'closed_at' => $r->closed_at !== null ? Carbon::parse($r->closed_at)->utc()->toIso8601String() : null,
                'closed_reason' => $r->closed_reason,
                'closed_by_name' => $r->closed_by_name,
                'invoice_id' => $r->invoice_id !== null ? (string) $r->invoice_id : null,
                'invoice_line_id' => $r->invoice_line_id !== null ? (string) $r->invoice_line_id : null,
                'invoice_status' => $r->invoice_status !== null ? (string) $r->invoice_status : null,
                'invoice_token' => $r->invoice_token !== null ? (string) $r->invoice_token : null,
                'invoice_paid_minor' => $paid,
                'outstanding_minor' => $outstanding,
                'settlement' => $r->settlement,
                'settlement_minor' => $settlementMinor,
                'next_lesson_at' => $r->next_lesson_at !== null ? Carbon::parse($r->next_lesson_at)->utc()->toIso8601String() : null,
                'upcoming_lesson_count' => (int) $r->upcoming_lesson_count,
                'outside_count' => (int) $r->outside_count,
                'renewed' => $r->renewed_by !== null,
                'renewal_held' => isset($payFirst[(string) $r->student_id]) && $r->renewed_by === null && $r->status !== 'CANCELLED' && $outstanding > 0,
                'deletable' => $r->status === 'OPEN' && $used === 0 && $paid === 0,
                'reminders_sent' => (int) $r->reminders_sent,
                'last_reminded_at' => $r->last_reminded_at !== null ? Carbon::parse($r->last_reminded_at)->utc()->toIso8601String() : null,
                'opened_by_name' => $r->opened_by_name,
                'created_at' => Carbon::parse($r->created_at)->utc()->toIso8601String(),
            ];
        })->values()->all();
    }
}
