<?php

declare(strict_types=1);

namespace App\Services;

use App\Support\AuthContext;
use App\Support\PublicInvoiceToken;
use App\Support\Tenancy;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Accounts: how a client pays the owner, decided once and then run by the book (FinanceLedger).
 *
 * The owner picks an AGREEMENT for a client and this class turns it into deals:
 *
 *   MONTHLY / QUARTERLY / SEMI_ANNUAL / YEARLY   one recurring line (yearly usually discounted —
 *                                                `list_amount_minor` keeps the undiscounted price)
 *   ONE_TIME_SUPPORT                             the system paid once (in installments if agreed)
 *                                                + support and server every year
 *   OUTRIGHT                                     the whole system bought, running on the client's
 *                                                own servers; yearly support is optional
 *
 * Changing the agreement never rewrites money that is already owed: the old recurring line ENDS
 * on the day the new one starts (it keeps what is due before that until it is paid, then
 * completes itself) and a new line starts. A purchase is a new sale every time.
 *
 * A platform client gets exactly one account, linked by `finance_clients.linked_academy_id`;
 * `ensureForAcademy` finds it, adopts a same-named book entry the owner typed before the link
 * existed, or opens one.
 */
final class PlatformAccounts
{
    public const PLANS = ['MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL', 'YEARLY', 'ONE_TIME_SUPPORT', 'OUTRIGHT'];

    /** The plans that are one recurring line, and the cycle each runs on. */
    public const RECURRING_PLANS = ['MONTHLY' => 'MONTHLY', 'QUARTERLY' => 'QUARTERLY', 'SEMI_ANNUAL' => 'SEMI_ANNUAL', 'YEARLY' => 'YEARLY'];

    /** Which product line a platform client's money belongs to, by its type. */
    private const SERVICE_BY_TYPE = [
        'MANAGEMENT' => 'MANAGEMENT_SYSTEM',
        'LMS' => 'COURSE_SITE',
        'WHATSAPP' => 'WHATSAPP_SERVICE',
        'VIDEO' => 'VIDEO_PLATFORM',
    ];

    /** Default line titles, in the owner's language (the form sends its own when it has one). */
    private const TITLES = [
        'MONTHLY' => 'اشتراك شهري',
        'QUARTERLY' => 'اشتراك كل 3 شهور',
        'SEMI_ANNUAL' => 'اشتراك كل 6 شهور',
        'YEARLY' => 'اشتراك سنوي',
        'HOSTING' => 'دعم وسيرفر سنوي',
        'SUPPORT' => 'دعم فني سنوي',
        'PURCHASE' => 'شراء النظام',
    ];

    public function __construct(
        private readonly FinanceLedger $ledger,
        private readonly ModuleBilling $modules,
    ) {}

    // ── The platform-client link ─────────────────────────────────────────────

    /** The account linked to this academy, or null. */
    public function accountIdFor(string $academyId): ?string
    {
        $id = DB::table('finance_clients')->where('linked_academy_id', $academyId)->value('id');

        return $id === null ? null : (string) $id;
    }

