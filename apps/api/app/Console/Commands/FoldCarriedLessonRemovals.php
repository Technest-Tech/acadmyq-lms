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
                $this->line($what.($p['adjustment_id'] !== null ? "  → off {$p['carried_to']}" : '  (already 0)'));
                if (! $apply) {
                    continue;
                }

                try {
                    Tenancy::withContext($ctx, function () use ($payroll, $p, $academyId): void {
                        $session = DB::table('sessions')->where('id', $p['session_id'])->first();
                        $payroll->correcting($p['payout_id'], fn () => $payroll->onSessionUnattended($session));
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
            // Marked again later: its pay lives on the later line, and recalculation already nets it.
            ->whereNotExists(fn ($q) => $q->selectRaw('1')->from('payout_line_items as later')
                ->whereColumn('later.session_id', 'li.session_id')->whereColumn('later.id', '<>', 'li.id'))
            ->orderBy('t.full_name')
            ->orderBy('li.session_date')
            ->get([
                'li.id', 'li.payout_id', 'li.session_id', 'li.amount_minor', 'li.currency',
                'p.period_year', 'p.period_month', 't.full_name as teacher_name',
                'se.status', 'se.bill_override', 'se.teacher_override', 'se.scheduled_at_utc',
                'st.full_name as student_name',
            ])
            ->filter(fn (object $l) => ! PayrollLessonCorrection::paysTeacher($l));

        $taken = [];

        return $lines->map(function (object $l) use ($payroll, $timezone, &$taken): array {
            // The reason both carries write: "d/m/Y · student" (PayrollLessonCorrection::describe,
            // Payroll::lessonUndoneReason).
            $key = Carbon::parse($l->scheduled_at_utc)->setTimezone($timezone)->format('d/m/Y').' · '.($l->student_name ?? '—');
            $row = [
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

            $adjustment = DB::table('payout_adjustments as a')
                ->join('payouts as p', 'p.id', '=', 'a.payout_id')
                ->where('a.repriced_payout_id', $l->payout_id)
                ->where('a.type', 'DEDUCTION')
                ->where('a.amount_minor', (int) $l->amount_minor)
                ->where(fn ($q) => $q->where('a.reason', 'like', 'Lesson removed: '.$key.'%')
                    ->orWhere('a.reason', 'like', 'Lesson undone: '.$key.'%'))
                ->whereNotIn('a.id', $taken)
                ->orderBy('a.created_at')
                ->first(['a.id', 'a.payout_id', 'p.period_year', 'p.period_month']);

            if ($adjustment === null) {
                return [...$row, 'skip' => 'no matching deduction found'];
            }
            $taken[] = (string) $adjustment->id;
            if ($payroll->carriesCorrections((string) $adjustment->payout_id)) {
                return [...$row, 'skip' => 'the deduction sits on a statement paid from the treasury'];
            }

            return [
                ...$row,
                'adjustment_id' => (string) $adjustment->id,
                'adjustment_payout_id' => (string) $adjustment->payout_id,
                'carried_to' => sprintf('%02d/%d', $adjustment->period_month, $adjustment->period_year),
            ];
        })->values();
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
