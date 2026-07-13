<?php

declare(strict_types=1);

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Services\AcademyBilling;
use App\Services\ModuleBilling;
use App\Services\Whatsapp\WhatsAppSender;
use App\Support\Audit;
use App\Support\AuthContext;
use App\Support\Tenancy;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Super Admin management of an academy's SaaS subscription (Platform↔Academy billing): the
 * trial window, activation/period, and the snapshot total cost. Gated by the Super-Admin-only
 * `academy_billing.manage` capability; every write runs in the target academy's context (so the
 * tenant `with check` admits it) and is audited.
 *
 * `mySummary` is the one owner-facing endpoint — the academy owner reads their OWN subscription
 * for the dashboard (no special capability; tenant.context scopes the read to their academy).
 */
final class AcademySubscriptionController extends Controller
{
    public function __construct(
        private readonly AcademyBilling $billing,
        private readonly ModuleBilling $modules,
        private readonly WhatsAppSender $sender,
    ) {}

    /**
     * GET /admin/subscriptions — cross-academy subscription overview + the global pending
     * payment-proof review queue (one audited SECURITY DEFINER read, like the billing overview).
     */
    public function overview(): JsonResponse
    {
        Gate::authorize('academy_billing.manage');

        $data = json_decode(DB::selectOne('select app.admin_subscription_overview() as o')->o, true);

        return response()->json($data);
    }

    /** GET /admin/academies/{id}/subscription — the subscription + its plan/add-on cost breakdown. */
    public function show(string $id): JsonResponse
    {
        Gate::authorize('academy_billing.manage');
        $this->assertAcademyExists($id);

        $payload = $this->inAcademyContext($id, function () use ($id) {
            $sub = $this->billing->ensureSubscription($id);
            $plan = ($sub->plan_id ?? null) !== null
                ? DB::table('plans')->where('id', $sub->plan_id)->first(['code', 'name', 'price_minor', 'currency'])
                : null;
            $addOns = DB::table('academy_addons as aa')
                ->join('add_ons as ao', 'ao.id', '=', 'aa.add_on_id')
                ->where('aa.academy_id', $id)
                ->where('aa.is_active', true)
                ->orderBy('ao.name')
                ->get(['ao.code', 'ao.name', 'ao.price_minor', 'ao.currency']);

            return ['subscription' => $sub, 'plan' => $plan, 'addOns' => $addOns];
        });

        return response()->json($payload);
    }

    /** PUT /admin/academies/{id}/subscription — adjust interval / period / activation dates. */
    public function update(Request $request, string $id): JsonResponse
    {
        Gate::authorize('academy_billing.manage');
        $this->assertAcademyExists($id);

        $data = $request->validate([
            'billing_interval' => ['sometimes', Rule::in(['MONTHLY', 'YEARLY'])],
            'activated_at' => ['sometimes', 'nullable', 'date'],
            'current_period_start' => ['sometimes', 'nullable', 'date'],
            'current_period_end' => ['sometimes', 'nullable', 'date'],
        ]);
        $ctx = app(AuthContext::class);

        $sub = $this->inAcademyContext($id, function () use ($id, $data, $ctx) {
            $fields = array_intersect_key($data, array_flip([
                'billing_interval', 'activated_at', 'current_period_start', 'current_period_end',
            ]));

            // R1: the write goes to the PRIMARY module sub; the legacy row is its mirror (returned
            // here so the existing panel keeps its response shape until R2 rewires it).
            if ($fields !== []) {
                $moduleSub = $this->modules->setFields($id, $this->modules->primaryModule($id), $fields);
                Audit::log('academy_subscription.updated', 'academy_subscription', $moduleSub->id, $id, $ctx->userId, 'SUPER_ADMIN', after: $fields);
            }

            return $this->billing->currentSubscription($id) ?? $this->billing->ensureSubscription($id);
        });

        return response()->json(['subscription' => $sub]);
    }

    /** POST /admin/academies/{id}/subscription/trial/extend — extend the trial by N days. */
    public function extendTrial(Request $request, string $id): JsonResponse
    {
        Gate::authorize('academy_billing.manage');
        $this->assertAcademyExists($id);

        $data = $request->validate(['days' => ['required', 'integer', 'min:1', 'max:365']]);
        $ctx = app(AuthContext::class);

        $sub = $this->inAcademyContext($id, function () use ($id, $data, $ctx) {
            $before = $this->billing->currentSubscription($id);

            // R1: the trial clock lives on the PRIMARY module sub; the legacy row mirrors it.
            $moduleSub = $this->modules->extendTrial($id, $this->modules->primaryModule($id), (int) $data['days']);

            Audit::log('academy_subscription.trial_extended', 'academy_subscription', $moduleSub->id, $id, $ctx->userId, 'SUPER_ADMIN',
                after: ['trial_end' => $moduleSub->trial_end, 'days' => (int) $data['days']],
                before: ['trial_end' => $before->trial_end ?? null]);

            return $this->billing->currentSubscription($id);
        });

        return response()->json(['subscription' => $sub]);
    }

