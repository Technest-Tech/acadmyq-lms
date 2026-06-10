<?php

declare(strict_types=1);

namespace App\Enums;

/** Canonical payment methods (Master Spec §9). */
enum PaymentMethod: string
{
    case Cash = 'CASH';
    case BankTransfer = 'BANK_TRANSFER';
    case Gateway = 'GATEWAY';
    case Other = 'OTHER';
}
