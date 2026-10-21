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
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * The Accounting section (docs/groups/01-ACCOUNTING.md) — the pages an academy on receipts reads its
 * money from. Every figure comes from receipts and their allocations, so partial payments, credit
 * and voids are exact.
 *
 *   GET  /accounting/overview?month=      the month: collected (by method / collector / day), what is
 *                                         owed and how old, credit held, top debtors, latest receipts
 *   GET  /accounting/groups?month=        every group's collection and profit, plus a per-teacher roll-up
 *   GET  /accounting/arrears              everyone who owes, aged 0–30 / 31–60 / 61–90 / 90+ days
 *   POST /accounting/arrears/remind       WhatsApp a payer what they owe
 *   GET  /accounting/statement            one payer's statement: every charge and receipt, running balance
 *   GET  /accounting/daily?from=&to=      collections per day, by method and by collector (the cash count)
 *
 * Behind `entitled:accounting` (opt-in per client): an academy without it never reaches any of this.
 * Reading is `invoice.read`; teacher cost and net need `payout.read`; reminding needs `invoice.send_link`.
 */
final class AccountingController extends Controller
{
    private const BUCKETS = ['d0_30', 'd31_60', 'd61_90', 'd90_plus'];

    public function __construct(private readonly Ledger $ledger) {}

    // ── Overview ────────────────────────────────────────────────────────────

    public function overview(Request $request): JsonResponse
    {
        Gate::authorize('invoice.read');
        $academyId = $this->academyId();
        [$month, $from, $to] = $this->month($request, $academyId);
        $today = Carbon::now($this->timezone($academyId))->format('Y-m-d');

        // Money in: receipts dated in the month (cash basis).
        $receipts = DB::table('receipts as r')
            ->leftJoin('users as u', 'u.id', '=', 'r.received_by')
            ->whereNull('r.voided_at')
            ->whereBetween('r.received_on', [$from, $to])
            ->get(['r.id', 'r.amount_minor', 'r.currency', 'r.method', 'r.received_on', 'r.received_by', 'r.source', 'u.full_name as collector']);

        $collected = [];
        foreach ($receipts as $r) {
            $c = (string) $r->currency;
            $collected[$c] ??= ['currency' => $c, 'amount_minor' => 0, 'count' => 0, 'today_minor' => 0, 'by_method' => [], 'by_collector' => [], 'by_day' => []];
            $amount = (int) $r->amount_minor;
            $day = Carbon::parse($r->received_on)->format('Y-m-d');
            $collected[$c]['amount_minor'] += $amount;
            $collected[$c]['count']++;
            if ($day === $today) {
                $collected[$c]['today_minor'] += $amount;
            }
            $collected[$c]['by_method'][(string) $r->method] = ($collected[$c]['by_method'][(string) $r->method] ?? 0) + $amount;
            $who = $r->received_by !== null ? (string) $r->received_by : 'system';
            $collected[$c]['by_collector'][$who] ??= ['id' => $r->received_by, 'name' => $r->collector, 'source' => (string) $r->source, 'amount_minor' => 0, 'count' => 0];
            $collected[$c]['by_collector'][$who]['amount_minor'] += $amount;
            $collected[$c]['by_collector'][$who]['count']++;
            $collected[$c]['by_day'][$day] = ($collected[$c]['by_day'][$day] ?? 0) + $amount;
        }
        foreach ($collected as $c => $row) {
            $byCollector = array_values($row['by_collector']);
            usort($byCollector, fn ($a, $b) => $b['amount_minor'] <=> $a['amount_minor']);
            $collected[$c]['by_collector'] = $byCollector;
            $days = [];
            for ($d = Carbon::parse($from); $d->format('Y-m-d') <= $to; $d->addDay()) {
                $days[] = ['date' => $d->format('Y-m-d'), 'amount_minor' => $row['by_day'][$d->format('Y-m-d')] ?? 0];
            }
            $collected[$c]['by_day'] = $days;
        }

        // The month's billing: what was charged FOR the month, and how much of it is paid.
        $billed = [];
        foreach ($this->linesQuery($academyId)
            ->where('i.period_year', (int) substr($month, 0, 4))
            ->where('i.period_month', (int) substr($month, 5, 2))
            ->get() as $l) {
            $c = (string) $l->currency;
            $billed[$c] ??= ['currency' => $c, 'billed_minor' => 0, 'paid_minor' => 0, 'rate' => null];
            $billed[$c]['billed_minor'] += (int) $l->amount_minor;
            $billed[$c]['paid_minor'] += min((int) $l->paid, (int) $l->amount_minor);
        }
        foreach ($billed as $c => $b) {
            $billed[$c]['rate'] = $b['billed_minor'] > 0 ? round($b['paid_minor'] / $b['billed_minor'], 4) : null;
        }

        // Owed today, everything unpaid, aged — and the biggest debtors.
        $open = $this->openLines($academyId);
        $owed = [];
        foreach ($open as $l) {
            $c = (string) $l->currency;
            $owed[$c] ??= ['currency' => $c, 'due_minor' => 0, 'overdue_minor' => 0, 'payers' => 0] + array_fill_keys(self::BUCKETS, 0);
            $left = (int) $l->amount_minor - (int) $l->paid;
            $owed[$c]['due_minor'] += $left;
            $owed[$c][$this->bucket((string) $l->due_date, $today)] += $left;
            if (Carbon::parse($l->due_date)->format('Y-m') < substr($today, 0, 7)) {
                $owed[$c]['overdue_minor'] += $left; // from a month that has already ended
            }
        }
        $byPayer = $this->groupByPayer($open);
        foreach ($byPayer as $p) {
            foreach (array_keys($p['due']) as $c) {
                if (isset($owed[$c])) {
                    $owed[$c]['payers']++;
                }
            }
        }

        $credit = [];
        foreach (DB::table('receipts as r')
            ->leftJoinSub(DB::table('receipt_allocations')->selectRaw('receipt_id, sum(amount_minor) as allocated')->groupBy('receipt_id'), 'a', 'a.receipt_id', '=', 'r.id')
            ->whereNull('r.voided_at')
            ->whereRaw('r.amount_minor > coalesce(a.allocated, 0)')
            ->groupBy('r.currency')
            ->get(['r.currency', DB::raw('sum(r.amount_minor - coalesce(a.allocated, 0)) as credit')]) as $row) {
            $credit[] = ['currency' => (string) $row->currency, 'credit_minor' => (int) $row->credit];
        }

        $top = $this->presentPayers(array_slice($this->sortByDue($byPayer), 0, 6));

        $recent = DB::table('receipts as r')
            ->leftJoin('guardians as g', 'g.id', '=', 'r.guardian_id')
            ->leftJoin('students as s', 's.id', '=', 'r.student_id')
            ->orderByDesc('r.received_on')->orderByDesc('r.created_at')->orderByDesc('r.number')
            ->limit(8)
            ->get(['r.id', 'r.number', 'r.received_on', 'r.amount_minor', 'r.currency', 'r.method', 'r.voided_at', DB::raw('coalesce(g.full_name, s.full_name, r.payer_name) as payer_name')])
            ->map(fn ($r) => [
                'id' => (string) $r->id,
                'number' => (string) $r->number,
                'received_on' => Carbon::parse($r->received_on)->format('Y-m-d'),
                'payer_name' => $r->payer_name,
                'amount_minor' => (int) $r->amount_minor,
                'currency' => (string) $r->currency,
                'method' => (string) $r->method,
                'voided' => $r->voided_at !== null,
            ])->all();

        ksort($collected);
        ksort($billed);
        ksort($owed);

        return response()->json([
            'month' => $month,
            'today' => $today,
            'collected' => array_values($collected),
            'billed' => array_values($billed),
            'owed' => array_values($owed),
            'credit' => $credit,
            'top_debtors' => $top,
            'recent_receipts' => $recent,
        ]);
    }

