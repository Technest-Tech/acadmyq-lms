<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Quick custom bills (Invoices → Custom bills): a bill for someone who is not on the books — a
 * walk-in, a one-off workshop attendee — named by hand instead of picked from the student list.
 *
 *   • `invoices.payer_name` — the typed name. Only a MANUAL invoice may use it, and only instead of
 *     a guardian/student link, never beside one: an AUTO invoice is always built from a real payer.
 *   • `invoices_exactly_one_payer_chk` widens from "guardian XOR student" to "guardian XOR student
 *     XOR (MANUAL + a typed name)".
 *   • `app.public_invoice_by_token()` falls back to the typed name for the payer shown on the pay
 *     page. Patched in place from its live definition (a single expression changes) rather than
 *     re-pasting the whole body, which would fork it from 2026_06_30 for no reason.
 */
return new class extends Migration
{
    private const PAYER_OLD = 'coalesce(g.full_name,  s_payer.full_name)';

    private const PAYER_NEW = 'coalesce(g.full_name,  s_payer.full_name, i.payer_name)';

    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            alter table invoices add column payer_name text;

            alter table invoices drop constraint invoices_exactly_one_payer_chk;
            alter table invoices add constraint invoices_exactly_one_payer_chk check (
                   (guardian_id is not null and student_id is null     and payer_name is null)
                or (guardian_id is null     and student_id is not null and payer_name is null)
                or (guardian_id is null     and student_id is null
                    and kind = 'MANUAL' and nullif(btrim(payer_name), '') is not null)
            );
        SQL);

        $this->patchPublicFunction(self::PAYER_OLD, self::PAYER_NEW);
    }

    public function down(): void
    {
        $this->patchPublicFunction(self::PAYER_NEW, self::PAYER_OLD);

        DB::unprepared(<<<'SQL'
            delete from invoices where payer_name is not null;

            alter table invoices drop constraint invoices_exactly_one_payer_chk;
            alter table invoices add constraint invoices_exactly_one_payer_chk
              check ((guardian_id is null) <> (student_id is null));

            alter table invoices drop column payer_name;
        SQL);
    }

    /** Swap one expression in the live function body; fail loudly if it is not there exactly once. */
    private function patchPublicFunction(string $from, string $to): void
    {
        $def = (string) DB::selectOne(
            "select pg_get_functiondef('app.public_invoice_by_token(text)'::regprocedure) as def",
        )->def;

        if (substr_count($def, $from) !== 1) {
            throw new RuntimeException('app.public_invoice_by_token: payer expression not found — patch it by hand.');
        }

        // pg_get_functiondef re-emits the owner-independent `create or replace`, so ownership and
        // grants set by the earlier migration survive.
        DB::unprepared(str_replace($from, $to, $def));
    }
};
