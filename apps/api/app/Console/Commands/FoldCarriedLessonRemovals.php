<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Services\Payroll;
use App\Services\PayrollLessonCorrection;
use App\Support\AuthContext;
use App\Support\Tenancy;
use App\Support\TenantContext;
use Carbon\Carbon;
use Illuminate\Console\Command;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * Lessons deleted after their month sealed whose pay was carried instead of taken off (lingo,
 * 2026-11-26: "محسوبه من ضمن الراتب"). The line stayed on the sealed statement, so the lesson still
 * counted in the window it was taught in, and a matching deduction sat on a later statement. A
 * statement nobody paid from the treasury is now corrected in place, so this does it for the ones
 * already carried: the line comes off its own statement and the deduction off the later one.
 *
 * A statement paid from the treasury keeps its line (that is the carry working as meant). A removed
 * line with no matching deduction is listed and left alone; so is a deduction on a statement that
 * was itself paid from the treasury. A line a recalculation already priced at 0 just comes off.
 *
 * Lists what it would do; `--apply` does it.
 *
 *   php artisan payroll:fold-carried-removals [--academy=<uuid>] [--apply]
 */
final class FoldCarriedLessonRemovals extends Command
{
    private const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

    private const UNMATCHED = 'no matching deduction found';

    protected $signature = 'payroll:fold-carried-removals
        {--academy= : Limit to one academy id}
        {--apply : Fold them (default: only list)}';

    protected $description = 'Take lessons deleted after the seal off their own statement, and the deduction carried for them off the later one.';

    public function handle(Payroll $payroll): int
    {
        $apply = (bool) $this->option('apply');
        $folded = 0;
        $left = 0;

        foreach ($this->academies() as $academyId => $name) {
            $ctx = new AuthContext(userId: self::SYSTEM_USER_ID, academyId: $academyId, role: 'SUPER_ADMIN', permissions: []);
            $pairs = Tenancy::withContext($ctx, fn () => $this->pairs($payroll, $academyId));
            if ($pairs->isEmpty()) {
                continue;
            }

            $this->info("{$name} ({$academyId})");
            foreach ($pairs as $p) {
                $what = sprintf('  %s · %s · %s · %s %s', $p['teacher'], $p['period'], $p['key'], $this->money($p['amount_minor']), $p['currency']);
                if ($p['skip'] !== null) {
                    $this->warn("{$what}  — left: {$p['skip']}");
                    $left++;

                    continue;
                }
                $this->line($what.($p['adjustment_id'] !== null ? "  → off {$p['carried_to']}" : '  (already 0)')
                    .($p['again'] ? '  (marked again: its later line stays)' : '')
                    .(isset($p['by_date']) ? "  (matched by date: «{$p['by_date']}»)" : ''));
                if (! $apply) {
                    continue;
                }

                try {
                    Tenancy::withContext($ctx, function () use ($payroll, $p, $academyId): void {
                        $session = DB::table('sessions')->where('id', $p['session_id'])->first();
                        $line = DB::table('payout_line_items')->where('id', $p['line_id'])->first();
                        $payroll->correcting($p['payout_id'], fn () => $payroll->reverseLine($line, $session));
                        if ($p['adjustment_id'] !== null) {
                            $payroll->correcting($p['adjustment_payout_id'], fn () => $payroll->removeAdjustment(
                                $p['adjustment_id'], $academyId, self::SYSTEM_USER_ID, 'SUPER_ADMIN',
                            ));
                        }
                    });
                    $folded++;
                } catch (Throwable $e) {
                    $this->error('    refused: '.$e->getMessage());
                    $left++;
                }
            }
        }

        $this->info($apply
            ? "Done: {$folded} folded, {$left} left."
            : "Listed only ({$left} would be left) — run again with --apply to fold them.");

        return self::SUCCESS;
    }

