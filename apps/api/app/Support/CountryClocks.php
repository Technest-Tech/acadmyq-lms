<?php

declare(strict_types=1);

namespace App\Support;

use DateTimeImmutable;
use DateTimeZone;

/**
 * Which clock a country keeps, so a timetable can be tied to "Saudi Arabia" or "Canada, Toronto"
 * rather than to a name like `Asia/Amman` nobody at an academy's desk should have to know (thirteen
 * Omani students were filed under Amman, عمّان for عُمان).
 *
 * The rules themselves (when a country changes its clocks, and by how much) are never written here:
 * they come from the server's timezone database, which follows every government's decision through
 * an ordinary system update. This class only says which entries of that database belong to a country.
 */
final class CountryClocks
{
    /**
     * Countries with several clocks: the ones worth offering, most-used first. A country not listed
     * here offers every zone the database files under it (for nearly all of them, exactly one).
     *
     * @var array<string, list<array{0:string, 1:string}>> country code => [[zone, Arabic city], …]
     */
    private const SEVERAL = [
        'US' => [
            ['America/New_York', 'نيويورك (الشرق)'],
            ['America/Chicago', 'شيكاغو (الوسط)'],
            ['America/Denver', 'دنفر (الجبلي)'],
            ['America/Los_Angeles', 'لوس أنجلوس (الغرب)'],
            ['America/Phoenix', 'أريزونا (بلا توقيت صيفي)'],
            ['America/Anchorage', 'ألاسكا'],
            ['Pacific/Honolulu', 'هاواي'],
        ],
        'CA' => [
            ['America/Toronto', 'تورنتو (الشرق)'],
            ['America/Winnipeg', 'وينيبيغ (الوسط)'],
            ['America/Edmonton', 'إدمنتون / كالجاري'],
            ['America/Vancouver', 'فانكوفر (الغرب)'],
            ['America/Halifax', 'هاليفاكس'],
            ['America/St_Johns', 'نيوفاوندلاند'],
            ['America/Regina', 'ساسكاتشوان (بلا توقيت صيفي)'],
        ],
        'AU' => [
            ['Australia/Sydney', 'سيدني / كانبرا'],
            ['Australia/Melbourne', 'ملبورن'],
            ['Australia/Brisbane', 'بريزبن (بلا توقيت صيفي)'],
            ['Australia/Adelaide', 'أديلايد'],
            ['Australia/Perth', 'بيرث (بلا توقيت صيفي)'],
            ['Australia/Darwin', 'داروين (بلا توقيت صيفي)'],
            ['Australia/Hobart', 'هوبارت'],
        ],
        'RU' => [
            ['Europe/Moscow', 'موسكو'],
            ['Europe/Kaliningrad', 'كالينينغراد'],
            ['Asia/Yekaterinburg', 'يكاترينبورغ'],
            ['Asia/Novosibirsk', 'نوفوسيبيرسك'],
            ['Asia/Vladivostok', 'فلاديفوستوك'],
        ],
        'BR' => [
            ['America/Sao_Paulo', 'ساو باولو'],
            ['America/Manaus', 'ماناوس'],
        ],
        'MX' => [
            ['America/Mexico_City', 'مكسيكو سيتي'],
            ['America/Tijuana', 'تيخوانا'],
        ],
        'ID' => [
            ['Asia/Jakarta', 'جاكرتا'],
            ['Asia/Makassar', 'ماكاسار'],
            ['Asia/Jayapura', 'جايابورا'],
        ],
        'KZ' => [
            ['Asia/Almaty', 'ألماتي'],
        ],
        'ES' => [
            ['Europe/Madrid', 'مدريد'],
            ['Atlantic/Canary', 'جزر الكناري'],
        ],
        'PT' => [
            ['Europe/Lisbon', 'لشبونة'],
            ['Atlantic/Azores', 'الأزور'],
        ],
        'NZ' => [
            ['Pacific/Auckland', 'أوكلاند'],
        ],
        'CN' => [
            ['Asia/Shanghai', 'بكين / شنغهاي'],
        ],
        'DE' => [
            ['Europe/Berlin', 'برلين'],
        ],
        'PS' => [
            ['Asia/Gaza', 'غزة'],
            ['Asia/Hebron', 'الضفة'],
        ],
        'MY' => [
            ['Asia/Kuala_Lumpur', 'كوالالمبور'],
        ],
        'UA' => [
            ['Europe/Kyiv', 'كييف'],
        ],
        'CL' => [
            ['America/Santiago', 'سانتياغو'],
        ],
        'AR' => [
            ['America/Argentina/Buenos_Aires', 'بوينس آيرس'],
        ],
    ];

