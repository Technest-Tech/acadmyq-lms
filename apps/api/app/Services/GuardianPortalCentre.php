<?php

declare(strict_types=1);

namespace App\Services;

use App\Http\Controllers\People\FamilyPayController;
use App\Support\AcademyUrl;
use App\Support\Entitlement;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * What a CENTRE's parent sees on top of the ordinary page (docs/centre-profile, Phase 2 §4): the
 * child's groups with their weekly timetable, the attendance sheet history, the week ahead, and
 * where the family stands on the receipts ledger.
 *
 * {@see GuardianPortal} calls this once and spreads what comes back over its payload. Each block is
 * keyed on the switch that owns it — `groups` for everything about a class, `accounting` for the
 * family account — never on the profile. An academy holding neither gets two empty arrays, so its
 * page is byte-for-byte what it was.
 *
 * Same allow-list as the page: a parent reads names, times, marks, topics and amounts. A staff note
 * on the sheet, a price setting, a phone — never. A child's lessons are the group's lessons on the
 * dates their membership covers, so another family's group never shows through a shared teacher.
 */
final class GuardianPortalCentre
{
    /** The week ahead, and how many of the latest sheets a parent is shown. */
    private const UPCOMING_DAYS = 7;

    private const RECENT_LESSONS = 10;

    /** The attendance rate's window. */
    private const SUMMARY_DAYS = 30;

    private const RECEIPTS = 5;

    public function __construct(private readonly Ledger $ledger) {}

    /**
     * @param  list<string>  $childIds
     * @return array{children: array<string, array<string, mixed>>, family: array<string, mixed>}
     */
    public function blocks(string $guardianId, string $academyId, array $childIds, string $tz, Carbon $now): array
    {
        $capabilities = Entitlement::resolve($academyId)['capabilities'];

        return [
            'children' => in_array('groups', $capabilities, true) ? $this->childBlocks($childIds, $tz, $now) : [],
            'family' => in_array('accounting', $capabilities, true)
                ? ['family_account' => $this->familyAccount($guardianId, $academyId, $tz, $now)]
                : [],
        ];
    }

    /**
     * @param  list<string>  $ids
     * @return array<string, array<string, mixed>>
     */
    private function childBlocks(array $ids, string $tz, Carbon $now): array
    {
        if ($ids === []) {
            return [];
        }

        $groups = $this->groups($ids);
        $upcoming = $this->upcoming($ids, $now);
        $recent = $this->recent($ids, $now);
        $summary = $this->summary($ids, $now);

        $out = [];
        foreach ($ids as $id) {
            $out[$id] = [
                'groups' => $groups->get($id, collect())->values()->all(),
                'group_lessons' => [
                    'upcoming' => $upcoming->get($id, collect())->values()->all(),
                    'recent' => $recent->get($id, collect())->values()->all(),
                ],
                'attendance_summary' => $summary[$id] ?? ['present' => 0, 'late' => 0, 'absent' => 0, 'excused' => 0, 'rate' => null],
            ];
        }

        return $out;
    }

