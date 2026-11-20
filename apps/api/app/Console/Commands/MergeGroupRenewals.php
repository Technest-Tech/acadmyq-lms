<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Services\RenewalMerge;
use App\Support\AuthContext;
use App\Support\Tenancy;
use App\Support\TenantContext;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Throwable;

/**
 * Puts a renewed group back together (Lingo, 2026-11-20). Renewing used to open a new group and
 * archive the old one; {@see RenewalMerge} folds each such pair into the one group it was: its
 * students, the new term's charges (priced again under the family's discounts) and settings go back
 * to the old group, whoever has used up what they paid for is raised their next month, and the
 * new group is deleted.
 *
 * Without `--apply` every group is folded for real inside a transaction that is then rolled back,
 * so what it prints is exactly what `--apply` will do. Each group is its own transaction: one that
 * cannot be folded is reported and left as it is, the rest go through.
 *
 *   php artisan groups:merge-renewals --academy=<uuid> [--group=<uuid>] [--apply]
 */
final class MergeGroupRenewals extends Command
{
    private const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

    protected $signature = 'groups:merge-renewals
        {--academy= : The academy id (required)}
        {--group= : Only this archived group (the old term)}
        {--apply : Save it (default: fold, print, roll back)}';

    protected $description = 'Fold renewed groups back into the group they continued.';

    public function handle(RenewalMerge $merge): int
    {
        $academyId = (string) $this->option('academy');
        if ($academyId === '' || ! $this->academyExists($academyId)) {
            $this->error('Give a real --academy=<uuid>.');

            return self::FAILURE;
        }
        $apply = (bool) $this->option('apply');
        $ctx = new AuthContext(userId: self::SYSTEM_USER_ID, academyId: $academyId, role: 'SUPER_ADMIN', permissions: []);

        $roots = Tenancy::withContext($ctx, fn () => $merge->roots($this->option('group') ?: null));
        if ($roots->isEmpty()) {
            $this->info('Nothing to fold.');

            return self::SUCCESS;
        }

        $done = [];
        $refused = [];
        foreach ($roots as $root) {
            try {
                $report = null;
                try {
                    Tenancy::withContext($ctx, function () use ($merge, $root, $apply, &$report): void {
                        $report = $merge->fold($root, self::SYSTEM_USER_ID, 'SUPER_ADMIN');
                        if (! $apply) {
                            throw new DryRunRollback;
                        }
                    });
                } catch (DryRunRollback) {
                    // rolled back on purpose; $report says what it would have done
                }
                $done[] = $report;
                $this->line($this->describe($report));
            } catch (RuntimeException $e) {
                $refused[] = [(string) $root->name, $e->getMessage()];
                $this->warn("  ✗ {$root->name}: {$e->getMessage()}");
            } catch (Throwable $e) {
                $refused[] = [(string) $root->name, $e->getMessage()];
                $this->error("  ✗ {$root->name}: ".mb_substr($e->getMessage(), 0, 300));
            }
        }

        $sum = fn (callable $pick): int => (int) array_sum(array_map($pick, $done));
        $this->newLine();
        $this->info(sprintf('%s %d group(s), refused %d.', $apply ? 'Folded' : 'Would fold', count($done), count($refused)));
        $this->line(sprintf('  students back in their group: %d (reopened %d, came in the new term %d, already back %d, left since %d)',
            $sum(fn ($r) => $r['active_members']), $sum(fn ($r) => $r['members']['reopened']), $sum(fn ($r) => $r['members']['came_new']),
            $sum(fn ($r) => $r['members']['already_back']), $sum(fn ($r) => $r['members']['left_since'])));
        $this->line(sprintf('  charges moved: %d — were %s, now %s (paid on them %s, handed back as credit %s)',
            $sum(fn ($r) => $r['charges_moved']['lines']), self::money($sum(fn ($r) => $r['charges_moved']['was_minor'])),
            self::money($sum(fn ($r) => $r['charges_moved']['now_minor'])), self::money($sum(fn ($r) => $r['charges_moved']['paid_minor'])),
            self::money($sum(fn ($r) => $r['charges_moved']['credit_back_minor']))));
        $this->line(sprintf('  charges raised now: %d — %s', $sum(fn ($r) => $r['charges_raised']['lines']), self::money($sum(fn ($r) => $r['charges_raised']['amount_minor']))));
        $this->line(sprintf('  lessons moved: %d, last-day lessons given back to students not renewed: %d, lessons to come: %d',
            $sum(fn ($r) => $r['lessons_moved']), $sum(fn ($r) => $r['last_day_given_back']), $sum(fn ($r) => $r['lessons_to_come'])));
        if (! $apply) {
            $this->info('Nothing was saved — run again with --apply.');
        }

        return $refused === [] ? self::SUCCESS : self::FAILURE;
    }

    /** @param array<string,mixed> $r */
    private function describe(array $r): string
    {
        return sprintf('  ✓ %s — %d students (reopened %d, new %d, back %d, left %d) · moved %d charges %s → %s · raised %d = %s · ends %s · %d lessons to come',
            $r['name'], $r['active_members'], $r['members']['reopened'], $r['members']['came_new'], $r['members']['already_back'], $r['members']['left_since'],
            $r['charges_moved']['lines'], self::money($r['charges_moved']['was_minor']), self::money($r['charges_moved']['now_minor']),
            $r['charges_raised']['lines'], self::money($r['charges_raised']['amount_minor']),
            $r['end_date'] ?? 'never', $r['lessons_to_come']);
    }

    private static function money(int $minor): string
    {
        return number_format($minor / 100, 2, '.', ',');
    }

    private function academyExists(string $academyId): bool
    {
        if (preg_match('/^[0-9a-f-]{36}$/i', $academyId) !== 1) {
            return false;
        }
        TenantContext::apply(userId: self::SYSTEM_USER_ID, academyId: null, role: 'SUPER_ADMIN', local: false);
        try {
            return DB::table('academies')->where('id', $academyId)->exists();
        } finally {
            TenantContext::clear();
        }
    }
}

/** Thrown inside the transaction of a dry run, so everything the fold did is rolled back. */
final class DryRunRollback extends \Exception {}
