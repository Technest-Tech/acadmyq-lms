<?php

declare(strict_types=1);

namespace App\Services;

use App\Support\AcademyUrl;
use App\Support\StudentTeachers;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * What a parent sees on their page (`/p/{token}`): their children, the lessons coming up, the
 * lessons just taken with their reports, the approved monthly reports, and the family's bills.
 *
 * Runs inside the family's tenant context (GuardianPortalController sets it), so RLS scopes every
 * read; this class only decides WHICH rows a parent is shown and in what shape. The payload is an
 * allow-list: names, times, statuses, report text and amounts — never a phone number, a price
 * setting, a staff note or an internal id other than the children's own (the page filters by them).
 *
 * The private lesson (`sessions`) and the group lesson (`class_group_lessons` + the child's row on
 * its sheet) are two tables but one thing to a parent, so both come out as the same `lesson` shape.
 */
final class GuardianPortal
{
    /** How far ahead the "coming up" list looks, and how many lessons it lists at most. */
    private const UPCOMING_DAYS = 14;

    private const UPCOMING_LIMIT = 30;

    /** How far back the history looks, and how many lessons it lists at most. */
    private const RECENT_DAYS = 60;

    private const RECENT_LIMIT = 40;

    private const PROGRESS_LIMIT = 12;

    private const INVOICE_LIMIT = 24;

    /** A private lesson's status as the parent reads it. RESCHEDULED never shows: its successor does. */
    private const PRIVATE_STATUS = [
        'ATTENDED' => 'ATTENDED',
        'FREE' => 'ATTENDED',
        'ABSENT_UNEXCUSED' => 'ABSENT',
        'ABSENT_EXCUSED' => 'EXCUSED',
        'CANCELLED_BY_TEACHER' => 'CANCELLED_BY_TEACHER',
        'CANCELLED_BY_STUDENT' => 'CANCELLED_BY_STUDENT',
    ];

    /** A group-sheet mark as the parent reads it. */
    private const GROUP_STATUS = [
        'PRESENT' => 'ATTENDED',
        'LATE' => 'LATE',
        'ABSENT' => 'ABSENT',
        'EXCUSED' => 'EXCUSED',
    ];

    /** @return array<string, mixed> */
    public function build(string $guardianId, string $academyId): array
    {
        $academy = DB::table('academies')->where('id', $academyId)
            ->first(['name', 'brand_display_name', 'brand_logo_url', 'timezone']);
        $guardian = DB::table('guardians')->where('id', $guardianId)->first(['full_name']);

        $tz = (string) ($academy->timezone ?? 'UTC');
        $now = Carbon::now();

        // Children still with the academy. One who left keeps their bills on the family's account
        // (below), but their timetable is over, so they get no card.
        $children = DB::table('students as s')
            ->leftJoinSub(StudentTeachers::summary(), 'sta', 'sta.student_id', '=', 's.id')
            ->where('s.guardian_id', $guardianId)
            ->whereNull('s.deleted_at')
            ->orderBy('s.full_name')
            ->get(['s.id', 's.full_name', 'sta.teachers'])
            ->map(fn (object $row): object => StudentTeachers::decodeRow($row));
        $ids = $children->pluck('id')->map(fn ($id) => (string) $id)->all();

        $upcoming = $this->upcoming($ids, $now);
        $recent = $this->recent($ids, $now);

        return [
            'academy' => [
                'name' => trim((string) ($academy->brand_display_name ?? '')) ?: (string) ($academy->name ?? ''),
                'logo_url' => trim((string) ($academy->brand_logo_url ?? '')) ?: null,
                'timezone' => $tz,
            ],
            'guardian' => ['name' => (string) ($guardian->full_name ?? '')],
            'children' => $this->children($children, $ids, $upcoming, $tz, $now),
            'upcoming' => $upcoming,
            'recent' => $recent,
            'progress_reports' => $this->progressReports($ids),
            ...$this->invoices($guardianId, $academyId, $tz, $now),
        ];
    }

