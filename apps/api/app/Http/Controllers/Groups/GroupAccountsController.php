<?php

declare(strict_types=1);

namespace App\Http\Controllers\Groups;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Groups\Concerns\InteractsWithClassGroups;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * GET /groups/{id}/accounts?month=YYYY-MM — one group's collection sheet (حسابات المجموعة,
 * docs/groups/01-ACCOUNTING.md). Built on receipts, so every figure is exact:
 *
 *   per member   what the month charged them, what receipts have paid on it, what is left, what is
 *                still owed from EARLIER months of this group (arrears), their last payment, and who
 *                pays for them — everything the Collect button needs
 *   per currency expected / collected / remaining / arrears, the collection rate, how many members
 *                are paid, part-paid, unpaid; what came in during the month (cash basis, whatever
 *                month it paid for); and, for whoever may read payroll, the teacher cost and the net
 *
 * `invoice.read`, like the money tab it replaces for a receipt-kept academy (entitled:accounting).
 */
final class GroupAccountsController extends Controller
{
    use InteractsWithClassGroups;

    public function show(Request $request, string $id): JsonResponse
    {
        Gate::authorize('invoice.read');
        $group = $this->findGroup($id);
        $data = $request->validate(['month' => ['sometimes', 'nullable', 'date_format:Y-m']]);
        $month = Carbon::parse(($data['month'] ?? Carbon::now((string) $group->timezone)->format('Y-m')).'-01');
        $from = $month->format('Y-m-d');
        $to = $month->copy()->endOfMonth()->format('Y-m-d');

        $paidByLine = DB::table('receipt_allocations')
            ->selectRaw('invoice_line_id, sum(amount_minor) as paid')
            ->groupBy('invoice_line_id');

        // Every charge this group has raised up to the end of the month: the month's own, and the
        // older ones that may still be owed.
        $lines = DB::table('invoice_line_items as li')
            ->join('invoices as i', 'i.id', '=', 'li.invoice_id')
            ->leftJoinSub($paidByLine, 'p', 'p.invoice_line_id', '=', 'li.id')
            ->where('li.class_group_id', $id)
            ->where('i.status', '<>', 'VOID')
            ->where('li.group_period', '<=', $to)
            ->get([
                'li.id', 'li.student_id', 'li.description', 'li.amount_minor', 'li.currency', 'li.group_charge', 'li.group_period',
                'li.invoice_id', 'i.guardian_id', 'i.student_id as payer_student_id', 'i.payer_name',
                DB::raw('coalesce(p.paid, 0) as paid'),
            ]);

        $members = DB::table('class_group_members as m')
            ->join('students as st', 'st.id', '=', 'm.student_id')
            ->leftJoin('guardians as g', 'g.id', '=', 'st.guardian_id')
            ->where('m.group_id', $id)
            ->where('m.joined_on', '<=', $to)
            ->where(fn ($q) => $q->whereNull('m.left_on')->orWhere('m.left_on', '>', $from))
            ->orderBy('st.full_name')
            ->get(['m.student_id', 'm.status', 'm.joined_on', 'm.left_on', 'm.price_minor', 'm.renewal_held_from', 'st.full_name', 'st.status as student_status',
                'st.guardian_id', 'st.whatsapp_phone as student_phone', 'g.full_name as guardian_name', 'g.whatsapp_phone as guardian_phone']);

        // The last receipt that paid this group for each student.
        $last = DB::table('receipt_allocations as ra')
            ->join('invoice_line_items as li', 'li.id', '=', 'ra.invoice_line_id')
            ->join('receipts as r', 'r.id', '=', 'ra.receipt_id')
            ->where('li.class_group_id', $id)
            ->whereNull('r.voided_at')
            ->orderByDesc('r.received_on')->orderByDesc('r.created_at')
            ->get(['li.student_id', 'r.id', 'r.number', 'r.received_on', 'r.method', 'r.amount_minor', 'r.currency'])
            ->unique('student_id')
            ->keyBy(fn ($r) => (string) $r->student_id);

        $byStudent = $lines->groupBy(fn ($l) => (string) $l->student_id);
        $studentIds = $members->pluck('student_id')->map(fn ($s) => (string) $s)
            ->merge($lines->where('group_period', '>=', $from)->pluck('student_id')->map(fn ($s) => (string) $s))
            ->unique()->values();
        $extra = DB::table('students as st')->leftJoin('guardians as g', 'g.id', '=', 'st.guardian_id')
            ->whereIn('st.id', $studentIds->diff($members->pluck('student_id')->map(fn ($s) => (string) $s))->values()->all())
            ->get(['st.id as student_id', 'st.full_name', 'st.status as student_status', 'st.guardian_id', 'st.whatsapp_phone as student_phone',
                'g.full_name as guardian_name', 'g.whatsapp_phone as guardian_phone']);
        $memberRows = $members->keyBy(fn ($m) => (string) $m->student_id);

        $rows = [];
        $totals = [];
        foreach ($studentIds as $sid) {
            $m = $memberRows[$sid] ?? $extra->firstWhere('student_id', $sid);
            if ($m === null) {
                continue;
            }
            $own = $byStudent[$sid] ?? collect();
            $monthLines = $own->filter(fn ($l) => Carbon::parse($l->group_period)->format('Y-m-d') >= $from);
            $older = $own->filter(fn ($l) => Carbon::parse($l->group_period)->format('Y-m-d') < $from);

            $currency = (string) ($monthLines->first()->currency ?? $own->first()->currency ?? $group->currency ?? '');
            $due = (int) $monthLines->sum('amount_minor');
            $paid = (int) $monthLines->sum(fn ($l) => min((int) $l->paid, (int) $l->amount_minor));
            $remaining = $due - $paid;
            $arrears = (int) $older->sum(fn ($l) => max(0, (int) $l->amount_minor - (int) $l->paid));

            $state = match (true) {
                $monthLines->isEmpty() => 'NO_CHARGE',
                $due === 0 => 'FREE',
                $remaining <= 0 => 'PAID',
                $paid > 0 => 'PARTIAL',
                default => 'UNPAID',
            };

            // Who pays: the payer on their latest invoice line, else what the academy would bill.
            $payerLine = $own->sortByDesc('group_period')->first();
            $payer = $payerLine !== null
                ? ($payerLine->guardian_id !== null
                    ? ['kind' => 'GUARDIAN', 'id' => (string) $payerLine->guardian_id]
                    : ($payerLine->payer_student_id !== null ? ['kind' => 'STUDENT', 'id' => (string) $payerLine->payer_student_id] : ['kind' => 'NAME', 'id' => null]))
                : ($m->guardian_id !== null ? ['kind' => 'GUARDIAN', 'id' => (string) $m->guardian_id] : ['kind' => 'STUDENT', 'id' => $sid]);
            $payer['name'] = $payer['kind'] === 'GUARDIAN' ? $m->guardian_name : $m->full_name;
            $payer['phone'] = $payer['kind'] === 'GUARDIAN' ? $m->guardian_phone : $m->student_phone;

            $lastReceipt = $last[$sid] ?? null;
            $rows[] = [
                'student_id' => $sid,
                'student_name' => $m->full_name,
                'member_status' => isset($memberRows[$sid]) ? (string) $m->status : 'LEFT',
                'joined_on' => isset($m->joined_on) ? Carbon::parse($m->joined_on)->format('Y-m-d') : null,
                'left_on' => isset($m->left_on) && $m->left_on !== null ? Carbon::parse($m->left_on)->format('Y-m-d') : null,
                'is_trial' => in_array($m->student_status, ['TRIAL', 'TRIAL_BOOKED'], true),
                'payer' => $payer,
                'currency' => $currency,
                'due_minor' => $due,
                'paid_minor' => $paid,
                'remaining_minor' => $remaining,
                'arrears_minor' => $arrears,
                'state' => $state,
                // Pay first: their next month is held until what they owe here is paid (RenewalPolicy).
                'awaiting_payment_since' => isset($m->renewal_held_from) && $m->renewal_held_from !== null ? Carbon::parse($m->renewal_held_from)->format('Y-m-d') : null,
                'charges' => $monthLines->sortBy('group_period')->map(fn ($l) => [
                    'line_id' => (string) $l->id,
                    'description' => (string) $l->description,
                    'charge' => (string) $l->group_charge,
                    'period' => Carbon::parse($l->group_period)->format('Y-m-d'),
                    'amount_minor' => (int) $l->amount_minor,
                    'paid_minor' => (int) $l->paid,
                ])->values()->all(),
                // What the Collect button pre-ticks: this month's unpaid lines, then older ones.
                'open_line_ids' => $own->filter(fn ($l) => (int) $l->amount_minor > (int) $l->paid)
                    ->sortBy(fn ($l) => Carbon::parse($l->group_period)->format('Y-m-d'))
                    ->pluck('id')->map(fn ($v) => (string) $v)->values()->all(),
                'last_receipt' => $lastReceipt !== null ? [
                    'id' => (string) $lastReceipt->id,
                    'number' => (string) $lastReceipt->number,
                    'received_on' => Carbon::parse($lastReceipt->received_on)->format('Y-m-d'),
                    'method' => (string) $lastReceipt->method,
                ] : null,
            ];

            if ($currency === '') {
                continue;
            }
            $totals[$currency] ??= [
                'currency' => $currency, 'expected_minor' => 0, 'collected_minor' => 0, 'remaining_minor' => 0, 'arrears_minor' => 0,
                'received_in_month_minor' => 0, 'paid' => 0, 'partial' => 0, 'unpaid' => 0, 'rate' => null, 'teacher_cost_minor' => null, 'net_minor' => null,
            ];
            $totals[$currency]['expected_minor'] += $due;
            $totals[$currency]['collected_minor'] += $paid;
            $totals[$currency]['remaining_minor'] += max(0, $remaining);
            $totals[$currency]['arrears_minor'] += $arrears;
            match ($state) {
                'PAID' => $totals[$currency]['paid']++,
                'PARTIAL' => $totals[$currency]['partial']++,
                'UNPAID' => $totals[$currency]['unpaid']++,
                default => null,
            };
        }

        // Cash basis: what receipts dated in this month paid on this group, whichever month it was for.
        foreach (DB::table('receipt_allocations as ra')
            ->join('invoice_line_items as li', 'li.id', '=', 'ra.invoice_line_id')
            ->join('receipts as r', 'r.id', '=', 'ra.receipt_id')
            ->where('li.class_group_id', $id)
            ->whereNull('r.voided_at')
            ->whereBetween('r.received_on', [$from, $to])
            ->groupBy('li.currency')
            ->get(['li.currency', DB::raw('sum(ra.amount_minor) as amount')]) as $c) {
            $cur = (string) $c->currency;
            $totals[$cur] ??= ['currency' => $cur, 'expected_minor' => 0, 'collected_minor' => 0, 'remaining_minor' => 0, 'arrears_minor' => 0,
                'received_in_month_minor' => 0, 'paid' => 0, 'partial' => 0, 'unpaid' => 0, 'rate' => null, 'teacher_cost_minor' => null, 'net_minor' => null];
            $totals[$cur]['received_in_month_minor'] = (int) $c->amount;
        }

        if (Gate::allows('payout.read')) {
            foreach (DB::table('payout_line_items as pl')
                ->leftJoin('class_group_lessons as l', 'l.id', '=', 'pl.class_group_lesson_id')
                ->where(fn ($q) => $q->where('l.group_id', $id)->orWhere('pl.class_group_id', $id))
                ->whereBetween('pl.session_date', [$from, $to])
                ->groupBy('pl.currency')
                ->get(['pl.currency', DB::raw('sum(pl.amount_minor) as amount')]) as $c) {
                $cur = (string) $c->currency;
                if (isset($totals[$cur])) {
                    $totals[$cur]['teacher_cost_minor'] = (int) $c->amount;
                }
            }
        }

        foreach ($totals as $cur => $t) {
            $totals[$cur]['rate'] = $t['expected_minor'] > 0 ? round($t['collected_minor'] / $t['expected_minor'], 4) : null;
            if ($t['teacher_cost_minor'] !== null || Gate::allows('payout.read')) {
                $totals[$cur]['teacher_cost_minor'] ??= 0;
                $totals[$cur]['net_minor'] = $t['collected_minor'] - $totals[$cur]['teacher_cost_minor'];
            }
        }
        ksort($totals);

        // Unpaid first, then part-paid, then the rest — the sheet is worked top-down.
        $order = ['UNPAID' => 0, 'PARTIAL' => 1, 'PAID' => 2, 'FREE' => 3, 'NO_CHARGE' => 4];
        usort($rows, fn ($a, $b) => [$order[$a['state']], $a['student_name']] <=> [$order[$b['state']], $b['student_name']]);

        return response()->json([
            'month' => $month->format('Y-m'),
            'group' => [
                'id' => (string) $group->id,
                'name' => (string) $group->name,
                'billing_mode' => (string) $group->billing_mode,
                'price_minor' => $group->price_minor !== null ? (int) $group->price_minor : null,
                'currency' => $group->currency,
            ],
            'rows' => $rows,
            'totals' => array_values($totals),
            'sees_teacher_cost' => Gate::allows('payout.read'),
            'can_collect' => Gate::allows('invoice.mark_paid'),
        ]);
    }
}
