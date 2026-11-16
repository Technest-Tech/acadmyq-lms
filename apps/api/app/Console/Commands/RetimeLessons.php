<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Services\LessonPackages;
use App\Services\SessionDurationCorrection;
use App\Support\Audit;
use App\Support\Tenancy;
use App\Support\TenantContext;
use App\Support\AuthContext;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * One lesson length becomes another across an academy (Alrayan, 2026-11-17: "I have no 45-minute
 * lessons at all" — every 45 is a 40 typed wrong). It changes only what has no money on it yet:
 *
 *   • timetable slots of that length (so every lesson generated from now on has the new one);
 *   • lessons not marked yet — upcoming, and past ones nobody marked — that nothing billed or paid;
 *   • running blocks sold as "N × 45": the label, and the block restated as N lessons of the new
 *     length (same price, same N); a block counted in lessons gets the new length too;
 *   • the length on the student's subscription (display; the hourly rate is not touched).
 *
 * Lessons already marked (attended, cancelled, charged, paid to a teacher) keep their length: changing
 * them moves teachers' pay for months already counted, and that is a separate decision. They are
 * listed so it can be made.
 *
 * `--marked` is that decision taken: marked lessons get the new length too.
 *   • attended ones go through {@see SessionDurationCorrection} the way the payroll page corrects a
 *     lesson: the teacher's line is re-priced on its own statement, sealed or not (one paid from
 *     the treasury carries the difference to the open statement); an OPEN bill's line follows; a
 *     running block still in minutes is re-cut; a finished block and a closed or paid bill are left
 *     as they were;
 *   • cancelled and free ones just get the length when it carries no money: not paid to a teacher,
 *     not on a bill, and — if charged to a block — a block that counts lessons or has finished;
 *   • any other cancelled or free one is listed and left.
 *
 * Lists by default; `--apply` writes, in one transaction.
 *
 *   php artisan lessons:retime --academy=<uuid> --from=45 --to=40 [--marked] [--apply]
 */
final class RetimeLessons extends Command
{
    private const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

    protected $signature = 'lessons:retime
        {--academy= : The academy (required)}
        {--from= : The length that is wrong, in minutes}
        {--to= : The length it should be, in minutes}
        {--marked : Also give lessons already marked the new length (teacher pay follows)}
        {--apply : Change them (default: only list)}';

    protected $description = "List, then change, an academy's lessons of one length to another (unmarked lessons, timetables, running blocks).";

