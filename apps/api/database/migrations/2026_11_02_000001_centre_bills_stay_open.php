<?php

declare(strict_types=1);

use App\Services\PackageSettlement;
use App\Support\Audit;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Takes back the month-end close on a curriculum centre on receipts (lingo, 2026-11-02): at 02:00
 * it shut 201 bills, so a discount found "nothing to apply to" and a subscription, a charge or a
 * lesson on them could no longer be corrected. Such a centre's bills no longer close at all
 * (Invoicing::closePeriodInvoices); these go back to how they stood the night before.
 *
 * Only `status` and `closed_at` move: no total, payment or receipt. In two steps, because the
 * freeze trigger refuses to reopen a bill while it still has a closed_at.
 */
return new class extends Migration
{
    public function up(): void
    {
        $this->fill();
    }

    public function down(): void
    {
        // Closing them again would freeze what people corrected since: nothing to take back.
    }

    /** Public so the test suite can run it against fixtures. Returns how many bills reopened. */
    public function fill(): int
    {
        // One unit, so the tenant settings below hold for every statement (they are transaction-local).
        return DB::transaction(function (): int {
            DB::statement("select set_config('app.current_role', 'SUPER_ADMIN', true)");

            $reopened = 0;
            foreach (DB::table('academies')->pluck('id')->all() as $id) {
                DB::statement("select set_config('app.current_academy_id', ?, true)", [(string) $id]);
                if (! PackageSettlement::availableFor((string) $id)) {
                    continue;
                }

                $closed = DB::table('invoices')->whereNotNull('closed_at')->where('status', '<>', 'VOID');
                $count = (clone $closed)->count();
                if ($count === 0) {
                    continue;
                }
                $ids = (clone $closed)->pluck('id')->all();
                DB::table('invoices')->whereIn('id', $ids)->update(['closed_at' => null]);
                DB::table('invoices')->whereIn('id', $ids)->update(['status' => 'OPEN', 'updated_at' => now()]);

                Audit::log('invoices.reopened_centre', 'academy', (string) $id, (string) $id, null, 'SUPER_ADMIN', after: ['invoices' => $count]);
                $reopened += $count;
            }
            DB::statement("select set_config('app.current_academy_id', '', true)");

            return $reopened;
        });
    }
};
