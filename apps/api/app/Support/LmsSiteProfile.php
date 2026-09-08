<?php

declare(strict_types=1);

namespace App\Support;

/**
 * The content contract of the LMS public course site (docs/lms/09) — the schema of record for the
 * `lms_site_profiles.content` blob, shared by the client's editor (`/api/courses/site`) and the
 * public site itself (`/api/learn/site`), so the two can never drift.
 *
 * Every LMS client renders the SAME template. This class describes the only thing that differs
 * between them: the words, the pictures, the brand colour and which sections are switched on.
 *
 * Two rules make the "unconfigured client still gets a finished site" promise work:
 *
 *  1. STRUCTURAL defaults live here — the `show` flags, the enums, the brand name/logo pulled off
 *     the academy row. `defaults()` alone is a valid, complete document.
 *  2. Default COPY does NOT live here. Headings, feature blurbs, the how-it-works steps and the
 *     starter FAQ are rendered by the web template from its own i18n messages whenever the stored
 *     value is empty — because these clients are Arabic-first and a PHP string constant can only be
 *     one language. Empty here means "the template's translated fallback", never "a blank page".
 *
 * `sanitize()` is the write gate: it strips unknown keys, clamps every string and list to a size the
 * layout can actually render, and rejects any URL that isn't http(s) (or, for links, a mailto:/tel:/
 * in-app path) — a client editing their own marketing copy must not be able to smuggle a
 * `javascript:` href onto a page their students visit.
 */
final class LmsSiteProfile
{
    /** Short single-line text (headings, names, labels). */
    private const MAX_TEXT = 200;

    /** Multi-line body copy (about, bios, quotes, answers). */
    private const MAX_BODY = 2000;

    /** Any URL field. */
    private const MAX_URL = 600;

    /**
     * A legal document (terms / refund / privacy). Far longer than MAX_BODY on purpose: these are
     * real policies, not marketing copy, and a client pasting a lawyer's text must not have it
     * silently truncated at a paragraph.
     */
    private const MAX_LEGAL = 20000;

    /** How many items each repeatable list may hold — the layouts stop reading well past these. */
    private const CAPS = [
        'hero.badges' => 6,
        'stats.items' => 4,
        'about.points' => 6,
        'features.items' => 8,
        'steps.items' => 6,
        'instructors.items' => 12,
        'testimonials.items' => 12,
        'faq.items' => 16,
        'footer.links' => 8,
    ];

    /** Icons the feature grid can render (lucide names the web maps in components/learn). */
    public const ICONS = [
        'sparkles', 'video', 'award', 'clock', 'infinity', 'smartphone',
        'users', 'shield', 'book', 'headphones', 'download', 'check',
    ];

    /** Which button the hero's primary CTA is. */
    private const CTAS = ['browse', 'redeem', 'contact'];

    /** How the hero renders: brand gradient, a full-bleed image, or a plain surface. */
    private const HERO_STYLES = ['gradient', 'image', 'plain'];

    /** Social networks the footer/contact page links out to. */
    public const SOCIALS = [
        'facebook', 'instagram', 'youtube', 'tiktok', 'telegram', 'x', 'linkedin', 'website',
    ];

    /** The platform's own brand colour (globals.css `--primary`), used when a client picks none. */
    public const DEFAULT_COLOR = '#12836a';