    public function handle(SessionDurationCorrection $corrections): int
    {
        $academyId = (string) $this->option('academy');
        $from = (int) $this->option('from');
        $to = (int) $this->option('to');
        if ($academyId === '' || $from < 5 || $to < 5 || $from === $to) {
            $this->error('Pass --academy=<uuid> --from=<minutes> --to=<minutes>.');

            return self::FAILURE;
        }

        $name = $this->academyName($academyId);
        if ($name === null) {
            $this->error('No such academy.');

            return self::FAILURE;
        }

        $ctx = new AuthContext(userId: self::SYSTEM_USER_ID, academyId: $academyId, role: 'SUPER_ADMIN', permissions: []);
        $apply = (bool) $this->option('apply');
        $withMarked = (bool) $this->option('marked');

        return Tenancy::withContext($ctx, function () use ($academyId, $name, $from, $to, $apply, $withMarked, $corrections): int {
            $slots = DB::table('schedule_slots as sl')
                ->join('schedules as sc', 'sc.id', '=', 'sl.schedule_id')
                ->join('students as s', 's.id', '=', 'sc.student_id')
                ->where('sc.academy_id', $academyId)
                ->whereNull('sc.deleted_at')
                ->where('sl.duration_minutes', $from)
                ->get(['sl.id', 's.full_name', 'sc.is_active', 'sl.weekday', 'sl.start_time_local']);

            $unmarked = DB::table('sessions')
                ->where('academy_id', $academyId)
                ->where('duration_minutes', $from)
                ->whereIn('status', ['SCHEDULED', 'RESCHEDULED'])
                ->where('billed', false)
                ->where('paid_to_teacher', false);
            $upcoming = (clone $unmarked)->where('scheduled_at_utc', '>', now())->count();
            $pastUnmarked = (clone $unmarked)->where('scheduled_at_utc', '<=', now())->count();

            $blocks = DB::table('lesson_packages as p')
                ->join('students as s', 's.id', '=', 'p.student_id')
                ->where('p.academy_id', $academyId)
                ->where('p.status', 'ACTIVE')
                ->orderBy('s.full_name')
                ->get(['p.*', 's.full_name as student_name']);
            $blockChanges = [];
            foreach ($blocks as $p) {
                $change = $this->blockChange($p, $from, $to);
                if ($change !== null) {
                    $blockChanges[] = [$p, $change];
                }
            }

            $subscriptions = DB::table('subscriptions')
                ->where('academy_id', $academyId)
                ->where('lesson_minutes', $from)
                ->count();

            $marked = DB::table('sessions as se')
                ->leftJoin('teachers as t', 't.id', '=', 'se.teacher_id')
                ->where('se.academy_id', $academyId)
                ->where('se.duration_minutes', $from)
                ->where(fn ($q) => $q->whereNotIn('se.status', ['SCHEDULED', 'RESCHEDULED'])->orWhere('se.billed', true)->orWhere('se.paid_to_teacher', true))
                ->selectRaw("coalesce(t.full_name, '—') as teacher, t.pay_type, count(*) as lessons, count(*) filter (where se.paid_to_teacher) as paid")
                ->groupBy('t.full_name', 't.pay_type')
                ->orderByDesc('lessons')
                ->get();

            $this->info("{$name} — lessons of {$from} min → {$to} min".($apply ? '' : ' (listing only)'));
            $this->line(sprintf('  Timetable slots: %d', $slots->count()));
            foreach ($slots as $slot) {
                $this->line(sprintf('    %s · day %d at %s%s', $slot->full_name, $slot->weekday, substr((string) $slot->start_time_local, 0, 5), $slot->is_active ? '' : ' (timetable stopped)'));
            }
            $this->line(sprintf('  Lessons not marked: %d upcoming, %d past and never marked', $upcoming, $pastUnmarked));
            $this->line(sprintf('  Running blocks: %d', count($blockChanges)));
            foreach ($blockChanges as [$p, $c]) {
                $this->line(sprintf('    %s · %s → %s · %d lessons, %d min → %d min%s', $p->student_name, $p->label, $c['label'], $c['lessons'],
                    (int) $p->minutes_total, $c['minutes_total'], $c['note'] !== '' ? " ({$c['note']})" : ''));
            }
            $this->line(sprintf('  Subscriptions with a lesson length of %d: %d', $from, $subscriptions));
            $markedPlan = null;
            if ($withMarked) {
                $markedPlan = $this->markedPlan($corrections, $academyId, $from, $to);
                $this->line(sprintf('  Lessons already marked: %d attended to correct, %d cancelled/free whose length carries no money, %d left alone',
                    count($markedPlan['attended']), count($markedPlan['plain']), count($markedPlan['left'])));
                foreach ($markedPlan['pay'] as $row) {
                    $this->line(sprintf('    %s · %04d-%02d%s: %d lessons, %s → %s %s (%s)', $row['teacher'], $row['year'], $row['month'],
                        $row['sealed'] ? ' (sealed)' : '', $row['lessons'], $this->money($row['before']), $this->money($row['after']), $row['currency'],
                        $row['carried'] ? 'paid from the treasury: difference carried to the open statement' : $this->money($row['after'] - $row['before'])));
                }
                $this->line(sprintf('    Teachers\' pay in all: %s', collect($markedPlan['pay'])->groupBy('currency')
                    ->map(fn ($rows, $currency) => $this->money($rows->sum('after') - $rows->sum('before')).' '.$currency)->implode(', ') ?: '0'));
                $this->line(sprintf('    Bills: %d open line(s) follow, %d on closed or paid bills stay · Blocks: %d lesson(s) on running blocks in minutes re-cut, %d on finished or lesson-counted blocks stay',
                    $markedPlan['invoice_open'], $markedPlan['invoice_closed'], $markedPlan['block_active'], $markedPlan['block_left']));
                foreach ($markedPlan['left'] as $row) {
                    $this->line(sprintf('    left: %s · %s · %s', $row->student, $row->day, $row->why));
                }
            } else {
                $this->line(sprintf('  Left as they are — lessons already marked, %d in all (pass --marked to change them too):', (int) $marked->sum('lessons')));
                foreach ($marked as $m) {
                    $this->line(sprintf('    %s (%s): %d lessons, %d of them paid to the teacher', $m->teacher, $m->pay_type ?? '—', $m->lessons, $m->paid));
                }
            }

            if (! $apply) {
                $this->info('Run again with --apply to change them.');

                return self::SUCCESS;
            }

            DB::transaction(function () use ($academyId, $from, $to, $slots, $unmarked, $blockChanges, $markedPlan, $corrections): void {
                DB::table('schedule_slots')->whereIn('id', $slots->pluck('id'))->update(['duration_minutes' => $to, 'updated_at' => now()]);
                $sessions = (clone $unmarked)->update(['duration_minutes' => $to, 'updated_at' => now()]);
                foreach ($blockChanges as [$p, $c]) {
                    DB::table('lesson_packages')->where('id', $p->id)->update(array_filter([
                        'label' => $c['label'],
                        'minutes_total' => $c['minutes_total'],
                        'hourly_rate_minor' => $c['hourly_rate_minor'],
                        'lesson_minutes' => $p->lesson_minutes !== null ? $to : null,
                        'updated_at' => now(),
                    ], fn ($v) => $v !== null));
                    Audit::log('lesson_package.retimed', 'lesson_package', (string) $p->id, $academyId, null, 'SUPER_ADMIN',
                        before: ['label' => $p->label, 'minutes_total' => (int) $p->minutes_total, 'hourly_rate_minor' => (int) $p->hourly_rate_minor, 'lesson_minutes' => $p->lesson_minutes],
                        after: ['label' => $c['label'], 'minutes_total' => $c['minutes_total'], 'hourly_rate_minor' => $c['hourly_rate_minor'], 'lesson_minutes' => $p->lesson_minutes !== null ? $to : null]);
                }
                $subs = DB::table('subscriptions')->where('academy_id', $academyId)->where('lesson_minutes', $from)->update(['lesson_minutes' => $to, 'updated_at' => now()]);

                $corrected = 0;
                $plain = 0;
                if ($markedPlan !== null) {
                    foreach ($markedPlan['attended'] as $sessionId) {
                        // The payroll page's own path: a sealed statement is corrected in place.
                        $corrections->update($sessionId, $to, self::SYSTEM_USER_ID, 'SUPER_ADMIN', true);
                        $corrected++;
                    }
                    $plain = DB::table('sessions')->whereIn('id', $markedPlan['plain'])->update(['duration_minutes' => $to, 'updated_at' => now()]);
                }

                Audit::log('academy.lessons_retimed', 'academy', $academyId, $academyId, null, 'SUPER_ADMIN',
                    before: ['minutes' => $from],
                    after: ['minutes' => $to, 'slots' => $slots->count(), 'sessions' => $sessions, 'blocks' => count($blockChanges), 'subscriptions' => $subs,
                        'marked_attended' => $corrected, 'marked_plain' => $plain]);
            });
            $this->info('Done.');

            return self::SUCCESS;
        });
    }

