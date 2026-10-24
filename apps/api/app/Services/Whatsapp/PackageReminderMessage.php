<?php

declare(strict_types=1);

namespace App\Services\Whatsapp;

use Illuminate\Support\Carbon;

/**
 * The WhatsApp reminder a payer gets about a lesson package — one language, laid out the way a
 * WhatsApp message is read on a phone: a greeting, a bold title, one fact per line, the amount in
 * bold, the pay link on a line of its own, and the academy's name to sign it.
 *
 * Two kinds, chosen by the package's state:
 *   • PAYMENT — money is still due on the package's bill. Names the amount and links the invoice
 *     page, which carries every way to pay.
 *   • RENEWAL — the block ran out, the bill is settled, and no next block has been opened.
 *
 * It names the package by its NUMBER and its hours, never by the stored label: the label is
 * usually the auto-generated "10 hours — October 2026", in whatever language the form was in,
 * and dropped into an Arabic sentence it read as noise.
 *
 * One language, not the Arabic-then-English pair the invoice message sends: half of a bilingual
 * message is noise to whoever reads it. The language is the one the staff member is working in.
 */
final class PackageReminderMessage
{
    public const PAYMENT = 'PAYMENT';

    public const RENEWAL = 'RENEWAL';

    /**
     * @param  array{academy:string, student:string, label?:string, sequence_no?:int, minutes_total?:int, minutes_remaining?:int, finished:bool, finished_on?:?string, total_minor?:int, paid_minor?:int, balance_minor:int, currency:string, url:?string}  $p
     */
    public static function build(string $kind, string $locale, array $p): string
    {
        return $locale === 'en' ? self::english($kind, $p) : self::arabic($kind, $p);
    }

    /** @param  array<string,mixed>  $p */
    private static function arabic(string $kind, array $p): string
    {
        $academy = trim((string) $p['academy']) !== '' ? trim((string) $p['academy']) : 'الأكاديمية';
        $renewal = $kind === self::RENEWAL;

        $lines = ['السلام عليكم ورحمة الله وبركاته،', ''];
        $lines[] = $renewal ? '*انتهاء باقة الحصص*' : '*تذكير بسداد باقة الحصص*';
        $lines[] = '';
        $lines[] = '▫️ الطالب: *'.trim((string) $p['student']).'*';
        $lines[] = '▫️ الباقة: '.self::packageAr($p);
        if ($p['finished'] && ($p['finished_on'] ?? null) !== null) {
            $lines[] = '▫️ انتهت في: '.Carbon::parse($p['finished_on'])->locale('ar')->translatedFormat('j F Y');
        } elseif (! $p['finished'] && isset($p['minutes_remaining'])) {
            $lines[] = '▫️ المتبقي: '.self::hoursAr((int) $p['minutes_remaining']);
        }

        if (! $renewal) {
            $paid = (int) ($p['paid_minor'] ?? 0);
            if ($paid > 0 && isset($p['total_minor'])) {
                $lines[] = '▫️ إجمالي الباقة: '.self::money((int) $p['total_minor'], (string) $p['currency']);
                $lines[] = '▫️ المدفوع: '.self::money($paid, (string) $p['currency']);
            }
            $lines[] = '▫️ المبلغ المستحق: *'.self::money((int) $p['balance_minor'], (string) $p['currency']).'*';
            $lines[] = '';
            if ($p['url'] !== null) {
                $lines[] = 'للدفع من خلال الرابط:';
                $lines[] = $p['url'];
                $lines[] = '';
            }
            $lines[] = 'وفي حال تم السداد بالفعل، يُرجى تجاهل هذه الرسالة.';
        } else {
            $lines[] = '';
            $lines[] = 'لمواصلة الحصص دون انقطاع، يُرجى التواصل معنا لتجديد الباقة.';
        }

        $lines[] = '';
        $lines[] = 'مع خالص الشكر،';
        $lines[] = '*'.$academy.'*';

        return implode("\n", $lines);
    }

