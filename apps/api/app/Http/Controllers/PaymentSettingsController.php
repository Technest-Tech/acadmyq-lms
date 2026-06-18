<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Support\Audit;
use App\Support\AuthContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;

/**
 * Per-academy payment channel configuration (Settings → Payment). Each academy
 * can configure up to three payment channels: BANK_TRANSFER, PAYPAL, and XPAY
 * (placeholder). Channels are stored as rows in `academy_payment_settings` — one
 * row per method per academy, upserted via PUT. The `is_active` flag controls
 * whether the channel is shown to students on the public invoice page.
 *
 * RLS scopes every query to the caller's academy. Writes require
 * `payment_settings.manage`; reads require `invoice.read` so the invoice screen
 * can show which methods are available when marking a bill paid.
 */
final class PaymentSettingsController extends Controller
{
    private const METHODS = ['BANK_TRANSFER', 'PAYPAL', 'XPAY'];

    /** GET /api/payment-settings — return all three channels, filling defaults for unconfigured ones. */
    public function index(): JsonResponse
    {
        Gate::authorize('invoice.read');

        $rows = DB::table('academy_payment_settings')
            ->whereIn('method', self::METHODS)
            ->get(['method', 'is_active', 'config'])
            ->keyBy('method');

        $result = array_map(function (string $method) use ($rows): array {
            if ($rows->has($method)) {
                $row = $rows->get($method);
                return [
                    'method'    => $method,
                    'is_active' => (bool) $row->is_active,
                    'config'    => is_string($row->config) ? json_decode($row->config, true) : (array) $row->config,
                ];
            }

            return [
                'method'    => $method,
                'is_active' => false,
                'config'    => (object) [],
            ];
        }, self::METHODS);

        return response()->json(['payment_settings' => array_values($result)]);
    }

    /**
     * PUT /api/payment-settings/{method} — create-or-update a channel's config and active state.
     * Sending an empty config with is_active=false is how you effectively disable a channel.
     */
    public function upsert(Request $request, string $method): JsonResponse
    {
        Gate::authorize('payment_settings.manage');

        $method = strtoupper($method);
        if (! in_array($method, self::METHODS, true)) {
            abort(404, 'Unknown payment method.');
        }

        $data = $request->validate([
            'is_active' => ['required', 'boolean'],
            'config'    => ['sometimes', 'array'],
        ]);

        $ctx       = app(AuthContext::class);
        $academyId = $this->academyId($ctx);
        $config    = $data['config'] ?? [];

        $config = $this->sanitizeConfig($method, $config);

        $existing = DB::table('academy_payment_settings')
            ->where('method', $method)
            ->first(['id']);

        $now = now();

        if ($existing !== null) {
            $before = DB::table('academy_payment_settings')
                ->where('method', $method)
                ->first(['is_active', 'config']);

            DB::table('academy_payment_settings')
                ->where('method', $method)
                ->update([
                    'is_active'  => $data['is_active'],
                    'config'     => json_encode($config),
                    'updated_at' => $now,
                ]);

            Audit::log(
                'payment_settings.manage',
                'academy_payment_settings',
                $existing->id,
                $academyId,
                $ctx->userId,
                $ctx->role,
                before: ['is_active' => $before->is_active, 'method' => $method],
                after:  ['is_active' => $data['is_active'], 'method' => $method],
            );
        } else {
            $id = (string) Str::uuid();
            DB::table('academy_payment_settings')->insert([
                'id'         => $id,
                'academy_id' => $academyId,
                'method'     => $method,
                'is_active'  => $data['is_active'],
                'config'     => json_encode($config),
                'created_at' => $now,
                'updated_at' => $now,
            ]);

            Audit::log(
                'payment_settings.manage',
                'academy_payment_settings',
                $id,
                $academyId,
                $ctx->userId,
                $ctx->role,
                after: ['is_active' => $data['is_active'], 'method' => $method],
            );
        }

        return response()->json(['ok' => true]);
    }

    private function academyId(AuthContext $ctx): string
    {
        if ($ctx->academyId === null) {
            abort(403, 'Enter an academy to manage its payment settings.');
        }

        return $ctx->academyId;
    }

    /**
     * Strip unknown keys and lightly sanitize config values per method so we
     * never store arbitrary junk in the JSONB column.
     *
     * @param  array<string,mixed> $config
     * @return array<string,mixed>
     */
    private function sanitizeConfig(string $method, array $config): array
    {
        return match ($method) {
            'BANK_TRANSFER' => [
                'account_number' => isset($config['account_number']) ? substr((string) $config['account_number'], 0, 120) : '',
                'account_holder' => isset($config['account_holder']) ? substr((string) $config['account_holder'], 0, 120) : '',
                'bank_name'      => isset($config['bank_name'])      ? substr((string) $config['bank_name'],      0, 120) : '',
                'iban'           => isset($config['iban'])           ? substr((string) $config['iban'],           0, 60)  : '',
            ],
            'PAYPAL' => [
                'client_id'     => isset($config['client_id'])     ? substr((string) $config['client_id'],     0, 300) : '',
                'client_secret' => isset($config['client_secret']) ? substr((string) $config['client_secret'], 0, 300) : '',
                'email'         => isset($config['email'])         ? substr((string) $config['email'],         0, 200) : '',
                'mode'          => in_array($config['mode'] ?? '', ['sandbox', 'live'], true) ? $config['mode'] : 'live',
            ],
            'XPAY' => [], // placeholder — no config yet
            default => [],
        };
    }
}