    /**
     * What `--marked` will do, read through the duration correction's own preview.
     *
     * @return array{attended: list<string>, plain: list<string>, left: list<object>, pay: list<array<string,mixed>>, invoice_open: int, invoice_closed: int, block_active: int, block_left: int}
     */
    private function markedPlan(SessionDurationCorrection $corrections, string $academyId, int $from, int $to): array
    {
        $sessions = DB::table('sessions as se')
            ->join('students as s', 's.id', '=', 'se.student_id')
            ->where('se.academy_id', $academyId)
            ->where('se.duration_minutes', $from)
            ->where(fn ($q) => $q->whereNotIn('se.status', ['SCHEDULED', 'RESCHEDULED'])->orWhere('se.billed', true)->orWhere('se.paid_to_teacher', true))
            ->orderBy('se.scheduled_at_utc')
            ->get(['se.*', 's.full_name as student']);

        $plan = ['attended' => [], 'plain' => [], 'left' => [], 'pay' => [], 'invoice_open' => 0, 'invoice_closed' => 0, 'block_active' => 0, 'block_left' => 0];
        $pay = [];
        foreach ($sessions as $session) {
            $day = substr((string) $session->scheduled_at_utc, 0, 10);
            if ((string) $session->status !== 'ATTENDED') {
                // Its length is money only where a teacher was paid for it, a bill carries it, or a
                // running block still in minutes burned it.
                $onBill = DB::table('invoice_line_items')->where('session_id', $session->id)->exists();
                $onMinuteBlock = DB::table('lesson_package_credits as c')
                    ->join('lesson_packages as p', 'p.id', '=', 'c.package_id')
                    ->where('c.session_id', $session->id)->where('p.status', 'ACTIVE')->whereNull('p.lesson_minutes')
                    ->exists();
                if (! (bool) $session->paid_to_teacher && ! $onBill && ! $onMinuteBlock) {
                    $plan['plain'][] = (string) $session->id;
                } else {
                    $plan['left'][] = (object) ['student' => $session->student, 'day' => $day, 'why' => strtolower((string) $session->status)
                        .((bool) $session->paid_to_teacher ? ', paid to the teacher' : ($onBill ? ', on a bill' : ', on a running block in minutes'))];
                }

                continue;
            }

            $preview = $corrections->preview($session, $to, true);
            if (! $preview['can_change']) {
                $plan['left'][] = (object) ['student' => $session->student, 'day' => $day, 'why' => implode(',', $preview['blockers'])];

                continue;
            }
            $plan['attended'][] = (string) $session->id;

            if ($preview['invoice'] !== null) {
                $plan[$preview['invoice']['status'] === 'OPEN' ? 'invoice_open' : 'invoice_closed']++;
            }
            $onBlock = DB::table('lesson_package_credits')->where('session_id', $session->id)->exists();
            if ($preview['package'] !== null && $preview['package']['status'] === 'ACTIVE') {
                $plan['block_active']++;
            } elseif ($onBlock) {
                $plan['block_left']++;
            }
            if ($preview['payout'] !== null) {
                $key = $preview['payout']['payout_id'];
                if (! isset($pay[$key])) {
                    $payout = DB::table('payouts as p')->join('teachers as t', 't.id', '=', 'p.teacher_id')->where('p.id', $key)
                        ->first(['t.full_name', 'p.period_year', 'p.period_month', 'p.finalized_at']);
                    $pay[$key] = ['teacher' => (string) $payout->full_name, 'year' => (int) $payout->period_year, 'month' => (int) $payout->period_month,
                        'sealed' => $payout->finalized_at !== null, 'carried' => (bool) $preview['payout']['finalized'],
                        'currency' => $preview['payout']['currency'], 'lessons' => 0, 'before' => 0, 'after' => 0];
                }
                $pay[$key]['lessons']++;
                $pay[$key]['before'] += (int) $preview['payout']['amount_before'];
                $pay[$key]['after'] += (int) $preview['payout']['amount_after'];
            }
        }
        usort($pay, fn (array $a, array $b) => [$a['teacher'], $a['year'], $a['month']] <=> [$b['teacher'], $b['year'], $b['month']]);
        $plan['pay'] = array_values($pay);

        return $plan;
    }

