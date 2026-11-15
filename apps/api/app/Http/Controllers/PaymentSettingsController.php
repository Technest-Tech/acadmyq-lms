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
 * Per-academy payment channel configuration (Settings → Payment methods). Six channels, stored as
 * rows in `academy_payment_settings` — one row per method per academy, upserted via PUT. The
 * `is_active` flag controls whether the channel is shown to payers on the public bill page (`/i/`)
 * and the family page (`/f/`).
 *
 * FIVE ARE MANUAL: the payer sends the money and the academy marks the bill paid. WALLET (mobile
 * wallet numbers — Vodafone Cash and the like) and INSTAPAY (an address and/or a payment link) for
 * academies paid in Egypt; PAYPAL (an email or paypal.me link) and BANK_TRANSFER (IBAN/SWIFT) for
 * families abroad; OTHER for anything else, as a title and free text. Each holds only what a payer
 * is meant to see — every link is forced to http(s), since the public page renders it as a link.
 * PAYPAL can also carry API keys for an automatic checkout; the secret never leaves this table.
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
    /** Display order: the Egyptian channels first, then abroad, then the catch-all, then the card. */
    private const METHODS = ['WALLET', 'INSTAPAY', 'BANK_TRANSFER', 'PAYPAL', 'OTHER', 'XPAY'];

    /** How many wallet numbers one academy may list (one per network is the real-world need). */
    private const MAX_WALLET_NUMBERS = 3;

    /** GET /api/payment-settings — return every channel, filling defaults for unconfigured ones. */
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

            $config = $row === null ? [] : $this->decode($row->config);

            // The PayPal API secret is write-only: anyone with invoice.read reads this endpoint.
            $hasSecret = ($config['client_secret'] ?? '') !== '';
            unset($config['client_secret']);

            $entry = [
                'method'    => $method,
                'is_active' => (bool) ($row->is_active ?? false),
                'config'    => $config === [] ? (object) [] : $config,
            ];

            if ($method === 'XPAY') {
                $entry['configured'] = $xpayConfigured;
            }
            if ($method === 'PAYPAL') {
                $entry['has_client_secret'] = $hasSecret;
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

        $existing = DB::table('academy_payment_settings')
            ->where('method', $method)
            ->first(['id', 'is_active', 'config']);
        $previous = $existing === null ? [] : $this->decode($existing->config);

        $config = $this->sanitizeConfig($method, $data['config'] ?? [], $previous);

        // A live method with nowhere to send the money is a dead end on the bill page.
        if ($data['is_active'] && ! $this->usable($method, $config)) {
            abort(422, match ($method) {
                'WALLET'        => 'Add at least one wallet number before switching this on.',
                'INSTAPAY'      => 'Add the InstaPay address or link before switching this on.',
                'BANK_TRANSFER' => 'Add the account number or IBAN before switching this on.',
                'PAYPAL'        => 'Add the PayPal email or paypal.me link before switching this on.',
                default         => 'Add the payment details before switching this on.',
            });
        }

        $now = now();

        if ($existing !== null) {
            $before = $existing;

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
                before: ['is_active' => $before->is_active, 'method' => $method, 'config' => $this->auditable($previous)],
                after:  ['is_active' => $data['is_active'], 'method' => $method, 'config' => $this->auditable($config)],
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
                after: ['is_active' => $data['is_active'], 'method' => $method, 'config' => $this->auditable($config)],
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
     * Keep only the keys each method knows, trimmed and capped, so the JSONB column never holds
     * arbitrary junk — and so a public page can render every value without a second check.
     *
     * @param  array<string,mixed> $config    what the request sent
     * @param  array<string,mixed> $previous  what the row holds now (PayPal keeps its API keys)
     * @return array<string,mixed>
     */
    private function sanitizeConfig(string $method, array $config, array $previous = []): array
    {
        $note = $this->text($config['note'] ?? null, 500);

        return match ($method) {
            'WALLET' => [
                'numbers' => $this->walletNumbers($config['numbers'] ?? []),
                'holder'  => $this->text($config['holder'] ?? null, 120),
                'note'    => $note,
            ],
            'INSTAPAY' => [
                'address' => $this->text($config['address'] ?? null, 120),
                'link'    => $this->url($config['link'] ?? null),
                'holder'  => $this->text($config['holder'] ?? null, 120),
                'note'    => $note,
            ],
            'BANK_TRANSFER' => [
                'account_number' => $this->text($config['account_number'] ?? null, 120),
                'account_holder' => $this->text($config['account_holder'] ?? null, 120),
                'bank_name'      => $this->text($config['bank_name'] ?? null, 120),
                'iban'           => $this->text($config['iban'] ?? null, 60),
                'swift'          => $this->text($config['swift'] ?? null, 20),
                'note'           => $note,
            ],
            'PAYPAL' => $this->paypalConfig($config, $previous, $note),
            'OTHER' => [
                'title'   => $this->text($config['title'] ?? null, 80),
                'details' => $this->text($config['details'] ?? null, 1000),
            ],
            // Unreachable: upsert() hands XPAY to toggleXpay() before it gets here, and that path
            // never writes `config`. Kept so the match stays total over self::METHODS and a future
            // writer cannot fall through to `default`.
            'XPAY' => [],
            default => [],
        };
    }

    /**
     * The payer-facing half (email, paypal.me, note) plus the API keys behind the automatic
     * checkout. The keys are kept unless the request names them, and the secret is kept unless a
     * new one is typed — the settings form never receives it back. Clearing the client id clears both.
     *
     * @return array<string,string>
     */
    private function paypalConfig(array $config, array $previous, string $note): array
    {
        $clientId = array_key_exists('client_id', $config)
            ? $this->text($config['client_id'], 300)
            : (string) ($previous['client_id'] ?? '');
        $typedSecret = $this->text($config['client_secret'] ?? null, 300);
        $mode = $config['mode'] ?? $previous['mode'] ?? 'live';

        return [
            'email'         => $this->email($config['email'] ?? null),
            'paypal_me'     => $this->paypalMe($config['paypal_me'] ?? null),
            'note'          => $note,
            'client_id'     => $clientId,
            'client_secret' => $typedSecret !== '' ? $typedSecret : ($clientId === '' ? '' : (string) ($previous['client_secret'] ?? '')),
            'mode'          => in_array($mode, ['sandbox', 'live'], true) ? $mode : 'live',
        ];
    }

    /** Whether a payer could actually send money with this config. */
    private function usable(string $method, array $config): bool
    {
        return match ($method) {
            'WALLET'        => $config['numbers'] !== [],
            'INSTAPAY'      => $config['address'] !== '' || $config['link'] !== '',
            'BANK_TRANSFER' => $config['account_number'] !== '' || $config['iban'] !== '',
            'PAYPAL'        => $config['email'] !== '' || $config['paypal_me'] !== '' || $config['client_id'] !== '',
            'OTHER'         => $config['details'] !== '',
            default         => true,
        };
    }

    /** @return array<string,mixed> */
    private function decode(mixed $config): array
    {
        $decoded = is_string($config) ? json_decode($config, true) : (array) $config;

        return is_array($decoded) ? $decoded : [];
    }

    /** @return array<string,mixed> */
    private function auditable(array $config): array
    {
        unset($config['client_secret']);

        return $config;
    }

    private function text(mixed $value, int $max): string
    {
        if (! is_scalar($value)) {
            return '';
        }

        return mb_substr(trim((string) $value), 0, $max);
    }

    /**
     * Up to three distinct numbers, each cut down to what a phone number is made of.
     *
     * @return list<string>
     */
    private function walletNumbers(mixed $numbers): array
    {
        $numbers = is_array($numbers) ? $numbers : [$numbers];
        $clean = [];
        foreach ($numbers as $n) {
            $n = trim((string) preg_replace('/[^0-9+\s-]/', '', is_scalar($n) ? (string) $n : ''));
            $n = mb_substr((string) preg_replace('/\s+/', ' ', $n), 0, 25);
            if ($n !== '' && ! in_array($n, $clean, true)) {
                $clean[] = $n;
            }
        }

        return array_slice($clean, 0, self::MAX_WALLET_NUMBERS);
    }

    private function email(mixed $value): string
    {
        $email = $this->text($value, 200);
        if ($email !== '' && filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
            abort(422, 'That PayPal email does not look right.');
        }

        return $email;
    }

    /** "name", "paypal.me/name" or the full link — all become https://paypal.me/name. */
    private function paypalMe(mixed $value): string
    {
        $raw = $this->text($value, 200);
        if ($raw === '') {
            return '';
        }
        if (preg_match('/^@?[A-Za-z0-9._-]{1,60}$/', $raw) === 1 && ! str_contains($raw, '.me')) {
            return 'https://paypal.me/'.ltrim($raw, '@');
        }

        return $this->url($raw);
    }

    /**
     * A link the public page will render as `<a href>`: http(s) only, with a host. A bare
     * "ipn.eg/S/…" gets its https:// added; `javascript:` and friends are refused outright.
     */
    private function url(mixed $value): string
    {
        $raw = $this->text($value, 300);
        if ($raw === '') {
            return '';
        }
        if (preg_match('#^[a-z][a-z0-9+.-]*:#i', $raw) !== 1) {
            $raw = 'https://'.ltrim($raw, '/');
        }

        $parts = parse_url($raw);
        $scheme = strtolower((string) ($parts['scheme'] ?? ''));
        $host = (string) ($parts['host'] ?? '');
        if (! in_array($scheme, ['http', 'https'], true) || $host === '' || ! str_contains($host, '.')) {
            abort(422, 'That link is not valid. Paste the full link, starting with https://');
        }

        return $raw;
    }
}
