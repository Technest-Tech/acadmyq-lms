<?php

declare(strict_types=1);

namespace App\Providers;

use App\Billing\BillingHook;
use App\Services\Invoicing;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        // Sprint 7: rebind the billing seam to the real price-snapshotting Invoicing service.
        // The MVP InvoiceBillingHook (zero-amount placeholder) is superseded. The firing
        // conditions and guards in AttendanceService are unchanged; only the money implementation
        // swaps out (AC-7.1–7.7, AC-7.12).
        $this->app->bind(BillingHook::class, Invoicing::class);
        $this->app->singleton(Invoicing::class);
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        //
    }
}
