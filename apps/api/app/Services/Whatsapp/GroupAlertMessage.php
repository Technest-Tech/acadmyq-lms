<?php

declare(strict_types=1);

namespace App\Services\Whatsapp;

use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;

/**
 * Writes the WhatsApp text for a batch of same-type alerts going to one group.
 *
 * One message per alert type, listing every subject, rather than one message per lesson: when
 * twelve lessons start at four o'clock a staff group wants one line-per-lesson list, and the linked
 * number wants one send instead of twelve (the gateway paces sends to stay clear of spam flags).
 *
 * Payloads are the snapshots {@see GroupAlerts} took at detection, so a message reads the same
 * whether it goes out now or on a retry ten minutes later.
 */
final class GroupAlertMessage
{
    /** Subjects per WhatsApp message; a longer batch is split across several. */
    public const MAX_ITEMS = 15;

    /**
     * @param  list<array<string,mixed>>  $payloads
     * @param  array{not_marked_after_minutes:int, report_overdue_hours:int}  $settings
     */
    public function compose(
        string $eventType,
        array $payloads,
        string $language,
        string $timezone,
        array $settings,
        ?CarbonInterface $now = null,
    ): string {
        $ar = $language !== 'en';
        $now = CarbonImmutable::instance($now ?? CarbonImmutable::now())->setTimezone($timezone);
        $many = count($payloads) > 1;

        $lines = match ($eventType) {
            GroupAlertCatalog::SESSION_STARTED => [
                $ar ? ($many ? '🟢 *حصص تبدأ الآن*' : '🟢 *حصة تبدأ الآن*') : ($many ? '🟢 *Lessons starting now*' : '🟢 *Lesson starting now*'),
                ...$this->sessionLines($payloads, $ar, $timezone, $now),
                // The button that closes the loop: a followed lesson gets no "not marked" reminder.
                $ar ? 'اضغط «متابعة» على الحصة في النظام عندما تتابعها.' : 'Press "Following" on the lesson in the system once you are on it.',
            ],
            GroupAlertCatalog::SESSION_NOT_MARKED => [
                $ar ? '⚠️ *لم يُسجَّل الحضور بعد*' : '⚠️ *Attendance not recorded yet*',
                $ar
                    ? 'مرّ '.$this->arMinutes($settings['not_marked_after_minutes']).' على بداية الحصة ولم يُسجِّل أحد حضورًا أو غيابًا أو إلغاءً.'
                    : $settings['not_marked_after_minutes'].' min after the start, nobody has marked it attended, absent or cancelled.',
                ...$this->sessionLines($payloads, $ar, $timezone, $now),
            ],
            GroupAlertCatalog::REPORT_OVERDUE => [
                $ar ? '📝 *تقرير الحصة لم يُكتب*' : '📝 *Lesson report not written*',
                $ar
                    ? 'مرّ '.$this->arHours($settings['report_overdue_hours']).' على انتهاء الحصة دون تقرير.'
                    : $settings['report_overdue_hours'].' h after the lesson ended, there is still no report.',
                ...$this->sessionLines($payloads, $ar, $timezone, $now),
            ],
            GroupAlertCatalog::PACKAGE_LOW => [
                $ar ? '⏳ *باقة أوشكت على الانتهاء*' : '⏳ *Package running low*',
                ...array_map(fn (array $p): string => $this->packageLowLine($p, $ar), $payloads),
            ],
            GroupAlertCatalog::PACKAGE_ENDED => [
                $ar ? '🔚 *انتهت باقة*' : '🔚 *Package ended*',
                ...array_map(fn (array $p): string => $this->packageEndedLine($p, $ar), $payloads),
            ],
            GroupAlertCatalog::PAYMENT_RECEIVED => [
                $ar ? ($many ? '💰 *تم تسجيل دفعات*' : '💰 *تم تسجيل دفعة*') : ($many ? '💰 *Payments received*' : '💰 *Payment received*'),
                ...array_map(fn (array $p): string => $this->paymentLine($p, $ar), $payloads),
            ],
            GroupAlertCatalog::TEST => $this->testLines($payloads[0] ?? [], $ar),
            default => [],
        };

        return implode("\n", $lines);
    }

