<?php

declare(strict_types=1);

namespace App\Enums;

/** Canonical academy (tenant) statuses (Master Spec §9). */
enum AcademyStatus: string
{
    case Active = 'ACTIVE';
    case Suspended = 'SUSPENDED';
    case Trial = 'TRIAL';
}