    /**
     * A complete, valid document for an academy that has never opened the editor. `$academy` is the
     * academies row (name / brand_display_name / brand_logo_url), the only client-specific data that
     * exists before any configuration.
     *
     * @param  array<string,mixed>  $academy
     * @return array<string,mixed>
     */
    public static function defaults(array $academy = []): array
    {
        $name = self::firstFilled([
            $academy['brand_display_name'] ?? null,
            $academy['name'] ?? null,
        ]);

        return [
            'brand' => [
                'name' => $name,
                'tagline' => '',
                'logo_url' => self::firstFilled([$academy['brand_logo_url'] ?? null]),
                // The square/compact mark, for the header on a narrow screen and the browser tab.
                // Blank falls back to the full logo, then to a monogram — a client never has to
                // supply three files to get a finished site.
                'logo_mark_url' => '',
                'favicon_url' => '',
                'color' => self::DEFAULT_COLOR,
                'hero_style' => 'gradient',
            ],
            'hero' => [
                'eyebrow' => '',
                'title' => '',
                'subtitle' => '',
                'image_url' => '',
                'primary_cta' => 'browse',
                // Overrides the label of whichever primary button `primary_cta` selected. Blank ⇒
                // the template's translated label for that action, which is the usual case.
                'cta_label' => '',
                'badges' => [],
            ],
            'stats' => ['show' => true, 'items' => []],
            // `body` is the story; `mission` and `approach` are the two blocks the About page adds
            // on top of it, so that page says something the home page does not (docs/lms/09).
            'about' => [
                'show' => true,
                'heading' => '',
                'body' => '',
                'image_url' => '',
                'points' => [],
                'mission' => '',
                'approach' => '',
            ],
            'features' => ['show' => true, 'heading' => '', 'subheading' => '', 'items' => []],
            'steps' => ['show' => true, 'heading' => '', 'items' => []],
            'instructors' => ['show' => true, 'heading' => '', 'items' => []],
            'testimonials' => ['show' => true, 'heading' => '', 'items' => []],
            'faq' => ['show' => true, 'heading' => '', 'items' => []],
            'cta' => ['show' => true, 'title' => '', 'subtitle' => '', 'button_label' => '', 'button_href' => ''],
            'contact' => [
                'show' => true,
                'email' => '',
                'phone' => '',
                'whatsapp' => '',
                'address' => '',
                // When a person is actually there to answer — the one contact detail that sets a
                // visitor's expectation of a reply, and the cheapest trust signal on the page.
                'hours' => '',
                'map_url' => '',
                'socials' => array_fill_keys(self::SOCIALS, ''),
            ],
            'footer' => ['note' => '', 'links' => []],
            'seo' => ['title' => '', 'description' => '', 'og_image_url' => ''],
            'pages' => ['about' => true, 'faq' => true, 'contact' => true],
            // The trust pages (docs/lms/10 §6). Empty is the normal state: the template renders its
            // own translated default policy, which is why they are shown by default rather than
            // hidden until written — a shop with no refund policy at all is the worse outcome.
            'legal' => [
                'show' => true,
                'terms' => '',
                'refund' => '',
                'privacy' => '',
                'business_name' => '',
                'updated_at' => '',
            ],
        ];
    }

    /**
     * The document the template renders: what the client stored, laid over the defaults.
     *
     * Merge rules, chosen so the site can never end up with a blank heading or a half-missing block:
     *  - text: a stored non-empty string wins; blank ⇒ the default (and, downstream, the template's
     *    translated fallback). To remove a section a client switches `show` off, not blanks it out.
     *  - lists: a stored list wins WHOLE, including empty — the editor always submits the full
     *    document, so an empty list means "I deleted these", not "I never looked".
     *  - booleans: a stored value always wins.
     *
     * @param  array<string,mixed>  $stored
     * @param  array<string,mixed>  $academy
     * @return array<string,mixed>
     */
    public static function merge(array $stored, array $academy = []): array
    {
        return self::mergeInto(self::defaults($academy), $stored);
    }