    /** POST /admin/academies/{id}/subscription/activate — convert a trial to a paid subscription. */
    public function activate(string $id): JsonResponse
    {
        Gate::authorize('academy_billing.manage');
        $this->assertAcademyExists($id);

        $ctx = app(AuthContext::class);

        $sub = $this->inAcademyContext($id, function () use ($id, $ctx) {
            // R1: activation happens on the PRIMARY module sub; the legacy row mirrors it.
            $moduleSub = $this->modules->activate($id, $this->modules->primaryModule($id));
            Audit::log('academy_subscription.activated', 'academy_subscription', $moduleSub->id, $id, $ctx->userId, 'SUPER_ADMIN',
                after: ['activated_at' => $moduleSub->activated_at, 'current_period_end' => $moduleSub->current_period_end]);

            return $this->billing->currentSubscription($id);
        });

        return response()->json(['subscription' => $sub]);
    }

    /** GET /my-subscription — the caller's OWN academy subscription (owner dashboard widget). */
    public function mySummary(): JsonResponse
    {
        $ctx = app(AuthContext::class);
        if ($ctx->academyId === null) {
            return response()->json(['subscription' => null]);
        }

        $sub = $this->billing->ensureSubscription($ctx->academyId);

        return response()->json(['subscription' => $sub]);
    }

    // ── Academy bills (Platform → Academy invoices) ──────────────────────────

    /** GET /admin/academies/{id}/bills — the academy's platform bills, newest first. */
    public function bills(string $id): JsonResponse
    {
        Gate::authorize('academy_billing.manage');
        $this->assertAcademyExists($id);

        $bills = $this->inAcademyContext($id, fn () => DB::table('academy_invoices')
            ->where('academy_id', $id)
            ->orderByDesc('issued_at')
            ->get());

        return response()->json(['bills' => $bills]);
    }

    /** POST /admin/academies/{id}/bills/generate — issue the current period's bill (idempotent). */
    public function generateBill(string $id): JsonResponse
    {
        Gate::authorize('academy_billing.manage');
        $this->assertAcademyExists($id);
        $ctx = app(AuthContext::class);

        $billId = $this->inAcademyContext($id, function () use ($id, $ctx) {
            $billId = $this->billing->generateCurrentBill($id);
            if ($billId !== null) {
                Audit::log('academy_invoice.generated', 'academy_invoice', $billId, $id, $ctx->userId, 'SUPER_ADMIN', after: ['trigger' => 'manual']);
            }

            return $billId;
        });

        if ($billId === null) {
            abort(422, 'A trial subscription cannot be billed. Activate it first.');
        }

        return response()->json(['billId' => $billId]);
    }

    /** POST /admin/academies/{id}/bills/{billId}/mark-paid — record an offline payment. */
    public function markBillPaid(Request $request, string $id, string $billId): JsonResponse
    {
        Gate::authorize('academy_billing.manage');
        $data = $request->validate([
            'method' => ['required', 'string', 'max:50'],
            'reason' => ['nullable', 'string', 'max:1000'],
        ]);
        $ctx = app(AuthContext::class);

        $this->inAcademyContext($id, function () use ($id, $billId, $data, $ctx) {
            $this->assertBillBelongs($id, $billId);
            $this->billing->markBillPaid($billId, $data['method'], $data['reason'] ?? null);
            Audit::log('academy_invoice.marked_paid', 'academy_invoice', $billId, $id, $ctx->userId, 'SUPER_ADMIN',
                after: ['method' => $data['method'], 'reason' => $data['reason'] ?? null]);
        });

        return response()->json(['ok' => true]);
    }

    /** POST /admin/academies/{id}/bills/{billId}/status — set OPEN / OVERDUE / VOID / PAID. */
    public function setBillStatus(Request $request, string $id, string $billId): JsonResponse
    {
        Gate::authorize('academy_billing.manage');
        $data = $request->validate([
            'status' => ['required', Rule::in(['OPEN', 'OVERDUE', 'VOID', 'PAID'])],
        ]);
        $ctx = app(AuthContext::class);

        $this->inAcademyContext($id, function () use ($id, $billId, $data, $ctx) {
            $this->assertBillBelongs($id, $billId);
            $this->billing->setBillStatus($billId, $data['status']);
            Audit::log('academy_invoice.status_changed', 'academy_invoice', $billId, $id, $ctx->userId, 'SUPER_ADMIN',
                after: ['status' => $data['status']]);
        });

        return response()->json(['ok' => true]);
    }