    /**
     * The groups a child sits in right now, each with its weekly slots. `teacher` is kept beside
     * `teacher_name` because the page's chips already read it.
     *
     * @param  list<string>  $ids
     * @return Collection<string, Collection<int, array<string, mixed>>>
     */
    private function groups(array $ids): Collection
    {
        $rows = DB::table('class_group_members as m')
            ->join('class_groups as g', 'g.id', '=', 'm.group_id')
            ->leftJoin('teachers as t', 't.id', '=', 'g.teacher_id')
            ->whereIn('m.student_id', $ids)
            ->where('m.status', 'ACTIVE')
            ->where('g.status', 'ACTIVE')
            ->orderBy('g.name')
            ->get(['m.student_id', 'm.joined_on', 'g.id', 'g.name', 'g.level', 't.full_name as teacher_name']);

        $slots = DB::table('class_group_slots')
            ->whereIn('group_id', $rows->pluck('id')->unique()->values()->all())
            ->orderBy('weekday')
            ->orderBy('start_time_local')
            ->get(['group_id', 'weekday', 'start_time_local', 'duration_minutes'])
            ->groupBy(fn (object $s) => (string) $s->group_id);

        return $rows
            ->map(fn (object $g): array => [
                'id' => (string) $g->id,
                'name' => (string) $g->name,
                'level' => $g->level !== null && trim((string) $g->level) !== '' ? (string) $g->level : null,
                'teacher' => $g->teacher_name,
                'teacher_name' => $g->teacher_name,
                'slots' => $slots->get((string) $g->id, collect())
                    ->map(fn (object $s): array => [
                        'weekday' => (int) $s->weekday,
                        'start_time_local' => substr((string) $s->start_time_local, 0, 5),
                        'duration_minutes' => (int) $s->duration_minutes,
                    ])->values()->all(),
                'joined_on' => Carbon::parse($g->joined_on)->format('Y-m-d'),
                'student_id' => (string) $g->student_id,
            ])
            ->groupBy('student_id')
            ->map(fn (Collection $c) => $c->map(function (array $g): array {
                unset($g['student_id']);

                return $g;
            }));
    }

    /**
     * The child's group lessons on the dates their membership covers (the same rule the page's
     * mixed lists follow).
     *
     * @param  list<string>  $ids
     */
    private function lessons(array $ids): Builder
    {
        return DB::table('class_group_lessons as l')
            ->join('class_group_members as m', 'm.group_id', '=', 'l.group_id')
            ->join('class_groups as g', 'g.id', '=', 'l.group_id')
            ->whereIn('m.student_id', $ids)
            ->whereColumn('m.joined_on', '<=', 'l.occurrence_local_date')
            ->where(function ($q): void {
                $q->whereNull('m.left_on')->orWhereColumn('m.left_on', '>=', 'l.occurrence_local_date');
            })
            // A student taken off one sheet is not expected at it.
            ->whereNotExists(fn ($q) => $q->select(DB::raw(1))
                ->from('class_group_lesson_removals as x')
                ->whereColumn('x.lesson_id', 'l.id')
                ->whereColumn('x.student_id', 'm.student_id'));
    }

    /**
     * @param  list<string>  $ids
     * @return Collection<string, Collection<int, array<string, mixed>>>
     */
    private function upcoming(array $ids, Carbon $now): Collection
    {
        $at = $now->toIso8601String();
        $until = $now->copy()->addDays(self::UPCOMING_DAYS)->toIso8601String();

        return $this->lessons($ids)
            ->where('g.status', 'ACTIVE')
            ->where('l.status', 'SCHEDULED')
            ->whereRaw('l.scheduled_at_utc + make_interval(mins => l.duration_minutes) > ?::timestamptz', [$at])
            ->where('l.scheduled_at_utc', '<', $until)
            ->orderBy('l.scheduled_at_utc')
            ->get(['l.id', 'm.student_id', 'l.group_id', 'g.name as group_name', 'l.scheduled_at_utc', 'l.duration_minutes', 'l.status'])
            ->map(fn (object $r): array => [
                'id' => (string) $r->id,
                'group_id' => (string) $r->group_id,
                'group_name' => (string) $r->group_name,
                'starts_at' => Carbon::parse($r->scheduled_at_utc)->utc()->toIso8601String(),
                'duration_minutes' => (int) $r->duration_minutes,
                'status' => (string) $r->status,
                'student_id' => (string) $r->student_id,
            ])
            ->groupBy('student_id')
            ->map(fn (Collection $c) => $c->map(function (array $l): array {
                unset($l['student_id']);

                return $l;
            }));
    }

