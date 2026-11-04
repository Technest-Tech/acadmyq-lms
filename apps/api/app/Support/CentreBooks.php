<?php

declare(strict_types=1);

namespace App\Support;

use App\Services\Ledger;

/**
 * "A centre on receipts" — the one question behind every centre-only book-keeping rule: its bills
 * never close at month end, a bill's status is read from the money on it, a sealed statement's
 * correction is carried, a settlement gives unused prepaid money back.
 *
 * It used to be asked as `PackageSettlement::availableFor()`, which made a package class the home
 * of rules that have nothing to do with packages (docs/centre-profile/01-PRIVATE-SUBSCRIPTION-SPLIT.md).
 * Same answer, its own name: the `centre` switch AND the books kept by receipts (`Ledger::keeps`).
 * Never the profile: a Quran academy switched onto `centre` + receipts gets exactly this and nothing
 * else, and a centre without receipts keeps its bills the ordinary way.
 */
final class CentreBooks
{
    public static function enabledFor(string $academyId): bool
    {
        return Ledger::keeps($academyId) && Entitlement::hasCapability($academyId, 'centre');
    }
}
