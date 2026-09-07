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
 * Per-academy payment channel configuration (Settings → Payment). Three channels:
 * BANK_TRANSFER, PAYPAL, and XPAY. Channels are stored as rows in
 * `academy_payment_settings` — one row per method per academy, upserted via PUT.
 * The `is_active` flag controls whether the channel is shown to students on the
 * public invoice page.
 *
 * TWO CHANNELS ARE THE ACADEMY'S, ONE IS OURS. Bank transfer and PayPal hold
 * credentials the academy itself owns and types in here. XPay does not: the
 * Super Admin provisions each client's merchant keys (Admin\ClientPaymentController)
 * and they live in `academy_xpay_credentials`, encrypted and never returned by any
 * academy-facing endpoint.
 *
 * So XPAY is a HALF-WRITE: the academy may switch its own card button on and off —
 * that is a business decision about its invoices, not a secret — but may never see
 * or set the keys behind it. `config` on the XPAY row belongs to the Super Admin and
 * this controller never touches it. See toggleXpay().
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

        // The XPAY row alone cannot say whether the channel is usable: a settings row can exist
        // with nothing provisioned behind it. This one boolean (RLS-scoped, so it can only ever
        // describe the caller's own academy) is the whole of what an academy may learn about the
        // credentials — it is what decides whether the Settings toggle is live or explained away.
        $xpayConfigured = DB::table('academy_xpay_credentials')->exists();

        $result = array_map(function (string $method) use ($rows, $xpayConfigured): array {
            $row = $rows->get($method);

            $entry = [
                'method'    => $method,
                'is_active' => (bool) ($row->is_active ?? false),
                'config'    => $row === null
                    ? (object) []
                    : (is_string($row->config) ? json_decode($row->config, true) : (array) $row->config),
            ];

            if ($method === 'XPAY') {
                $entry['configured'] = $xpayConfigured;
            }

            return $entry;
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

        // XPay is provisioned by the Super Admin (Admin\ClientPaymentController), not by the academy:
        // the merchant keys belong to Academiq's onboarding process and the academy never holds them.
        // The one thing the academy does decide is whether the button shows, so that write — and
        // only that write — is handled apart, where no submitted `config` can reach the row.
        if ($method === 'XPAY') {
            return $this->toggleXpay($request);
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

    /**
     * PUT /api/payment-settings/XPAY — show or hide the card button on this academy's invoices.
     *
     * Deliberately narrow: it reads `is_active` and nothing else, and updates `is_active` and
     * nothing else. Whatever `config` the request carried is discarded unread, so no academy-side
     * write can ever reach the publishable key or mode the Super Admin set.
     *
     * ON requires keys behind the channel. Without them the button would still render on the public
     * invoice and then 422 the moment a parent pressed it — `app.xpay_config_by_token` resolves to
     * null with no credentials — which is a worse failure than the button simply not being there.
     * OFF is always allowed: if card payment starts misbehaving, the academy must be able to pull it
     * without waiting on us.
     */
    private function toggleXpay(Request $request): JsonResponse
    {
        $data = $request->validate(['is_active' => ['required', 'boolean']]);

        $ctx       = app(AuthContext::class);
        $academyId = $this->academyId($ctx);

        $row = DB::table('academy_payment_settings')
            ->where('method', 'XPAY')
            ->first(['id', 'is_active']);

        if ($data['is_active'] && ($row === null || DB::table('academy_xpay_credentials')->doesntExist())) {
            abort(422, 'Card payment has not been set up for this academy yet. Contact Academiq to have it enabled.');
        }

        // No row means the channel was never provisioned, so it is already off — nothing to switch.
        if ($row === null) {
            return response()->json(['ok' => true]);
        }

        DB::table('academy_payment_settings')
            ->where('id', $row->id)
            ->update([
                'is_active'  => $data['is_active'],
                'updated_at' => now(),
            ]);

        Audit::log(
            'payment_settings.manage',
            'academy_payment_settings',
            $row->id,
            $academyId,
            $ctx->userId,
            $ctx->role,
            before: ['is_active' => $row->is_active, 'method' => 'XPAY'],
            after:  ['is_active' => $data['is_active'], 'method' => 'XPAY'],
        );

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
            // Unreachable: upsert() hands XPAY to toggleXpay() before it gets here, and that path
            // never writes `config`. Kept so the match stays total over self::METHODS and a future
            // writer cannot fall through to `default`.
            'XPAY' => [],
            default => [],
        };
    }
}
