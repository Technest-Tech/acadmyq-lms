<?php

declare(strict_types=1);

namespace App\Support;

use App\Billing\LessonMoney;
use App\Billing\PackageMoney;
use App\Billing\SubscriptionMoney;

/**
 * Which home a private lesson's money has in this academy — resolved ONCE from the switches, so no
 * shared service ever asks `if ($centre)` (docs/centre-profile/00-OVERVIEW.md, the profile rule).
 *
 *   centre ON and packages OFF  → {@see SubscriptionMoney}: the centre's subscription in lessons
 *   anything else               → {@see PackageMoney}: the hour block, as it always was
 *
 * `packages` is part of the question on purpose: the split ships while the centres still run on
 * the old block engine (`packages` ON for them), and nothing may change for them until the data
 * move flips the preset (plan step 5). A Quran academy switched onto `centre` alone keeps its
 * packages too.
 */
final class MoneyPolicy
{
    public static function for(string $academyId): LessonMoney
    {
        $capabilities = Entitlement::resolve($academyId)['capabilities'];

        return in_array('centre', $capabilities, true) && ! in_array('packages', $capabilities, true)
            ? app(SubscriptionMoney::class)
            : app(PackageMoney::class);
    }
}