    /**
     * Normalise a client-submitted document for storage: unknown keys dropped, strings trimmed and
     * clamped, lists capped, enums and URLs validated. Never throws — a bad value degrades to the
     * default rather than 422-ing a 200-field form on one stray character.
     *
     * @param  array<string,mixed>  $input
     * @return array<string,mixed>
     */
    public static function sanitize(array $input): array
    {
        $brand = self::block($input, 'brand');
        $hero = self::block($input, 'hero');
        $stats = self::block($input, 'stats');
        $about = self::block($input, 'about');
        $features = self::block($input, 'features');
        $steps = self::block($input, 'steps');
        $instructors = self::block($input, 'instructors');
        $testimonials = self::block($input, 'testimonials');
        $faq = self::block($input, 'faq');
        $cta = self::block($input, 'cta');
        $contact = self::block($input, 'contact');
        $footer = self::block($input, 'footer');
        $seo = self::block($input, 'seo');
        $pages = self::block($input, 'pages');
        $legal = self::block($input, 'legal');

        return [
            'brand' => [
                'name' => self::text($brand['name'] ?? null),
                'tagline' => self::text($brand['tagline'] ?? null),
                'logo_url' => self::imageUrl($brand['logo_url'] ?? null),
                'logo_mark_url' => self::imageUrl($brand['logo_mark_url'] ?? null),
                'favicon_url' => self::imageUrl($brand['favicon_url'] ?? null),
                'color' => self::color($brand['color'] ?? null),
                'hero_style' => self::enum($brand['hero_style'] ?? null, self::HERO_STYLES, 'gradient'),
            ],
            'hero' => [
                'eyebrow' => self::text($hero['eyebrow'] ?? null),
                'title' => self::text($hero['title'] ?? null),
                'subtitle' => self::text($hero['subtitle'] ?? null, self::MAX_BODY),
                'image_url' => self::imageUrl($hero['image_url'] ?? null),
                'primary_cta' => self::enum($hero['primary_cta'] ?? null, self::CTAS, 'browse'),
                'cta_label' => self::text($hero['cta_label'] ?? null, 60),
                'badges' => self::list($hero['badges'] ?? null, 'hero.badges', fn ($v): ?string => self::text($v) ?: null),
            ],
            'stats' => [
                'show' => self::bool($stats['show'] ?? null),
                'items' => self::list($stats['items'] ?? null, 'stats.items', fn ($v): ?array => self::keyed($v, [
                    'value' => fn ($x): string => self::text($x, 24),
                    'label' => fn ($x): string => self::text($x),
                ], 'label')),
            ],
            'about' => [
                'show' => self::bool($about['show'] ?? null),
                'heading' => self::text($about['heading'] ?? null),
                'body' => self::text($about['body'] ?? null, self::MAX_BODY),
                'image_url' => self::imageUrl($about['image_url'] ?? null),
                'points' => self::list($about['points'] ?? null, 'about.points', fn ($v): ?string => self::text($v) ?: null),
                'mission' => self::text($about['mission'] ?? null, self::MAX_BODY),
                'approach' => self::text($about['approach'] ?? null, self::MAX_BODY),
            ],
            'features' => [
                'show' => self::bool($features['show'] ?? null),
                'heading' => self::text($features['heading'] ?? null),
                'subheading' => self::text($features['subheading'] ?? null, self::MAX_BODY),
                'items' => self::list($features['items'] ?? null, 'features.items', fn ($v): ?array => self::keyed($v, [
                    'icon' => fn ($x): string => self::enum($x, self::ICONS, 'sparkles'),
                    'title' => fn ($x): string => self::text($x),
                    'body' => fn ($x): string => self::text($x, self::MAX_BODY),
                ], 'title')),
            ],
            'steps' => [
                'show' => self::bool($steps['show'] ?? null),
                'heading' => self::text($steps['heading'] ?? null),
                'items' => self::list($steps['items'] ?? null, 'steps.items', fn ($v): ?array => self::keyed($v, [
                    'title' => fn ($x): string => self::text($x),
                    'body' => fn ($x): string => self::text($x, self::MAX_BODY),
                ], 'title')),
            ],
            'instructors' => [
                'show' => self::bool($instructors['show'] ?? null),
                'heading' => self::text($instructors['heading'] ?? null),
                'items' => self::list($instructors['items'] ?? null, 'instructors.items', fn ($v): ?array => self::keyed($v, [
                    'name' => fn ($x): string => self::text($x),
                    'role' => fn ($x): string => self::text($x),
                    'bio' => fn ($x): string => self::text($x, self::MAX_BODY),
                    'photo_url' => fn ($x): string => self::imageUrl($x),
                    // Comma-separated in the editor, chips on the site — one field, because a
                    // repeatable list per teacher is more form than the fact deserves.
                    'expertise' => fn ($x): string => self::text($x, 300),
                    'link_url' => fn ($x): string => self::linkUrl($x),
                ], 'name')),
            ],
            'testimonials' => [
                'show' => self::bool($testimonials['show'] ?? null),
                'heading' => self::text($testimonials['heading'] ?? null),
                'items' => self::list($testimonials['items'] ?? null, 'testimonials.items', fn ($v): ?array => self::keyed($v, [
                    'name' => fn ($x): string => self::text($x),
                    'role' => fn ($x): string => self::text($x),
                    'quote' => fn ($x): string => self::text($x, self::MAX_BODY),
                    'photo_url' => fn ($x): string => self::imageUrl($x),
                    'rating' => fn ($x): int => max(0, min(5, (int) $x)),
                ], 'quote')),
            ],
            'faq' => [
                'show' => self::bool($faq['show'] ?? null),
                'heading' => self::text($faq['heading'] ?? null),
                'items' => self::list($faq['items'] ?? null, 'faq.items', fn ($v): ?array => self::keyed($v, [
                    'q' => fn ($x): string => self::text($x, 300),
                    'a' => fn ($x): string => self::text($x, self::MAX_BODY),
                ], 'q')),
            ],
            'cta' => [
                'show' => self::bool($cta['show'] ?? null),
                'title' => self::text($cta['title'] ?? null),
                'subtitle' => self::text($cta['subtitle'] ?? null, self::MAX_BODY),
                'button_label' => self::text($cta['button_label'] ?? null, 60),
                'button_href' => self::linkUrl($cta['button_href'] ?? null),
            ],
            'contact' => [
                'show' => self::bool($contact['show'] ?? null),
                'email' => self::text($contact['email'] ?? null, 120),
                'phone' => self::text($contact['phone'] ?? null, 40),
                'whatsapp' => self::text($contact['whatsapp'] ?? null, 40),
                'address' => self::text($contact['address'] ?? null, 300),
                'hours' => self::text($contact['hours'] ?? null, 300),
                'map_url' => self::imageUrl($contact['map_url'] ?? null),
                'socials' => self::socials($contact['socials'] ?? null),
            ],
            'footer' => [
                'note' => self::text($footer['note'] ?? null, self::MAX_BODY),
                'links' => self::list($footer['links'] ?? null, 'footer.links', fn ($v): ?array => self::keyed($v, [
                    'label' => fn ($x): string => self::text($x, 60),
                    'href' => fn ($x): string => self::linkUrl($x),
                ], 'label')),
            ],
            'seo' => [
                'title' => self::text($seo['title'] ?? null, 120),
                'description' => self::text($seo['description'] ?? null, 300),
                'og_image_url' => self::imageUrl($seo['og_image_url'] ?? null),
            ],
            'pages' => [
                'about' => self::bool($pages['about'] ?? null),
                'faq' => self::bool($pages['faq'] ?? null),
                'contact' => self::bool($pages['contact'] ?? null),
            ],
            'legal' => [
                'show' => self::bool($legal['show'] ?? null),
                'terms' => self::text($legal['terms'] ?? null, self::MAX_LEGAL),
                'refund' => self::text($legal['refund'] ?? null, self::MAX_LEGAL),
                'privacy' => self::text($legal['privacy'] ?? null, self::MAX_LEGAL),
                // Who the buyer is contracting with. The platform is never the seller of a course
                // (docs/lms/10 §6), so the pages have to be able to name the real one.
                'business_name' => self::text($legal['business_name'] ?? null),
                'updated_at' => self::text($legal['updated_at'] ?? null, 40),
            ],
        ];
    }

