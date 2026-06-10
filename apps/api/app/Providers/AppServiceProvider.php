<?php

declare(strict_types=1);

namespace App\Providers;

use App\Billing\BillingHook;
use App\Billing\InvoiceBillingHook;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        // The Sprint 6 billing seam (§5). Sprint 7 will rebind this to the price-snapshotting
        // implementation; the firing conditions/guards in AttendanceService stay unchanged.
        $this->app->bind(BillingHook::class, InvoiceBillingHook::class);
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        //
    }
}
