<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Three more ways an academy can be paid on its bill page (`/i/`) and family page (`/f/`), set
 * from Settings → Payment methods (2026-11-15):
 *
 *   WALLET    mobile-wallet numbers (Vodafone Cash, Etisalat Cash, …) — Egypt
 *   INSTAPAY  an InstaPay address and/or payment link — Egypt
 *   OTHER     anything else, as a title + free text (Western Union, Wise, …)
 *
 * Bank transfer and PayPal already existed; abroad they are the email and the IBAN/SWIFT. All of
 * these are manual: the payer sends the money and the academy marks the bill paid. Only the check
 * constraint widens — `app.public_invoice_by_token` already returns every ACTIVE row's config (minus
 * `client_secret`), so the new methods reach the bill page with no function change. Their configs
 * hold nothing secret by construction (PaymentSettingsController::sanitizeConfig).
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::unprepared(<<<'SQL'
            alter table academy_payment_settings drop constraint if exists payment_settings_method_chk;
            alter table academy_payment_settings add constraint payment_settings_method_chk check (
              method in ('BANK_TRANSFER', 'PAYPAL', 'XPAY', 'WALLET', 'INSTAPAY', 'OTHER')
            );
        SQL);
    }

    public function down(): void
    {
        DB::unprepared(<<<'SQL'
            delete from academy_payment_settings where method in ('WALLET', 'INSTAPAY', 'OTHER');
            alter table academy_payment_settings drop constraint if exists payment_settings_method_chk;
            alter table academy_payment_settings add constraint payment_settings_method_chk check (
              method in ('BANK_TRANSFER', 'PAYPAL', 'XPAY')
            );
        SQL);
    }
};
