<?php

declare(strict_types=1);

namespace App\Http\Controllers\Lms;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Lms\Concerns\InteractsWithLms;
use App\Support\Audit;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

/**
 * Where the client's money lands (docs/lms/10 §2 / brief §6). One row per method the client accepts —
 * their InstaPay handle, their Vodafone Cash number, their bank account — plus the payment
 * instructions the checkout screen shows above the upload box.
 *
 * `payment_method.manage` is its own capability, separate from `course_order.manage`: reviewing a
 * receipt and *changing the account the money goes to* are very different levels of trust.
 *
 * Currency lives on `academies.default_currency`, not here — a client sells in one currency
 * (docs/lms/01), and the same screen edits it so the client never has to hunt for it. That write
 * needs `payment_settings.manage`, the capability that already guards the academy's money settings.
 */
final class PaymentMethodController extends Controller
{
    use InteractsWithLms;

    private const TYPES = ['INSTAPAY', 'VODAFONE_CASH', 'BANK_TRANSFER', 'OTHER'];

    /** GET /api/courses/payment-methods — every configured method (active or not) + the currency. */
    public function index(): JsonResponse
    {
        Gate::authorize('course_order.read');

        $rows = DB::table('lms_payment_methods')
            ->orderBy('position')
            ->orderBy('type')
            ->get()
            ->keyBy(fn (object $m): string => (string) $m->type);

        // Always return all four slots, configured or not: the editor is a fixed list of the methods
        // we support, not a "add a method" wizard — the client should see InstaPay sitting there
        // switched off rather than have to discover it exists.
        $methods = [];
        foreach (self::TYPES as $i => $type) {
            $row = $rows->get($type);
            $methods[] = [
                'id' => $row === null ? null : (string) $row->id,
                'type' => $type,
                'label' => $row->label ?? null,
                'account_name' => $row->account_name ?? null,
                'account_number' => $row->account_number ?? null,
                'bank_name' => $row->bank_name ?? null,
                'instructions' => $row->instructions ?? null,
                'is_active' => (bool) ($row->is_active ?? false),
                'position' => (int) ($row->position ?? $i),
            ];
        }

        return response()->json([
            'methods' => $methods,
            'currency' => $this->academyCurrency(),
            'active_count' => count(array_filter($methods, fn (array $m): bool => $m['is_active'])),
        ]);
    }

    /**
     * PUT /api/courses/payment-methods — save the whole set in one write.
     *
     * A form that edits four fixed slots is saved as four fixed slots: one round trip, no partial
     * state where the client switched InstaPay on and the save of the number failed separately.
     */
    public function update(Request $request): JsonResponse
    {
        Gate::authorize('payment_method.manage');
        $academyId = $this->currentAcademyId();

        $data = $request->validate([
            'methods' => ['required', 'array', 'max:8'],
            'methods.*.type' => ['required', Rule::in(self::TYPES)],
            'methods.*.label' => ['sometimes', 'nullable', 'string', 'max:120'],
            'methods.*.account_name' => ['sometimes', 'nullable', 'string', 'max:160'],
            'methods.*.account_number' => ['sometimes', 'nullable', 'string', 'max:160'],
            'methods.*.bank_name' => ['sometimes', 'nullable', 'string', 'max:160'],
            'methods.*.instructions' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'methods.*.is_active' => ['sometimes', 'boolean'],
            'methods.*.position' => ['sometimes', 'integer', 'min:0', 'max:99'],
        ]);

        $before = DB::table('lms_payment_methods')->where('is_active', true)->pluck('type')->all();

        DB::transaction(function () use ($data, $academyId): void {
            foreach ($data['methods'] as $i => $m) {
                $active = (bool) ($m['is_active'] ?? false);
                $number = trim((string) ($m['account_number'] ?? ''));

                // An active method with nowhere to send the money is a dead end on the checkout
                // screen, so it simply cannot be switched on. OTHER is exempt: it may be pure prose
                // ("pay at the office"), which is a legitimate instruction with no account number.
                if ($active && $number === '' && $m['type'] !== 'OTHER') {
                    abort(422, 'Add the account number before switching this method on.');
                }

                $payload = [
                    'label' => $this->nullable($m['label'] ?? null),
                    'account_name' => $this->nullable($m['account_name'] ?? null),
                    'account_number' => $number === '' ? null : $number,
                    'bank_name' => $this->nullable($m['bank_name'] ?? null),
                    'instructions' => $this->nullable($m['instructions'] ?? null),
                    'is_active' => $active,
                    'position' => (int) ($m['position'] ?? $i),
                    'updated_at' => now(),
                ];

                $existing = DB::table('lms_payment_methods')
                    ->where('type', $m['type'])
                    ->first(['id']);

                if ($existing !== null) {
                    DB::table('lms_payment_methods')->where('id', $existing->id)->update($payload);

                    continue;
                }

                DB::table('lms_payment_methods')->insert($payload + [
                    'id' => (string) Str::uuid(),
                    'academy_id' => $academyId,
                    'type' => $m['type'],
                    'created_at' => now(),
                ]);
            }
        });

        $after = DB::table('lms_payment_methods')->where('is_active', true)->pluck('type')->all();

        Audit::log('lms_payment_method.update', 'lms_payment_method', null, $academyId,
            $this->ctx()->userId, $this->ctx()->role,
            after: ['active' => $after], before: ['active' => $before]);

        return $this->index();
    }

    /** PUT /api/courses/payment-currency — the currency the client sells in. */
    public function setCurrency(Request $request): JsonResponse
    {
        Gate::authorize('payment_settings.manage');
        $academyId = $this->currentAcademyId();

        $data = $request->validate([
            'currency' => ['required', 'string', 'size:3', 'regex:/^[A-Za-z]{3}$/'],
        ]);
        $currency = strtoupper($data['currency']);
        $before = $this->academyCurrency();

        if ($currency === $before) {
            return response()->json(['ok' => true, 'currency' => $currency]);
        }

        // Course prices are stored bare (minor units, no currency of their own — docs/lms/01), so
        // switching the currency RE-DENOMINATES every existing price rather than converting it. That
        // is a decision the client has to make knowingly, so it is refused once a sale exists.
        if (DB::table('course_orders')->whereIn('status', ['PAID', 'REFUNDED'])->exists()) {
            abort(422, 'This academy has already sold courses in '.$before.'. Contact support to change the currency.');
        }

        DB::table('academies')->where('id', $academyId)->update([
            'default_currency' => $currency,
            'updated_at' => now(),
        ]);

        Audit::log('academy.currency_changed', 'academy', $academyId, $academyId,
            $this->ctx()->userId, $this->ctx()->role,
            after: ['default_currency' => $currency], before: ['default_currency' => $before]);

        return response()->json(['ok' => true, 'currency' => $currency]);
    }

    private function nullable(mixed $value): ?string
    {
        $value = trim((string) ($value ?? ''));

        return $value === '' ? null : $value;
    }
}
