<?php

declare(strict_types=1);

namespace App\Support;

/**
 * What a package's money is FOR, in the words the academy and the parent use — "a new
 * subscription", "the renewal", "the hours used" — so a due line says why it is owed, not only how
 * much. One rule, read by the packages list and the family's payment page alike.
 *
 *   UNBILLED      finished and used, but no bill was ever raised
 *   OVERDRAFT     the bill is settled; the last lesson ran past the hours and nothing covered it
 *   USAGE         billed when it finishes, for the hours actually used (ON_COMPLETION)
 *   NEW           the student's first package, paid up front
 *   AUTO_RENEWAL  opened by itself when the last one ran out
 *   RENEWAL       opened by hand after an earlier one
 */
final class PackagePurpose
{
    /**
     * @param  object  $p  a lesson_packages row; `invoice_total_minor` / `invoice_paid_minor` when joined
     */
    public static function of(object $p): string
    {
        $outstanding = max(0, (int) ($p->invoice_total_minor ?? 0) - (int) ($p->invoice_paid_minor ?? 0));

        if ($p->invoice_id === null && (string) $p->status === 'COMPLETED' && (int) $p->minutes_consumed > 0) {
            return 'UNBILLED';
        }
        if ($p->invoice_id !== null && $outstanding === 0 && (int) $p->minutes_overdrawn > 0
            && $p->overdraft_invoice_id === null && $p->overdraft_absorbed_by === null) {
            return 'OVERDRAFT';
        }
        if ((string) $p->bill_timing === 'ON_COMPLETION') {
            return 'USAGE';
        }
        if ((int) $p->sequence_no <= 1) {
            return 'NEW';
        }

        return (bool) $p->opened_automatically ? 'AUTO_RENEWAL' : 'RENEWAL';
    }
}
