<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Evidence for an offline invoice payment.
 *
 * `payment_reason` remains the human note. These columns keep the bank/wallet transaction
 * reference and the optional uploaded proof as separate searchable/auditable facts. The file
 * itself lives on the private local disk and is only streamed through an authorized endpoint.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            alter table invoices
              add column if not exists payment_reference text,
              add column if not exists payment_proof_path text;

            comment on column invoices.payment_reference is
              'Optional bank, wallet, or transfer transaction reference recorded with an offline payment';
            comment on column invoices.payment_proof_path is
              'Private-disk path of the optional payment receipt/proof; never exposed without invoice.read';
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            alter table invoices
              drop column if exists payment_proof_path,
              drop column if exists payment_reference;
        SQL);
    }
};