    // ── Groups: collection and profit ───────────────────────────────────────

    public function groups(Request $request): JsonResponse
    {
        Gate::authorize('invoice.read');
        $academyId = $this->academyId();
        [$month, $from, $to] = $this->month($request, $academyId);
        $seesCost = Gate::allows('payout.read');

        $groups = DB::table('class_groups as g')
            ->leftJoin('teachers as t', 't.id', '=', 'g.teacher_id')
            ->orderBy('g.name')
            ->get(['g.id', 'g.name', 'g.level', 'g.status', 'g.billing_mode', 'g.price_minor', 'g.currency', 'g.teacher_id', 't.full_name as teacher_name'])
            ->keyBy(fn ($g) => (string) $g->id);

        $members = DB::table('class_group_members')
            ->where('joined_on', '<=', $to)
            ->where(fn ($q) => $q->whereNull('left_on')->orWhere('left_on', '>', $from))
            ->groupBy('group_id')
            ->get(['group_id', DB::raw('count(distinct student_id) as n')])
            ->pluck('n', 'group_id');

        $per = [];
        $blank = fn (string $c) => [
            'currency' => $c, 'expected_minor' => 0, 'collected_minor' => 0, 'remaining_minor' => 0, 'arrears_minor' => 0,
            'received_in_month_minor' => 0, 'teacher_cost_minor' => $seesCost ? 0 : null, 'net_minor' => null, 'rate' => null, 'margin' => null,
        ];

        foreach ($this->linesQuery($academyId)->whereNotNull('li.class_group_id')->where('li.group_period', '<=', $to)->get() as $l) {
            $gid = (string) $l->class_group_id;
            $c = (string) $l->currency;
            $per[$gid][$c] ??= $blank($c);
            $amount = (int) $l->amount_minor;
            $paid = min((int) $l->paid, $amount);
            if (Carbon::parse($l->group_period)->format('Y-m-d') >= $from) {
                $per[$gid][$c]['expected_minor'] += $amount;
                $per[$gid][$c]['collected_minor'] += $paid;
                $per[$gid][$c]['remaining_minor'] += $amount - $paid;
            } else {
                $per[$gid][$c]['arrears_minor'] += $amount - $paid;
            }
        }

        foreach (DB::table('receipt_allocations as ra')
            ->join('invoice_line_items as li', 'li.id', '=', 'ra.invoice_line_id')
            ->join('receipts as r', 'r.id', '=', 'ra.receipt_id')
            ->whereNotNull('li.class_group_id')
            ->whereNull('r.voided_at')
            ->whereBetween('r.received_on', [$from, $to])
            ->groupBy('li.class_group_id', 'li.currency')
            ->get(['li.class_group_id', 'li.currency', DB::raw('sum(ra.amount_minor) as amount')]) as $row) {
            $gid = (string) $row->class_group_id;
            $c = (string) $row->currency;
            $per[$gid][$c] ??= $blank($c);
            $per[$gid][$c]['received_in_month_minor'] = (int) $row->amount;
        }

        if ($seesCost) {
            foreach (DB::table('payout_line_items as pl')
                ->leftJoin('class_group_lessons as l', 'l.id', '=', 'pl.class_group_lesson_id')
                ->whereRaw('coalesce(l.group_id, pl.class_group_id) is not null')
                ->whereBetween('pl.session_date', [$from, $to])
                ->groupBy(DB::raw('coalesce(l.group_id, pl.class_group_id)'), 'pl.currency')
                ->get([DB::raw('coalesce(l.group_id, pl.class_group_id) as group_id'), 'pl.currency', DB::raw('sum(pl.amount_minor) as amount')]) as $row) {
                $gid = (string) $row->group_id;
                $c = (string) $row->currency;
                $per[$gid][$c] ??= $blank($c);
                $per[$gid][$c]['teacher_cost_minor'] = (int) $row->amount;
            }
        }

        $rows = [];
        $totals = [];
        $teachers = [];
        foreach ($groups as $gid => $g) {
            $money = $per[$gid] ?? [];
            if ($money === [] && $g->status === 'ARCHIVED') {
                continue;
            }
            foreach ($money as $c => $m) {
                $money[$c] = $this->finishMoney($m, $seesCost);
                $totals[$c] ??= $blank($c);
                foreach (['expected_minor', 'collected_minor', 'remaining_minor', 'arrears_minor', 'received_in_month_minor'] as $k) {
                    $totals[$c][$k] += $m[$k];
                }
                if ($seesCost) {
                    $totals[$c]['teacher_cost_minor'] += (int) $m['teacher_cost_minor'];
                    $tid = (string) ($g->teacher_id ?? 'none');
                    $teachers[$tid.'|'.$c] ??= ['teacher_id' => $g->teacher_id, 'teacher_name' => $g->teacher_name, 'groups' => 0] + $blank($c);
                    $teachers[$tid.'|'.$c]['groups']++;
                    foreach (['expected_minor', 'collected_minor', 'remaining_minor', 'arrears_minor', 'received_in_month_minor', 'teacher_cost_minor'] as $k) {
                        $teachers[$tid.'|'.$c][$k] += (int) $m[$k];
                    }
                }
            }
            $rows[] = [
                'id' => $gid,
                'name' => (string) $g->name,
                'level' => $g->level,
                'status' => (string) $g->status,
                'teacher_name' => $g->teacher_name,
                'billing_mode' => (string) $g->billing_mode,
                'price_minor' => $g->price_minor !== null ? (int) $g->price_minor : null,
                'currency' => $g->currency,
                'students' => (int) ($members[$gid] ?? 0),
                'money' => array_values($money),
            ];
        }

        $teacherRows = array_map(fn ($t) => $this->finishMoney($t, true), array_values($teachers));
        usort($teacherRows, fn ($a, $b) => [$a['currency'], $b['collected_minor']] <=> [$b['currency'], $a['collected_minor']]);
        ksort($totals);

        return response()->json([
            'month' => $month,
            'groups' => $rows,
            'totals' => array_values(array_map(fn ($t) => $this->finishMoney($t, $seesCost), $totals)),
            'teachers' => $seesCost ? $teacherRows : null,
            'sees_teacher_cost' => $seesCost,
        ]);
    }