    /**
     * The latest sheets, newest first, with the child's own mark. A held lesson the sheet skipped
     * them on reads as no mark, never as absent.
     *
     * @param  list<string>  $ids
     * @return Collection<string, Collection<int, array<string, mixed>>>
     */
    private function recent(array $ids, Carbon $now): Collection
    {
        $rows = $this->lessons($ids)
            ->leftJoin('class_group_attendance as a', function ($j): void {
                $j->on('a.lesson_id', '=', 'l.id')->on('a.student_id', '=', 'm.student_id');
            })
            ->where('l.status', 'HELD')
            ->where('l.scheduled_at_utc', '<=', $now->toIso8601String())
            ->orderByDesc('l.scheduled_at_utc')
            // Per child the cut is RECENT_LESSONS; one query serves every child, so it reads that
            // many for each and trims below.
            ->limit(self::RECENT_LESSONS * max(1, count($ids)))
            ->get(['l.id', 'm.student_id', 'l.group_id', 'g.name as group_name', 'l.scheduled_at_utc', 'l.duration_minutes',
                'a.status as mark', 'l.topic', 'l.homework']);

        return $rows
            ->map(fn (object $r): array => [
                'id' => (string) $r->id,
                'group_id' => (string) $r->group_id,
                'group_name' => (string) $r->group_name,
                'starts_at' => Carbon::parse($r->scheduled_at_utc)->utc()->toIso8601String(),
                'duration_minutes' => (int) $r->duration_minutes,
                'attendance' => $r->mark !== null ? (string) $r->mark : null,
                'topic' => trim((string) ($r->topic ?? '')) !== '' ? trim((string) $r->topic) : null,
                'homework' => trim((string) ($r->homework ?? '')) !== '' ? trim((string) $r->homework) : null,
                'student_id' => (string) $r->student_id,
            ])
            ->groupBy('student_id')
            ->map(fn (Collection $c) => $c->take(self::RECENT_LESSONS)->map(function (array $l): array {
                unset($l['student_id']);

                return $l;
            }));
    }

