<?php

declare(strict_types=1);

namespace App\Providers;

use App\Billing\BillingHook;
use App\Payroll\PayoutHook;
use App\Services\Invoicing;
use App\Services\Payroll;
use App\Support\Lms\FfmpegHlsTranscoder;
use App\Support\Lms\HlsTranscoder;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
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

        // Sprint 8: bind the payroll seam. The same AttendanceService status-change transaction
        // that fires the billing hook now also fires this payout hook, so one ATTENDED outcome
        // bills the student (Invoicing) and pays the teacher (Payroll), each guarded independently
        // (AC-8.1, AC-8.12).
        $this->app->bind(PayoutHook::class, Payroll::class);
        $this->app->singleton(Payroll::class);

        // LMS phase 3b: the HLS transcode seam. TranscodeMediaJob resolves this; the real ffmpeg
        // impl runs on a host that has the binary, while tests bind a fake (docs/lms/04 — VOD).
        $this->app->bind(HlsTranscoder::class, FfmpegHlsTranscoder::class);
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        // Per-key throttle for the external WhatsApp API (docs/whatsapp-api). Keyed by the resolved
        // API-key id (set on the request by AuthenticateWhatsAppApiKey) so one client's volume can't
        // starve another's; falls back to the client IP before the key is resolved.
        RateLimiter::for('wa-api', function (Request $request) {
            $keyId = $request->attributes->get('wa_api_key_id');

            return Limit::perMinute(120)->by(is_string($keyId) ? $keyId : (string) $request->ip());
        });
    }
}
