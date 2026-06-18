<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * GET /api/reports/exchange-rates — live FX rates into the academy's home currency (EGP).
 *
 * The financial-statistics page mixes currencies (teachers/staff/invoices can each be billed in
 * their own currency). The owner needs a single converted view: every total — and the salaries
 * derived from it — expressed in one home currency. This endpoint returns, for each foreign
 * currency we care about, how many home-currency units one unit buys (`to_home`).
 *
 * Rates come from open.er-api.com (free, no key) and are cached for `services.exchange.ttl`
 * seconds so the upstream is hit at most once per window per host. On upstream failure we serve
 * the last good cached payload if we have one; otherwise we return `available: false` and an empty
 * rate list so the page degrades to its plain per-currency view instead of erroring.
 */
final class ExchangeRateController extends Controller
{
    public function index(): JsonResponse
    {
        // Same capability that guards the financial-statistics page itself.
        Gate::authorize('invoice.read');

        $cfg = config('services.exchange');
        $home = strtoupper((string) $cfg['home_currency']);
        $wanted = array_map('strtoupper', (array) $cfg['currencies']);

        $cacheKey = "fx_rates:{$home}";
        $ttl = max(60, (int) $cfg['ttl']);

        $payload = Cache::remember($cacheKey, $ttl, function () use ($cfg, $home, $wanted): ?array {
            return $this->fetchRates($cfg, $home, $wanted);
        });

        // A failed fetch returns null — don't cache the failure; fall back to the last good payload.
        if ($payload === null) {
            Cache::forget($cacheKey);
            $stale = Cache::get("{$cacheKey}:last");

            if (is_array($stale)) {
                $stale['stale'] = true;

                return response()->json($stale);
            }

            return response()->json([
                'home' => $home,
                'available' => false,
                'stale' => false,
                'as_of' => null,
                'source' => null,
                'rates' => [],
            ]);
        }

        // Keep a copy that never expires so we can serve it if the upstream later goes down.
        Cache::forever("{$cacheKey}:last", $payload);

        return response()->json($payload);
    }

    /**
     * Fetch home-based rates and invert them to foreign→home. Returns null on any failure so the
     * caller can fall back to a stale copy rather than caching a broken result.
     *
     * @param  array<string,mixed>  $cfg
     * @param  list<string>  $wanted
     * @return array<string,mixed>|null
     */
    private function fetchRates(array $cfg, string $home, array $wanted): ?array
    {
        try {
            $response = Http::timeout((int) $cfg['timeout'])
                ->acceptJson()
                ->get(rtrim((string) $cfg['base_url'], '/')."/{$home}");

            if (! $response->successful()) {
                Log::warning('exchange-rates: upstream returned non-2xx', ['status' => $response->status()]);

                return null;
            }

            $body = $response->json();

            // open.er-api.com shape: { result, time_last_update_unix, base_code, rates: { USD: 0.0203, ... } }
            $rates = $body['rates'] ?? null;
            if (! is_array($rates) || ($body['result'] ?? null) === 'error') {
                Log::warning('exchange-rates: unexpected upstream payload');

                return null;
            }

            $out = [];
            foreach ($wanted as $cur) {
                if ($cur === $home) {
                    continue;
                }
                $perHome = $rates[$cur] ?? null; // foreign units per 1 home unit
                if (! is_numeric($perHome) || (float) $perHome <= 0) {
                    continue;
                }
                $out[] = [
                    'currency' => $cur,
                    // home units per 1 foreign unit — what the page multiplies foreign totals by.
                    'to_home' => round(1 / (float) $perHome, 6),
                ];
            }

            return [
                'home' => $home,
                'available' => true,
                'stale' => false,
                'as_of' => $body['time_last_update_unix'] ?? null,
                'source' => parse_url((string) $cfg['base_url'], PHP_URL_HOST),
                'rates' => $out,
            ];
        } catch (\Throwable $e) {
            Log::warning('exchange-rates: fetch failed', ['error' => $e->getMessage()]);

            return null;
        }
    }
}