    /**
     * Each removed lesson still on a sealed statement nobody paid from the treasury, with the
     * deduction carried for it.
     *
     * @return Collection<int, array<string, mixed>>
     */
    private function pairs(Payroll $payroll, string $academyId): Collection
    {
        $timezone = (string) (DB::table('academies')->where('id', $academyId)->value('timezone') ?: 'UTC');

        $lines = DB::table('payout_line_items as li')
            ->join('payouts as p', 'p.id', '=', 'li.payout_id')
            ->join('sessions as se', 'se.id', '=', 'li.session_id')
            ->leftJoin('students as st', 'st.id', '=', 'se.student_id')
            ->leftJoin('teachers as t', 't.id', '=', 'p.teacher_id')
            ->whereNotNull('p.finalized_at')
            ->orderBy('t.full_name')
            ->orderBy('li.session_date')
            ->get([
                'li.id', 'li.payout_id', 'li.session_id', 'li.amount_minor', 'li.currency',
                'p.period_year', 'p.period_month', 't.full_name as teacher_name',
                'se.status', 'se.bill_override', 'se.teacher_override', 'se.scheduled_at_utc',
                'st.full_name as student_name',
                // Undone, then marked again: its pay lives on a later line, so this one is the duplicate.
                DB::raw('exists (select 1 from payout_line_items later where later.session_id = li.session_id and later.id <> li.id and later.created_at > li.created_at) as again'),
                DB::raw('exists (select 1 from payout_line_items other where other.session_id = li.session_id and other.id <> li.id) as other_line'),
            ])
            ->filter(fn (object $l) => PayrollLessonCorrection::paysTeacher($l)
                ? (bool) $l->again
                : ! (bool) $l->other_line);

        $taken = [];

        // By the student's name first, for every line, so a match by date alone never takes a
        // deduction another line names.
        $rows = $lines->map(function (object $l) use ($payroll, $timezone, &$taken): array {
            // The reason both carries write: "d/m/Y · student" (PayrollLessonCorrection::describe,
            // Payroll::lessonUndoneReason).
            $date = Carbon::parse($l->scheduled_at_utc)->setTimezone($timezone)->format('d/m/Y');
            $key = $date.' · '.($l->student_name ?? '—');
            $row = [
                'date' => $date,
                'line_id' => (string) $l->id,
                'again' => (bool) $l->again,
                'session_id' => (string) $l->session_id,
                'payout_id' => (string) $l->payout_id,
                'amount_minor' => (int) $l->amount_minor,
                'currency' => (string) $l->currency,
                'teacher' => (string) ($l->teacher_name ?? '—'),
                'period' => sprintf('%02d/%d', $l->period_month, $l->period_year),
                'key' => $key,
                'adjustment_id' => null,
                'adjustment_payout_id' => null,
                'carried_to' => null,
                'skip' => null,
            ];

            if ($payroll->carriesCorrections((string) $l->payout_id)) {
                return [...$row, 'skip' => 'its statement was paid from the treasury'];
            }
            if ((int) $l->amount_minor === 0) {
                return $row; // A recalculation already priced it at 0 and dropped what was carried.
            }

            $adjustment = $this->carried($row, $key, $taken)->first();
            if ($adjustment === null) {
                return [...$row, 'skip' => self::UNMATCHED];
            }
            $taken[] = (string) $adjustment->id;

            return $this->matched($payroll, $row, $adjustment);
        });

        // Then by date alone, for a student renamed since the deduction was written (lingo: "حمزه
        // محمود" became "حمزه محمود برايفت"): only when exactly one deduction of that amount, on that
        // date, from that statement is left, and it does not name a lesson that still pays.
        return $rows->map(function (array $row) use ($payroll, &$taken): array {
            if ($row['skip'] !== self::UNMATCHED) {
                return $row;
            }
            $live = $this->payingNames($row);
            $candidates = $this->carried($row, $row['date'].' · ', $taken)
                ->reject(fn (object $a) => in_array($this->namedIn((string) $a->reason), $live, true))
                ->values();
            if ($candidates->count() !== 1) {
                return $row;
            }
            $adjustment = $candidates->first();
            $taken[] = (string) $adjustment->id;

            return [...$this->matched($payroll, [...$row, 'skip' => null], $adjustment), 'by_date' => $this->namedIn((string) $adjustment->reason)];
        })->values();
    }

