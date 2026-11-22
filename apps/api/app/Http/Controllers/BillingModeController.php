<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Jobs\SendPrepaidBillJob;
use App\Services\PrepaidMonthly;
use App\Support\Audit;
use App\Support\AuthContext;
use App\Support\Entitlement;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Settings → طريقة التحصيل: does the academy bill "after the lessons" (the default) or "monthly, in
 * advance" ({@see PrepaidMonthly})? The owner's choice (settings.manage). A centre keeps its own
 * subscription engine and cannot pick it.
 */
final class BillingModeController extends Controller
{
    public function __construct(private readonly PrepaidMonthly $prepaid) {}

    /** GET /api/academy/billing-mode */
    public function show(): JsonResponse
    {
        Gate::authorize('settings.manage');
        $academyId = $this->academyId();

        return response()->json($this->payload($academyId));
    }

    /** PUT /api/academy/billing-mode */
    public function update(Request $request): JsonResponse
    {
        Gate::authorize('settings.manage');
        $academyId = $this->academyId();

        $data = $request->validate([
            'mode' => ['required', Rule::in([PrepaidMonthly::MODE_AFTER, PrepaidMonthly::MODE_PREPAID])],
            'issue_day' => ['sometimes', 'integer', 'between:1,28'],
            'due_day' => ['sometimes', 'integer', 'between:1,28'],
            'whatsapp' => ['sometimes', 'boolean'],
        ]);

        if ($data['mode'] === PrepaidMonthly::MODE_PREPAID && Entitlement::hasCapability($academyId, 'centre')) {
            throw ValidationException::withMessages(['mode' => [
                'A centre bills by its own subscriptions. / السنتر بيحصّل باشتراكاته الخاصة.',
            ]]);
        }

        $before = PrepaidMonthly::settings($academyId);
        $row = [
            'billing_mode' => $data['mode'],
            'prepaid_issue_day' => (int) ($data['issue_day'] ?? $before['issue_day']),
            'prepaid_due_day' => (int) ($data['due_day'] ?? $before['due_day']),
            'prepaid_whatsapp' => (bool) ($data['whatsapp'] ?? $before['whatsapp']),
            'updated_at' => now(),
        ];

        // Switching ON starts the regime with the NEXT month: this month stays billed after its
        // lessons (its bill closes on the 2nd as always) and next month is the first billed ahead.
        // Switching OFF keeps the dates — the months already billed ahead stay covered by their fees.
        if ($data['mode'] === PrepaidMonthly::MODE_PREPAID && $before['mode'] !== PrepaidMonthly::MODE_PREPAID) {
            $tz = (string) (DB::table('academies')->where('id', $academyId)->value('timezone') ?: 'UTC');
            $next = CarbonImmutable::now($tz)->startOfMonth()->addMonthNoOverflow()->format('Y-m-d');
            $row['prepaid_from'] = $next;
            $row['prepaid_first_fee'] = $next;
        }

        DB::table('academy_settings')->updateOrInsert(['academy_id' => $academyId], $row);

        $ctx = app(AuthContext::class);
        Audit::log('academy.billing_mode_updated', 'academy', $academyId, $academyId, $ctx->userId, $ctx->role,
            after: PrepaidMonthly::settings($academyId), before: $before);

        return response()->json($this->payload($academyId));
    }

    /**
     * GET /api/academy/billing-mode/preview — what the next run bills (or, before the issue day,
     * would bill), written nowhere.
     */
    public function preview(): JsonResponse
    {
        Gate::authorize('settings.manage');
        $academyId = $this->academyId();
        $period = $this->nextPeriod($academyId);
        if ($period === null) {
            return response()->json(['period' => null, 'summary' => null, 'students' => []]);
        }

        $preview = $this->prepaid->preview($academyId, $period);
        $rows = $preview['students'];

        $totals = [];
        $counts = ['billed' => 0, 'already' => 0, 'no_price' => 0, 'no_timetable' => 0, 'deducted_lessons' => 0];
        foreach ($rows as $r) {
            if ($r['already']) {
                $counts['already']++;
            } elseif ($r['skip'] === PrepaidMonthly::SKIP_NO_PRICE) {
                $counts['no_price']++;
            } elseif ($r['skip'] === PrepaidMonthly::SKIP_NO_TIMETABLE) {
                $counts['no_timetable']++;
            } elseif ($r['lines'] !== []) {
                $counts['billed']++;
                $totals[$r['currency']] = ($totals[$r['currency']] ?? 0) + (int) $r['total_minor'];
                $counts['deducted_lessons'] += count(array_filter($r['lines'], fn ($l) => $l['amount_minor'] < 0));
            }
        }

        return response()->json([
            'period' => $period,
            'summary' => [...$counts, 'totals' => collect($totals)->map(fn ($minor, $cur) => ['currency' => $cur, 'total_minor' => $minor])->values()],
            'students' => collect($rows)
                ->filter(fn ($r) => $r['lines'] !== [] || $r['skip'] !== null)
                ->map(fn ($r) => [
                    'student_id' => $r['student_id'],
                    'full_name' => $r['full_name'],
                    'currency' => $r['currency'],
                    'skip' => $r['skip'],
                    'fee_minor' => $r['fee_minor'],
                    'deducted_minor' => $r['deducted_minor'],
                    'charged_minor' => $r['charged_minor'],
                    'deferred' => $r['deferred'],
                    'total_minor' => $r['total_minor'],
                    'lines' => array_map(fn ($l) => ['description' => $l['description'], 'amount_minor' => $l['amount_minor']], $r['lines']),
                ])
                ->values(),
        ]);
    }

    /**
     * POST /api/academy/billing-mode/issue — run now what the daily job runs from the issue day (a
     * retry when the job missed, or the owner who would rather not wait for the morning).
     */
    public function issue(): JsonResponse
    {
        Gate::authorize('settings.manage');
        Gate::authorize('invoice.create');
        $academyId = $this->academyId();

        $period = $this->prepaid->periodDue($academyId);
        if ($period === null) {
            throw ValidationException::withMessages(['period' => [
                'Bills go out from the issue day. / الفواتير بتطلع من يوم الإصدار.',
            ]]);
        }

        $ctx = app(AuthContext::class);
        $result = $this->prepaid->issue($academyId, $period, $ctx->userId, $ctx->role);
        SendPrepaidBillJob::queueFor($academyId, $period, $result['invoices']);

        return response()->json($result);
    }

    /** @return array<string, mixed> */
    private function payload(string $academyId): array
    {
        $s = PrepaidMonthly::settings($academyId);

        return [
            'settings' => $s,
            'available' => ! Entitlement::hasCapability($academyId, 'centre'),
            'next_period' => $this->nextPeriod($academyId),
            'issue_open' => $this->prepaid->periodDue($academyId) !== null,
        ];
    }

    /** The month the next run bills: next month, once the regime has started billing. */
    private function nextPeriod(string $academyId): ?string
    {
        $s = PrepaidMonthly::settings($academyId);
        if ($s['mode'] !== PrepaidMonthly::MODE_PREPAID || $s['first_fee'] === null) {
            return null;
        }
        $tz = (string) (DB::table('academies')->where('id', $academyId)->value('timezone') ?: 'UTC');
        $next = CarbonImmutable::now($tz)->startOfMonth()->addMonthNoOverflow()->format('Y-m-d');

        return max($next, $s['first_fee']);
    }

    private function academyId(): string
    {
        $academyId = app(AuthContext::class)->academyId;
        if ($academyId === null) {
            abort(403, 'Enter an academy to manage its settings.');
        }

        return $academyId;
    }
}
