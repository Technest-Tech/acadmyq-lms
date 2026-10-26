<?php

declare(strict_types=1);

namespace App\Http\Controllers\People;

use App\Http\Controllers\Controller;
use App\Support\AcademyUrl;
use App\Support\Audit;
use App\Support\AuthContext;
use App\Support\PackagePurpose;
use App\Support\Tenancy;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;

/**
 * One payment link per family (`/f/{token}`). When two children or more owe on their packages, the
 * parent gets ONE page — every child's bill, what it is for, the total, and how to pay it in one
 * transfer — instead of a link per child. The bills are not merged: each package keeps its own
 * invoice, so a package is still marked paid the moment its own money is in (a card pays each bill
 * through its own `/i/` link, which the page links to).
 *
 * The link is the credential (like `/i/` and `/p/`): 48 random base62 chars, one per guardian, made
 * the first time staff send it and reused after that, so a family always has the same link and it
 * always shows what is owed NOW. Resolved through app.family_pay_lookup, then read under RLS as
 * that academy with a sentinel GUARDIAN role.
 */
final class FamilyPayController extends Controller
{
    private const TOKEN_LENGTH = 48;

    private const UNPAID = ['OPEN', 'CLOSED', 'PARTIALLY_PAID'];

    /** POST /api/packages/family/{guardianId}/pay-link — the family's link, made if it has none. */
    public function issue(string $guardianId): JsonResponse
    {
        Gate::authorize('package.read');
        Gate::authorize('invoice.send_link');

        $guardian = DB::table('guardians')->where('id', $guardianId)->first(['id', 'pay_token']);
        if ($guardian === null) {
            abort(404, 'Guardian not found.');
        }

        $token = $guardian->pay_token;
        if ($token === null) {
            $token = Str::random(self::TOKEN_LENGTH);
            DB::table('guardians')->where('id', $guardianId)->update([
                'pay_token' => $token,
                'pay_issued_at' => now()->toIso8601String(),
                'updated_at' => now()->toIso8601String(),
            ]);
            $ctx = app(AuthContext::class);
            Audit::log('guardian.pay_link_issued', 'guardian', $guardianId, $ctx->academyId, $ctx->userId, $ctx->role);
        }

        return response()->json([
            'url' => AcademyUrl::origin((string) app(AuthContext::class)->academyId).'/f/'.$token,
        ]);
    }

    /**
     * GET /api/f/{token} — the family's page. Every miss (unknown token, deleted family, suspended
     * academy) is the same 404.
     */
    public function publicShow(string $token): JsonResponse
    {
        $row = DB::selectOne('select guardian_id, academy_id from app.family_pay_lookup(?)', [$token]);
        if ($row === null) {
            abort(404, 'Page not found.');
        }

        $ctx = new AuthContext(userId: '', academyId: (string) $row->academy_id, role: 'GUARDIAN', permissions: []);
        app()->instance(AuthContext::class, $ctx);

        $payload = Tenancy::withContext($ctx, fn (): array => $this->build((string) $row->guardian_id, (string) $row->academy_id));

        return response()
            ->json($payload)
            ->header('Cache-Control', 'no-store')
            ->header('X-Robots-Tag', 'noindex, nofollow');
    }

    /**
     * The page's allow-list: names, what each bill is for, amounts and links — never a phone, a
     * price setting or an internal id. A child who has left still owes, so their bill stays.
     *
     * @return array<string, mixed>
     */
    private function build(string $guardianId, string $academyId): array
    {
        $academy = DB::table('academies')->where('id', $academyId)->first(['name', 'brand_display_name', 'brand_logo_url']);
        $guardian = DB::table('guardians')->where('id', $guardianId)->first(['full_name']);
        $origin = AcademyUrl::origin($academyId);

        $rows = DB::table('lesson_packages as p')
            ->join('students as s', 's.id', '=', 'p.student_id')
            ->join('invoices as i', 'i.id', '=', 'p.invoice_id')
            ->where('s.guardian_id', $guardianId)
            ->whereIn('i.status', self::UNPAID)
            ->whereRaw('i.total_minor > i.amount_paid_minor')
            ->orderBy('s.full_name')
            ->orderBy('p.sequence_no')
            ->get([
                'p.invoice_id', 'p.status', 'p.bill_timing', 'p.sequence_no', 'p.opened_automatically',
                'p.minutes_consumed', 'p.minutes_overdrawn', 'p.overdraft_invoice_id', 'p.overdraft_absorbed_by',
                'p.label', 'p.course', 'p.minutes_total', 'p.carried_over_minutes',
                's.full_name as child',
                'i.total_minor as invoice_total_minor', 'i.amount_paid_minor as invoice_paid_minor',
                'i.currency', 'i.public_token',
                DB::raw('(select count(*) from lesson_package_credits c where c.package_id = p.id) as lessons'),
            ]);

        $totals = [];
        $items = $rows->map(function (object $p) use ($origin, &$totals): array {
            $due = (int) $p->invoice_total_minor - (int) $p->invoice_paid_minor;
            $totals[$p->currency] = ($totals[$p->currency] ?? 0) + $due;

            return [
                'child' => (string) $p->child,
                'package_no' => (int) $p->sequence_no,
                'label' => (string) $p->label,
                'course' => $p->course,
                'purpose' => PackagePurpose::of($p),
                'lessons' => (int) $p->lessons,
                'minutes' => (int) $p->minutes_total + (int) $p->carried_over_minutes,
                'due_minor' => $due,
                'currency' => (string) $p->currency,
                'url' => $origin.'/i/'.$p->public_token,
            ];
        })->values()->all();
        ksort($totals);

        // Only the methods a parent can use from here: a bank transfer for the whole amount (its
        // public details only), and whether a card can pay — each bill through its own link.
        $methods = DB::table('academy_payment_settings')->where('is_active', true)->pluck('config', 'method');
        $bank = isset($methods['BANK_TRANSFER']) ? json_decode((string) $methods['BANK_TRANSFER'], true) : null;

        return [
            'academy' => [
                'name' => (string) ($academy->brand_display_name ?: $academy->name),
                'logo_url' => $academy->brand_logo_url,
            ],
            'guardian_name' => (string) ($guardian->full_name ?? ''),
            'items' => $items,
            'totals' => collect($totals)->map(fn (int $minor, string $currency): array => ['currency' => $currency, 'amount_minor' => $minor])->values()->all(),
            'bank_transfer' => is_array($bank) ? array_intersect_key($bank, array_flip(['bank_name', 'account_holder', 'account_number', 'iban'])) : null,
            'card' => isset($methods['XPAY']) || isset($methods['PAYPAL']),
        ];
    }
}