    /**
     * The deductions carried from this line's statement for this amount whose reason starts with
     * `$key` ("d/m/Y · student", or just "d/m/Y · "), oldest first.
     *
     * @param  array<string, mixed>  $row
     * @param  list<string>  $taken
     * @return Collection<int, object>
     */
    private function carried(array $row, string $key, array $taken): Collection
    {
        $like = str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $key).'%';

        return DB::table('payout_adjustments as a')
            ->join('payouts as p', 'p.id', '=', 'a.payout_id')
            ->where('a.repriced_payout_id', $row['payout_id'])
            ->where('a.type', 'DEDUCTION')
            ->where('a.amount_minor', $row['amount_minor'])
            ->where(fn ($q) => $q->where('a.reason', 'like', 'Lesson removed: '.$like)
                ->orWhere('a.reason', 'like', 'Lesson undone: '.$like))
            ->whereNotIn('a.id', $taken)
            ->orderBy('a.created_at')
            ->get(['a.id', 'a.payout_id', 'a.reason', 'p.period_year', 'p.period_month']);
    }

    /**
     * @param  array<string, mixed>  $row
     * @return array<string, mixed>
     */
    private function matched(Payroll $payroll, array $row, object $adjustment): array
    {
        if ($payroll->carriesCorrections((string) $adjustment->payout_id)) {
            return [...$row, 'skip' => 'the deduction sits on a statement paid from the treasury'];
        }

        return [
            ...$row,
            'adjustment_id' => (string) $adjustment->id,
            'adjustment_payout_id' => (string) $adjustment->payout_id,
            'carried_to' => sprintf('%02d/%d', $adjustment->period_month, $adjustment->period_year),
        ];
    }

    /** The student a carried reason names: "Lesson undone: d/m/Y · NAME / تراجع عن حصة: …". */
    private function namedIn(string $reason): string
    {
        $after = explode(' · ', $reason, 2)[1] ?? '';

        return trim(explode(' / ', $after, 2)[0]);
    }

    /**
     * The students whose lessons on this line's statement and date still pay: a deduction naming one
     * of them belongs to that lesson, never to a renamed one.
     *
     * @param  array<string, mixed>  $row
     * @return list<string>
     */
    private function payingNames(array $row): array
    {
        $day = Carbon::createFromFormat('d/m/Y', (string) $row['date'])->format('Y-m-d');

        return DB::table('payout_line_items as li')
            ->join('sessions as se', 'se.id', '=', 'li.session_id')
            ->join('students as st', 'st.id', '=', 'se.student_id')
            ->where('li.payout_id', $row['payout_id'])
            ->where('li.session_date', $day)
            ->get(['se.status', 'se.bill_override', 'se.teacher_override', 'st.full_name'])
            ->filter(fn (object $s) => PayrollLessonCorrection::paysTeacher($s))
            ->pluck('full_name')
            ->map(fn ($n) => (string) $n)
            ->unique()
            ->values()
            ->all();
    }

    private function money(int $minor): string
    {
        return number_format($minor / 100, 2);
    }

    /** @return array<string, string> id => name */
    private function academies(): array
    {
        TenantContext::apply(userId: self::SYSTEM_USER_ID, academyId: null, role: 'SUPER_ADMIN', local: false);
        try {
            return DB::table('academies')
                ->when($this->option('academy'), fn ($q, $id) => $q->where('id', $id))
                ->where('status', 'ACTIVE')
                ->orderBy('name')
                ->pluck('name', 'id')
                ->mapWithKeys(fn ($n, $id) => [(string) $id => (string) $n])
                ->all();
        } finally {
            TenantContext::clear();
        }
    }
}