    // ── merge helpers ─────────────────────────────────────────────────────────

    /**
     * @param  array<string,mixed>  $defaults
     * @param  array<string,mixed>  $stored
     * @return array<string,mixed>
     */
    private static function mergeInto(array $defaults, array $stored): array
    {
        foreach ($defaults as $key => $fallback) {
            if (! array_key_exists($key, $stored)) {
                continue;
            }
            $value = $stored[$key];

            if (is_array($fallback) && self::isMap($fallback) && is_array($value)) {
                $defaults[$key] = self::mergeInto($fallback, $value);

                continue;
            }
            if (is_array($fallback)) {          // a list: a submitted list wins whole, empty included
                $defaults[$key] = is_array($value) ? array_values($value) : $fallback;

                continue;
            }
            if (is_bool($fallback)) {
                $defaults[$key] = is_bool($value) ? $value : (bool) $value;

                continue;
            }
            if (is_string($value) && trim($value) !== '') {
                $defaults[$key] = $value;
            }
        }

        return $defaults;
    }

    /** A map (object-shaped block) rather than a list of items. */
    private static function isMap(array $value): bool
    {
        return $value !== [] && ! array_is_list($value);
    }

    // ── sanitize helpers ──────────────────────────────────────────────────────

    /**
     * @param  array<string,mixed>  $input
     * @return array<string,mixed>
     */
    private static function block(array $input, string $key): array
    {
        $block = $input[$key] ?? null;

        return is_array($block) ? $block : [];
    }

