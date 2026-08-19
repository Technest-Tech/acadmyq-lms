<?php

declare(strict_types=1);

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Services\Xpay\XpayClient;
use App\Support\Audit;
use App\Support\AuthContext;
use App\Support\Tenancy;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Super Admin → client → Payments. THE one writer of a client's XPay provisioning.
 *
 * Kept out of ClientController on purpose: that controller is the module/subscription engine's
 * surface, and this is a different fact about a client (which card gateway its invoices use). What
 * they share is the convention — Super-Admin-only, every write inside the target academy's tenant
 * context, every write audited.
 *
 * TWO KEY SETS, ONE IN FORCE. A client can hold its test and live credentials at the same time; the
 * `mode` field says which set every payment path resolves. Going live is therefore a one-field flip
 * rather than a destructive paste-over, and dropping back to test to reproduce a problem costs
 * nothing.
 *
 * THE SECRETS ONLY EVER TRAVEL INWARD. Reads return last-four tails, never a key. The academy's own
 * Settings → Payment page reads `academy_payment_settings`, which by design holds nothing secret —
 * so an academy can see THAT card payment is on, and never WHAT it was configured with.
 */
final class ClientPaymentController extends Controller
{
    private const MODES = ['test', 'live'];

    public function __construct(private readonly XpayClient $xpay) {}

    /** GET /admin/clients/{id}/payments/xpay — provisioning state, no secrets. */
    public function showXpay(string $id): JsonResponse
    {
        Gate::authorize('academy.read');

        $this->assertAcademyExists($id);

        return response()->json(['xpay' => $this->state($id)]);
    }

