<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * A pay-by date on a bill (Ahmed 2026-11-17, custom bills — "تاريخ دفع معين").
 *
 *   • `invoices.due_on` — the academy-local day the payer is asked to pay by. Optional; set on a
 *     hand-made bill when it is raised and changeable afterwards (it is not a financial field, so
 *     the closed-invoice trigger leaves it alone).
 *   • The follow-up rule reads it: a bill with a pay-by date is chased the day after that date,
 *     one without it 24 hours after it was raised (InvoiceController::FOLLOW_UP_SQL).
 *   • `app.public_invoice_by_token()` returns it, so the pay page can say "pay by …". Patched in
 *     place from its live definition, like 2026_09_24_000002.
 */
return new class extends Migration
{
    /** @var list<array{0:string,1:string}> */
    private const PATCHES = [
        ['i.payment_reason,', 'i.payment_reason, i.due_on,'],
        ["'payment_reason',    v_invoice.payment_reason,", "'payment_reason',    v_invoice.payment_reason, 'due_on', v_invoice.due_on,"],
    ];

    public function up(): void
    {
        DB::unprepared('alter table invoices add column due_on date');

        $this->patchPublicFunction(array_map(fn (array $p): array => [$p[0], $p[1]], self::PATCHES));
    }

    public function down(): void
    {
        $this->patchPublicFunction(array_map(fn (array $p): array => [$p[1], $p[0]], self::PATCHES));

        DB::unprepared('alter table invoices drop column due_on');
    }

    /**
     * Swap expressions in the live function body; fail loudly unless each is there exactly once.
     *
     * @param  list<array{0:string,1:string}>  $swaps
     */
    private function patchPublicFunction(array $swaps): void
    {
        $def = (string) DB::selectOne(
            "select pg_get_functiondef('app.public_invoice_by_token(text)'::regprocedure) as def",
        )->def;

        foreach ($swaps as [$from, $to]) {
            if (substr_count($def, $from) !== 1) {
                throw new RuntimeException("app.public_invoice_by_token: '{$from}' not found exactly once — patch it by hand.");
            }
            $def = str_replace($from, $to, $def);
        }

        DB::unprepared($def);
    }
};