    // ── Arrears ─────────────────────────────────────────────────────────────

    public function arrears(Request $request): JsonResponse
    {
        Gate::authorize('invoice.read');
        $academyId = $this->academyId();
        $data = $request->validate([
            'group_id' => ['sometimes', 'nullable', 'uuid'],
            'bucket' => ['sometimes', 'nullable', Rule::in(['overdue', ...self::BUCKETS])],
            'q' => ['sometimes', 'nullable', 'string', 'max:120'],
        ]);
        $today = Carbon::now($this->timezone($academyId))->format('Y-m-d');

        $open = $this->openLines($academyId);
        if (isset($data['group_id'])) {
            // Payers who owe on that group — but their whole balance, which is what a reminder is about.
            $owing = $open->where('class_group_id', $data['group_id'])->map(fn ($l) => $this->payerKey($l))->unique()->all();
            $open = $open->filter(fn ($l) => in_array($this->payerKey($l), $owing, true));
        }

        $payers = $this->groupByPayer($open);
        $rows = $this->presentPayers($this->sortByDue($payers));

        if (isset($data['bucket'])) {
            $rows = array_values(array_filter($rows, fn ($r) => collect($r['balances'])->contains(
                fn ($b) => $data['bucket'] === 'overdue' ? $b['overdue_minor'] > 0 : $b[$data['bucket']] > 0,
            )));
        }
        if (isset($data['q']) && trim((string) $data['q']) !== '') {
            $term = mb_strtolower(trim((string) $data['q']));
            $rows = array_values(array_filter($rows, fn ($r) => str_contains(mb_strtolower((string) $r['name']), $term)
                || str_contains((string) $r['phone'], $term)
                || collect($r['students'])->contains(fn ($s) => str_contains(mb_strtolower($s), $term))));
        }

        $totals = [];
        foreach ($rows as $r) {
            foreach ($r['balances'] as $b) {
                $c = $b['currency'];
                $totals[$c] ??= ['currency' => $c, 'due_minor' => 0, 'overdue_minor' => 0, 'payers' => 0] + array_fill_keys(self::BUCKETS, 0);
                $totals[$c]['payers']++;
                foreach (['due_minor', 'overdue_minor', ...self::BUCKETS] as $k) {
                    $totals[$c][$k] += $b[$k];
                }
            }
        }
        ksort($totals);

        return response()->json([
            'today' => $today,
            'payers' => $rows,
            'totals' => array_values($totals),
            'groups' => DB::table('class_groups')->where('status', '<>', 'ARCHIVED')->orderBy('name')->get(['id', 'name'])
                ->map(fn ($g) => ['id' => (string) $g->id, 'name' => (string) $g->name])->all(),
            'can_collect' => Gate::allows('invoice.mark_paid'),
            'can_remind' => Gate::allows('invoice.send_link'),
        ]);
    }

