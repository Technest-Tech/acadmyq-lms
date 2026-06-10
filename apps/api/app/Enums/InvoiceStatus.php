<?php

declare(strict_types=1);

namespace App\Enums;

/** Canonical invoice statuses (Master Spec §9). */
enum InvoiceStatus: string
{
    case Open = 'OPEN';
    case Closed = 'CLOSED';
    case Paid = 'PAID';
    case PartiallyPaid = 'PARTIALLY_PAID';
    case Void = 'VOID';
}