    /**
     * The academy's account, made on first need: an unlinked book entry with the academy's name is
     * adopted (the owner may have typed the client into the old Finance book); otherwise a new one
     * is opened with the owner's phone and email so reminders have somewhere to go.
     */
    public function ensureForAcademy(string $academyId): string
    {
        $existing = $this->accountIdFor($academyId);
        if ($existing !== null) {
            $this->ensurePayToken($existing);

            return $existing;
        }

        $academy = $this->inAcademy($academyId, fn () => [
            'name' => DB::table('academies')->where('id', $academyId)->value('name'),
            'owner' => DB::table('users as u')
                ->join('user_roles as ur', 'ur.user_id', '=', 'u.id')
                ->where('ur.academy_id', $academyId)
                ->where('ur.role', 'ACADEMY_OWNER')
                ->orderBy('u.created_at')
                ->first(['u.phone', 'u.email']),
        ]);
        if ($academy['name'] === null) {
            abort(404, 'Client not found.');
        }
        $name = trim((string) $academy['name']);

        $adopt = DB::table('finance_clients')
            ->whereNull('linked_academy_id')
            ->whereRaw('lower(name) = lower(?)', [$name])
            ->value('id');
        if ($adopt !== null) {
            DB::table('finance_clients')->where('id', $adopt)->update([
                'linked_academy_id' => $academyId,
                'updated_at' => DB::raw('now()'),
            ]);
            $this->ensurePayToken((string) $adopt);

            return (string) $adopt;
        }

        // Names are unique in the book; a second academy called the same gets a suffix.
        $bookName = $name;
        for ($n = 2; DB::table('finance_clients')->whereRaw('lower(name) = lower(?)', [$bookName])->exists(); $n++) {
            $bookName = "{$name} ({$n})";
        }

        $id = (string) DB::table('finance_clients')->insertGetId([
            'id' => DB::raw('uuid_generate_v7()'),
            'name' => $bookName,
            'phone' => $academy['owner']->phone ?? null,
            'email' => $academy['owner']->email ?? null,
            'linked_academy_id' => $academyId,
            'pay_token' => PublicInvoiceToken::forName($name),
        ], 'id');

        return $id;
    }

    /** Every account has a pay link; mint one for an account made before links existed. */
    public function ensurePayToken(string $clientId): string
    {
        $row = DB::table('finance_clients')->where('id', $clientId)->first(['name', 'pay_token']);
        if ($row === null) {
            abort(404, 'Client not found.');
        }
        if ($row->pay_token !== null && $row->pay_token !== '') {
            return (string) $row->pay_token;
        }
        $token = PublicInvoiceToken::forName((string) $row->name);
        DB::table('finance_clients')->where('id', $clientId)->update(['pay_token' => $token, 'updated_at' => DB::raw('now()')]);

        return $token;
    }

    /** The public pay page for an account. */
    public function payUrl(string $token): string
    {
        $base = rtrim((string) (config('app.frontend_url') ?: config('app.url')), '/');

        return "{$base}/a/{$token}";
    }

    // ── The agreement ────────────────────────────────────────────────────────

