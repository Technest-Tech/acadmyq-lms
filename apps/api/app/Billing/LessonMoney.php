<?php

declare(strict_types=1);

namespace App\Billing;

/**
 * What a private lesson's money does when it is marked, BEFORE the monthly bill is considered
 * (docs/centre-profile/01-PRIVATE-SUBSCRIPTION-SPLIT.md, "Where it plugs into shared code").
 *
 * Two homes for that money exist: the Quran academy's hour block ({@see PackageMoney}) and the
 * centre's subscription counted in lessons ({@see SubscriptionMoney}). `Invoicing` asks the policy
 * {@see \App\Support\MoneyPolicy} picked for the academy and never which one it is talking to.
 * "Handled" means the lesson's money lives here, and the monthly path must not open an invoice
 * line for it; "not handled" means the lesson bills (or un-bills) the ordinary way.
 */
interface LessonMoney
{
    /** The lesson became billable. True when its money is taken care of here. */
    public function onBillable(object $session): bool;

    /** The lesson is no longer billable. True when its money was undone here. */
    public function onUnbilled(object $session): bool;
}
