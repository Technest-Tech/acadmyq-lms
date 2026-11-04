<?php

declare(strict_types=1);

namespace App\Http\Controllers\Centre;

use App\Http\Controllers\Controller;
use App\Services\CentreSubscriptionRows;
use App\Services\CentreSubscriptions;
use App\Services\SubscriptionSettlement;
use App\Services\Whatsapp\SubscriptionReminderMessage;
use App\Support\AuthContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

/**
 * /subscriptions* — the centre's private subscriptions (docs/centre-profile/01-PRIVATE-SUBSCRIPTION-SPLIT.md,
 * "API contract"). Behind `entitled:centre`; permissions are the package ones (package.read /
 * package.manage), renamed in the catalogue copy only.
 */
final class CentreSubscriptionController extends Controller
{
    public function __construct(private readonly CentreSubscriptions $subscriptions, private readonly CentreSubscriptionRows $rows, private readonly SubscriptionSettlement $settlement) {}

    /** GET /subscriptions?view=open|due|finished|outside&student_id=&teacher_id=&q=&page=&per_page= */
    public function index(Request $request): JsonResponse
    {
        Gate::authorize('package.read');
        $f = $request->validate([
            'view' => ['sometimes', 'nullable', Rule::in(CentreSubscriptionRows::VIEWS)],
            'student_id' => ['sometimes', 'nullable', 'uuid'],
            'teacher_id' => ['sometimes', 'nullable', 'uuid'],
            'q' => ['sometimes', 'nullable', 'string', 'max:120'],
            'page' => ['sometimes', 'integer', 'min:1'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:200'],
        ]);

        return response()->json($this->rows->listing($f));
    }

    /** GET /subscriptions/summary */
    public function summary(): JsonResponse
    {
        Gate::authorize('package.read');

        return response()->json($this->rows->summary());
    }

    /** GET /subscriptions/students?q= */
    public function students(Request $request): JsonResponse
    {
        Gate::authorize('package.read');

        return response()->json(['rows' => $this->rows->studentPicks($request->query('q'))]);
    }

    /** POST /subscriptions — SellInput */
    public function store(Request $request): JsonResponse
    {
        Gate::authorize('package.manage');
        $data = $request->validate(['student_id' => ['required', 'uuid']] + self::sellRules());
        $ctx = app(AuthContext::class);

        $sold = $this->subscriptions->sell($data, $ctx->userId, $ctx->role);

        return response()->json([
            'subscription' => $this->rows->one($sold['subscription_id']),
            'invoice_id' => $sold['invoice_id'],
            'due_minor' => $sold['due_minor'],
            'warnings' => $sold['warnings'],
            'lessons_taken' => $sold['lessons_taken'],
        ], 201);
    }

    /** GET /subscriptions/{id} */
    public function show(string $id): JsonResponse
    {
        Gate::authorize('package.read');
        $row = $this->rows->one($id);
        if ($row === null) {
            abort(404, 'Subscription not found.');
        }

        return response()->json(['subscription' => $row, 'lessons' => $this->rows->lessons($id)]);
    }

    /** PATCH /subscriptions/{id} — EditInput */
    public function update(Request $request, string $id): JsonResponse
    {
        Gate::authorize('package.manage');
        $changes = $request->validate([
            'label' => ['sometimes', 'nullable', 'string', 'max:255'],
            'teacher_id' => ['sometimes', 'nullable', 'uuid'],
            'course' => ['sometimes', 'nullable', 'string', 'max:80'],
            'new_subject' => ['sometimes', 'boolean'],
            'lessons_sold' => ['sometimes', 'integer', 'min:1', 'max:1000'],
            'lesson_minutes' => ['sometimes', 'nullable', 'integer', 'min:5', 'max:600'],
            'lesson_price_minor' => ['sometimes', 'integer', 'min:0'],
            'price_minor' => ['sometimes', 'nullable', 'integer', 'min:0'],
            'starts_on' => ['sometimes', 'date_format:Y-m-d'],
        ]);
        $ctx = app(AuthContext::class);

        $edited = $this->subscriptions->edit($id, $changes, $ctx->userId, $ctx->role);

        return response()->json(['subscription' => $this->rows->one($id)] + $edited);
    }

    /** GET /subscriptions/{id}/settlement — SettlementPreview */
    public function settlement(string $id): JsonResponse
    {
        Gate::authorize('package.read');
        Gate::authorize('invoice.read');
        $sub = DB::table('centre_subscriptions')->where('id', $id)->first();
        if ($sub === null) {
            abort(404, 'Subscription not found.');
        }
        $preview = $this->settlement->preview($sub);

        return response()->json(($preview ?? ['paid_minor' => 0, 'used_value_minor' => 0, 'owed_back_minor' => 0, 'currency' => (string) $sub->currency, 'can_refund' => false, 'settlement' => $sub->settlement]) + [
            'settled' => in_array($sub->settlement, SubscriptionSettlement::MODES, true) ? [
                'mode' => (string) $sub->settlement, 'amount_minor' => (int) $sub->settled_minor, 'note' => $sub->settle_note,
                'on' => $sub->settled_at !== null ? substr((string) $sub->settled_at, 0, 10) : null,
                'expense_number' => $sub->settle_expense_id !== null ? DB::table('expenses')->where('id', $sub->settle_expense_id)->value('number') : null,
            ] : null,
            'accounts' => Gate::allows('expense.manage') ? DB::table('cash_accounts')->where('is_active', true)->where('currency', $sub->currency)->orderBy('sort_order')->get(['id', 'name', 'kind'])
                ->map(fn ($a) => ['id' => (string) $a->id, 'name' => (string) $a->name, 'kind' => (string) $a->kind])->all() : [],
            'can_settle' => Gate::allows('package.manage') && Gate::allows('invoice.mark_paid'),
        ]);
    }

    /** POST /subscriptions/{id}/close { reason, settlement?, refund? } */
    public function close(Request $request, string $id): JsonResponse
    {
        Gate::authorize('package.manage');
        $data = $request->validate(['reason' => ['required', 'string', 'max:500']] + self::settlementRules());
        $this->authorizeSettlement($data['settlement'] ?? null);
        $ctx = app(AuthContext::class);

        $closed = $this->subscriptions->close($id, (string) $data['reason'], $data['settlement'] ?? null, $data['refund'] ?? null, $ctx->userId, $ctx->role);

        return response()->json(['subscription' => $this->rows->one($id), 'settlement' => $closed['settlement']]);
    }

    /** POST /subscriptions/{id}/settle { settlement, refund? } — a block closed PENDING, decided later. */
    public function settle(Request $request, string $id): JsonResponse
    {
        Gate::authorize('package.manage');
        $data = $request->validate(['settlement' => ['required', Rule::in(SubscriptionSettlement::MODES)]] + self::settlementRules());
        $this->authorizeSettlement($data['settlement']);
        $ctx = app(AuthContext::class);

        $settled = $this->settlement->settle($id, (string) $data['settlement'], $data['refund'] ?? null, $ctx->userId, $ctx->role);

        return response()->json(['subscription' => $this->rows->one($id), 'settlement' => $settled]);
    }

    /** POST /subscriptions/{id}/cancel { note? } → 204 */
    public function cancel(Request $request, string $id): JsonResponse
    {
        Gate::authorize('package.manage');
        $data = $request->validate(['note' => ['sometimes', 'nullable', 'string', 'max:500']]);
        $ctx = app(AuthContext::class);

        $this->subscriptions->cancel($id, $data['note'] ?? null, $ctx->userId, $ctx->role);

        return response()->json(null, 204);
    }

    /** POST /subscriptions/{id}/remind { kind: PAYMENT|FINISHED, locale? } */
    public function remind(Request $request, string $id): JsonResponse
    {
        Gate::authorize('package.read');
        Gate::authorize('invoice.send_link');
        $data = $request->validate([
            'kind' => ['required', Rule::in([SubscriptionReminderMessage::PAYMENT, SubscriptionReminderMessage::FINISHED])],
            'locale' => ['sometimes', 'nullable', Rule::in(['ar', 'en'])],
        ]);
        $ctx = app(AuthContext::class);

        return response()->json($this->subscriptions->remind($id, (string) $data['kind'], (string) ($data['locale'] ?? 'ar'), $ctx->userId, $ctx->role));
    }

    /** The SellInput fields (without student_id) — shared with POST /students. @return array<string, list<mixed>> */
    public static function sellRules(string $prefix = ''): array
    {
        return [
            "{$prefix}teacher_id" => ['sometimes', 'nullable', 'uuid'],
            "{$prefix}course" => ['sometimes', 'nullable', 'string', 'max:80'],
            "{$prefix}new_subject" => ['sometimes', 'boolean'],
            "{$prefix}label" => ['sometimes', 'nullable', 'string', 'max:255'],
            "{$prefix}lessons_sold" => ['required', 'integer', 'min:1', 'max:1000'],
            "{$prefix}lesson_minutes" => ['sometimes', 'nullable', 'integer', 'min:5', 'max:600'],
            "{$prefix}lesson_price_minor" => ['required', 'integer', 'min:0'],
            "{$prefix}price_minor" => ['sometimes', 'nullable', 'integer', 'min:0'],
            "{$prefix}currency" => ['sometimes', 'nullable', 'string', 'size:3'],
            "{$prefix}starts_on" => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            "{$prefix}override_pay_first" => ['sometimes', 'boolean'],
        ];
    }

    /** @return array<string, list<mixed>> */
    private static function settlementRules(): array
    {
        return [
            'settlement' => ['sometimes', 'nullable', Rule::in(SubscriptionSettlement::MODES)],
            'refund' => ['sometimes', 'nullable', 'array'],
            'refund.method' => ['sometimes', 'nullable', 'string', 'max:32'],
            'refund.cash_account_id' => ['sometimes', 'nullable', 'uuid'],
            'refund.reference' => ['sometimes', 'nullable', 'string', 'max:120'],
            'refund.note' => ['sometimes', 'nullable', 'string', 'max:500'],
        ];
    }

    private function authorizeSettlement(?string $mode): void
    {
        if ($mode === null) {
            return;
        }
        Gate::authorize('invoice.mark_paid');
        if ($mode === 'REFUND') {
            Gate::authorize('expense.manage');
        }
    }
}
