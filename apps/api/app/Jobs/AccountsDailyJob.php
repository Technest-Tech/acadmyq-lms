<?php

declare(strict_types=1);

namespace App\Jobs;

use App\Services\AccountReminders;
use App\Services\FinanceLedger;
use App\Support\AuthContext;
use App\Support\Tenancy;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;

/**
 * The accounts' morning (replaces the monthly platform-bill run and its reminder sweep): roll every
 * active subscription up to today, so a cycle that started overnight is owed and the next renewal
 * date is right on every screen, then send the reminders (AccountReminders). Idempotent — a second
 * run on the same day rolls nothing new and sends nothing twice.
 */
final class AccountsDailyJob implements ShouldQueue
{
    use Dispatchable;
    use InteractsWithQueue;
    use Queueable;
    use SerializesModels;

    private const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

    public function __construct(private readonly bool $remind = true) {}

    /** @return array{accrued:int, reminders:?array<string,mixed>} */
    public function handle(FinanceLedger $ledger, AccountReminders $reminders): array
    {
        $ctx = new AuthContext(userId: self::SYSTEM_USER_ID, academyId: null, role: 'SUPER_ADMIN', permissions: []);

        $accrued = Tenancy::withContext($ctx, fn (): int => $ledger->accrueAll());
        $sent = $this->remind ? Tenancy::withContext($ctx, fn (): array => $reminders->run()) : null;

        return ['accrued' => $accrued, 'reminders' => $sent];
    }
}
