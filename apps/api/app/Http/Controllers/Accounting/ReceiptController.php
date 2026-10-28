<?php

declare(strict_types=1);

namespace App\Http\Controllers\Accounting;

use App\Http\Controllers\Controller;
use App\Services\Ledger;
use App\Services\Whatsapp\WhatsAppSender;
use App\Support\AcademyUrl;
use App\Support\Audit;
use App\Support\AuthContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Receipts (docs/groups/01-ACCOUNTING.md, F1) — the money-in desk of an academy with `accounting`.
 *
 *   GET  /receipts                the register: filter by day range, method, collector, payer, group
 *   POST /receipts                record money received (and allocate it)
 *   GET  /receipts/{id}           one receipt: what it paid, what is left as credit
 *   POST /receipts/{id}/void      void with a reason (receipt.void)
 *   POST /receipts/{id}/send      WhatsApp the payer their receipt link
 *   GET  /receipts/{id}/proof     the uploaded proof (transfer screenshot)
 *   GET  /payer-account           what a payer owes, line by line, and their credit (the Collect screen)
 *   GET  /rc/{token}              public: the receipt a parent opens from WhatsApp
 *
 * Reading is `invoice.read`, recording is `invoice.mark_paid` — the same people who could mark an
 * invoice paid before. Voiding is its own `receipt.void`: undoing money is a heavier call.
 */
final class ReceiptController extends Controller
{
    public function __construct(private readonly Ledger $ledger) {}