    /** POST /accounting/arrears/remind — WhatsApp a payer what they owe, with the bills to pay. */
    public function remind(Request $request): JsonResponse
    {
        Gate::authorize('invoice.send_link');
        $academyId = $this->academyId();
        $data = $request->validate([
            'guardian_id' => ['nullable', 'uuid', 'required_without:student_id'],
            'student_id' => ['nullable', 'uuid'],
        ]);
        $payer = $this->ledger->resolvePayer($academyId, $data['guardian_id'] ?? null, $data['student_id'] ?? null) + ['payer_name' => null];

        $lines = $this->ledger->openLines($academyId, $payer);
        if ($lines->isEmpty()) {
            throw ValidationException::withMessages(['payer' => ['Nothing is owed. / لا توجد مستحقات.']]);
        }

        $info = $this->payerContact($payer);
        $academy = trim((string) (DB::table('academies')->where('id', $academyId)->value('name') ?? '')) ?: 'Academy';
        $invoiceLinks = DB::table('invoices')->whereIn('id', $lines->pluck('invoice_id')->unique()->values()->all())
            ->orderByDesc('period_year')->orderByDesc('period_month')->limit(3)->pluck('public_token')
            ->map(fn ($token) => AcademyUrl::invoice($academyId, (string) $token))->all();

        $message = $this->reminderMessage($academy, (string) ($info['name'] ?? ''), $lines, $invoiceLinks);
        $send = app(WhatsAppSender::class)->sendOrLink($academyId, (string) ($info['phone'] ?? ''), $message, [
            'automation_type' => 'MANUAL',
            'recipient_kind' => $payer['guardian_id'] !== null ? 'GUARDIAN' : 'STUDENT',
            'recipient_id' => (string) ($payer['guardian_id'] ?? $payer['student_id']),
            'ref_type' => 'balance',
            'ref_id' => (string) ($payer['guardian_id'] ?? $payer['student_id']),
        ]);

        $ctx = app(AuthContext::class);
        Audit::log('accounting.reminder_sent', $payer['guardian_id'] !== null ? 'guardian' : 'student', (string) ($payer['guardian_id'] ?? $payer['student_id']), $academyId, $ctx->userId, $ctx->role, after: [
            'due' => $lines->groupBy('currency')->map(fn ($g) => $g->sum(fn ($l) => (int) $l->amount_minor - (int) $l->allocated))->all(),
            'sent' => $send['sent'],
        ]);

        return response()->json([
            'phone' => $info['phone'],
            'message' => $message,
            'transport' => $send['transport'],
            'sent' => $send['sent'],
        ]);
    }

    // ── Statement of account ────────────────────────────────────────────────

