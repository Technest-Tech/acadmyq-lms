<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Services\PrepaidMonthly;
use App\Support\Audit;
use App\Support\AuthContext;
use App\Support\Entitlement;
use App\Support\Tenancy;
use Carbon\CarbonImmutable;
use Illuminate\Console\Command;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Switch an academy to monthly billing in advance from a month of OUR choosing — the Settings card
 * always starts with next month; this is for an academy that was already collecting in advance
 * outside the system (انا مسلم, 2026-11-22: November collected in full at its start, its leave to come
 * off December's bill).
 *
 *   --from=YYYY-MM       first month of the regime: lessons from then on add no lesson lines, and a
 *                        not-charged one comes off a later bill
 *   --first-fee=YYYY-MM  first month the system bills in advance; the months from --from up to it
 *                        are treated as paid in full outside the system
 *   --void-before=YYYY-MM  also void the automatic lesson bills of earlier months that nothing was
 *                        paid on (their amounts were per lesson, not what the academy collected).
 *                        A bill carrying a group charge or any payment is left alone and listed.
 *
 * A dry run does everything — switch, void, work out the first run's bills — prints it, and rolls it
 * all back; `--apply` keeps it.
 *
 *   php artisan billing:prepaid-start <academy> --from=2026-11 --first-fee=2026-12 --void-before=2026-12 [--apply]
 */
final class StartPrepaidBilling extends Command
{
    private const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

    protected $signature = 'billing:prepaid-start
        {academy : The academy id}
        {--from= : First month of the regime (YYYY-MM)}
        {--first-fee= : First month the system bills in advance (YYYY-MM)}
        {--void-before= : Void unpaid automatic lesson bills of months before this one (YYYY-MM)}
        {--apply : Do it (default: only list)}';

    protected $description = 'Switch an academy to monthly billing in advance from a chosen month.';

    public function handle(): int
    {
        $academyId = (string) $this->argument('academy');
        $from = $this->month('from');
        $firstFee = $this->month('first-fee');
        $voidBefore = $this->option('void-before') !== null ? $this->month('void-before') : null;
        if ($from === null || $firstFee === null || $firstFee < $from || ($this->option('void-before') !== null && $voidBefore === null)) {
            $this->error('Give --from and --first-fee as YYYY-MM, with --first-fee not before --from.');

            return self::FAILURE;
        }
        $apply = (bool) $this->option('apply');

        $ctx = new AuthContext(userId: self::SYSTEM_USER_ID, academyId: $academyId, role: 'SUPER_ADMIN', permissions: []);

        try {
            return Tenancy::withContext($ctx, function () use ($academyId, $from, $firstFee, $voidBefore, $apply): int {
                $name = DB::table('academies')->where('id', $academyId)->value('name');
                if ($name === null) {
                    $this->error('No such academy.');

                    return self::FAILURE;
                }
                if (Entitlement::hasCapability($academyId, 'centre')) {
                    $this->error('A centre bills by its own subscriptions.');

                    return self::FAILURE;
                }

                $before = PrepaidMonthly::settings($academyId);
                $this->info("{$name}: billing in advance from {$from}, first bill by the system for {$firstFee}".($apply ? '' : ' (dry run)'));
                $this->line('  now: '.json_encode($before));

                [$voidable, $kept] = $voidBefore !== null ? $this->bills($voidBefore) : [collect(), collect()];
                if ($voidBefore !== null) {
                    $this->line("  automatic bills before {$voidBefore} to void: {$voidable->count()}");
                    foreach ($voidable->groupBy(fn ($b) => sprintf('%04d-%02d %s', $b->period_year, $b->period_month, $b->status)) as $key => $rows) {
                        $this->line(sprintf('    %s: %d bills', $key, $rows->count()));
                    }
                    if ($kept->isNotEmpty()) {
                        $this->warn("  left alone (paid, or carrying a group charge): {$kept->count()}");
                        foreach ($kept as $b) {
                            $this->line(sprintf('    %s %04d-%02d %s total=%d paid=%d', $b->id, $b->period_year, $b->period_month, $b->status, $b->total_minor, $b->amount_paid_minor));
                        }
                    }
                }

                DB::table('academy_settings')->updateOrInsert(['academy_id' => $academyId], [
                    'billing_mode' => PrepaidMonthly::MODE_PREPAID,
                    'prepaid_from' => $from,
                    'prepaid_first_fee' => $firstFee,
                    'updated_at' => now(),
                ]);
                Audit::log('academy.billing_mode_updated', 'academy', $academyId, $academyId, null, 'SUPER_ADMIN',
                    after: [...PrepaidMonthly::settings($academyId), 'via' => 'billing:prepaid-start'], before: $before);

                foreach ($voidable as $bill) {
                    DB::table('invoices')->where('id', $bill->id)->update(['status' => 'VOID', 'updated_at' => now()]);
                    Audit::log('invoice.voided', 'invoice', (string) $bill->id, $academyId, null, 'SUPER_ADMIN',
                        after: ['status' => 'VOID', 'reason' => 'PREPAID_SWITCH', 'was' => (string) $bill->status, 'total_minor' => (int) $bill->total_minor]);
                }

                // What the first run would bill, worked out on the switched settings (so a dry run shows
                // the real numbers before anything is kept).
                $this->previewFirstRun($academyId, $firstFee);

                if (! $apply) {
                    throw new StartPrepaidBillingDryRun;
                }

                $this->info('  done: settings saved'.($voidBefore !== null ? ", {$voidable->count()} bills voided" : ''));

                return self::SUCCESS;
            });
        } catch (StartPrepaidBillingDryRun) {
            $this->info('  dry run: nothing kept. Add --apply to do it.');

            return self::SUCCESS;
        }
    }

    private function previewFirstRun(string $academyId, string $period): void
    {
        $rows = app(PrepaidMonthly::class)->preview($academyId, $period)['students'];
        $billed = collect($rows)->filter(fn ($r) => $r['lines'] !== []);
        $this->line("  first run ({$period}): {$billed->count()} students billed; "
            .collect($rows)->where('skip', PrepaidMonthly::SKIP_NO_PRICE)->count().' without a monthly price, '
            .collect($rows)->where('skip', PrepaidMonthly::SKIP_NO_TIMETABLE)->count().' without a timetable (both stay per lesson)');
        foreach ($billed->groupBy('currency') as $currency => $group) {
            $this->line(sprintf('    %s: fees %s, deducted %s (%d lessons), lessons charged %s, total %s, deductions waiting %d',
                $currency,
                number_format($group->sum('fee_minor') / 100, 2),
                number_format($group->sum('deducted_minor') / 100, 2),
                $group->sum(fn ($r) => count(array_filter($r['lines'], fn ($l) => $l['amount_minor'] < 0))),
                number_format($group->sum('charged_minor') / 100, 2),
                number_format($group->sum('total_minor') / 100, 2),
                $group->sum('deferred'),
            ));
        }
        foreach ($billed->filter(fn ($r) => $r['deducted_minor'] > 0 || $r['charged_minor'] > 0)->take(15) as $r) {
            $this->line(sprintf('    %s: %s', $r['full_name'], implode(' | ', array_map(
                fn ($l) => $l['description'].' '.number_format($l['amount_minor'] / 100, 2), $r['lines']))));
        }
    }

    /**
     * The automatic bills of months before `$before`: those with nothing paid and lesson lines only
     * (voidable), and the rest (kept).
     *
     * @return array{0: Collection<int, object>, 1: Collection<int, object>}
     */
    private function bills(string $before): array
    {
        $b = CarbonImmutable::parse($before);
        $bills = DB::table('invoices as i')
            ->where('i.kind', 'AUTO')
            ->whereIn('i.status', ['OPEN', 'CLOSED', 'PARTIALLY_PAID', 'PAID'])
            ->whereRaw('(i.period_year * 100 + i.period_month) < ?', [$b->year * 100 + $b->month])
            ->orderBy('i.period_year')->orderBy('i.period_month')
            ->get([
                'i.id', 'i.status', 'i.period_year', 'i.period_month', 'i.total_minor', 'i.amount_paid_minor', 'i.paid_at',
                DB::raw('exists (select 1 from invoice_line_items li where li.invoice_id = i.id and li.session_id is null) as has_other_lines'),
                DB::raw('exists (select 1 from receipt_allocations ra where ra.invoice_id = i.id) as has_receipt'),
            ]);

        $voidable = $bills->filter(fn ($x) => in_array($x->status, ['OPEN', 'CLOSED'], true)
            && (int) $x->amount_paid_minor === 0 && $x->paid_at === null && ! $x->has_other_lines && ! $x->has_receipt)->values();
        $kept = $bills->reject(fn ($x) => $voidable->contains('id', $x->id))->values();

        return [$voidable, $kept];
    }

    private function month(string $option): ?string
    {
        $v = (string) $this->option($option);

        return preg_match('/^\d{4}-(0[1-9]|1[0-2])$/', $v) === 1 ? $v.'-01' : null;
    }
}

/** Thrown at the end of a dry run so the transaction rolls back everything it did. */
final class StartPrepaidBillingDryRun extends \RuntimeException {}
