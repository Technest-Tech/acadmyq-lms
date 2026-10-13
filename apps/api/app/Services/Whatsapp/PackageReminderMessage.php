<?php

declare(strict_types=1);

namespace App\Services\Whatsapp;

/**
 * The WhatsApp reminder a payer gets about a lesson package — short, polite, one language.
 *
 * Two kinds, chosen by the package's state:
 *   • PAYMENT — money is still due on the package's bill. Names the amount and links the invoice
 *     page, which carries every way to pay.
 *   • RENEWAL — the block ran out, the bill is settled, and no next block has been opened.
 *
 * One language, not the Arabic-then-English pair the invoice message sends: a reminder is read on
 * a phone, and half of a bilingual message is noise to whoever reads it. The language is the one
 * the staff member sending it is working in.
 */
final class PackageReminderMessage
{
    public const PAYMENT = 'PAYMENT';

    public const RENEWAL = 'RENEWAL';

    /**
     * @param  array{academy:string, student:string, label:string, finished:bool, balance_minor:int, currency:string, url:?string}  $p
     */
    public static function build(string $kind, string $locale, array $p): string
    {
        $academy = trim($p['academy']) !== '' ? trim($p['academy']) : 'Academy';
        $package = trim($p['label']) !== '' ? "{$p['student']} ({$p['label']})" : $p['student'];
        $amount = self::money($p['balance_minor'], $p['currency']);

        if ($locale === 'en') {
            $lines = ['Hello,'];
            $lines[] = match (true) {
                $kind === self::RENEWAL => "{$package}'s lesson package has ended. To continue lessons, please renew the package.",
                $p['finished'] => "A kind reminder that {$package}'s lesson package has ended, with {$amount} still due.",
                default => "A kind reminder that {$amount} is due for {$package}'s lesson package.",
            };
            if ($kind === self::PAYMENT && $p['url'] !== null) {
                $lines[] = "Pay here: {$p['url']}";
            }
            $lines[] = '';
            $lines[] = 'Thank you,';
            $lines[] = $academy;

            return implode("\n", $lines);
        }

        $lines = ['السلام عليكم ورحمة الله،'];
        $lines[] = match (true) {
            $kind === self::RENEWAL => "نودّ إعلامكم بانتهاء باقة {$package}. لمواصلة الحصص يُرجى تجديد الباقة.",
            $p['finished'] => "نذكّركم بانتهاء باقة {$package}، والمبلغ المستحق {$amount}.",
            default => "نذكّركم بسداد باقة {$package}، والمبلغ المستحق {$amount}.",
        };
        if ($kind === self::PAYMENT && $p['url'] !== null) {
            $lines[] = "رابط الدفع: {$p['url']}";
        }
        $lines[] = '';
        $lines[] = 'مع خالص الشكر،';
        $lines[] = $academy;

        return implode("\n", $lines);
    }

    /** Minor units → "1,200 EGP", or "1,234.50 EGP" when there are piastres to show. */
    private static function money(int $minor, string $currency): string
    {
        $decimals = $minor % 100 === 0 ? 0 : 2;

        return trim(number_format($minor / 100, $decimals).' '.trim($currency));
    }
}