    /**
     * @param  list<array<string,mixed>>  $payloads
     * @return list<string>
     */
    private function sessionLines(array $payloads, bool $ar, string $timezone, CarbonImmutable $now): array
    {
        return array_map(function (array $p) use ($ar, $timezone, $now): string {
            $time = $this->when((string) ($p['starts_at'] ?? ''), $timezone, $now, $ar);
            $teacher = trim((string) ($p['teacher'] ?? '')) ?: '—';
            $student = trim((string) ($p['student'] ?? '')) ?: '—';

            return $ar
                ? "• {$time} — المعلم {$teacher} مع {$student}"
                : "• {$time} — {$teacher} with {$student}";
        }, $payloads);
    }

    /** @param array<string,mixed> $p */
    private function packageLowLine(array $p, bool $ar): string
    {
        $left = $this->duration((int) ($p['minutes_left'] ?? 0), $ar);
        $line = $ar
            ? '• '.$this->name($p['student'] ?? null).' — «'.$this->name($p['label'] ?? null)."»: متبقٍ {$left}"
            : '• '.$this->name($p['student'] ?? null).' — "'.$this->name($p['label'] ?? null)."\": {$left} left";

        return $line.$this->guardianSuffix($p, $ar);
    }

    /** @param array<string,mixed> $p */
    private function packageEndedLine(array $p, bool $ar): string
    {
        $reason = (string) ($p['reason'] ?? '');
        $why = $reason === 'EXHAUSTED'
            ? ($ar ? 'استُهلكت بالكامل' : 'used up')
            : ($ar ? 'أُغلقت يدويًا' : 'closed by hand');

        $line = $ar
            ? '• '.$this->name($p['student'] ?? null).' — «'.$this->name($p['label'] ?? null)."» ({$why})"
            : '• '.$this->name($p['student'] ?? null).' — "'.$this->name($p['label'] ?? null)."\" ({$why})";

        $over = (int) ($p['minutes_overdrawn'] ?? 0);
        if ($over > 0) {
            $line .= $ar
                ? ' — تجاوز '.$this->duration($over, true)
                : ' — '.$this->duration($over, false).' over';
        }

        $line .= $this->guardianSuffix($p, $ar);

        if (! empty($p['invoice_url'])) {
            $line .= "\n  ".($ar ? 'الفاتورة: ' : 'Invoice: ').$p['invoice_url'];
        }

        return $line;
    }

    /** @param array<string,mixed> $p */
    private function paymentLine(array $p, bool $ar): string
    {
        $currency = (string) ($p['currency'] ?? '');
        $amount = $this->money((int) ($p['amount_minor'] ?? 0), $currency);
        $payer = $this->name($p['payer'] ?? null);
        $method = $this->method((string) ($p['method'] ?? ''), $ar);
        $period = (string) ($p['period'] ?? '');

        $line = "• {$amount} — {$payer}";
        if ($period !== '') {
            $line .= $ar ? " — فاتورة {$period}" : " — invoice {$period}";
        }
        if ($method !== '') {
            $line .= " — {$method}";
        }

        $paid = (int) ($p['paid_total_minor'] ?? 0);
        $total = (int) ($p['invoice_total_minor'] ?? 0);
        if (($p['status'] ?? '') === 'PAID' || ($total > 0 && $paid >= $total)) {
            $line .= $ar ? ' (مدفوعة بالكامل)' : ' (paid in full)';
        } elseif ($total > 0) {
            $line .= $ar
                ? ' (مدفوع '.$this->money($paid, $currency).' من '.$this->money($total, $currency).')'
                : ' ('.$this->money($paid, $currency).' of '.$this->money($total, $currency).' paid)';
        }

        return $line;
    }

