<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Card payments charge what is LEFT on an invoice, not its total (docs/groups/01-ACCOUNTING.md).
 *
 * On an academy kept by receipts a running month's invoice stays OPEN however much is paid on it,
 * so "OPEN" no longer means "nothing paid": charging the total would charge a parent twice. XPay's
 * config already returns `amount_paid_minor`; PayPal's did not, nor the academy — which the
 * capture needs to record its receipt. Both are added here. On every other academy an OPEN or
 * CLOSED invoice has nothing paid on it, so what is left IS the total and nothing changes.
 */
return new class extends Migration
{
    private const FROM = "'total_minor',   i.total_minor,";

    private const TO = "'total_minor',   i.total_minor,\n            'amount_paid_minor', i.amount_paid_minor,\n            'academy_id',    i.academy_id,";

    public function up(): void
    {
        $this->patch(self::FROM, self::TO);
    }

    public function down(): void
    {
        $this->patch(self::TO, self::FROM);
    }

    /** Swap one expression in the live function body; fail loudly if it is not there exactly once. */
    private function patch(string $from, string $to): void
    {
        $def = (string) DB::selectOne(
            "select pg_get_functiondef('app.paypal_config_by_token(text)'::regprocedure) as def",
        )->def;

        if (substr_count($def, $from) !== 1) {
            throw new RuntimeException('app.paypal_config_by_token: total_minor expression not found — patch it by hand.');
        }

        // pg_get_functiondef re-emits the owner-independent `create or replace`, so ownership and
        // grants set by the earlier migration survive.
        DB::unprepared(str_replace($from, $to, $def));
    }
};
