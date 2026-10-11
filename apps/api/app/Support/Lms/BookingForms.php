<?php

declare(strict_types=1);

namespace App\Support\Lms;

use Illuminate\Support\Facades\DB;

/**
 * The one place a `booking_forms` row is turned into what a screen reads (docs/lms/13), so the
 * dashboard, the public form page and the site document can never disagree about what a form asks.
 *
 * Everything here runs under the caller's tenant context — RLS scopes every read to one academy.
 */
final class BookingForms
{
    /** Request statuses, in pipeline order. The DB CHECK enforces the same set. */
    public const STATUSES = ['NEW', 'CONTACTED', 'CONFIRMED', 'COMPLETED', 'CANCELLED'];

    /** Still owes the academy something. NEW is the only one that lights the sidebar badge. */
    public const OPEN_STATUSES = ['NEW', 'CONTACTED', 'CONFIRMED'];

    /** Caps on the client-defined pick-list — enough for real menus, short enough to tap through. */
    public const MAX_CHOICES = 12;

    public const MAX_CHOICE_LENGTH = 80;

    /**
     * The decoded pick-list, trimmed and de-duplicated. A malformed stored value degrades to "no
     * question asked" rather than to an error on a public page.
     *
     * @return list<string>
     */
    public static function choices(mixed $raw): array
    {
        $list = is_string($raw) ? json_decode($raw, true) : $raw;
        if (! is_array($list)) {
            return [];
        }

        $out = [];
        foreach ($list as $item) {
            if (! is_string($item)) {
                continue;
            }
            $item = mb_substr(trim($item), 0, self::MAX_CHOICE_LENGTH);
            if ($item !== '' && ! in_array($item, $out, true)) {
                $out[] = $item;
            }
        }

        return array_slice($out, 0, self::MAX_CHOICES);
    }

    /**
     * What the public site needs to render the form — every switch, no staff bookkeeping.
     *
     * @return array<string,mixed>
     */
    public static function publicDto(object $f): array
    {
        return [
            'slug' => (string) $f->slug,
            'title' => (string) $f->title,
            'description' => $f->description,
            'submit_label' => $f->submit_label,
            'success_message' => $f->success_message,
            'ask_email' => (bool) $f->ask_email,
            'ask_course' => (bool) $f->ask_course,
            'ask_date' => (bool) $f->ask_date,
            'ask_message' => (bool) $f->ask_message,
            'choice_label' => $f->choice_label,
            'choices' => self::choices($f->choices),
        ];
    }

    /**
     * The forms the public site advertises, oldest first (the order the client made them in — the
     * first one is the "main" form wherever the template needs just one).
     *
     * @return list<array<string,mixed>>
     */
    public static function forSite(): array
    {
        return DB::table('booking_forms')
            ->where('status', 'ACTIVE')
            ->orderBy('created_at')
            ->orderBy('id')
            ->get(['slug', 'title', 'description', 'ask_course', 'show_in_nav', 'show_on_home'])
            ->map(fn (object $f): array => [
                'slug' => (string) $f->slug,
                'title' => (string) $f->title,
                'description' => $f->description,
                'ask_course' => (bool) $f->ask_course,
                'nav' => (bool) $f->show_in_nav,
                'home' => (bool) $f->show_on_home,
            ])
            ->values()
            ->all();
    }

    /**
     * The published courses a "which course?" question offers — the same set the catalogue shows,
     * so a visitor can never book something they could not find.
     *
     * @return list<array{id:string,title:string,slug:string}>
     */
    public static function courseOptions(): array
    {
        return DB::table('courses')
            ->where('status', 'PUBLISHED')
            ->whereNull('deleted_at')
            ->orderByDesc('published_at')
            ->get(['id', 'title', 'slug'])
            ->map(fn (object $c): array => [
                'id' => (string) $c->id,
                'title' => (string) $c->title,
                'slug' => (string) $c->slug,
            ])
            ->values()
            ->all();
    }
}