    public function statement(Request $request): JsonResponse
    {
        Gate::authorize('invoice.read');
        $academyId = $this->academyId();
        $data = $request->validate([
            'guardian_id' => ['nullable', 'uuid', 'required_without:student_id'],
            'student_id' => ['nullable', 'uuid'],
            'from' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            'to' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
        ]);
        $payer = $this->ledger->resolvePayer($academyId, $data['guardian_id'] ?? null, $data['student_id'] ?? null);
        $tz = $this->timezone($academyId);
        $to = $data['to'] ?? Carbon::now($tz)->format('Y-m-d');
        $from = $data['from'] ?? Carbon::parse($to)->subMonths(5)->startOfMonth()->format('Y-m-d');

        $charges = $this->linesQuery($academyId)
            ->when($payer['guardian_id'] !== null, fn ($q) => $q->where('i.guardian_id', $payer['guardian_id']))
            ->when($payer['guardian_id'] === null, fn ($q) => $q->whereNull('i.guardian_id')->where('i.student_id', $payer['student_id']))
            ->leftJoin('students as st', 'st.id', '=', 'li.student_id')
            ->leftJoin('class_groups as cg', 'cg.id', '=', 'li.class_group_id')
            ->addSelect(['li.description', 'st.full_name as student_name', 'cg.name as group_name', 'i.public_token'])
            ->get();

        $receipts = DB::table('receipts')
            ->whereNull('voided_at')
            ->when($payer['guardian_id'] !== null, fn ($q) => $q->where('guardian_id', $payer['guardian_id']))
            ->when($payer['guardian_id'] === null, fn ($q) => $q->whereNull('guardian_id')->where('student_id', $payer['student_id']))
            ->get(['id', 'number', 'received_on', 'amount_minor', 'currency', 'method', 'reference']);

        $entries = [];
        foreach ($charges as $l) {
            $entries[] = [
                'date' => Carbon::parse($l->due_date)->format('Y-m-d'),
                'kind' => 'CHARGE',
                'id' => (string) $l->id,
                'description' => (string) $l->description,
                'student_name' => $l->student_name,
                'group_name' => $l->group_name,
                'currency' => (string) $l->currency,
                'debit_minor' => (int) $l->amount_minor,
                'credit_minor' => 0,
                'paid_minor' => min((int) $l->paid, (int) $l->amount_minor),
                'invoice_url' => AcademyUrl::invoice($academyId, (string) $l->public_token),
            ];
        }
        foreach ($receipts as $r) {
            $entries[] = [
                'date' => Carbon::parse($r->received_on)->format('Y-m-d'),
                'kind' => 'RECEIPT',
                'id' => (string) $r->id,
                'description' => (string) $r->number,
                'method' => (string) $r->method,
                'reference' => $r->reference,
                'currency' => (string) $r->currency,
                'debit_minor' => 0,
                'credit_minor' => (int) $r->amount_minor,
            ];
        }
        // Charges before receipts on the same day: the bill is raised, then paid.
        usort($entries, fn ($a, $b) => [$a['currency'], $a['date'], $a['kind'] === 'RECEIPT'] <=> [$b['currency'], $b['date'], $b['kind'] === 'RECEIPT']);

        $currencies = [];
        foreach ($entries as $e) {
            $c = $e['currency'];
            $currencies[$c] ??= ['currency' => $c, 'opening_minor' => 0, 'charges_minor' => 0, 'receipts_minor' => 0, 'closing_minor' => 0, 'entries' => []];
            if ($e['date'] < $from) {
                $currencies[$c]['opening_minor'] += $e['debit_minor'] - $e['credit_minor'];

                continue;
            }
            if ($e['date'] > $to) {
                continue;
            }
            $currencies[$c]['charges_minor'] += $e['debit_minor'];
            $currencies[$c]['receipts_minor'] += $e['credit_minor'];
            $currencies[$c]['entries'][] = $e;
        }
        foreach ($currencies as $c => $cur) {
            $running = $cur['opening_minor'];
            foreach ($cur['entries'] as $i => $e) {
                $running += $e['debit_minor'] - $e['credit_minor'];
                $currencies[$c]['entries'][$i]['balance_minor'] = $running;
            }
            $currencies[$c]['closing_minor'] = $running;
        }
        ksort($currencies);

        return response()->json([
            'payer' => $this->payerContact($payer + ['payer_name' => null]),
            'students' => DB::table('students')
                ->when($payer['guardian_id'] !== null, fn ($q) => $q->where('guardian_id', $payer['guardian_id']), fn ($q) => $q->where('id', $payer['student_id']))
                ->whereNull('deleted_at')->orderBy('full_name')->pluck('full_name')->all(),
            'from' => $from,
            'to' => $to,
            'currencies' => array_values($currencies),
            // What is actually owed and held right now, whatever the window shows.
            'balance' => $this->ledger->balance($academyId, $payer),
        ]);
    }

    // ── Daily collections ───────────────────────────────────────────────────

