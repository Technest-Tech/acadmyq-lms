<?php

declare(strict_types=1);

namespace App\Enums;

/** Canonical subscription statuses (Master Spec §9). */
enum SubscriptionStatus: string
{
    case Active = 'ACTIVE';
    case Paused = 'PAUSED';
    case Ended = 'ENDED';
}
