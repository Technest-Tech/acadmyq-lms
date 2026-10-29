<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Services\Invoicing;
use App\Support\Audit;
use App\Support\AuthContext;
use App\Support\Entitlement;
use App\Support\Tenancy;
use App\Support\TenantContext;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * The dues a deleted subscription left behind before deleting took them along (a curriculum centre,
 * 2026-10-29) — a one-off repair for curriculum centres only. Two leftovers:
 *
 *   - a group membership deleted as a mistake (`class_group.member_undone`) that began mid-month:
 *     its month's charge (dated the 1st) stayed. Removed when the student has no membership in that
 *     group any more and the bill is still open — what was paid toward it becomes their credit.
 *   - a private subscription deleted unused whose bill had already closed with its month: the bill
 *     stayed. Voided when nothing was paid toward it.
 *
 * Lists what it would do; `--apply` does it.
 *
 *   php artisan subscriptions:clear-deleted-dues [--academy=<uuid>] [--apply]
 */
final class ClearDeletedSubscriptionDues extends Command
{
    private const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

    protected $signature = 'subscriptions:clear-deleted-dues
        {--academy= : Limit to one academy id}
        {--apply : Remove them (default: only list)}';

    protected $description = 'Take off the dues that deleted group / private subscriptions left behind (curriculum centres).';

    public function handle(Invoicing $invoicing): int
    {
        $apply = (bool) $this->option('apply');
        foreach ($this->academies() as $academyId => $name) {
            $ctx = new AuthContext(userId: self::SYSTEM_USER_ID, academyId: $academyId, role: 'SUPER_ADMIN', permissions: []);
            // A curriculum centre's only (read inside its own context: entitlements are tenant rows).
            [$lines, $bills] = Tenancy::withContext($ctx, fn () => Entitlement::hasCapability($academyId, 'centre')
                ? [$this->groupLeftovers(), $this->packageLeftovers()]
                : [collect(), collect()]);
            if ($lines->isEmpty() && $bills->isEmpty()) {
                continue;
            }

            $this->info("{$name} ({$academyId})");
            foreach ($lines as $l) {
                $this->line(sprintf('  group charge  %s · %s · %s  %d %s', $l->student_name, $l->group_name, $l->group_period, $l->amount_minor, $l->currency));
            }
            foreach ($bills as $b) {
                $this->line(sprintf('  subscription  %s · %s · bill %04d-%02d  %d %s', $b->student_name, $b->label, $b->period_year, $b->period_month, $b->total_minor, $b->currency));
            }
            if (! $apply) {
                continue;
            }

            Tenancy::withContext($ctx, function () use ($lines, $bills, $invoicing, $academyId): void {
                foreach ($lines as $l) {
                    $invoicing->removeGroupLine(DB::table('invoice_line_items')->where('id', $l->id)->first());
                }
                foreach ($bills as $b) {
                    DB::table('invoices')->where('id', $b->invoice_id)->where('amount_paid_minor', 0)->update(['status' => 'VOID', 'updated_at' => now()]);
                    DB::table('lesson_packages')->where('overdraft_invoice_id', $b->invoice_id)->update(['overdraft_invoice_id' => null, 'updated_at' => now()]);
                }
                Audit::log('subscriptions.deleted_dues_cleared', 'academy', $academyId, $academyId, null, 'SUPER_ADMIN',
                    after: ['group_lines' => $lines->pluck('id')->all(), 'voided_invoices' => $bills->pluck('invoice_id')->all()]);
            });
            $this->info('  → cleared');
        }
        $this->info($apply ? 'Done.' : 'Listed only — run again with --apply to clear them.');

        return self::SUCCESS;
    }

    /** Group charges of a student deleted from the group, with no membership left there, on an open bill. */
    private function groupLeftovers()
    {
        return DB::table('invoice_line_items as li')
            ->join('invoices as i', 'i.id', '=', 'li.invoice_id')
            ->join('class_groups as g', 'g.id', '=', 'li.class_group_id')
            ->leftJoin('students as s', 's.id', '=', 'li.student_id')
            ->where('i.status', 'OPEN')
            ->whereNotExists(fn ($q) => $q->selectRaw('1')->from('class_group_members as m')
                ->whereColumn('m.group_id', 'li.class_group_id')->whereColumn('m.student_id', 'li.student_id'))
            ->whereExists(fn ($q) => $q->selectRaw('1')->from('audit_log as a')
                ->where('a.action', 'class_group.member_undone')
                ->whereColumn('a.entity_id', 'li.class_group_id')
                ->whereRaw("a.before->>'student_id' = li.student_id::text"))
            ->orderBy('s.full_name')
            ->get(['li.id', 'li.amount_minor', 'li.currency', 'li.group_period', 's.full_name as student_name', 'g.name as group_name']);
    }

    /** Bills of private subscriptions deleted unused (cancelled) that nobody paid and that were never voided. */
    private function packageLeftovers()
    {
        return DB::table('lesson_packages as p')
            ->join('invoices as i', 'i.id', '=', 'p.invoice_id')
            ->leftJoin('students as s', 's.id', '=', 'p.student_id')
            ->where('p.status', 'CANCELLED')
            ->whereIn('i.status', ['OPEN', 'CLOSED'])
            ->where('i.amount_paid_minor', 0)
            ->orderBy('s.full_name')
            ->get(['p.invoice_id', 'p.label', 'i.period_year', 'i.period_month', 'i.total_minor', 'i.currency', 's.full_name as student_name']);
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
