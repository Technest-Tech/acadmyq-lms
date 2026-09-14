<?php

declare(strict_types=1);

namespace App\Services\Whatsapp;

/**
 * The alerts a linked WhatsApp group can receive, and the knobs that time them.
 *
 * The two categories are only how the panel groups the checkboxes — any group may take any alert.
 * "Supervision" watches lessons as they happen; "Accounting" watches money and prepaid hours.
 */
final class GroupAlertCatalog
{
    /** A lesson's start time has arrived. */
    public const SESSION_STARTED = 'SESSION_STARTED';

    /** A lesson started N minutes ago and nobody has recorded what happened (attended, absent, cancelled). */
    public const SESSION_NOT_MARKED = 'SESSION_NOT_MARKED';

    /** A lesson was marked as held, and N hours after it ended there is still no report. */
    public const REPORT_OVERDUE = 'REPORT_OVERDUE';

    /** A lesson package's balance dropped to where the next lesson will overdraw it. */
    public const PACKAGE_LOW = 'PACKAGE_LOW';

    /** A lesson package closed — used up, or closed by hand. */
    public const PACKAGE_ENDED = 'PACKAGE_ENDED';

    /** Money was recorded against an invoice — by hand, PayPal or XPay. */
    public const PAYMENT_RECEIVED = 'PAYMENT_RECEIVED';

    /** The operator's "send a test" from the panel. Never selectable. */
    public const TEST = 'TEST';

    public const CATEGORIES = [
        'SUPERVISION' => [self::SESSION_STARTED, self::SESSION_NOT_MARKED, self::REPORT_OVERDUE],
        'ACCOUNTING' => [self::PACKAGE_LOW, self::PACKAGE_ENDED, self::PAYMENT_RECEIVED],
    ];

    /** The alerts whose truth can lapse before they go out, so they are re-checked at send time. */
    public const CONDITIONAL = [self::SESSION_STARTED, self::SESSION_NOT_MARKED, self::REPORT_OVERDUE];

    /**
     * How long an alert may wait for a connected number before it stops being worth sending. A
     * "starting now" twenty minutes late is noise; a payment a day late is still news.
     */
    public const MAX_AGE_MINUTES = [
        self::SESSION_STARTED => 20,
        self::SESSION_NOT_MARKED => 6 * 60,
        self::REPORT_OVERDUE => 24 * 60,
        self::PACKAGE_LOW => 48 * 60,
        self::PACKAGE_ENDED => 48 * 60,
        self::PAYMENT_RECEIVED => 48 * 60,
        self::TEST => 30,
    ];

    public const DEFAULT_SETTINGS = [
        'not_marked_after_minutes' => 15,
        'report_overdue_hours' => 2,
    ];

    public const SETTING_BOUNDS = [
        'not_marked_after_minutes' => [1, 240],
        'report_overdue_hours' => [1, 72],
    ];

    /** @return list<string> every selectable alert type */
    public static function selectable(): array
    {
        return array_merge(...array_values(self::CATEGORIES));
    }

    /**
     * Known alert types only, in catalog order, without duplicates.
     *
     * @param  array<mixed>  $events
     * @return list<string>
     */
    public static function normaliseEvents(array $events): array
    {
        return array_values(array_intersect(self::selectable(), array_map('strval', $events)));
    }

    /**
     * Stored settings merged over the defaults and clamped, so a hand-edited row can never make the
     * sweep ask for a negative window.
     *
     * @param  array<mixed>|null  $raw
     * @return array{not_marked_after_minutes:int, report_overdue_hours:int}
     */
    public static function settings(?array $raw): array
    {
        $out = self::DEFAULT_SETTINGS;

        foreach (self::SETTING_BOUNDS as $key => [$min, $max]) {
            if (isset($raw[$key]) && is_numeric($raw[$key])) {
                $out[$key] = max($min, min($max, (int) $raw[$key]));
            }
        }

        return $out;
    }

    /**
     * A stored `events` column (jsonb arrives as a string) read back as known alert types.
     *
     * @return list<string>
     */
    public static function decodeEvents(mixed $raw): array
    {
        $decoded = is_string($raw) ? json_decode($raw, true) : $raw;

        return is_array($decoded) ? self::normaliseEvents($decoded) : [];
    }

    /**
     * A stored `settings` column read back through {@see settings()}.
     *
     * @return array{not_marked_after_minutes:int, report_overdue_hours:int}
     */
    public static function decodeSettings(mixed $raw): array
    {
        $decoded = is_string($raw) ? json_decode($raw, true) : $raw;

        return self::settings(is_array($decoded) ? $decoded : null);
    }
}
