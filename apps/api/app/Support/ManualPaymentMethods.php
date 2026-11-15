<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Support\Facades\DB;

/**
 * The academy's manual payment methods as a payer may see them — the allow-list behind the family
 * page (`/f/{token}`), where one transfer can cover every bill at once.
 *
 * Manual means the payer sends the money and the academy marks the bills paid: wallet numbers,
 * InstaPay, a PayPal email/paypal.me link, a bank account, or the academy's own free text. XPay and
 * the PayPal API checkout are NOT here: they take money per bill (or per family, for XPay) through
 * their own flows. Each method keeps only its public keys; a PayPal row with API keys and no email
 * or link has nothing a payer can send to, so it is left out.
 *
 * Reads run under the caller's tenant context (RLS scopes `academy_payment_settings`).
 */
final class ManualPaymentMethods
{
    /** Display order on the payer's page — the same as the single bill's page. */
    public const ORDER = ['INSTAPAY', 'WALLET', 'PAYPAL', 'BANK_TRANSFER', 'OTHER'];

    private const PUBLIC_KEYS = [
        'WALLET' => ['numbers', 'holder', 'note'],
        'INSTAPAY' => ['address', 'link', 'holder', 'note'],
        'PAYPAL' => ['email', 'paypal_me', 'note'],
        'BANK_TRANSFER' => ['bank_name', 'account_holder', 'account_number', 'iban', 'swift', 'note'],
        'OTHER' => ['title', 'details'],
    ];

    /** @return list<array{method: string, config: array<string, mixed>}> */
    public static function active(): array
    {
        $rows = DB::table('academy_payment_settings')
            ->where('is_active', true)
            ->whereIn('method', self::ORDER)
            ->pluck('config', 'method');

        $methods = [];
        foreach (self::ORDER as $method) {
            if (! isset($rows[$method])) {
                continue;
            }
            $raw = json_decode((string) $rows[$method], true);
            $config = array_intersect_key(is_array($raw) ? $raw : [], array_flip(self::PUBLIC_KEYS[$method]));

            if ($method === 'PAYPAL' && ($config['email'] ?? '') === '' && ($config['paypal_me'] ?? '') === '') {
                continue;
            }

            $methods[] = ['method' => $method, 'config' => $config];
        }

        return $methods;
    }
}
