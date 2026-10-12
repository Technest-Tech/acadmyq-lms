<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Support\Facades\DB;

/**
 * Academy controls (Settings → Controls) — per-academy switches over what the academy's own
 * users may do.
 *
 * A switch that takes something away from a role does it by SUBTRACTING capabilities from the
 * resolved set (see {@see restrict}), never by adding checks to individual controllers: every
 * Gate and every `can()` in the UI then follows from the one place, and a new endpoint gated on
 * the same capability is covered without anyone remembering this setting exists.
 */
final class AcademySettings
{
    public const DEFAULTS = [
        'teacher_lessons_read_only' => false,
        'teacher_can_reschedule'    => true,
        'teacher_can_add_lessons'   => true,
    ];

    /**
     * The finer-grained switches: each one, when OFF, takes exactly one capability from a
     * TEACHER. "Read-only lessons" above already covers both, so they only matter while it is off.
     */
    public const TEACHER_SWITCH_CAPS = [
        'teacher_can_reschedule'  => 'session.reschedule',
        'teacher_can_add_lessons' => 'session.create',
    ];

    /**
     * What a TEACHER loses when their academy makes lessons read-only: everything that creates or
     * changes a lesson. `session.read` stays — they still see their schedule and lessons.
     */
    public const TEACHER_LESSON_WRITE_CAPS = [
        'session.create',
        'session.mark_attendance',
        'session.write_report',
        'session.reschedule',
        'session.cancel_request',
        'session.free_request',
    ];

    /**
     * The academy's settings merged over the defaults. Reads through the BYPASSRLS function, so it
     * works both before the tenant context exists (the auth middleware) and inside it.
     *
     * @return array{teacher_lessons_read_only: bool, teacher_can_reschedule: bool, teacher_can_add_lessons: bool}
     */
    public static function forAcademy(?string $academyId): array
    {
        if ($academyId === null) {
            return self::DEFAULTS;
        }

        $json = DB::selectOne('select app.auth_academy_settings(?::uuid) as s', [$academyId])?->s;
        $row = $json === null ? [] : (array) json_decode((string) $json, true);

        $settings = [];
        foreach (self::DEFAULTS as $key => $default) {
            $settings[$key] = (bool) ($row[$key] ?? $default);
        }

        return $settings;
    }

    /**
     * The capability set a role actually holds in this academy, after its controls are applied.
     *
     * @param  list<string>  $permissions
     * @return list<string>
     */
    public static function restrict(string $role, ?string $academyId, array $permissions): array
    {
        // Only a TEACHER is restricted today; skip the lookup for everyone else.
        if ($role !== 'TEACHER' || $academyId === null) {
            return $permissions;
        }

        $settings = self::forAcademy($academyId);

        $removed = $settings['teacher_lessons_read_only'] ? self::TEACHER_LESSON_WRITE_CAPS : [];
        foreach (self::TEACHER_SWITCH_CAPS as $key => $cap) {
            if (! $settings[$key]) {
                $removed[] = $cap;
            }
        }

        return $removed === [] ? $permissions : array_values(array_diff($permissions, $removed));
    }
}