    public function daily(Request $request): JsonResponse
    {
        Gate::authorize('invoice.read');
        $academyId = $this->academyId();
        $data = $request->validate([
            'from' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            'to' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            'collector_id' => ['sometimes', 'nullable', 'uuid'],
        ]);
        $tz = $this->timezone($academyId);
        $to = $data['to'] ?? Carbon::now($tz)->format('Y-m-d');
        $from = $data['from'] ?? Carbon::parse($to)->subDays(13)->format('Y-m-d');
        if (Carbon::parse($from)->diffInDays(Carbon::parse($to)) > 92) {
            throw ValidationException::withMessages(['from' => ['Up to three months at a time. / حتى ثلاثة أشهر في المرة.']]);
        }

        $receipts = DB::table('receipts as r')
            ->leftJoin('users as u', 'u.id', '=', 'r.received_by')
            ->whereNull('r.voided_at')
            ->whereBetween('r.received_on', [$from, $to])
            ->when(isset($data['collector_id']), fn ($q) => $q->where('r.received_by', $data['collector_id']))
            ->get(['r.amount_minor', 'r.currency', 'r.method', 'r.received_on', 'r.received_by', 'r.source', 'u.full_name as collector']);
        $voided = DB::table('receipts')
            ->whereNotNull('voided_at')
            ->whereBetween('received_on', [$from, $to])
            ->when(isset($data['collector_id']), fn ($q) => $q->where('received_by', $data['collector_id']))
            ->groupBy('received_on')
            ->get(['received_on', DB::raw('count(*) as n')])
            ->mapWithKeys(fn ($r) => [Carbon::parse($r->received_on)->format('Y-m-d') => (int) $r->n]);

        $days = [];
        $totals = [];
        foreach ($receipts as $r) {
            $d = Carbon::parse($r->received_on)->format('Y-m-d');
            $c = (string) $r->currency;
            $amount = (int) $r->amount_minor;
            $who = $r->received_by !== null ? (string) $r->received_by : 'system';
            $days[$d][$c] ??= ['currency' => $c, 'amount_minor' => 0, 'count' => 0, 'by_method' => [], 'by_collector' => []];
            $days[$d][$c]['amount_minor'] += $amount;
            $days[$d][$c]['count']++;
            $days[$d][$c]['by_method'][(string) $r->method] = ($days[$d][$c]['by_method'][(string) $r->method] ?? 0) + $amount;
            $days[$d][$c]['by_collector'][$who] ??= ['id' => $r->received_by, 'name' => $r->collector, 'source' => (string) $r->source, 'amount_minor' => 0, 'count' => 0];
            $days[$d][$c]['by_collector'][$who]['amount_minor'] += $amount;
            $days[$d][$c]['by_collector'][$who]['count']++;
            $totals[$c] ??= ['currency' => $c, 'amount_minor' => 0, 'count' => 0, 'by_method' => []];
            $totals[$c]['amount_minor'] += $amount;
            $totals[$c]['count']++;
            $totals[$c]['by_method'][(string) $r->method] = ($totals[$c]['by_method'][(string) $r->method] ?? 0) + $amount;
        }

        $out = [];
        for ($d = Carbon::parse($to); $d->format('Y-m-d') >= $from; $d->subDay()) {
            $key = $d->format('Y-m-d');
            $out[] = [
                'date' => $key,
                'voided' => $voided[$key] ?? 0,
                'currencies' => array_values(array_map(function ($cur) {
                    $cur['by_collector'] = array_values($cur['by_collector']);

                    return $cur;
                }, $days[$key] ?? [])),
            ];
        }
        ksort($totals);

        return response()->json([
            'from' => $from,
            'to' => $to,
            'days' => $out,
            'totals' => array_values($totals),
            'collectors' => DB::table('receipts as r')->join('users as u', 'u.id', '=', 'r.received_by')
                ->distinct()->orderBy('u.full_name')->get(['u.id', 'u.full_name'])
                ->map(fn ($u) => ['id' => (string) $u->id, 'name' => (string) $u->full_name])->all(),
        ]);
    }

    // ── internals ───────────────────────────────────────────────────────────

    /** Every non-void invoice line of the academy, with what receipts paid on it and its due date. */
    private function linesQuery(string $academyId)
    {
        $paid = DB::table('receipt_allocations')->selectRaw('invoice_line_id, sum(amount_minor) as paid')->groupBy('invoice_line_id');

        return DB::table('invoice_line_items as li')
            ->join('invoices as i', 'i.id', '=', 'li.invoice_id')
            ->leftJoinSub($paid, 'a', 'a.invoice_line_id', '=', 'li.id')
            ->where('i.academy_id', $academyId)
            ->where('i.status', '<>', 'VOID')
            ->where('li.amount_minor', '>', 0)
            ->select([
                'li.id', 'li.invoice_id', 'li.student_id', 'li.class_group_id', 'li.group_period', 'li.currency', 'li.amount_minor',
                'i.guardian_id', 'i.student_id as payer_student_id', 'i.payer_name',
                DB::raw('coalesce(a.paid, 0) as paid'),
                DB::raw('coalesce(li.session_date, make_date(i.period_year::int, i.period_month::int, 1)) as due_date'),
            ]);
    }

    /** @return Collection<int, object> */
    private function openLines(string $academyId): Collection
    {
        return $this->linesQuery($academyId)->whereRaw('li.amount_minor > coalesce(a.paid, 0)')->get();
    }

    private function payerKey(object $l): string
    {
        return $l->guardian_id !== null ? 'g:'.$l->guardian_id : ($l->payer_student_id !== null ? 's:'.$l->payer_student_id : 'n:'.$l->invoice_id);
    }