    /**
     * PUT /admin/clients/{id}/payments/xpay — provision or update the client's XPay keys.
     *
     * Secrets are replace-only: an omitted or blank `secret_key`/`webhook_secret` keeps whatever is
     * stored for that mode, so the admin can switch environments or fix a typo'd publishable key
     * without re-pasting credentials they can no longer read back.
     */
    public function updateXpay(Request $request, string $id): JsonResponse
    {
        Gate::authorize('academy_billing.manage');

        $this->assertAcademyExists($id);

        $data = $request->validate([
            'is_active' => ['required', 'boolean'],
            'mode' => ['required', 'in:test,live'],
            'test' => ['sometimes', 'array'],
            'test.publishable_key' => ['nullable', 'string', 'max:300'],
            'test.secret_key' => ['nullable', 'string', 'max:300'],
            'test.webhook_secret' => ['nullable', 'string', 'max:300'],
            'live' => ['sometimes', 'array'],
            'live.publishable_key' => ['nullable', 'string', 'max:300'],
            'live.secret_key' => ['nullable', 'string', 'max:300'],
            'live.webhook_secret' => ['nullable', 'string', 'max:300'],
        ]);

        $mode = (string) $data['mode'];
        $ctx = app(AuthContext::class);

        $existing = $this->inAcademyContext(
            $id,
            fn () => DB::table('academy_xpay_credentials')->where('academy_id', $id)->get()->keyBy('mode'),
        );

        // Normalise + validate each submitted environment before writing any of them, so a bad live
        // key never leaves a half-applied test key behind.
        $incoming = [];
        foreach (self::MODES as $m) {
            $section = (array) ($data[$m] ?? []);
            $publishable = trim((string) ($section['publishable_key'] ?? ''));
            $secret = trim((string) ($section['secret_key'] ?? ''));
            $webhook = trim((string) ($section['webhook_secret'] ?? ''));

            if ($secret !== '') {
                $this->assertKeyMatchesMode($secret, 'sk_', $m, "{$m}.secret_key");
            }
            if ($publishable !== '') {
                $this->assertKeyMatchesMode($publishable, 'pk_', $m, "{$m}.publishable_key");
            }
            if ($webhook !== '' && ! str_starts_with($webhook, 'whsec_')) {
                $this->fail("{$m}.webhook_secret", 'An XPay webhook signing secret starts with "whsec_".');
            }

            // There is no such thing as a credentials row without a secret key — the column is NOT
            // NULL, and a row with no credential could never take a payment. A mode with nothing
            // stored and nothing submitted is simply skipped.
            $isNew = ! $existing->has($m);
            if ($isNew && $secret === '') {
                if ($publishable !== '' || $webhook !== '') {
                    $this->fail("{$m}.secret_key", 'Add the '.$m.' secret key too — a key set cannot be saved without it.');
                }

                continue;
            }

            $incoming[$m] = compact('publishable', 'secret', 'webhook', 'isNew');
        }

        // Whichever environment is being put in force has to actually have keys behind it.
        if (! isset($incoming[$mode])) {
            $this->fail("{$mode}.secret_key", 'Add the '.$mode.' secret key before switching this client to '.$mode.' mode.');
        }

        $this->inAcademyContext($id, function () use ($id, $data, $mode, $incoming, $existing, $ctx): void {
            DB::transaction(function () use ($id, $data, $mode, $incoming, $existing, $ctx): void {
                $now = now();

                foreach ($incoming as $m => $vals) {
                    $row = [
                        'updated_by' => $ctx->userId,
                        'updated_at' => $now,
                    ];
                    if ($vals['publishable'] !== '') {
                        $row['publishable_key'] = $vals['publishable'];
                    }
                    if ($vals['secret'] !== '') {
                        $row['secret_key_enc'] = Crypt::encryptString($vals['secret']);
                        $row['secret_last4'] = mb_substr($vals['secret'], -4);
                    }
                    if ($vals['webhook'] !== '') {
                        $row['webhook_secret_enc'] = Crypt::encryptString($vals['webhook']);
                        $row['webhook_last4'] = mb_substr($vals['webhook'], -4);
                    }

                    if ($vals['isNew']) {
                        DB::table('academy_xpay_credentials')->insert($row + [
                            'academy_id' => $id,
                            'mode' => $m,
                            'created_at' => $now,
                        ]);
                    } elseif (count($row) > 2) {
                        DB::table('academy_xpay_credentials')
                            ->where('academy_id', $id)
                            ->where('mode', $m)
                            ->update($row);
                    }
                }

                // ── The public-safe half: what the invoice page and the academy may see ──
                // The active mode's publishable key is mirrored here so the public payload keeps a
                // stable shape; nothing secret is ever mirrored.
                $activePublishable = $incoming[$mode]['publishable'] !== ''
                    ? $incoming[$mode]['publishable']
                    : (string) ($existing->get($mode)->publishable_key ?? '');

                $publicConfig = ['publishable_key' => $activePublishable, 'mode' => $mode];

                $settingsRow = DB::table('academy_payment_settings')->where('method', 'XPAY')->first(['id']);
                if ($settingsRow === null) {
                    DB::table('academy_payment_settings')->insert([
                        'id' => (string) Str::uuid(),
                        'academy_id' => $id,
                        'method' => 'XPAY',
                        'is_active' => $data['is_active'],
                        'config' => json_encode($publicConfig),
                        'created_at' => $now,
                        'updated_at' => $now,
                    ]);
                } else {
                    DB::table('academy_payment_settings')->where('method', 'XPAY')->update([
                        'is_active' => $data['is_active'],
                        'config' => json_encode($publicConfig),
                        'updated_at' => $now,
                    ]);
                }
            });
        });

        Audit::log(
            'payment_settings.manage',
            'academy_xpay_credentials',
            $id,
            $id,
            $ctx->userId,
            $ctx->role,
            // Never audit the keys themselves — only that they changed.
            after: [
                'method' => 'XPAY',
                'is_active' => $data['is_active'],
                'mode' => $mode,
                'keys_rotated' => array_values(array_filter(
                    array_keys($incoming),
                    fn (string $m): bool => $incoming[$m]['secret'] !== '' || $incoming[$m]['webhook'] !== '',
                )),
            ],
            before: [
                'method' => 'XPAY',
                'modes_configured' => $existing->keys()->all(),
            ],
        );

        return response()->json(['xpay' => $this->state($id)]);
    }

    /**
     * POST /admin/clients/{id}/payments/xpay/test — prove a stored secret key actually works before
     * a real payer discovers it does not. Defaults to the active mode; `?mode=live` checks the other
     * set without switching to it.
     */
    public function testXpay(Request $request, string $id): JsonResponse
    {
        Gate::authorize('academy_billing.manage');

        $this->assertAcademyExists($id);

        $mode = (string) $request->input('mode', '');
        if (! in_array($mode, self::MODES, true)) {
            $mode = $this->activeMode($id);
        }

        $row = $this->inAcademyContext(
            $id,
            fn () => DB::table('academy_xpay_credentials')
                ->where('academy_id', $id)
                ->where('mode', $mode)
                ->first(['secret_key_enc']),
        );

        if ($row === null) {
            return response()->json([
                'ok' => false,
                'mode' => $mode,
                'message' => 'No '.$mode.' secret key is stored for this client.',
            ], 422);
        }

        try {
            $secret = Crypt::decryptString((string) $row->secret_key_enc);
        } catch (\Throwable) {
            return response()->json([
                'ok' => false,
                'mode' => $mode,
                'message' => 'The stored key could not be decrypted (APP_KEY may have changed). Re-enter it.',
            ], 422);
        }

        return response()->json($this->xpay->ping($secret) + ['mode' => $mode]);
    }