    /**
     * Set a client's agreement (see the class doc). `$input`:
     *   plan        one of PLANS
     *   currency    ISO code for every line
     *   service     product line of the main line (defaults from the platform client's type)
     *   recurring   {amount_minor, list_amount_minor?, first_due_on, title?} — required for the
     *               four subscription plans and ONE_TIME_SUPPORT, optional for OUTRIGHT
     *   one_time    {title?, installments: [{due_on, amount_minor, note?}]} — required for
     *               ONE_TIME_SUPPORT and OUTRIGHT, optional (a setup fee) for the others
     *   notes       free text on the new lines
     *   activate    end the platform client's trials now (it starts paying)
     *
     * @param  array<string,mixed>  $input
     * @return array{recurring_deal_id:?string, one_time_deal_id:?string}
     */
    public function setAgreement(string $clientId, array $input): array
    {
        $plan = (string) $input['plan'];
        if (! in_array($plan, self::PLANS, true)) {
            throw ValidationException::withMessages(['plan' => 'Unknown agreement.']);
        }
        $client = DB::table('finance_clients')->where('id', $clientId)->first();
        if ($client === null) {
            abort(404, 'Client not found.');
        }

        $recurring = isset($input['recurring']) && is_array($input['recurring']) ? $input['recurring'] : null;
        $oneTime = isset($input['one_time']) && is_array($input['one_time']) && ($input['one_time']['installments'] ?? []) !== []
            ? $input['one_time'] : null;

        if ($recurring === null && (isset(self::RECURRING_PLANS[$plan]) || $plan === 'ONE_TIME_SUPPORT')) {
            throw ValidationException::withMessages(['recurring.amount_minor' => 'Enter what the client pays each cycle.']);
        }
        if ($oneTime === null && in_array($plan, ['ONE_TIME_SUPPORT', 'OUTRIGHT'], true)) {
            throw ValidationException::withMessages(['one_time.installments' => 'Enter what the client pays for the system.']);
        }
        if ($recurring !== null && (int) ($recurring['amount_minor'] ?? 0) <= 0) {
            throw ValidationException::withMessages(['recurring.amount_minor' => 'Enter what the client pays each cycle.']);
        }

        $currency = strtoupper((string) $input['currency']);
        $clientType = $client->linked_academy_id === null
            ? null
            : DB::table('academies')->where('id', $client->linked_academy_id)->value('client_type');
        $service = (string) ($input['service'] ?? self::SERVICE_BY_TYPE[$clientType ?? 'MANAGEMENT'] ?? 'MANAGEMENT_SYSTEM');
        $notes = isset($input['notes']) && trim((string) $input['notes']) !== '' ? trim((string) $input['notes']) : null;

        return DB::transaction(function () use ($clientId, $client, $plan, $recurring, $oneTime, $currency, $service, $notes, $input): array {
            $result = ['recurring_deal_id' => null, 'one_time_deal_id' => null];

            if ($oneTime !== null) {
                $result['one_time_deal_id'] = $this->ledger->createDeal([
                    'client_id' => $clientId,
                    'title' => $this->title($oneTime['title'] ?? null, self::TITLES['PURCHASE']),
                    'service' => $service,
                    'kind' => 'ONE_TIME',
                    'billing_interval' => null,
                    'amount_minor' => 0,
                    'currency' => $currency,
                    'started_on' => (string) min(array_column($oneTime['installments'], 'due_on')),
                    'notes' => $notes,
                ], array_values($oneTime['installments']));
                $this->ledger->settle($result['one_time_deal_id']);
            }

            $current = DB::table('finance_deals')
                ->where('client_id', $clientId)
                ->where('kind', 'SUBSCRIPTION')
                ->where('status', 'ACTIVE')
                ->whereNull('ends_on')
                ->orderBy('started_on')
                ->orderBy('created_at')
                ->first();

            if ($recurring === null) {
                // An outright purchase with no support contract: whatever ran before stops tomorrow.
                if ($current !== null) {
                    $this->endRecurring($current, CarbonImmutable::parse($this->ledger->today())->addDay()->toDateString());
                }
            } else {
                $interval = self::RECURRING_PLANS[$plan] ?? 'YEARLY';
                $lineService = match ($plan) {
                    'ONE_TIME_SUPPORT' => 'HOSTING',
                    'OUTRIGHT' => 'SUPPORT',
                    default => $service,
                };
                $defaultTitle = match ($plan) {
                    'ONE_TIME_SUPPORT' => self::TITLES['HOSTING'],
                    'OUTRIGHT' => self::TITLES['SUPPORT'],
                    default => self::TITLES[$plan],
                };
                $firstDue = (string) $recurring['first_due_on'];
                $amount = (int) $recurring['amount_minor'];
                $list = isset($recurring['list_amount_minor']) && (int) $recurring['list_amount_minor'] > $amount
                    ? (int) $recurring['list_amount_minor'] : null;
                $title = $this->title($recurring['title'] ?? null, $defaultTitle);

                if ($current !== null) {
                    $this->endRecurring($current, $firstDue);
                }

                $result['recurring_deal_id'] = $this->ledger->createDeal([
                    'client_id' => $clientId,
                    'title' => $title,
                    'service' => $lineService,
                    'kind' => 'SUBSCRIPTION',
                    'billing_interval' => $interval,
                    'amount_minor' => $amount,
                    'list_amount_minor' => $list,
                    'currency' => $currency,
                    'started_on' => $firstDue,
                    'notes' => $notes,
                ]);
                $this->ledger->settle($result['recurring_deal_id']);
            }

            DB::table('finance_clients')->where('id', $clientId)->update([
                'plan' => $plan,
                'updated_at' => DB::raw('now()'),
            ]);
            $this->ensurePayToken($clientId);

            if (($input['activate'] ?? false) === true && $client->linked_academy_id !== null) {
                $this->endTrials((string) $client->linked_academy_id);
            }

            return $result;
        });
    }