    /**
     * Marks over the last SUMMARY_DAYS days on held lessons the child was a member for (the same
     * lessons the history lists). The rate counts late as present — the child was there — and is
     * null until there is a sheet to count.
     *
     * @param  list<string>  $ids
     * @return array<string, array{present: int, late: int, absent: int, excused: int, rate: ?int}>
     */
    private function summary(array $ids, Carbon $now): array
    {
        $rows = $this->lessons($ids)
            ->join('class_group_attendance as a', function ($j): void {
                $j->on('a.lesson_id', '=', 'l.id')->on('a.student_id', '=', 'm.student_id');
            })
            ->where('l.status', 'HELD')
            ->where('l.scheduled_at_utc', '>=', $now->copy()->subDays(self::SUMMARY_DAYS)->toIso8601String())
            ->where('l.scheduled_at_utc', '<=', $now->toIso8601String())
            ->groupBy('a.student_id')
            ->selectRaw("a.student_id,
                count(*) filter (where a.status = 'PRESENT') as present,
                count(*) filter (where a.status = 'LATE') as late,
                count(*) filter (where a.status = 'ABSENT') as absent,
                count(*) filter (where a.status = 'EXCUSED') as excused")
            ->get();

        $out = [];
        foreach ($rows as $r) {
            $present = (int) $r->present;
            $late = (int) $r->late;
            $total = $present + $late + (int) $r->absent + (int) $r->excused;
            $out[(string) $r->student_id] = [
                'present' => $present,
                'late' => $late,
                'absent' => (int) $r->absent,
                'excused' => (int) $r->excused,
                'rate' => $total > 0 ? (int) round(($present + $late) * 100 / $total) : null,
            ];
        }

        return $out;
    }

    /**
     * Where the family stands, through the ledger the office works from (Ledger::balance and its
     * open lines — nothing is re-added here). A family is one account where the academy bills
     * families; each child's own account is added where it bills students. Overdue is what is
     * still owed from a month before this one, the office screen's own reading.
     *
     * @return array<string, mixed>
     */
    private function familyAccount(string $guardianId, string $academyId, string $tz, Carbon $now): array
    {
        $childIds = DB::table('students')->where('guardian_id', $guardianId)->pluck('id')->map(fn ($id) => (string) $id)->all();
        $thisMonth = $now->copy()->setTimezone($tz)->format('Y-m');

        $payers = [['guardian_id' => $guardianId, 'student_id' => null, 'payer_name' => null]];
        if (! Ledger::poolsFamily($academyId)) {
            foreach ($childIds as $sid) {
                $payers[] = ['guardian_id' => null, 'student_id' => $sid, 'payer_name' => null];
            }
        }

        $byCurrency = [];
        foreach ($payers as $payer) {
            foreach ($this->ledger->balance($academyId, $payer) as $b) {
                $c = $b['currency'];
                $byCurrency[$c] ??= ['due_minor' => 0, 'credit_minor' => 0, 'overdue_minor' => 0];
                $byCurrency[$c]['due_minor'] += $b['due_minor'];
                $byCurrency[$c]['credit_minor'] += $b['credit_minor'];
            }
            foreach ($this->ledger->openLines($academyId, $payer) as $l) {
                $month = $l->session_date !== null
                    ? Carbon::parse($l->session_date)->format('Y-m')
                    : sprintf('%04d-%02d', (int) $l->period_year, (int) $l->period_month);
                if ($month < $thisMonth) {
                    $c = (string) $l->currency;
                    $byCurrency[$c] ??= ['due_minor' => 0, 'credit_minor' => 0, 'overdue_minor' => 0];
                    $byCurrency[$c]['overdue_minor'] += (int) $l->amount_minor - (int) $l->allocated;
                }
            }
        }

        // A family pays in one currency; when it does not, the one it owes most in leads the card.
        $currency = (string) (DB::table('academies')->where('id', $academyId)->value('default_currency') ?? 'EGP');
        if ($byCurrency !== []) {
            uasort($byCurrency, fn (array $a, array $b): int => $b['due_minor'] <=> $a['due_minor']);
            $currency = (string) array_key_first($byCurrency);
        }
        $money = $byCurrency[$currency] ?? ['due_minor' => 0, 'credit_minor' => 0, 'overdue_minor' => 0];

        $receipts = DB::table('receipts as r')
            ->where(function ($q) use ($guardianId, $childIds): void {
                $q->where('r.guardian_id', $guardianId);
                if ($childIds !== []) {
                    $q->orWhereIn('r.student_id', $childIds);
                }
            })
            ->whereNull('r.voided_at')
            ->orderByDesc('r.received_on')
            ->orderByDesc('r.created_at')
            ->limit(self::RECEIPTS)
            ->get(['r.number', 'r.received_on', 'r.amount_minor', 'r.currency', 'r.method'])
            ->map(fn (object $r): array => [
                'number' => (string) $r->number,
                'received_on' => Carbon::parse($r->received_on)->format('Y-m-d'),
                'amount_minor' => (int) $r->amount_minor,
                'currency' => (string) $r->currency,
                'method' => (string) $r->method,
            ])->values()->all();

        return [
            'currency' => $currency,
            'due_minor' => (int) $money['due_minor'],
            'overdue_minor' => (int) $money['overdue_minor'],
            'credit_minor' => (int) $money['credit_minor'],
            'recent_receipts' => $receipts,
            'pay_url' => $this->payUrl($guardianId, $academyId),
        ];
    }

    /**
     * The family's card-payment page (`/f/{token}`), only when it can take a payment: the academy
     * accepts cards, the family already holds its link, and that page has a bill to show. Otherwise
     * the office collects, and the card says so by having no button.
     */
    private function payUrl(string $guardianId, string $academyId): ?string
    {
        $token = DB::table('guardians')->where('id', $guardianId)->value('pay_token');
        if ($token === null || $token === '') {
            return null;
        }
        $cards = DB::table('academy_payment_settings')->where('method', 'XPAY')->where('is_active', true)->exists();
        if (! $cards || ! FamilyPayController::dueQuery($guardianId)->exists()) {
            return null;
        }

        return AcademyUrl::origin($academyId).'/f/'.$token;
    }
}