    /**
     * The provisioning state both reads and writes return: the channel's on/off, which environment
     * is in force, and a per-environment summary carrying tails rather than keys.
     *
     * @return array<string,mixed>
     */
    private function state(string $id): array
    {
        [$settings, $credentials] = $this->inAcademyContext($id, fn (): array => [
            DB::table('academy_payment_settings')->where('method', 'XPAY')->first(['is_active', 'config']),
            DB::table('academy_xpay_credentials')->where('academy_id', $id)->get()->keyBy('mode'),
        ]);

        $config = $settings === null
            ? []
            : (is_string($settings->config) ? (array) json_decode($settings->config, true) : (array) $settings->config);

        $modes = [];
        foreach (self::MODES as $m) {
            $row = $credentials->get($m);
            $modes[$m] = [
                'configured' => $row !== null,
                'publishable_key' => $row->publishable_key ?? null,
                'secret_last4' => $row->secret_last4 ?? null,
                'webhook_last4' => $row->webhook_last4 ?? null,
                'has_webhook_secret' => ! empty($row->webhook_secret_enc ?? null),
                'updated_at' => $row->updated_at ?? null,
            ];
        }

        return [
            'is_active' => (bool) ($settings->is_active ?? false),
            'mode' => (string) ($config['mode'] ?? 'test'),
            'configured' => $credentials->isNotEmpty(),
            'modes' => $modes,
            // The URL the admin pastes into the client's XPay dashboard → Developers → Webhooks.
            // The same URL serves both environments; which signing secret it verifies against
            // follows the active mode.
            'webhook_url' => $this->webhookUrl($id),
        ];
    }

    private function activeMode(string $id): string
    {
        $row = $this->inAcademyContext(
            $id,
            fn () => DB::table('academy_payment_settings')->where('method', 'XPAY')->first(['config']),
        );

        if ($row === null) {
            return 'test';
        }

        $config = is_string($row->config) ? (array) json_decode($row->config, true) : (array) $row->config;

        return in_array($config['mode'] ?? '', self::MODES, true) ? (string) $config['mode'] : 'test';
    }

    /**
     * A key pasted into the wrong environment's box is the classic way to end up with a checkout
     * that silently never charges anyone, so the prefix must agree with the section it was typed in.
     */
    private function assertKeyMatchesMode(string $key, string $prefix, string $mode, string $field): void
    {
        if (str_starts_with($key, $prefix.$mode.'_')) {
            return;
        }

        $other = $mode === 'test' ? 'live' : 'test';
        $this->fail(
            $field,
            str_starts_with($key, $prefix.$other.'_')
                ? 'That is a '.$other.' key — it belongs in the '.$other.' section.'
                : 'Expected an XPay key starting with "'.$prefix.$mode.'_".',
        );
    }

    private function fail(string $field, string $message): never
    {
        throw ValidationException::withMessages([$field => [$message]]);
    }

    /** The per-academy callback XPay posts to; the academy id selects the signing secret. */
    private function webhookUrl(string $academyId): string
    {
        return rtrim((string) config('app.url'), '/').'/api/webhooks/xpay/'.$academyId;
    }

    private function assertAcademyExists(string $id): void
    {
        if (DB::table('academies')->where('id', $id)->doesntExist()) {
            abort(404, 'Client not found.');
        }
    }

    /** Run a closure inside the target client's tenant context (mirrors ClientController). */
    private function inAcademyContext(string $academyId, callable $fn): mixed
    {
        $ctx = app(AuthContext::class);
        $target = new AuthContext(
            userId: $ctx->userId,
            academyId: $academyId,
            role: 'SUPER_ADMIN',
            permissions: $ctx->permissions,
        );

        return Tenancy::withContext($target, $fn);
    }
}