    /**
     * Stop a recurring line from `$endsOn` on. Cycles not yet paid that start on or after that day
     * are dropped; what came before stays owed. A line that ends up with no cycles and no money
     * (an agreement corrected a minute after it was made) is removed outright.
     */
    private function endRecurring(object $deal, string $endsOn): void
    {
        $id = (string) $deal->id;
        DB::table('finance_deals')->where('id', $id)->update(['ends_on' => $endsOn, 'updated_at' => DB::raw('now()')]);

        // Drop the trailing cycles on/after the end that no money reached. The waterfall pays oldest
        // first, so walking from the newest down and stopping at the first touched cycle is exact.
        foreach (array_reverse($this->ledger->schedule($id)) as $inst) {
            if ($inst->due_on < $endsOn || $inst->paid_minor > 0) {
                break;
            }
            DB::table('finance_installments')->where('id', $inst->id)->delete();
        }

        $hasCycles = DB::table('finance_installments')->where('deal_id', $id)->exists();
        $hasMoney = DB::table('finance_payments')->where('deal_id', $id)->exists();
        if (! $hasCycles && ! $hasMoney) {
            DB::table('finance_deals')->where('id', $id)->delete();

            return;
        }
        $this->ledger->settle($id);
    }

    /** End every running trial of a platform client: it pays from now on. */
    private function endTrials(string $academyId): void
    {
        $this->inAcademy($academyId, function () use ($academyId): void {
            foreach ($this->modules->all($academyId) as $sub) {
                if ($sub->is_trial && $sub->status !== 'ENDED') {
                    $this->modules->activate($academyId, (string) $sub->module);
                }
            }
        });
    }

    private function title(mixed $typed, string $fallback): string
    {
        $value = trim((string) ($typed ?? ''));

        return $value === '' ? $fallback : mb_substr($value, 0, 200);
    }

    // ── One-time import of the old per-module bills ─────────────────────────