    /** @param  array<string,mixed>  $p */
    private static function english(string $kind, array $p): string
    {
        $academy = trim((string) $p['academy']) !== '' ? trim((string) $p['academy']) : 'The Academy';
        $renewal = $kind === self::RENEWAL;

        $lines = ['Hello,', ''];
        $lines[] = $renewal ? '*Lesson package ended*' : '*Lesson package payment reminder*';
        $lines[] = '';
        $lines[] = '▫️ Student: *'.trim((string) $p['student']).'*';
        $lines[] = '▫️ Package: '.self::packageEn($p);
        if ($p['finished'] && ($p['finished_on'] ?? null) !== null) {
            $lines[] = '▫️ Ended on: '.Carbon::parse($p['finished_on'])->format('j F Y');
        } elseif (! $p['finished'] && isset($p['minutes_remaining'])) {
            $lines[] = '▫️ Remaining: '.self::hoursEn((int) $p['minutes_remaining']);
        }

        if (! $renewal) {
            $paid = (int) ($p['paid_minor'] ?? 0);
            if ($paid > 0 && isset($p['total_minor'])) {
                $lines[] = '▫️ Package total: '.self::money((int) $p['total_minor'], (string) $p['currency']);
                $lines[] = '▫️ Paid: '.self::money($paid, (string) $p['currency']);
            }
            $lines[] = '▫️ Amount due: *'.self::money((int) $p['balance_minor'], (string) $p['currency']).'*';
            $lines[] = '';
            if ($p['url'] !== null) {
                $lines[] = 'Pay here:';
                $lines[] = $p['url'];
                $lines[] = '';
            }
            $lines[] = 'If you have already paid, please ignore this message.';
        } else {
            $lines[] = '';
            $lines[] = 'To continue lessons without a break, please get in touch to renew the package.';
        }

        $lines[] = '';
        $lines[] = 'Thank you,';
        $lines[] = '*'.$academy.'*';

        return implode("\n", $lines);
    }

    /** "رقم 2 — 10 ساعات", or the stored label when the caller has no number to give. */
    private static function packageAr(array $p): string
    {
        if (! isset($p['sequence_no'])) {
            return trim((string) ($p['label'] ?? ''));
        }

        $text = 'رقم '.(int) $p['sequence_no'];

        return isset($p['minutes_total']) ? $text.' — '.self::hoursAr((int) $p['minutes_total']) : $text;
    }

    private static function packageEn(array $p): string
    {
        if (! isset($p['sequence_no'])) {
            return trim((string) ($p['label'] ?? ''));
        }

        $text = '#'.(int) $p['sequence_no'];

        return isset($p['minutes_total']) ? $text.' — '.self::hoursEn((int) $p['minutes_total']) : $text;
    }

    /** Minutes in Arabic, with the right noun for the count: ساعة / ساعتان / ٣–١٠ ساعات / ١١+ ساعة. */
    private static function hoursAr(int $minutes): string
    {
        $h = intdiv($minutes, 60);
        $m = $minutes % 60;

        $hours = match (true) {
            $h === 0 => null,
            $h === 1 => 'ساعة واحدة',
            $h === 2 => 'ساعتان',
            $h <= 10 => $h.' ساعات',
            default => $h.' ساعة',
        };
        $mins = $m === 0 ? null : $m.' دقيقة';

        return match (true) {
            $hours !== null && $mins !== null => $hours.' و'.$mins,
            $hours !== null => $hours,
            default => $mins ?? '0 دقيقة',
        };
    }

    private static function hoursEn(int $minutes): string
    {
        $h = intdiv($minutes, 60);
        $m = $minutes % 60;

        $hours = $h === 0 ? null : $h.($h === 1 ? ' hour' : ' hours');
        $mins = $m === 0 ? null : $m.' min';

        return trim(implode(' ', array_filter([$hours, $mins]))) ?: '0 min';
    }

    /** Minor units → "1,200 EGP", or "1,234.50 EGP" when there are piastres to show. */
    private static function money(int $minor, string $currency): string
    {
        $decimals = $minor % 100 === 0 ? 0 : 2;

        return trim(number_format($minor / 100, $decimals).' '.trim($currency));
    }
}
