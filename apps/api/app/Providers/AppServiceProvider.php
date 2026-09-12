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
        // The marketing site's demo form. Six an hour per IP: a prospect fills this in ONCE, so the
        // ceiling is invisible to a real visitor and makes an open, unauthenticated POST endpoint
        // worthless to a spammer. Deliberately per-IP and not per-email — an email address is
        // whatever the sender types, so keying on it would rate-limit nobody.
        RateLimiter::for('demo-requests', fn (Request $request) => Limit::perHour(6)->by((string) $request->ip()));

        // Per-key throttle for the external WhatsApp API (docs/whatsapp-api). Keyed by the resolved
        // API-key id (set on the request by AuthenticateWhatsAppApiKey) so one client's volume can't
        // starve another's; falls back to the client IP before the key is resolved.
        RateLimiter::for('wa-api', function (Request $request) {
            $keyId = $request->attributes->get('wa_api_key_id');

            return Limit::perMinute(120)->by(is_string($keyId) ? $keyId : (string) $request->ip());
        });

        /*
        | The per-client subdomain surfaces (docs/lms/02). Every one of these is keyed by
        | HANDLE + IP rather than by IP alone, which fixes two opposite failures of a bare
        | `throttle:N,1`:
        |
        |  - one caller, many tenants. The Next.js server resolves `GET /api/site` and the
        |    storefront documents for EVERY client from one address, so a plain per-IP bucket is
        |    shared by the whole platform: past a few dozen tenants the web app throttles itself,
        |    and the fallbacks are silent and wrong (an unresolved LMS client renders as
        |    MANAGEMENT, i.e. a staff login page where their course site should be). Adding the
        |    handle gives the renderer one budget per tenant.
        |  - one tenant, many callers. Keying on the handle ALONE would let a single visitor spend
        |    a whole client's budget; the IP keeps each visitor in their own bucket.
        |
        | The handle is read straight from the `X-Academy` header because these limiters run
        | before `resolve.academy`. An absent or unknown handle collapses to one bucket per IP,
        | which is the right shape for the 404 it is about to receive.
        */
        $perTenant = static function (Request $request): string {
            $handle = strtolower(trim((string) $request->header('X-Academy', '')));

            return ($handle !== '' ? $handle : '-').'|'.$request->ip();
        };

        // Which product answers on a handle: one cheap read, fetched by the renderer on every
        // uncached page of every tenant host, so the ceiling is generous.
        RateLimiter::for('tenant-site', fn (Request $request) => Limit::perMinute(300)->by($perTenant($request)));

        // The public course site's reads — site document, catalogue, a course, the bookshop. Public
        // and cacheable; a real visitor browsing hard stays far below this.
        RateLimiter::for('learn-read', fn (Request $request) => Limit::perMinute(300)->by($perTenant($request)));

        // Learner credential endpoints (register / login / forgot / reset). docs/lms/02 asks for
        // "per IP + per academy", and this is the limit that actually has to bite: it is the only
        // place on the platform where an anonymous caller can guess a password or mint an account.
        RateLimiter::for('learn-auth', fn (Request $request) => [
            Limit::perMinute(10)->by($perTenant($request)),
            Limit::perHour(60)->by($perTenant($request)),
        ]);
    }
}