    /**
     * Bring a platform client's old billing into the book (run once per academy by
     * `accounts:adopt-billing`; a no-op for an academy that already has an account with deals).
     * Its paid modules become one recurring line at today's module prices and interval; each old
     * bill becomes a cycle on that line and each paid bill a payment, so history, debt and the next
     * renewal all carry over. A payment proof still waiting for review moves to the book's inbox.
     *
     * @return array{status:string, client_id:?string, cycles:int, payments:int, proofs:int}
     */
    public function adoptLegacyBilling(string $academyId): array
    {
        $none = ['status' => 'skipped', 'client_id' => null, 'cycles' => 0, 'payments' => 0, 'proofs' => 0];

        $linked = $this->accountIdFor($academyId);
        if ($linked !== null && DB::table('finance_deals')->where('client_id', $linked)->exists()) {
            return ['status' => 'already', 'client_id' => $linked] + $none;
        }

        $legacy = $this->inAcademy($academyId, fn () => [
            'modules' => DB::table('module_subscriptions')
                ->where('academy_id', $academyId)
                ->where('status', 'ACTIVE')
                ->where('is_trial', false)
                ->where('total_cost_minor', '>', 0)
                ->orderByRaw("case module when 'MANAGEMENT' then 0 when 'LMS' then 1 when 'VIDEO' then 2 else 3 end")
                ->get(),
            'bills' => DB::table('academy_invoices')
                ->where('academy_id', $academyId)
                ->where('status', '<>', 'VOID')
                ->where('total_minor', '>', 0)
                ->orderBy('period_start')
                ->get(),
            'proofs' => DB::table('academy_payment_submissions')
                ->where('academy_id', $academyId)
                ->where('review_status', 'PENDING')
                ->get(),
        ]);

        if ($legacy['modules']->isEmpty() && $legacy['bills']->isEmpty()) {
            return $none;
        }

        return DB::transaction(function () use ($academyId, $legacy): array {
            $clientId = $this->ensureForAcademy($academyId);
            $primary = $legacy['modules']->first();
            $lastBill = $legacy['bills']->last();

            $currency = (string) ($primary->currency ?? $lastBill->currency ?? 'EGP');
            $interval = (string) ($primary->billing_interval ?? 'MONTHLY');
            $interval = in_array($interval, FinanceLedger::INTERVALS, true) ? $interval : 'MONTHLY';
            $amount = (int) $legacy['modules']->where('currency', $currency)->sum('total_cost_minor');
            if ($amount <= 0) {
                $amount = (int) ($lastBill->total_minor ?? 0);
            }

            $firstBill = $legacy['bills']->first();
            $startedOn = $firstBill !== null
                ? CarbonImmutable::parse((string) $firstBill->period_start)->toDateString()
                : CarbonImmutable::parse((string) ($primary->current_period_end ?? $primary->activated_at ?? $this->ledger->today()))->toDateString();

            $clientType = DB::table('academies')->where('id', $academyId)->value('client_type');
            $dealId = (string) DB::table('finance_deals')->insertGetId([
                'id' => DB::raw('uuid_generate_v7()'),
                'client_id' => $clientId,
                'title' => self::TITLES[$interval] ?? self::TITLES['MONTHLY'],
                'service' => self::SERVICE_BY_TYPE[$clientType ?? 'MANAGEMENT'] ?? 'MANAGEMENT_SYSTEM',
                'kind' => 'SUBSCRIPTION',
                'billing_interval' => $interval,
                'amount_minor' => $amount,
                'currency' => $currency,
                'started_on' => $startedOn,
                'notes' => 'Imported from the platform bills.',
            ], 'id');

            $cycles = 0;
            $payments = 0;
            foreach ($legacy['bills']->where('currency', $currency)->values() as $i => $bill) {
                DB::table('finance_installments')->insert([
                    'id' => DB::raw('uuid_generate_v7()'),
                    'deal_id' => $dealId,
                    'seq' => $i + 1,
                    'due_on' => CarbonImmutable::parse((string) $bill->period_start)->toDateString(),
                    'amount_minor' => (int) $bill->total_minor,
                ]);
                $cycles++;

                $paid = $bill->status === 'PAID' ? (int) $bill->total_minor : (int) ($bill->amount_paid_minor ?? 0);
                if ($paid > 0) {
                    DB::table('finance_payments')->insert([
                        'id' => DB::raw('uuid_generate_v7()'),
                        'deal_id' => $dealId,
                        'paid_on' => CarbonImmutable::parse((string) ($bill->paid_at ?? $bill->period_start))->toDateString(),
                        'amount_minor' => min($paid, (int) $bill->total_minor),
                        'method' => $this->method((string) ($bill->payment_method ?? '')),
                        'note' => 'Imported platform bill '.CarbonImmutable::parse((string) $bill->period_start)->toDateString(),
                    ]);
                    $payments++;
                }
            }
            $this->ledger->settle($dealId);

            $proofs = 0;
            foreach ($legacy['proofs'] as $proof) {
                DB::table('finance_payment_submissions')->insert([
                    'id' => DB::raw('uuid_generate_v7()'),
                    'client_id' => $clientId,
                    'method' => (string) $proof->method,
                    'amount_minor' => $proof->amount_minor ?? null,
                    'currency' => $currency,
                    'note' => $proof->note ?? null,
                    'screenshot_path' => (string) $proof->screenshot_path,
                    'status' => 'PENDING',
                    'created_at' => $proof->created_at,
                ]);
                $proofs++;
            }

            DB::table('finance_clients')->where('id', $clientId)->update([
                'plan' => $interval,
                'updated_at' => DB::raw('now()'),
            ]);

            return ['status' => 'adopted', 'client_id' => $clientId, 'cycles' => $cycles, 'payments' => $payments, 'proofs' => $proofs];
        });
    }

    private function method(string $raw): string
    {
        $key = strtoupper(str_replace([' ', '-'], '_', trim($raw)));

        return in_array($key, FinanceLedger::METHODS, true) ? $key : 'OTHER';
    }

    // ── Context ──────────────────────────────────────────────────────────────

    /** Run $fn inside the academy's tenant context, as the Super Admin (the book stays visible). */
    private function inAcademy(string $academyId, callable $fn): mixed
    {
        $ctx = app()->bound(AuthContext::class) ? app(AuthContext::class) : null;

        return Tenancy::withContext(new AuthContext(
            userId: $ctx?->userId ?? '00000000-0000-0000-0000-000000000000',
            academyId: $academyId,
            role: 'SUPER_ADMIN',
            permissions: $ctx?->permissions ?? [],
        ), $fn);
    }
}