    /**
     * @param  array<string,mixed>  $p
     * @return list<string>
     */
    private function testLines(array $p, bool $ar): array
    {
        $label = trim((string) ($p['label'] ?? ''));

        return $ar
            ? ['✅ *رسالة تجريبية*', $label !== '' ? "هذه المجموعة مربوطة بتنبيهات «{$label}»، وستصل التنبيهات هنا." : 'هذه المجموعة مربوطة بالتنبيهات، وستصل هنا.']
            : ['✅ *Test message*', $label !== '' ? "This group is linked to the \"{$label}\" alerts — they will arrive here." : 'This group is linked to alerts — they will arrive here.'];
    }

    /** @param array<string,mixed> $p */
    private function guardianSuffix(array $p, bool $ar): string
    {
        $guardian = trim((string) ($p['guardian'] ?? ''));
        $phone = trim((string) ($p['guardian_phone'] ?? ''));
        if ($guardian === '' && $phone === '') {
            return '';
        }

        $who = trim($guardian.($phone !== '' ? ' '.$phone : ''));

        return $ar ? " — ولي الأمر: {$who}" : " — guardian: {$who}";
    }

    /** "4:05 م" today; "13/9 4:05 م" on any other day, in the academy's own clock. */
    private function when(string $iso, string $timezone, CarbonImmutable $now, bool $ar): string
    {
        if ($iso === '') {
            return '—';
        }

        $at = CarbonImmutable::parse($iso)->setTimezone($timezone);
        $time = $at->format('g:i').' '.($at->hour < 12 ? ($ar ? 'ص' : 'AM') : ($ar ? 'م' : 'PM'));

        return $at->isSameDay($now) ? $time : $at->format('j/n').' '.$time;
    }

    /** Minutes → "1h 30m" / "1 س 30 د". */
    private function duration(int $minutes, bool $ar): string
    {
        $h = intdiv(max(0, $minutes), 60);
        $m = max(0, $minutes) % 60;
        [$hu, $mu] = $ar ? ['س', 'د'] : ['h', 'm'];

        if ($h === 0) {
            return $ar ? "{$m} {$mu}" : "{$m}{$mu}";
        }
        if ($m === 0) {
            return $ar ? "{$h} {$hu}" : "{$h}{$hu}";
        }

        return $ar ? "{$h} {$hu} {$m} {$mu}" : "{$h}{$hu} {$m}{$mu}";
    }

    private function money(int $minor, string $currency): string
    {
        $amount = number_format($minor / 100, 2);
        if (str_ends_with($amount, '.00')) {
            $amount = substr($amount, 0, -3);
        }

        return trim($amount.' '.$currency);
    }

    private function method(string $method, bool $ar): string
    {
        return match ($method) {
            'CASH' => $ar ? 'نقدًا' : 'cash',
            'BANK_TRANSFER' => $ar ? 'تحويل بنكي' : 'bank transfer',
            'GATEWAY' => $ar ? 'دفع إلكتروني' : 'online',
            'OTHER' => $ar ? 'طريقة أخرى' : 'other',
            default => '',
        };
    }

    private function name(mixed $value): string
    {
        $name = trim((string) $value);

        return $name !== '' ? $name : '—';
    }

    /** Arabic counts agree with their noun: دقيقة، دقيقتان، ٣–١٠ دقائق، ١١+ دقيقة. */
    private function arMinutes(int $n): string
    {
        return match (true) {
            $n === 1 => 'دقيقة',
            $n === 2 => 'دقيقتان',
            $n >= 3 && $n <= 10 => "{$n} دقائق",
            default => "{$n} دقيقة",
        };
    }

    private function arHours(int $n): string
    {
        return match (true) {
            $n === 1 => 'ساعة',
            $n === 2 => 'ساعتان',
            $n >= 3 && $n <= 10 => "{$n} ساعات",
            default => "{$n} ساعة",
        };
    }
}