    private static function text(mixed $value, int $max = self::MAX_TEXT): string
    {
        if (! is_string($value) && ! is_numeric($value)) {
            return '';
        }

        return mb_substr(trim((string) $value), 0, $max);
    }

    private static function bool(mixed $value): bool
    {
        if ($value === null) {
            return true;   // absent ⇒ visible; sections are opt-OUT
        }

        return filter_var($value, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE) ?? (bool) $value;
    }

    /** @param  list<string>  $allowed */
    private static function enum(mixed $value, array $allowed, string $fallback): string
    {
        $value = is_string($value) ? strtolower(trim($value)) : '';

        return in_array($value, $allowed, true) ? $value : $fallback;
    }

    private static function color(mixed $value): string
    {
        $value = is_string($value) ? strtolower(trim($value)) : '';

        return preg_match('/^#[0-9a-f]{6}$/', $value) === 1 ? $value : self::DEFAULT_COLOR;
    }

    /** An image / embed source: http(s) only. Anything else (javascript:, data:) becomes ''. */
    private static function imageUrl(mixed $value): string
    {
        $value = self::text($value, self::MAX_URL);

        return preg_match('#^https?://#i', $value) === 1 ? $value : '';
    }

    /** A clickable link: http(s), mailto:, tel:, or an in-app path. Anything else becomes ''. */
    private static function linkUrl(mixed $value): string
    {
        $value = self::text($value, self::MAX_URL);

        return preg_match('#^(https?://|mailto:|tel:|/)#i', $value) === 1 ? $value : '';
    }

    /**
     * Map + clamp a repeatable list, dropping entries the mapper rejects (returns null) so a blank
     * row left behind in the editor never renders as an empty card.
     *
     * @param  callable(mixed): (array<string,mixed>|string|null)  $map
     * @return list<mixed>
     */
    private static function list(mixed $value, string $cap, callable $map): array
    {
        if (! is_array($value)) {
            return [];
        }

        $out = [];
        foreach (array_values($value) as $item) {
            $mapped = $map($item);
            if ($mapped !== null && $mapped !== '' && $mapped !== []) {
                $out[] = $mapped;
            }
            if (count($out) >= (self::CAPS[$cap] ?? 8)) {
                break;
            }
        }

        return $out;
    }

    /**
     * Sanitize one list entry through a per-field map. `$required` names the field that makes the
     * entry worth keeping — an entry blank there is dropped.
     *
     * @param  array<string,callable(mixed): mixed>  $fields
     * @return array<string,mixed>|null
     */
    private static function keyed(mixed $item, array $fields, string $required): ?array
    {
        if (! is_array($item)) {
            return null;
        }

        $out = [];
        foreach ($fields as $key => $map) {
            $out[$key] = $map($item[$key] ?? null);
        }

        return ($out[$required] ?? '') === '' ? null : $out;
    }

    /** @return array<string,string> */
    private static function socials(mixed $value): array
    {
        $value = is_array($value) ? $value : [];
        $out = [];
        foreach (self::SOCIALS as $network) {
            $out[$network] = self::linkUrl($value[$network] ?? null);
        }

        return $out;
    }

    /** @param  list<mixed>  $candidates */
    private static function firstFilled(array $candidates): string
    {
        foreach ($candidates as $candidate) {
            if (is_string($candidate) && trim($candidate) !== '') {
                return trim($candidate);
            }
        }

        return '';
    }
}