    /**
     * One card per child: who teaches them, their groups, the hours left on their package, this
     * month so far, and their next lesson.
     *
     * @param  Collection<int, object>  $children
     * @param  list<string>  $ids
     * @param  list<array<string, mixed>>  $upcoming
     * @return list<array<string, mixed>>
     */
    private function children(Collection $children, array $ids, array $upcoming, string $tz, Carbon $now): array
    {
        if ($ids === []) {
            return [];
        }

        $groups = DB::table('class_group_members as m')
            ->join('class_groups as g', 'g.id', '=', 'm.group_id')
            ->leftJoin('teachers as t', 't.id', '=', 'g.teacher_id')
            ->whereIn('m.student_id', $ids)
            ->where('m.status', 'ACTIVE')
            ->where('g.status', 'ACTIVE')
            ->orderBy('g.name')
            ->get(['m.student_id', 'g.name', 't.full_name as teacher_name'])
            ->groupBy('student_id');

        // A child can hold one open package per course. `course` is read through to_jsonb so this
        // stays valid on a schema that predates per-course packages (it is simply null there).
        $packages = DB::table('lesson_packages as p')
            ->whereIn('p.student_id', $ids)
            ->where('p.status', 'ACTIVE')
            ->orderBy('p.starts_on')
            ->get(['p.student_id', 'p.label', 'p.minutes_total', 'p.carried_over_minutes', 'p.minutes_consumed', 'p.expires_on',
                DB::raw("to_jsonb(p) ->> 'course' as course")])
            ->groupBy('student_id');

        // "This month" is the academy's calendar month — the one its bills are cut on.
        $monthStart = $now->copy()->setTimezone($tz)->startOfMonth();
        $from = $monthStart->toIso8601String();
        $to = $monthStart->copy()->addMonth()->toIso8601String();

        $private = DB::table('sessions')
            ->whereIn('student_id', $ids)
            ->whereNull('hidden_at')
            ->where('scheduled_at_utc', '>=', $from)
            ->where('scheduled_at_utc', '<', $to)
            ->groupBy('student_id')
            ->selectRaw("student_id,
                count(*) filter (where status in ('ATTENDED','FREE')) as attended,
                count(*) filter (where status in ('ABSENT_UNEXCUSED','ABSENT_EXCUSED')) as absent,
                coalesce(sum(duration_minutes) filter (where status in ('ATTENDED','FREE')), 0) as minutes")
            ->get()
            ->keyBy('student_id');

        $group = DB::table('class_group_attendance as a')
            ->join('class_group_lessons as l', 'l.id', '=', 'a.lesson_id')
            ->whereIn('a.student_id', $ids)
            ->where('l.status', 'HELD')
            ->where('l.scheduled_at_utc', '>=', $from)
            ->where('l.scheduled_at_utc', '<', $to)
            ->groupBy('a.student_id')
            ->selectRaw("a.student_id,
                count(*) filter (where a.status in ('PRESENT','LATE')) as attended,
                count(*) filter (where a.status in ('ABSENT','EXCUSED')) as absent,
                coalesce(sum(l.duration_minutes) filter (where a.status in ('PRESENT','LATE')), 0) as minutes")
            ->get()
            ->keyBy('student_id');

        $lessons = app(LessonPackages::class);

        return $children->map(function (object $child) use ($groups, $packages, $private, $group, $upcoming, $lessons): array {
            $id = (string) $child->id;
            $p = $private->get($id);
            $g = $group->get($id);
            $next = collect($upcoming)->firstWhere('child_id', $id);

            return [
                'id' => $id,
                'name' => (string) $child->full_name,
                'teachers' => collect($child->teachers ?? [])
                    ->map(fn (array $t): array => ['name' => (string) ($t['teacher_name'] ?? ''), 'course' => $t['course'] ?? null])
                    ->values()->all(),
                'groups' => collect($groups->get($id, []))
                    ->map(fn (object $row): array => ['name' => (string) $row->name, 'teacher' => $row->teacher_name])
                    ->values()->all(),
                'packages' => collect($packages->get($id, []))
                    ->map(fn (object $p): array => [
                        'label' => (string) $p->label,
                        'course' => $p->course,
                        'total_minutes' => (int) $p->minutes_total + (int) $p->carried_over_minutes,
                        'remaining_minutes' => $lessons->remainingMinutes($p),
                        'expires_on' => $p->expires_on,
                    ])->values()->all(),
                'month' => [
                    'attended' => (int) ($p->attended ?? 0) + (int) ($g->attended ?? 0),
                    'absent' => (int) ($p->absent ?? 0) + (int) ($g->absent ?? 0),
                    'minutes' => (int) ($p->minutes ?? 0) + (int) ($g->minutes ?? 0),
                ],
                'next_lesson' => $next,
            ];
        })->values()->all();
    }

    /**
     * Lessons that have not ended yet, soonest first — a lesson in progress still counts.
     *
     * @param  list<string>  $ids
     * @return list<array<string, mixed>>
     */
    private function upcoming(array $ids, Carbon $now): array
    {
        if ($ids === []) {
            return [];
        }

        $at = $now->toIso8601String();
        $until = $now->copy()->addDays(self::UPCOMING_DAYS)->toIso8601String();

        $private = DB::table('sessions as se')
            ->leftJoin('teachers as t', 't.id', '=', 'se.teacher_id')
            ->whereIn('se.student_id', $ids)
            ->whereNull('se.hidden_at')
            ->where('se.status', 'SCHEDULED')
            ->whereRaw('se.scheduled_at_utc + make_interval(mins => se.duration_minutes) > ?::timestamptz', [$at])
            ->where('se.scheduled_at_utc', '<', $until)
            ->orderBy('se.scheduled_at_utc')
            ->limit(self::UPCOMING_LIMIT)
            ->get(['se.id', 'se.student_id', 'se.scheduled_at_utc', 'se.duration_minutes', 't.full_name as teacher_name'])
            ->map(fn (object $r): array => $this->lesson($r, 'PRIVATE', 'SCHEDULED'));

        $group = $this->groupLessons($ids)
            ->where('g.status', 'ACTIVE')
            ->where('l.status', 'SCHEDULED')
            ->whereRaw('l.scheduled_at_utc + make_interval(mins => l.duration_minutes) > ?::timestamptz', [$at])
            ->where('l.scheduled_at_utc', '<', $until)
            ->orderBy('l.scheduled_at_utc')
            ->limit(self::UPCOMING_LIMIT)
            ->get(['l.id', 'm.student_id', 'l.scheduled_at_utc', 'l.duration_minutes', 't.full_name as teacher_name', 'g.name as group_name'])
            ->map(fn (object $r): array => $this->lesson($r, 'GROUP', 'SCHEDULED'));

        return $private->concat($group)
            ->sortBy('starts_at')
            ->take(self::UPCOMING_LIMIT)
            ->values()->all();
    }

    /**
     * Lessons already decided — attended, absent or cancelled — newest first, each with its report.
     * A past lesson nobody marked yet is left out: "not recorded" is the academy's to-do, not news.
     *
     * @param  list<string>  $ids
     * @return list<array<string, mixed>>
     */
    private function recent(array $ids, Carbon $now): array
    {
        if ($ids === []) {
            return [];
        }

        $at = $now->toIso8601String();
        $since = $now->copy()->subDays(self::RECENT_DAYS)->toIso8601String();
        $fields = $this->reportFields();

        $private = DB::table('sessions as se')
            ->leftJoin('teachers as t', 't.id', '=', 'se.teacher_id')
            ->leftJoin('session_reports as r', 'r.session_id', '=', 'se.id')
            ->whereIn('se.student_id', $ids)
            ->whereNull('se.hidden_at')
            ->whereIn('se.status', array_keys(self::PRIVATE_STATUS))
            ->where('se.scheduled_at_utc', '>=', $since)
            ->where('se.scheduled_at_utc', '<=', $at)
            ->orderByDesc('se.scheduled_at_utc')
            ->limit(self::RECENT_LIMIT)
            ->get(['se.id', 'se.student_id', 'se.scheduled_at_utc', 'se.duration_minutes', 'se.status',
                't.full_name as teacher_name', 'r.values as report_values'])
            ->map(function (object $r) use ($fields): array {
                $lesson = $this->lesson($r, 'PRIVATE', self::PRIVATE_STATUS[$r->status]);
                $lesson['report'] = $this->renderReport($r->report_values, $fields);

                return $lesson;
            });

        $group = $this->groupLessons($ids)
            ->leftJoin('class_group_attendance as a', function ($j): void {
                $j->on('a.lesson_id', '=', 'l.id')->on('a.student_id', '=', 'm.student_id');
            })
            ->whereIn('l.status', ['HELD', 'CANCELLED'])
            ->where('l.scheduled_at_utc', '>=', $since)
            ->where('l.scheduled_at_utc', '<=', $at)
            ->orderByDesc('l.scheduled_at_utc')
            ->limit(self::RECENT_LIMIT)
            ->get(['l.id', 'm.student_id', 'l.scheduled_at_utc', 'l.duration_minutes', 'l.status as lesson_status',
                'a.status as mark', 'l.topic', 'l.homework', 't.full_name as teacher_name', 'g.name as group_name'])
            ->map(function (object $r): array {
                // A held lesson with no mark for this child: the sheet was not filled for them.
                $status = $r->lesson_status === 'CANCELLED' ? 'CANCELLED' : (self::GROUP_STATUS[$r->mark] ?? 'HELD');
                $lesson = $this->lesson($r, 'GROUP', $status);
                $topic = trim((string) ($r->topic ?? ''));
                $homework = trim((string) ($r->homework ?? ''));
                $lesson['topic'] = $topic !== '' ? $topic : null;
                $lesson['homework'] = $homework !== '' ? $homework : null;

                return $lesson;
            });

        return $private->concat($group)
            ->sortByDesc('starts_at')
            ->take(self::RECENT_LIMIT)
            ->values()->all();
    }

    /**
     * A child's group lessons: the group's lessons on the dates the child was a member — joining in
     * week 3 never shows weeks 1–2, leaving never hides the lessons already taken.
     *
     * @param  list<string>  $ids
     */
    private function groupLessons(array $ids): Builder
    {
        return DB::table('class_group_lessons as l')
            ->join('class_group_members as m', 'm.group_id', '=', 'l.group_id')
            ->join('class_groups as g', 'g.id', '=', 'l.group_id')
            ->leftJoin('teachers as t', 't.id', '=', 'l.teacher_id')
            ->whereIn('m.student_id', $ids)
            ->whereColumn('m.joined_on', '<=', 'l.occurrence_local_date')
            ->where(function ($q): void {
                $q->whereNull('m.left_on')->orWhereColumn('m.left_on', '>=', 'l.occurrence_local_date');
            });
    }

    /** @return array<string, mixed> */
    private function lesson(object $r, string $kind, string $status): array
    {
        return [
            'id' => (string) $r->id,
            'child_id' => (string) $r->student_id,
            'kind' => $kind,
            'group_name' => $kind === 'GROUP' ? ($r->group_name ?? null) : null,
            'teacher' => $r->teacher_name ?? null,
            'starts_at' => Carbon::parse($r->scheduled_at_utc)->utc()->toIso8601String(),
            'duration_minutes' => (int) $r->duration_minutes,
            'status' => $status,
        ];
    }

    /**
     * Every report field the academy ever defined — live ones first in form order, then retired
     * ones, so an old report still reads in full (the same order WhatsAppReportBuilder sends).
     *
     * @return Collection<int, object>
     */
    private function reportFields(): Collection
    {
        return DB::table('report_field_definitions')
            ->orderByDesc('is_active')
            ->orderBy('sort_order')
            ->get(['key', 'label_ar', 'label_en', 'field_type']);
    }

    /**
     * A lesson report as label/value pairs, empty answers dropped. Null when there is no report or
     * nothing in it was filled — an empty card would read as "the teacher wrote nothing".
     *
     * @param  Collection<int, object>  $fields
     * @return list<array<string, mixed>>|null
     */
    private function renderReport(mixed $raw, Collection $fields): ?array
    {
        if ($raw === null) {
            return null;
        }
        $values = is_string($raw) ? (json_decode($raw, true) ?: []) : (array) $raw;

        $out = [];
        foreach ($fields as $field) {
            if (! array_key_exists($field->key, $values)) {
                continue;
            }
            $value = $values[$field->key];
            $text = is_bool($value) ? ($value ? 'true' : 'false') : trim((string) (is_scalar($value) ? $value : ''));
            if ($text === '') {
                continue;
            }
            $out[] = [
                'label_ar' => (string) $field->label_ar,
                'label_en' => (string) $field->label_en,
                'type' => (string) $field->field_type,
                'value' => $text,
            ];
        }

        return $out === [] ? null : $out;
    }

    /**
     * Monthly progress reports — only ones the academy APPROVED; a pending or rejected draft is the
     * teacher's and the reviewer's business.
     *
     * @param  list<string>  $ids
     * @return list<array<string, mixed>>
     */
    private function progressReports(array $ids): array
    {
        if ($ids === []) {
            return [];
        }

        return DB::table('student_progress_reports as r')
            ->leftJoin('teachers as t', 't.id', '=', 'r.teacher_id')
            ->whereIn('r.student_id', $ids)
            ->where('r.status', 'APPROVED')
            ->orderByDesc('r.period_month')
            ->orderByDesc('r.reviewed_at')
            ->limit(self::PROGRESS_LIMIT)
            ->get(['r.id', 'r.student_id', 'r.period_month', 'r.title', 'r.body', 't.full_name as teacher_name'])
            ->map(fn (object $r): array => [
                'id' => (string) $r->id,
                'child_id' => (string) $r->student_id,
                'month' => Carbon::parse($r->period_month)->format('Y-m'),
                'title' => (string) $r->title,
                'body' => (string) $r->body,
                'teacher' => $r->teacher_name,
            ])->values()->all();
    }

    /**
     * The family's bills, newest first, each with what is left to pay and the link that pays it.
     * A family is one account: bills on the guardian AND bills on any of their children, including a
     * child who has since left (Ledger::poolsFamily). Void and zero bills are noise, not news.
     *
     * @return array{invoices: list<array<string, mixed>>, balance: list<array{currency: string, due_minor: int}>}
     */
    private function invoices(string $guardianId, string $academyId, string $tz, Carbon $now): array
    {
        $childIds = DB::table('students')->where('guardian_id', $guardianId)->pluck('id')->all();
        $names = DB::table('students')->whereIn('id', $childIds)->pluck('full_name', 'id');
        $current = $now->copy()->setTimezone($tz);

        $rows = DB::table('invoices as i')
            ->where(function ($q) use ($guardianId, $childIds): void {
                $q->where('i.guardian_id', $guardianId);
                if ($childIds !== []) {
                    $q->orWhereIn('i.student_id', $childIds);
                }
            })
            ->where('i.status', '<>', 'VOID')
            ->where('i.total_minor', '>', 0)
            ->orderByDesc('i.period_year')
            ->orderByDesc('i.period_month')
            ->orderByDesc('i.created_at')
            // No limit here: the balance must count every unpaid bill, however old. A family has
            // about one bill a month, so the list is cut to INVOICE_LIMIT only for display.
            ->get([
                'i.id', 'i.public_token', 'i.student_id', 'i.period_year', 'i.period_month', 'i.status',
                'i.currency', 'i.total_minor', 'i.amount_paid_minor',
                DB::raw('(select count(*) from invoice_line_items li where li.invoice_id = i.id and li.session_id is not null) as lesson_count'),
                // An itemised bill (a package, books, a group month) is named by its first line.
                DB::raw('(select li.description from invoice_line_items li where li.invoice_id = i.id and li.session_id is null order by li.created_at, li.id limit 1) as first_item'),
            ]);

        $origin = AcademyUrl::origin($academyId);
        $balance = [];

        $invoices = $rows->map(function (object $i) use ($names, $origin, $current, &$balance): array {
            $total = (int) $i->total_minor;
            $paid = min($total, max(0, (int) ($i->amount_paid_minor ?? 0)));
            // On an academy kept by receipts a covered running month stays OPEN (Ledger), so
            // "paid" is read from the money, exactly as the public invoice page does.
            $isPaid = $i->status === 'PAID' || $paid >= $total;
            $due = $isPaid ? 0 : $total - $paid;
            if ($due > 0) {
                $balance[$i->currency] = ($balance[$i->currency] ?? 0) + $due;
            }

            return [
                'id' => (string) $i->id,
                'period_year' => (int) $i->period_year,
                'period_month' => (int) $i->period_month,
                'state' => $isPaid ? 'PAID' : ($paid > 0 ? 'PARTIAL' : 'UNPAID'),
                // The month still running: its bill grows as lessons are taken.
                'running' => $i->status === 'OPEN' && (int) $i->lesson_count > 0
                    && (int) $i->period_year === $current->year && (int) $i->period_month === $current->month,
                'currency' => (string) $i->currency,
                'total_minor' => $total,
                'paid_minor' => $paid,
                'due_minor' => $due,
                'lesson_count' => (int) $i->lesson_count,
                'title' => (int) $i->lesson_count === 0 && $i->first_item !== null ? (string) $i->first_item : null,
                'child_name' => $i->student_id !== null ? ($names[$i->student_id] ?? null) : null,
                'url' => $origin.'/i/'.$i->public_token,
            ];
        })->take(self::INVOICE_LIMIT)->values()->all();

        ksort($balance);

        return [
            'invoices' => $invoices,
            'balance' => collect($balance)
                ->map(fn (int $due, string $currency): array => ['currency' => $currency, 'due_minor' => $due])
                ->values()->all(),
        ];
    }
}