    /**
     * Open lines → one entry per payer: what they owe per currency, aged.
     *
     * @param  Collection<int, object>  $lines
     * @return array<string, array<string, mixed>>
     */
    private function groupByPayer(Collection $lines): array
    {
        $today = Carbon::now($this->timezone($this->academyId()))->format('Y-m-d');
        $out = [];
        foreach ($lines as $l) {
            $key = $this->payerKey($l);
            $c = (string) $l->currency;
            $left = (int) $l->amount_minor - (int) $l->paid;
            $out[$key] ??= [
                'kind' => $l->guardian_id !== null ? 'GUARDIAN' : ($l->payer_student_id !== null ? 'STUDENT' : 'NAME'),
                'id' => $l->guardian_id ?? $l->payer_student_id,
                'payer_name' => $l->payer_name,
                'students' => [],
                'groups' => [],
                'due' => [],
                'oldest' => null,
                'lines' => 0,
            ];
            $out[$key]['due'][$c] ??= ['currency' => $c, 'due_minor' => 0, 'overdue_minor' => 0] + array_fill_keys(self::BUCKETS, 0);
            $out[$key]['due'][$c]['due_minor'] += $left;
            $out[$key]['due'][$c][$this->bucket((string) $l->due_date, $today)] += $left;
            if (Carbon::parse($l->due_date)->format('Y-m') < substr($today, 0, 7)) {
                $out[$key]['due'][$c]['overdue_minor'] += $left;
            }
            if ($l->student_id !== null) {
                $out[$key]['students'][(string) $l->student_id] = true;
            }
            if ($l->class_group_id !== null) {
                $out[$key]['groups'][(string) $l->class_group_id] = true;
            }
            $date = Carbon::parse($l->due_date)->format('Y-m-d');
            $out[$key]['oldest'] = $out[$key]['oldest'] === null || $date < $out[$key]['oldest'] ? $date : $out[$key]['oldest'];
            $out[$key]['lines']++;
        }

        return $out;
    }

    /**
     * Biggest debt first (summed across currencies — currencies are few, and the order is all it is used for).
     *
     * @param  array<string, array<string, mixed>>  $payers
     * @return list<array<string, mixed>>
     */
    private function sortByDue(array $payers): array
    {
        $list = array_values($payers);
        usort($list, fn ($a, $b) => array_sum(array_column($b['due'], 'due_minor')) <=> array_sum(array_column($a['due'], 'due_minor')));

        return $list;
    }

    /**
     * Names, phones, children, groups and the last payment for a list of payers.
     *
     * @param  list<array<string, mixed>>  $payers
     * @return list<array<string, mixed>>
     */
    private function presentPayers(array $payers): array
    {
        $guardianIds = array_values(array_filter(array_map(fn ($p) => $p['kind'] === 'GUARDIAN' ? (string) $p['id'] : null, $payers)));
        $studentPayerIds = array_values(array_filter(array_map(fn ($p) => $p['kind'] === 'STUDENT' ? (string) $p['id'] : null, $payers)));
        $studentIds = array_values(array_unique(array_merge($studentPayerIds, ...array_map(fn ($p) => array_keys($p['students']), $payers))));
        $groupIds = array_values(array_unique(array_merge([], ...array_map(fn ($p) => array_keys($p['groups']), $payers))));

        $guardians = $guardianIds === [] ? collect() : DB::table('guardians')->whereIn('id', $guardianIds)->get(['id', 'full_name', 'whatsapp_phone'])->keyBy(fn ($g) => (string) $g->id);
        $students = $studentIds === [] ? collect() : DB::table('students')->whereIn('id', $studentIds)->get(['id', 'full_name', 'whatsapp_phone'])->keyBy(fn ($s) => (string) $s->id);
        $groups = $groupIds === [] ? collect() : DB::table('class_groups')->whereIn('id', $groupIds)->pluck('name', 'id');

        $last = collect();
        if ($guardianIds !== [] || $studentPayerIds !== []) {
            $last = DB::table('receipts')
                ->whereNull('voided_at')
                ->where(fn ($q) => $q->whereIn('guardian_id', $guardianIds ?: ['00000000-0000-0000-0000-000000000000'])
                    ->orWhereIn('student_id', $studentPayerIds ?: ['00000000-0000-0000-0000-000000000000']))
                ->orderByDesc('received_on')->orderByDesc('created_at')->orderByDesc('number')
                ->get(['guardian_id', 'student_id', 'id', 'number', 'received_on', 'amount_minor', 'currency'])
                ->unique(fn ($r) => $r->guardian_id !== null ? 'g:'.$r->guardian_id : 's:'.$r->student_id)
                ->keyBy(fn ($r) => $r->guardian_id !== null ? 'g:'.$r->guardian_id : 's:'.$r->student_id);
        }

        return array_map(function ($p) use ($guardians, $students, $groups, $last) {
            $id = $p['id'] !== null ? (string) $p['id'] : null;
            $contact = match ($p['kind']) {
                'GUARDIAN' => $guardians[$id] ?? null,
                'STUDENT' => $students[$id] ?? null,
                default => null,
            };
            $lastReceipt = $id !== null ? ($last[($p['kind'] === 'GUARDIAN' ? 'g:' : 's:').$id] ?? null) : null;

            return [
                'kind' => $p['kind'],
                'id' => $id,
                'name' => $contact->full_name ?? $p['payer_name'],
                'phone' => $contact->whatsapp_phone ?? null,
                'students' => array_values(array_filter(array_map(fn ($sid) => $students[$sid]->full_name ?? null, array_keys($p['students'])))),
                'groups' => array_values(array_filter(array_map(fn ($gid) => $groups[$gid] ?? null, array_keys($p['groups'])))),
                'balances' => array_values($p['due']),
                'oldest_due' => $p['oldest'],
                'open_charges' => $p['lines'],
                'last_receipt' => $lastReceipt !== null ? [
                    'id' => (string) $lastReceipt->id,
                    'number' => (string) $lastReceipt->number,
                    'received_on' => Carbon::parse($lastReceipt->received_on)->format('Y-m-d'),
                    'amount_minor' => (int) $lastReceipt->amount_minor,
                    'currency' => (string) $lastReceipt->currency,
                ] : null,
            ];
        }, $payers);
    }

