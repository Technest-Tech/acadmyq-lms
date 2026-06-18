<?php

declare(strict_types=1);

namespace App\Support;

/**
 * The student lifecycle vocabulary (R-STU). `status` is the learner's *display* lifecycle —
 * deliberately distinct from two other axes that move on their own clocks: the per-student
 * subscription's billing status (ACTIVE/PAUSED/ENDED) and the soft-delete (`deleted_at`) that
 * hides a row from active rosters.
 *
 * The three ACTIVE states describe a live learner; the two TERMINAL states record *why* a
 * student left and are written only by the deactivate flow, which also soft-deletes the row —
 * so a GRADUATED/WITHDRAWN student is always `deleted_at`-bearing, and reactivate() returns
 * them to REGULAR. The DB CHECK constraint (2026_06_24 migration) is the backstop on this set.
 */
final class StudentStatus
{
    public const TRIAL = 'TRIAL';

    public const TRIAL_BOOKED = 'TRIAL_BOOKED';

    public const REGULAR = 'REGULAR';

    public const GRADUATED = 'GRADUATED';

    public const WITHDRAWN = 'WITHDRAWN';

    /** Every status the column may hold. */
    public const ALL = [self::TRIAL, self::TRIAL_BOOKED, self::REGULAR, self::GRADUATED, self::WITHDRAWN];

    /** A live learner — the only states a student may hold while not soft-deleted. */
    public const ACTIVE = [self::TRIAL, self::TRIAL_BOOKED, self::REGULAR];

    /** Why a student left — set only at deactivate time, never via a plain profile edit. */
    public const TERMINAL = [self::GRADUATED, self::WITHDRAWN];

    public static function isTerminal(string $status): bool
    {
        return in_array($status, self::TERMINAL, true);
    }
}
