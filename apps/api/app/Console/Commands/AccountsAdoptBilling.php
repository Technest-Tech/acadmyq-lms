<?php

declare(strict_types=1);

namespace App\Console\Commands;

use App\Services\PlatformAccounts;
use App\Support\AuthContext;
use App\Support\DryRunComplete;
use App\Support\Tenancy;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * Move every platform client's old billing into the accounts book (run once after the accounts
 * deploy, safe to run again).
 *
 * Before 2026-11-08 a paid client was billed through `academy_invoices` (one bill per module period)
 * and the owner's own Finance book knew nothing about it. For each academy this links (or opens) its
 * account and, unless the account already has deals, turns its paid modules into one recurring line
 * with every old bill as a cycle and every paid bill as a payment — see
 * PlatformAccounts::adoptLegacyBilling. A client with no paid module and no bill is left alone: it
 * shows on Accounts → Dues as "no agreement yet" until the owner sets one.
 *
 *   php artisan accounts:adopt-billing             every academy
 *   php artisan accounts:adopt-billing --academy=… one academy
 *   php artisan accounts:adopt-billing --dry-run   say what would happen, write nothing
 */
final class AccountsAdoptBilling extends Command
{
    protected $signature = 'accounts:adopt-billing
        {--academy= : Only this academy id}
        {--dry-run : Report, then roll everything back}';

    protected $description = 'Bring the old per-module platform bills into the accounts book';

    private const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

    public function handle(PlatformAccounts $accounts): int
    {
        $ctx = new AuthContext(userId: self::SYSTEM_USER_ID, academyId: null, role: 'SUPER_ADMIN', permissions: []);
        $dry = (bool) $this->option('dry-run');

        $ids = $this->option('academy') !== null
            ? [(string) $this->option('academy')]
            : Tenancy::withContext($ctx, fn () => DB::table('academies')->orderBy('name')->pluck('id')->map(fn ($id) => (string) $id)->all());

        $rows = [];
        foreach ($ids as $academyId) {
            $res = null;
            try {
                $res = Tenancy::withContext($ctx, function () use ($accounts, $academyId, $dry, &$res): array {
                    $res = $accounts->adoptLegacyBilling($academyId);
                    if ($dry) {
                        throw new DryRunComplete; // every write ran against the real constraints; keep none
                    }

                    return $res;
                });
            } catch (DryRunComplete) {
                // $res holds what the real run would have done.
            } catch (Throwable $e) {
                $res = ['status' => 'error: '.$e->getMessage(), 'cycles' => 0, 'payments' => 0, 'proofs' => 0];
            }
            $name = Tenancy::withContext($ctx, fn () => DB::table('academies')->where('id', $academyId)->value('name'));
            $rows[] = [$name ?? $academyId, $res['status'], $res['cycles'], $res['payments'], $res['proofs']];
        }

        $this->table(['Client', 'Result', 'Cycles', 'Payments', 'Proofs'], $rows);
        if ($dry) {
            $this->warn('Dry run — nothing was written.');
        }

        return self::SUCCESS;
    }
}