    /** Minor units as a plain figure: 16000 → "160.00". */
    private function money(int $minor): string
    {
        return number_format($minor / 100, 2, '.', '');
    }

    /**
     * A running block's new terms, or null when the length is not on it. Sold as "N × from": the
     * same N lessons of the new length. Counted in lessons of `from` with no such label: the lessons
     * it holds, of the new length. A block still in hours keeps its minutes when its new end would
     * already be behind it — converting it to lessons closes it properly.
     *
     * @return array{label: string, lessons: int, minutes_total: int, hourly_rate_minor: int, note: string}|null
     */
    private function blockChange(object $p, int $from, int $to): ?array
    {
        $terms = LessonPackages::labelTerms($p);
        $inLessons = $p->lesson_minutes !== null && (int) $p->lesson_minutes === $from;
        if (($terms === null || $terms['minutes'] !== $from) && ! $inLessons) {
            return null;
        }

        $lessons = $terms !== null && $terms['minutes'] === $from
            ? $terms['lessons']
            : max(1, (int) round(((int) $p->minutes_total) / $from));
        $label = $terms !== null && $terms['minutes'] === $from
            ? (string) preg_replace('/([×xX*]\s*)(?:'.$from.'|'.strtr((string) $from, ['0' => '٠', '1' => '١', '2' => '٢', '3' => '٣', '4' => '٤', '5' => '٥', '6' => '٦', '7' => '٧', '8' => '٨', '9' => '٩']).')(?!\d)/u', '${1}'.$to, (string) $p->label, 1)
            : (string) $p->label;
        $minutesTotal = $lessons * $to;
        $note = '';
        if ($p->lesson_minutes === null && (int) $p->minutes_consumed >= $minutesTotal + (int) $p->carried_over_minutes) {
            $minutesTotal = (int) $p->minutes_total;
            $note = 'already past its new end in minutes: label only, convert it to lessons';
        }

        return [
            'label' => $label,
            'lessons' => $lessons,
            'minutes_total' => $minutesTotal,
            'hourly_rate_minor' => $minutesTotal > 0 ? (int) round((int) $p->price_minor * 60 / $minutesTotal) : (int) $p->hourly_rate_minor,
            'note' => $note,
        ];
    }

    private function academyName(string $academyId): ?string
    {
        TenantContext::apply(userId: self::SYSTEM_USER_ID, academyId: null, role: 'SUPER_ADMIN', local: false);
        try {
            $name = DB::table('academies')->where('id', $academyId)->value('name');

            return $name !== null ? (string) $name : null;
        } finally {
            TenantContext::clear();
        }
    }
}