    /**
     * POST /admin/academies/{id}/bills/{billId}/send — send the bill to the academy owner over
     * WhatsApp (via the seam: Wasender when a token is configured, otherwise a wa.me deep link).
     */
    public function sendBill(string $id, string $billId): JsonResponse
    {
        Gate::authorize('academy_billing.manage');
        $ctx = app(AuthContext::class);

        $result = $this->inAcademyContext($id, function () use ($id, $billId, $ctx) {
            $bill = $this->assertBillBelongs($id, $billId);
            $academyName = (string) DB::table('academies')->where('id', $id)->value('name');
            $phone = $this->billing->ownerPhone($id) ?? '';

            $frontendUrl = config('app.frontend_url') ?: config('app.url');
            $url = rtrim((string) $frontendUrl, '/').'/a/'.$bill->public_token;
            $period = sprintf('%s → %s', $bill->period_start, $bill->period_end);

            $message = implode("\n\n", [
                "مرحباً {$academyName}، فاتورة اشتراككم للفترة {$period} جاهزة. يمكنكم الدفع عبر الرابط: {$url}",
                "Hello {$academyName}, your subscription invoice for {$period} is ready. Pay via: {$url}",
            ]);

            $send = $this->sender->sendOrLink($id, $phone, $message, [
                'automation_type' => 'MANUAL',
                'recipient_kind' => 'ACADEMY_OWNER',
                'ref_type' => 'academy_invoice',
                'ref_id' => $billId,
            ]);

            DB::table('academy_invoices')->where('id', $billId)->update([
                'sent_at' => now(),
                'sent_channel' => 'WHATSAPP',
                'updated_at' => now(),
            ]);

            Audit::log('academy_invoice.sent', 'academy_invoice', $billId, $id, $ctx->userId, 'SUPER_ADMIN',
                after: ['transport' => $send['transport'], 'phone' => $phone]);

            return ['send' => $send, 'url' => $url, 'message' => $message, 'phone' => $phone];
        });

        return response()->json([
            'phone' => $result['phone'],
            'message' => $result['message'],
            'url' => $result['url'],
            'transport' => $result['send']['transport'],
            'sent' => $result['send']['sent'],
            'deeplink' => $result['send']['deeplink'],
        ]);
    }

    // ── Payment proof submissions (public uploads → Super Admin review) ──────

    /** GET /admin/academies/{id}/bills/{billId}/submissions — payment proofs for a bill. */
    public function billSubmissions(string $id, string $billId): JsonResponse
    {
        Gate::authorize('academy_billing.manage');

        $subs = $this->inAcademyContext($id, fn () => DB::table('academy_payment_submissions')
            ->where('academy_id', $id)
            ->where('academy_invoice_id', $billId)
            ->orderByDesc('created_at')
            ->get(['id', 'method', 'amount_minor', 'note', 'review_status', 'reviewed_at', 'created_at']));

        return response()->json(['submissions' => $subs]);
    }

    /** GET /admin/academies/{id}/payment-submissions/{subId}/screenshot — stream the private file. */
    public function screenshot(string $id, string $subId): StreamedResponse|JsonResponse
    {
        Gate::authorize('academy_billing.manage');

        $path = $this->inAcademyContext($id, fn () => DB::table('academy_payment_submissions')
            ->where('id', $subId)->where('academy_id', $id)->value('screenshot_path'));

        if ($path === null || ! Storage::disk('local')->exists($path)) {
            abort(404, 'Screenshot not found.');
        }

        return Storage::disk('local')->response($path);
    }

    /** POST /admin/academies/{id}/payment-submissions/{subId}/review — approve (→ paid) or reject. */
    public function reviewSubmission(Request $request, string $id, string $subId): JsonResponse
    {
        Gate::authorize('academy_billing.manage');
        $data = $request->validate(['decision' => ['required', Rule::in(['approve', 'reject'])]]);
        $ctx = app(AuthContext::class);

        $this->inAcademyContext($id, function () use ($id, $subId, $data, $ctx) {
            $sub = DB::table('academy_payment_submissions')
                ->where('id', $subId)->where('academy_id', $id)->first();
            if ($sub === null) {
                abort(404, 'Submission not found.');
            }

            $status = $data['decision'] === 'approve' ? 'APPROVED' : 'REJECTED';
            DB::table('academy_payment_submissions')->where('id', $subId)->update([
                'review_status' => $status,
                'reviewed_by' => $ctx->userId,
                'reviewed_at' => now(),
                'updated_at' => now(),
            ]);

            // Approving a proof settles the bill with the submitted method.
            if ($status === 'APPROVED') {
                $this->billing->markBillPaid((string) $sub->academy_invoice_id, (string) $sub->method, 'Payment proof approved');
            }

            Audit::log('academy_payment.reviewed', 'academy_payment_submission', $subId, $id, $ctx->userId, 'SUPER_ADMIN',
                after: ['decision' => $status]);
        });

        return response()->json(['ok' => true]);
    }

    // ── internals ────────────────────────────────────────────────────────────

    /** Ensure the bill exists and belongs to the academy (within its context); returns the row. */
    private function assertBillBelongs(string $academyId, string $billId): object
    {
        $bill = DB::table('academy_invoices')->where('id', $billId)->where('academy_id', $academyId)->first();
        if ($bill === null) {
            abort(404, 'Bill not found.');
        }

        return $bill;
    }

    private function assertAcademyExists(string $id): void
    {
        if (DB::table('academies')->where('id', $id)->doesntExist()) {
            abort(404, 'Academy not found.');
        }
    }

    /**
     * Run $fn inside the target academy's tenant context as Super Admin (the audited cross-tenant
     * path) so RLS `with check` admits the writes. Mirrors AcademyController::inAcademyContext.
     *
     * @template T
     *
     * @param  callable():T  $fn
     * @return T
     */
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