    public function index(Request $request): JsonResponse
    {
        Gate::authorize('invoice.read');
        $academyId = $this->academyId();

        $data = $request->validate([
            'from' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            'to' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            'method' => ['sometimes', 'nullable', Rule::in(Ledger::METHODS)],
            'collector_id' => ['sometimes', 'nullable', 'uuid'],
            'group_id' => ['sometimes', 'nullable', 'uuid'],
            'guardian_id' => ['sometimes', 'nullable', 'uuid'],
            'student_id' => ['sometimes', 'nullable', 'uuid'],
            'q' => ['sometimes', 'nullable', 'string', 'max:120'],
            'status' => ['sometimes', 'nullable', Rule::in(['active', 'void', 'all'])],
            'page' => ['sometimes', 'integer', 'min:1'],
            'per_page' => ['sometimes', 'integer', 'min:10', 'max:200'],
        ]);

        $tz = $this->timezone($academyId);
        $today = Carbon::now($tz);
        $from = $data['from'] ?? $today->copy()->startOfMonth()->format('Y-m-d');
        $to = $data['to'] ?? $today->format('Y-m-d');
        $status = $data['status'] ?? 'active';

        $base = $this->registerQuery()
            ->whereBetween('r.received_on', [$from, $to])
            ->when(isset($data['method']), fn ($q) => $q->where('r.method', $data['method']))
            ->when(isset($data['collector_id']), fn ($q) => $q->where('r.received_by', $data['collector_id']))
            ->when(isset($data['guardian_id']), fn ($q) => $q->where('r.guardian_id', $data['guardian_id']))
            ->when(isset($data['student_id']), fn ($q) => $q->where('r.student_id', $data['student_id']))
            ->when(isset($data['group_id']), fn ($q) => $q->whereExists(fn ($e) => $e->from('receipt_allocations as ra')
                ->join('invoice_line_items as li', 'li.id', '=', 'ra.invoice_line_id')
                ->whereColumn('ra.receipt_id', 'r.id')
                ->where('li.class_group_id', $data['group_id'])))
            ->when(isset($data['q']) && trim((string) $data['q']) !== '', function ($q) use ($data) {
                $term = '%'.str_replace(['%', '_'], ['\%', '\_'], trim((string) $data['q'])).'%';
                $q->where(fn ($w) => $w->where('r.number', 'ilike', $term)
                    ->orWhere('g.full_name', 'ilike', $term)
                    ->orWhere('s.full_name', 'ilike', $term)
                    ->orWhere('r.payer_name', 'ilike', $term)
                    ->orWhere('r.reference', 'ilike', $term));
            });

        // Totals are over the live receipts of the filter, whatever page is showing.
        $totals = [];
        foreach ((clone $base)->whereNull('r.voided_at')
            ->groupBy('r.currency', 'r.method')
            ->select(['r.currency', 'r.method', DB::raw('count(*) as n'), DB::raw('sum(r.amount_minor) as amount')])
            ->get() as $t) {
            $c = (string) $t->currency;
            $totals[$c] ??= ['currency' => $c, 'count' => 0, 'amount_minor' => 0, 'by_method' => []];
            $totals[$c]['count'] += (int) $t->n;
            $totals[$c]['amount_minor'] += (int) $t->amount;
            $totals[$c]['by_method'][(string) $t->method] = (int) $t->amount;
        }
        ksort($totals);

        $listed = (clone $base)
            ->when($status === 'active', fn ($q) => $q->whereNull('r.voided_at'))
            ->when($status === 'void', fn ($q) => $q->whereNotNull('r.voided_at'));

        $perPage = (int) ($data['per_page'] ?? 50);
        $page = (int) ($data['page'] ?? 1);
        $total = (clone $listed)->count();
        $rows = $listed
            ->orderByDesc('r.received_on')->orderByDesc('r.created_at')
            ->offset(($page - 1) * $perPage)->limit($perPage)
            ->get();

        $groups = $this->groupsOf($rows->pluck('id')->all());

        return response()->json([
            'from' => $from,
            'to' => $to,
            'receipts' => $rows->map(fn ($r) => $this->presentRow($r, $groups[(string) $r->id] ?? []))->all(),
            'totals' => array_values($totals),
            'collectors' => DB::table('receipts as r')->join('users as u', 'u.id', '=', 'r.received_by')
                ->distinct()->orderBy('u.full_name')->get(['u.id', 'u.full_name'])
                ->map(fn ($u) => ['id' => (string) $u->id, 'name' => (string) $u->full_name])->all(),
            'meta' => ['page' => $page, 'per_page' => $perPage, 'total' => $total],
            'can_void' => Gate::allows('receipt.void'),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        Gate::authorize('invoice.mark_paid');
        $academyId = $this->academyId();
        $tz = $this->timezone($academyId);

        $data = $request->validate([
            'guardian_id' => ['nullable', 'uuid', 'required_without_all:student_id,invoice_id'],
            'student_id' => ['nullable', 'uuid'],
            'invoice_id' => ['nullable', 'uuid'],
            'amount_minor' => ['required', 'integer', 'min:1', 'max:100000000000'],
            'currency' => ['nullable', 'string', 'size:3'],
            'method' => ['required', Rule::in(Ledger::METHODS)],
            'reference' => ['nullable', 'string', 'max:255'],
            'note' => ['nullable', 'string', 'max:1000'],
            'received_on' => ['nullable', 'date_format:Y-m-d', 'before_or_equal:'.Carbon::now($tz)->format('Y-m-d')],
            // Money that moved through a bank, a wallet or a card leaves a picture; cash does not.
            'proof' => [Rule::requiredIf(fn () => $request->input('method') !== 'CASH'), 'nullable', 'file', 'image', 'mimes:jpg,jpeg,png,webp', 'max:20480'],
            'line_ids' => ['nullable', 'array', 'max:500'],
            'line_ids.*' => ['uuid'],
            'apply_rest' => ['nullable', 'boolean'],
        ]);

        $payer = $this->ledger->resolvePayer($academyId, $data['guardian_id'] ?? null, $data['student_id'] ?? null);

        $currency = $data['currency'] ?? null;
        if (isset($data['invoice_id'])) {
            $currency ??= DB::table('invoices')->where('id', $data['invoice_id'])->value('currency');
        }
        if ($currency === null) {
            $currency = DB::table('invoice_line_items')->whereIn('id', $data['line_ids'] ?? [])->value('currency')
                ?? DB::table('academies')->where('id', $academyId)->value('default_currency');
        }

        $proofPath = null;
        if ($request->hasFile('proof')) {
            $proof = $request->file('proof');
            $proofPath = $proof?->storeAs("receipt-proofs/{$academyId}", Str::uuid().'.'.strtolower((string) ($proof->extension() ?: 'jpg')), 'local');
        }

        $ctx = app(AuthContext::class);
        $receipt = $this->ledger->record($academyId, $payer, (int) $data['amount_minor'], strtoupper((string) $currency), [
            'invoice_id' => $data['invoice_id'] ?? null,
            'method' => (string) $data['method'],
            'reference' => $data['reference'] ?? null,
            'note' => $data['note'] ?? null,
            'received_on' => $data['received_on'] ?? null,
            'proof_path' => is_string($proofPath) && $proofPath !== '' ? $proofPath : null,
            'line_ids' => $data['line_ids'] ?? [],
            'apply_rest' => array_key_exists('apply_rest', $data) && $data['apply_rest'] !== null ? (bool) $data['apply_rest'] : true,
            'received_by' => $ctx->userId,
            'actor_role' => $ctx->role,
        ]);

        return response()->json(['receipt' => $this->detail((string) $receipt->id)], 201);
    }

    public function show(string $id): JsonResponse
    {
        Gate::authorize('invoice.read');

        return response()->json(['receipt' => $this->detail($id)]);
    }

    public function void(Request $request, string $id): JsonResponse
    {
        Gate::authorize('receipt.void');
        $data = $request->validate(['reason' => ['required', 'string', 'min:3', 'max:500']]);
        $ctx = app(AuthContext::class);

        $this->ledger->void($id, trim((string) $data['reason']), $ctx->userId, $ctx->role);

        return response()->json(['receipt' => $this->detail($id)]);
    }

    public function send(string $id): JsonResponse
    {
        Gate::authorize('invoice.send_link');
        $receipt = $this->detail($id);
        if ($receipt['voided']) {
            throw ValidationException::withMessages(['receipt' => ['A void receipt is not sent. / لا يُرسل إيصال ملغى.']]);
        }

        $academyId = $this->academyId();
        $academy = (string) (DB::table('academies')->where('id', $academyId)->value('name') ?? '');
        $message = $this->whatsAppMessage($academy, $receipt);
        $phone = (string) ($receipt['payer']['phone'] ?? '');

        $send = app(WhatsAppSender::class)->sendOrLink($academyId, $phone, $message, [
            'automation_type' => 'MANUAL',
            'recipient_kind' => $receipt['payer']['kind'] === 'GUARDIAN' ? 'GUARDIAN' : 'STUDENT',
            'recipient_id' => (string) ($receipt['payer']['id'] ?? ''),
            'ref_type' => 'receipt',
            'ref_id' => $id,
        ]);

        $ctx = app(AuthContext::class);
        Audit::log('receipt.sent', 'receipt', $id, $academyId, $ctx->userId, $ctx->role, after: ['phone' => $phone, 'sent' => $send['sent']]);

        return response()->json([
            'phone' => $phone,
            'message' => $message,
            'url' => $receipt['public_url'],
            'transport' => $send['transport'],
            'sent' => $send['sent'],
        ]);
    }

    public function proof(string $id): StreamedResponse
    {
        Gate::authorize('invoice.read');
        $path = DB::table('receipts')->where('id', $id)->value('proof_path');
        if (! is_string($path) || $path === '' || ! Storage::disk('local')->exists($path)) {
            abort(404, 'No proof on this receipt.');
        }

        return Storage::disk('local')->response($path, null, ['Cache-Control' => 'private, no-store']);
    }

    /**
     * GET /payer-account?guardian_id= | student_id= | invoice_id= — everything the Collect screen
     * needs: who the payer is, every unpaid line they have (oldest first, with what is left on it),
     * their credit, and their last receipts.
     */
    public function account(Request $request): JsonResponse
    {
        Gate::authorize('invoice.read');
        $academyId = $this->academyId();
        $data = $request->validate([
            'guardian_id' => ['nullable', 'uuid', 'required_without_all:student_id,invoice_id'],
            'student_id' => ['nullable', 'uuid'],
            'invoice_id' => ['nullable', 'uuid'],
        ]);

        if (isset($data['invoice_id'])) {
            $invoice = DB::table('invoices')->where('id', $data['invoice_id'])->first();
            if ($invoice === null) {
                abort(404, 'Invoice not found.');
            }
            $payer = $this->ledger->payerOfInvoice($invoice);
        } else {
            $payer = $this->ledger->resolvePayer($academyId, $data['guardian_id'] ?? null, $data['student_id'] ?? null) + ['payer_name' => null];
        }

        $named = $payer['guardian_id'] === null && $payer['student_id'] === null;
        $lines = $this->ledger->openLines($academyId, $named ? null : $payer, null, $named ? (string) $data['invoice_id'] : null);
        $groupNames = DB::table('class_groups')->whereIn('id', $lines->pluck('class_group_id')->filter()->unique()->values()->all())->pluck('name', 'id');

        $recent = DB::table('receipts')
            ->when($payer['guardian_id'] !== null, fn ($q) => $q->where('guardian_id', $payer['guardian_id']))
            ->when($payer['guardian_id'] === null && $payer['student_id'] !== null, fn ($q) => $q->whereNull('guardian_id')->where('student_id', $payer['student_id']))
            ->when($named, fn ($q) => $q->whereRaw('false'))
            ->orderByDesc('received_on')->orderByDesc('created_at')->limit(5)
            ->get(['id', 'number', 'received_on', 'amount_minor', 'currency', 'method', 'voided_at']);

        return response()->json([
            'payer' => $this->payerInfo($payer),
            'accounting' => Ledger::enabledFor($academyId),
            'lines' => $lines->map(fn ($l) => [
                'id' => (string) $l->id,
                'invoice_id' => (string) $l->invoice_id,
                'description' => (string) $l->description,
                'student_id' => $l->student_id !== null ? (string) $l->student_id : null,
                'student_name' => $l->student_name,
                'group_id' => $l->class_group_id !== null ? (string) $l->class_group_id : null,
                'group_name' => $l->class_group_id !== null ? ($groupNames[(string) $l->class_group_id] ?? null) : null,
                'group_charge' => $l->group_charge,
                'date' => $l->session_date !== null ? Carbon::parse($l->session_date)->format('Y-m-d') : null,
                'period' => sprintf('%04d-%02d', (int) $l->period_year, (int) $l->period_month),
                'amount_minor' => (int) $l->amount_minor,
                'paid_minor' => (int) $l->allocated,
                'remaining_minor' => (int) $l->amount_minor - (int) $l->allocated,
                'currency' => (string) $l->currency,
                'invoice_status' => (string) $l->invoice_status,
            ])->values()->all(),
            'balance' => $named ? [] : $this->ledger->balance($academyId, $payer),
            'recent_receipts' => $recent->map(fn ($r) => [
                'id' => (string) $r->id,
                'number' => (string) $r->number,
                'received_on' => (string) $r->received_on,
                'amount_minor' => (int) $r->amount_minor,
                'currency' => (string) $r->currency,
                'method' => (string) $r->method,
                'voided' => $r->voided_at !== null,
            ])->all(),
        ]);
    }

    /** GET /rc/{token} — the receipt a parent opens from WhatsApp; the definer function is the allow-list. */
    public function publicShow(string $token): JsonResponse
    {
        $raw = DB::selectOne('select app.public_receipt_by_token(?) as data', [$token])->data ?? null;
        $dto = is_string($raw) ? json_decode($raw, true) : null;
        if (! is_array($dto) || $dto === []) {
            abort(404, 'Receipt not found.');
        }

        return response()->json($dto)
            ->header('Cache-Control', 'no-store')
            ->header('X-Robots-Tag', 'noindex, nofollow');
    }

    // ── shapes ──────────────────────────────────────────────────────────────

    /** @return array<string, mixed> */
    private function detail(string $id): array
    {
        $r = $this->registerQuery()->where('r.id', $id)->first();
        if ($r === null) {
            abort(404, 'Receipt not found.');
        }

        $allocations = DB::table('receipt_allocations as ra')
            ->join('invoice_line_items as li', 'li.id', '=', 'ra.invoice_line_id')
            ->join('invoices as i', 'i.id', '=', 'ra.invoice_id')
            ->leftJoin('students as st', 'st.id', '=', 'li.student_id')
            ->leftJoin('class_groups as cg', 'cg.id', '=', 'li.class_group_id')
            ->where('ra.receipt_id', $id)
            ->orderByRaw('li.session_date asc nulls last')->orderBy('li.created_at')
            ->get(['ra.amount_minor', 'li.id as line_id', 'li.description', 'li.amount_minor as line_amount', 'li.session_date',
                'st.full_name as student_name', 'cg.name as group_name', 'i.id as invoice_id', 'i.period_year', 'i.period_month']);

        $payer = ['guardian_id' => $r->guardian_id, 'student_id' => $r->student_id, 'payer_name' => $r->payer_name];
        $allocated = (int) $allocations->sum('amount_minor');
        $refunded = $this->ledger->refunded($id);
        $academyId = (string) $r->academy_id;

        $voidedBy = $r->voided_by !== null ? DB::table('users')->where('id', $r->voided_by)->value('full_name') : null;

        return $this->presentRow($r, $allocations->pluck('group_name')->filter()->unique()->values()->all()) + [
            'note' => $r->note,
            'has_proof' => $r->proof_path !== null,
            'payer' => $this->payerInfo($payer),
            'public_url' => AcademyUrl::receipt($academyId, (string) $r->public_token),
            'unallocated_minor' => $r->voided_at === null ? (int) $r->amount_minor - $allocated - $refunded : 0,
            // Paid back to the family out of the treasury (a refund expense).
            'refunded_minor' => $refunded,
            'voided_at' => $r->voided_at,
            'voided_by_name' => $voidedBy,
            'allocations' => $allocations->map(fn ($a) => [
                'line_id' => (string) $a->line_id,
                'invoice_id' => (string) $a->invoice_id,
                'description' => (string) $a->description,
                'student_name' => $a->student_name,
                'group_name' => $a->group_name,
                'period' => sprintf('%04d-%02d', (int) $a->period_year, (int) $a->period_month),
                'line_amount_minor' => (int) $a->line_amount,
                'amount_minor' => (int) $a->amount_minor,
            ])->all(),
            'balance_after' => $payer['guardian_id'] !== null || $payer['student_id'] !== null ? $this->ledger->balance($academyId, $payer) : [],
            'can_void' => Gate::allows('receipt.void') && $r->voided_at === null,
        ];
    }

    private function registerQuery()
    {
        $allocated = DB::table('receipt_allocations')->selectRaw('receipt_id, sum(amount_minor) as allocated')->groupBy('receipt_id');

        return DB::table('receipts as r')
            ->leftJoin('guardians as g', 'g.id', '=', 'r.guardian_id')
            ->leftJoin('students as s', 's.id', '=', 'r.student_id')
            ->leftJoin('users as u', 'u.id', '=', 'r.received_by')
            ->leftJoinSub($allocated, 'a', 'a.receipt_id', '=', 'r.id')
            ->select([
                'r.*',
                DB::raw('coalesce(g.full_name, s.full_name, r.payer_name) as payer_display'),
                'u.full_name as received_by_name',
                DB::raw('coalesce(a.allocated, 0) as allocated'),
            ]);
    }

    /**
     * @param  list<string>  $groups
     * @return array<string, mixed>
     */
    private function presentRow(object $r, array $groups): array
    {
        return [
            'id' => (string) $r->id,
            'number' => (string) $r->number,
            'received_on' => Carbon::parse($r->received_on)->format('Y-m-d'),
            'created_at' => $r->created_at,
            'payer_name' => $r->payer_display,
            'payer_kind' => $r->guardian_id !== null ? 'GUARDIAN' : ($r->student_id !== null ? 'STUDENT' : 'NAME'),
            'guardian_id' => $r->guardian_id,
            'student_id' => $r->student_id,
            'amount_minor' => (int) $r->amount_minor,
            'allocated_minor' => (int) $r->allocated,
            'currency' => (string) $r->currency,
            'method' => (string) $r->method,
            'reference' => $r->reference,
            'source' => (string) $r->source,
            'received_by_name' => $r->received_by_name,
            'voided' => $r->voided_at !== null,
            'void_reason' => $r->void_reason,
            'groups' => array_values($groups),
        ];
    }

    /**
     * @param  list<string>  $receiptIds
     * @return array<string, list<string>>
     */
    private function groupsOf(array $receiptIds): array
    {
        if ($receiptIds === []) {
            return [];
        }
        $out = [];
        foreach (DB::table('receipt_allocations as ra')
            ->join('invoice_line_items as li', 'li.id', '=', 'ra.invoice_line_id')
            ->join('class_groups as cg', 'cg.id', '=', 'li.class_group_id')
            ->whereIn('ra.receipt_id', $receiptIds)
            ->distinct()
            ->get(['ra.receipt_id', 'cg.name']) as $row) {
            $out[(string) $row->receipt_id][] = (string) $row->name;
        }

        return $out;
    }

    /**
     * @param  array{guardian_id: ?string, student_id: ?string, payer_name?: ?string}  $payer
     * @return array{kind: string, id: ?string, name: ?string, phone: ?string}
     */
    private function payerInfo(array $payer): array
    {
        if ($payer['guardian_id'] !== null) {
            $g = DB::table('guardians')->where('id', $payer['guardian_id'])->first(['id', 'full_name', 'whatsapp_phone']);

            return ['kind' => 'GUARDIAN', 'id' => (string) $payer['guardian_id'], 'name' => $g->full_name ?? null, 'phone' => $g->whatsapp_phone ?? null];
        }
        if ($payer['student_id'] !== null) {
            $s = DB::table('students')->where('id', $payer['student_id'])->first(['id', 'full_name', 'whatsapp_phone']);

            return ['kind' => 'STUDENT', 'id' => (string) $payer['student_id'], 'name' => $s->full_name ?? null, 'phone' => $s->whatsapp_phone ?? null];
        }

        return ['kind' => 'NAME', 'id' => null, 'name' => $payer['payer_name'] ?? null, 'phone' => null];
    }

    /** @param  array<string, mixed>  $r */
    private function whatsAppMessage(string $academy, array $r): string
    {
        $amount = number_format(((int) $r['amount_minor']) / 100, 2).' '.$r['currency'];
        $owed = collect($r['balance_after'])->firstWhere('currency', $r['currency']);
        $left = $owed !== null ? max(0, (int) $owed['balance_minor']) : 0;
        $leftText = number_format($left / 100, 2).' '.$r['currency'];
        $academy = trim($academy) !== '' ? trim($academy) : 'Academy';

        $ar = ["🧾 *إيصال استلام — {$academy}*", "رقم الإيصال: {$r['number']}", "👤 {$r['payer_name']}", "💰 المبلغ المستلم: {$amount}", "📅 التاريخ: {$r['received_on']}"];
        $ar[] = $left > 0 ? "⏳ المتبقي عليكم: {$leftText}" : '✅ لا يوجد مبلغ متبقٍ — شكراً لكم';
        $ar[] = '';
        $ar[] = "📄 الإيصال: {$r['public_url']}";

        $en = ["🧾 *{$academy} — Payment receipt*", "Receipt no.: {$r['number']}", "💰 Received: {$amount}", "📅 Date: {$r['received_on']}"];
        $en[] = $left > 0 ? "⏳ Still due: {$leftText}" : '✅ Nothing outstanding — thank you';
        $en[] = '';
        $en[] = "📄 Receipt: {$r['public_url']}";

        return implode("\n", $ar)."\n\n———\n\n".implode("\n", $en);
    }

    private function academyId(): string
    {
        return (string) app(AuthContext::class)->academyId;
    }

    private function timezone(string $academyId): string
    {
        return (string) (DB::table('academies')->where('id', $academyId)->value('timezone') ?: 'UTC');
    }
}
