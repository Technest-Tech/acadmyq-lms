<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Where a teacher's payout actually goes. Payroll has always computed WHAT to pay (R-PAY) and
 * said nothing about HOW — so the number or the InstaPay link lived in a WhatsApp thread, and the
 * person doing the transfer went looking for it every month.
 *
 * Two columns, not a table: a teacher is paid to ONE destination, and a second row would only
 * raise the question of which one is current. Changing it is an edit, and the teacher.update audit
 * already records the before/after.
 *
 * `payout_handle` is deliberately free text rather than a phone column. The two methods carry
 * genuinely different strings — a wallet is an Egyptian mobile number, an InstaPay destination is
 * an address (`name@instapay`) OR a share link (`ipn.eg/S/…`) — and normalising either into E.164
 * would corrupt the other. The CHECK keeps the pair honest instead: a method with nowhere to send
 * the money, or a destination that does not say how to read it, are both meaningless, so the two
 * are either both set or both null.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            alter table teachers
              add column payout_method text
                check (payout_method is null or payout_method in ('INSTAPAY', 'WALLET')),
              add column payout_handle text,
              add constraint teachers_payout_pair_ck
                check ((payout_method is null) = (payout_handle is null));
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            alter table teachers
              drop constraint if exists teachers_payout_pair_ck,
              drop column if exists payout_method,
              drop column if exists payout_handle;
        SQL);
    }
};
