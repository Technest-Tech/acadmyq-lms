<?php

declare(strict_types=1);

namespace App\Enums;

/** Per-academy invoice grouping mode (Master Spec §9, R-INV-4). */
enum InvoiceGrouping: string
{
    case PerGuardian = 'PER_GUARDIAN';
    case PerStudent = 'PER_STUDENT';
}
