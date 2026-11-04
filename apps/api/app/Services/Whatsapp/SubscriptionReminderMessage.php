<?php

declare(strict_types=1);

namespace App\Services\Whatsapp;

use App\Support\LessonCount;
use Illuminate\Support\Carbon;

/**
 * The WhatsApp reminder a family gets about a centre subscription — {@see PackageReminderMessage}'s
 * layout, in lessons: a greeting, a bold title, one fact per line, the amount in bold, the pay link
 * on its own line, the academy's name to sign it. One language, plain characters only.
 *
 *   PAYMENT   money is still due on the subscription's bill.
 *   FINISHED  the lessons are used up and no next block has been sold.
 */
final class SubscriptionReminderMessage
{
    public const PAYMENT = 'PAYMENT';

    public const FINISHED = 'FINISHED';

    /**
     * @param  array{academy:string, student:string, label:string, sequence_no:int, course?:?string, lessons_sold:int, lessons_left:int, finished:bool, finished_on?:?string, total_minor:int, paid_minor:int, balance_minor:int, currency:string, url:?string}  $p
     */
    public static function build(string $kind, string $locale, array $p): string
    {
        return $locale === 'en' ? self::english($kind, $p) : self::arabic($kind, $p);
    }

    /** @param  array<string,mixed>  $p */
    private static function arabic(string $kind, array $p): string
    {
        $academy = trim((string) $p['academy']) !== '' ? trim((string) $p['academy']) : 'الأكاديمية';
        $finished = $kind === self::FINISHED;
        $subject = isset($p['course']) && trim((string) $p['course']) !== '' ? ' ('.trim((string) $p['course']).')' : '';

        $lines = ['السلام عليكم ورحمة الله وبركاته،', ''];
        $lines[] = $finished ? '*انتهاء الاشتراك*' : '*تذكير بسداد الاشتراك*';
        $lines[] = '';
        $lines[] = '• الطالب: *'.trim((string) $p['student']).'*';
        $lines[] = '• الاشتراك: رقم '.(int) $p['sequence_no'].' — '.LessonCount::ar((int) $p['lessons_sold']).$subject;
        if ($p['finished'] && ($p['finished_on'] ?? null) !== null) {
            $lines[] = '• انتهى في: '.Carbon::parse($p['finished_on'])->locale('ar')->translatedFormat('j F Y');
        } elseif (! $p['finished']) {
            $lines[] = '• المتبقي: '.LessonCount::ar((int) $p['lessons_left']);
        }

        if (! $finished) {
            if ((int) $p['paid_minor'] > 0) {
                $lines[] = '• إجمالي الاشتراك: '.self::money((int) $p['total_minor'], (string) $p['currency']);
                $lines[] = '• المدفوع: '.self::money((int) $p['paid_minor'], (string) $p['currency']);
            }
            $lines[] = '• المبلغ المستحق: *'.self::money((int) $p['balance_minor'], (string) $p['currency']).'*';
            $lines[] = '';
            if ($p['url'] !== null) {
                $lines[] = 'للدفع من خلال الرابط:';
                $lines[] = $p['url'];
                $lines[] = '';
            }
            $lines[] = 'وفي حال تم السداد بالفعل، يُرجى تجاهل هذه الرسالة.';
        } else {
            $lines[] = '';
            $lines[] = 'لمواصلة الحصص دون انقطاع، يُرجى التواصل معنا لتجديد الاشتراك.';
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
        $finished = $kind === self::FINISHED;
        $subject = isset($p['course']) && trim((string) $p['course']) !== '' ? ' ('.trim((string) $p['course']).')' : '';

        $lines = ['Hello,', ''];
        $lines[] = $finished ? '*Subscription finished*' : '*Subscription payment reminder*';
        $lines[] = '';
        $lines[] = '• Student: *'.trim((string) $p['student']).'*';
        $lines[] = '• Subscription: #'.(int) $p['sequence_no'].' — '.LessonCount::en((int) $p['lessons_sold']).$subject;
        if ($p['finished'] && ($p['finished_on'] ?? null) !== null) {
            $lines[] = '• Finished on: '.Carbon::parse($p['finished_on'])->format('j F Y');
        } elseif (! $p['finished']) {
            $lines[] = '• Remaining: '.LessonCount::en((int) $p['lessons_left']);
        }

        if (! $finished) {
            if ((int) $p['paid_minor'] > 0) {
                $lines[] = '• Subscription total: '.self::money((int) $p['total_minor'], (string) $p['currency']);
                $lines[] = '• Paid: '.self::money((int) $p['paid_minor'], (string) $p['currency']);
            }
            $lines[] = '• Amount due: *'.self::money((int) $p['balance_minor'], (string) $p['currency']).'*';
            $lines[] = '';
            if ($p['url'] !== null) {
                $lines[] = 'Pay here:';
                $lines[] = $p['url'];
                $lines[] = '';
            }
            $lines[] = 'If you have already paid, please ignore this message.';
        } else {
            $lines[] = '';
            $lines[] = 'To continue lessons without a break, please get in touch to renew the subscription.';
        }

        $lines[] = '';
        $lines[] = 'Thank you,';
        $lines[] = '*'.$academy.'*';

        return implode("\n", $lines);
    }

    private static function money(int $minor, string $currency): string
    {
        $decimals = $minor % 100 === 0 ? 0 : 2;

        return trim(number_format($minor / 100, $decimals).' '.trim($currency));
    }
}
