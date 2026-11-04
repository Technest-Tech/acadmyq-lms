<?php

declare(strict_types=1);

namespace App\Billing;

use App\Services\LessonPackages;

/**
 * The Quran academy's hour block, exactly as `Invoicing` called it before the seam existed: the
 * package clock gets first refusal ({@see LessonPackages::consume()}), and a lesson that ate
 * package minutes is given back the same way ({@see LessonPackages::release()}). A declined lesson
 * (the student is on package billing with no open block) falls to the hourly path, as it always did.
 */
final class PackageMoney implements LessonMoney
{
    public function __construct(private readonly LessonPackages $packages) {}

    public function onBillable(object $session): bool
    {
        return $this->packages->consume($session);
    }

    public function onUnbilled(object $session): bool
    {
        return $this->packages->release($session);
    }
}