    /**
     * @param  array{guardian_id: ?string, student_id: ?string, payer_name: ?string}  $payer
     * @return array{kind: string, id: ?string, name: ?string, phone: ?string}
     */
    private function payerContact(array $payer): array
    {
        if ($payer['guardian_id'] !== null) {
            $g = DB::table('guardians')->where('id', $payer['guardian_id'])->first(['full_name', 'whatsapp_phone']);

            return ['kind' => 'GUARDIAN', 'id' => (string) $payer['guardian_id'], 'name' => $g->full_name ?? null, 'phone' => $g->whatsapp_phone ?? null];
        }
        $s = DB::table('students')->where('id', $payer['student_id'])->first(['full_name', 'whatsapp_phone']);

        return ['kind' => 'STUDENT', 'id' => (string) $payer['student_id'], 'name' => $s->full_name ?? null, 'phone' => $s->whatsapp_phone ?? null];
    }

    /**
     * @param  array<string, mixed>  $m
     * @return array<string, mixed>
     */
    private function finishMoney(array $m, bool $seesCost): array
    {
        $m['rate'] = $m['expected_minor'] > 0 ? round($m['collected_minor'] / $m['expected_minor'], 4) : null;
        if ($seesCost) {
            $m['teacher_cost_minor'] = (int) ($m['teacher_cost_minor'] ?? 0);
            $m['net_minor'] = $m['received_in_month_minor'] - $m['teacher_cost_minor'];
            $m['margin'] = $m['received_in_month_minor'] > 0 ? round($m['net_minor'] / $m['received_in_month_minor'], 4) : null;
        } else {
            $m['teacher_cost_minor'] = null;
            $m['net_minor'] = null;
            $m['margin'] = null;
        }

        return $m;
    }

    private function bucket(string $dueDate, string $today): string
    {
        $age = (int) Carbon::parse($dueDate)->startOfDay()->diffInDays(Carbon::parse($today)->startOfDay(), false);

        return match (true) {
            $age <= 30 => 'd0_30',
            $age <= 60 => 'd31_60',
            $age <= 90 => 'd61_90',
            default => 'd90_plus',
        };
    }

    /**
     * @param  Collection<int, object>  $lines
     * @param  list<string>  $links
     */
    private function reminderMessage(string $academy, string $name, Collection $lines, array $links): string
    {
        $due = $lines->groupBy('currency')->map(fn ($g, $c) => number_format($g->sum(fn ($l) => (int) $l->amount_minor - (int) $l->allocated) / 100, 2).' '.$c)->values()->implode(' + ');
        $items = $lines->take(6)->map(fn ($l) => '• '.$l->description.' — '.number_format(((int) $l->amount_minor - (int) $l->allocated) / 100, 2).' '.$l->currency)->implode("\n");
        $more = $lines->count() > 6 ? "\n• …" : '';
        $linkText = implode("\n", $links);

        $ar = ["🔔 *تذكير بالمستحقات — {$academy}*"];
        if ($name !== '') {
            $ar[] = "👤 {$name}";
        }
        $ar[] = "💰 المبلغ المستحق: {$due}";
        $ar[] = '';
        $ar[] = $items.$more;
        if ($linkText !== '') {
            $ar[] = '';
            $ar[] = "💳 للتفاصيل والدفع:\n{$linkText}";
        }
        $ar[] = '';
        $ar[] = 'شكرًا لكم 🌷';

        $en = ["🔔 *Payment reminder — {$academy}*", "💰 Amount due: {$due}"];
        if ($linkText !== '') {
            $en[] = "💳 Details & pay:\n{$linkText}";
        }

        return implode("\n", $ar)."\n\n———\n\n".implode("\n", $en);
    }

    /** @return array{0: string, 1: string, 2: string} [YYYY-MM, first day, last day] */
    private function month(Request $request, string $academyId): array
    {
        $data = $request->validate(['month' => ['sometimes', 'nullable', 'date_format:Y-m']]);
        $month = Carbon::parse(($data['month'] ?? Carbon::now($this->timezone($academyId))->format('Y-m')).'-01');

        return [$month->format('Y-m'), $month->format('Y-m-d'), $month->copy()->endOfMonth()->format('Y-m-d')];
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