    /**
     * The zones a country offers, the usual one first. Empty for a code the database does not know.
     *
     * @return list<array{timezone:string, city:string, city_ar:?string}>
     */
    public static function zones(?string $country): array
    {
        $code = self::code($country);
        if ($code === null) {
            return [];
        }

        if (isset(self::SEVERAL[$code])) {
            $known = array_flip(DateTimeZone::listIdentifiers());
            $out = [];
            foreach (self::SEVERAL[$code] as [$zone, $cityAr]) {
                // An older database may still call a zone by its previous name (Kyiv was Kiev).
                if (isset($known[$zone])) {
                    $out[] = ['timezone' => $zone, 'city' => self::city($zone), 'city_ar' => $cityAr];
                }
            }
            if ($out !== []) {
                return $out;
            }
        }

        try {
            $zones = DateTimeZone::listIdentifiers(DateTimeZone::PER_COUNTRY, $code);
        } catch (\Throwable) {
            return [];
        }

        return array_map(fn (string $zone) => ['timezone' => $zone, 'city' => self::city($zone), 'city_ar' => null], $zones ?: []);
    }

    /** The clock a country is assumed to keep when nobody has said which of its zones. */
    public static function usual(?string $country): ?string
    {
        return self::zones($country)[0]['timezone'] ?? null;
    }

    /**
     * Every country the database knows, with its zones: what the timetable form's picker offers.
     *
     * @return array<string, list<array{timezone:string, city:string, city_ar:?string}>>
     */
    public static function catalogue(): array
    {
        $out = [];
        foreach (DateTimeZone::listIdentifiers() as $zone) {
            $code = self::countryOf($zone);
            if ($code !== null && ! isset($out[$code])) {
                $out[$code] = self::zones($code);
            }
        }
        ksort($out);

        return array_filter($out, fn (array $zones) => $zones !== []);
    }

    /** The country a zone is filed under (`Asia/Riyadh` → SA), or null for UTC and the like. */
    public static function countryOf(string $timezone): ?string
    {
        try {
            $code = (new DateTimeZone($timezone))->getLocation()['country_code'] ?? '';
        } catch (\Throwable) {
            return null;
        }

        return preg_match('/^[A-Z]{2}$/', (string) $code) === 1 ? (string) $code : null;
    }

    /** Minutes a zone's clock is ahead of UTC at an instant. */
    public static function offsetMinutes(string $timezone, DateTimeImmutable|\DateTimeInterface $at): int
    {
        return intdiv((new DateTimeZone($timezone))->getOffset($at), 60);
    }

    /**
     * The moments a zone's clock jumps inside a window, and by how many minutes (+60 = clocks go
     * forward an hour). Read from the timezone database, so it holds for any country and any rule.
     *
     * @return list<array{at:int, shift_minutes:int}> `at` is a unix timestamp
     */
    public static function changes(string $timezone, int $from, int $to): array
    {
        try {
            $transitions = (new DateTimeZone($timezone))->getTransitions($from, $to);
        } catch (\Throwable) {
            return [];
        }
        if (! is_array($transitions) || count($transitions) < 2) {
            return [];
        }

        $out = [];
        $offset = (int) $transitions[0]['offset'];
        foreach (array_slice($transitions, 1) as $t) {
            $shift = intdiv((int) $t['offset'] - $offset, 60);
            $offset = (int) $t['offset'];
            // A change of name only (the abbreviation, not the clock) is not a change anyone feels.
            if ($shift !== 0) {
                $out[] = ['at' => (int) $t['ts'], 'shift_minutes' => $shift];
            }
        }

        return $out;
    }

    /** A country as stored on a student or guardian → its two-letter code, or null. */
    public static function code(?string $country): ?string
    {
        $code = strtoupper(trim((string) $country));

        return preg_match('/^[A-Z]{2}$/', $code) === 1 ? $code : null;
    }

    private static function city(string $zone): string
    {
        $parts = explode('/', $zone);

        return str_replace('_', ' ', (string) end($parts));
    }
}
