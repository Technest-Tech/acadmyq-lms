<?php

declare(strict_types=1);

namespace App\Services;

use App\Support\Audit;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * A student's charges follow them to the family they move to.
 *
 * In an academy that bills families (PER_GUARDIAN) a child's lessons, group months and package go
 * on their parent's bills. Moving the child to another parent used to re-point the child alone: the
 * old parent kept every bill — a parent with no children left still owing — and the new one owed
 * nothing (lingo, 2026-10-28: two «آيات محسن», the child moved to delete the duplicate).
 *
 * What moves, bill by bill, for every bill of another family that holds a line of this student:
 *
 *   - a bill still OPEN (the running month): all of the student's lines go to the new family's bill
 *     for that month, so the month stays whole (a per-month fee counts its lessons per bill). A bill
 *     that is only the student's changes hands as it is.
 *   - a bill already closed that is only the student's, with something still owed: it changes hands
 *     whole — its money is frozen, its addressee is not.
 *   - a closed bill shared with siblings: it cannot be split (its totals are frozen), so the
 *     student's part stays and is reported as `stuck`.
 *   - anything fully paid stays where it was: history keeps the family that paid it.
 *
 * Receipts never move — money stays recorded against whoever paid it; its allocations still cover
 * the lines they covered, now on the new family's bills. A student's own bills (a PER_STUDENT
 * academy, a package bill raised on the child) follow them by themselves and are not touched.
 * Runs inside the caller's tenant transaction.
 */
final class FamilyCharges
{
    public function __construct(
        private readonly Invoicing $invoicing,
        private readonly Ledger $ledger,
    ) {}

    /**
     * Carry the student's charges onto the bills of the family they are in now — from one family
     * (`$fromGuardianId`, the one they just left) or from every other family's bills.
     *
     * @return array{lines: int, invoices: int, stuck: int, amounts: list<array{currency: string, amount_minor: int}>}
     */
    public function carry(string $academyId, string $studentId, ?string $fromGuardianId, ?string $actorUserId, ?string $actorRole): array
    {
        $result = ['lines' => 0, 'invoices' => 0, 'stuck' => 0, 'amounts' => []];
        $academy = DB::table('academies')->where('id', $academyId)->first();
        $to = DB::table('students')->where('id', $studentId)->value('guardian_id');
        if ($academy === null || $to === null || ! Ledger::poolsFamily($academyId)) {
            return $result;
        }
        $to = (string) $to;
        $keeps = Ledger::keeps($academyId);

        $invoices = DB::table('invoices')
            ->where('academy_id', $academyId)
            ->whereNotNull('guardian_id')
            ->where('guardian_id', '<>', $to)
            ->when($fromGuardianId !== null, fn ($q) => $q->where('guardian_id', $fromGuardianId))
            ->where('status', '<>', 'VOID')
            ->whereExists(fn ($q) => $q->selectRaw('1')->from('invoice_line_items as li')
                ->whereColumn('li.invoice_id', 'invoices.id')->where('li.student_id', $studentId))
            ->orderBy('period_year')->orderBy('period_month')->orderBy('id')
            ->lockForUpdate()
            ->get();

        $amounts = [];
        $touched = [];
        $from = [];
        foreach ($invoices as $inv) {
            $lines = $this->lines((string) $inv->id);
            $mine = $lines->filter(fn ($l) => (string) $l->student_id === $studentId)->values();
            $shared = $lines->count() > $mine->count();
            $owed = $this->owed($mine, $inv, $keeps);

            if ($inv->status !== 'OPEN' && $owed <= 0) {
                continue; // paid: the family that paid it keeps it
            }
            if ($inv->status !== 'OPEN' && $shared) {
                $result['stuck'] += $mine->count();

                continue;
            }

            if (! $shared) {
                $touched[] = $this->takeWhole($academy, $inv, $to);
            } else {
                $target = $this->invoicing->openInvoiceFor($academy, $to, null, (int) $inv->period_year, (int) $inv->period_month, (string) $inv->currency);
                $this->moveLines($mine, $inv, $target);
                $touched[] = $target;
            }
            $from[] = (string) $inv->guardian_id;
            $result['lines'] += $mine->count();
            $result['invoices']++;
            if ($owed > 0) {
                $amounts[(string) $inv->currency] = ($amounts[(string) $inv->currency] ?? 0) + $owed;
            }
        }

        // The new family's credit pays what just arrived.
        foreach (array_unique($touched) as $invoiceId) {
            $this->ledger->afterLinesChanged($invoiceId);
        }

        ksort($amounts);
        $result['amounts'] = array_map(fn ($c, $a) => ['currency' => (string) $c, 'amount_minor' => $a], array_keys($amounts), array_values($amounts));
        if ($result['lines'] > 0 || $result['stuck'] > 0) {
            Audit::log('student.charges_moved', 'student', $studentId, $academyId, $actorUserId, $actorRole,
                before: ['guardian_ids' => array_values(array_unique($from))],
                after: ['guardian_id' => $to] + $result);
        }

        return $result;
    }

    /**
     * What a family's bills still hold for children who are no longer in it — each with the family
     * they are in now, so the page can offer to send it after them. `movable` is false when all of
     * it sits on closed bills shared with siblings, which {@see carry()} cannot split.
     *
     * @return list<array{student_id: string, student_name: string, guardian_id: string, guardian_name: ?string, movable: bool, amounts: list<array{currency: string, amount_minor: int}>}>
     */
    public function strays(string $academyId, string $guardianId): array
    {
        if (! Ledger::poolsFamily($academyId)) {
            return [];
        }
        $keeps = Ledger::keeps($academyId);

        $invoices = DB::table('invoices as i')
            ->where('i.academy_id', $academyId)
            ->where('i.guardian_id', $guardianId)
            ->where('i.status', '<>', 'VOID')
            ->whereExists(fn ($q) => $q->selectRaw('1')->from('invoice_line_items as li')
                ->join('students as s', 's.id', '=', 'li.student_id')
                ->whereColumn('li.invoice_id', 'i.id')
                ->whereNotNull('s.guardian_id')->where('s.guardian_id', '<>', $guardianId))
            ->get(['i.*']);

        $out = [];
        foreach ($invoices as $inv) {
            $lines = $this->lines((string) $inv->id);
            foreach ($lines->groupBy('student_id') as $studentId => $group) {
                $student = $studentId !== '' ? DB::table('students as s')->leftJoin('guardians as g', 'g.id', '=', 's.guardian_id')
                    ->where('s.id', $studentId)->first(['s.full_name', 's.guardian_id', 'g.full_name as guardian_name']) : null;
                if ($student === null || $student->guardian_id === null || (string) $student->guardian_id === $guardianId) {
                    continue;
                }
                $owed = $this->owed($group, $inv, $keeps);
                if ($owed <= 0) {
                    continue;
                }
                $out[$studentId] ??= ['student_id' => (string) $studentId, 'student_name' => (string) $student->full_name,
                    'guardian_id' => (string) $student->guardian_id, 'guardian_name' => $student->guardian_name, 'movable' => false, 'amounts' => []];
                $out[$studentId]['movable'] = $out[$studentId]['movable'] || $inv->status === 'OPEN' || $group->count() === $lines->count();
                $out[$studentId]['amounts'][(string) $inv->currency] = ($out[$studentId]['amounts'][(string) $inv->currency] ?? 0) + $owed;
            }
        }

        return array_values(array_map(function (array $s) {
            ksort($s['amounts']);
            $s['amounts'] = array_map(fn ($c, $a) => ['currency' => (string) $c, 'amount_minor' => $a], array_keys($s['amounts']), array_values($s['amounts']));

            return $s;
        }, $out));
    }

    /**
     * A bill that is only this student's goes to the new family as it is. Two automatic bills for
     * one family and month cannot exist: if the new family already has one, a running month's lines
     * join it (the emptied bill stays behind at zero — never deleted, payments may point at it);
     * otherwise the bill keeps its money and changes hands as a separate one.
     *
     * @return string the bill the lines are on now
     */
    private function takeWhole(object $academy, object $inv, string $to): string
    {
        if ($inv->kind === 'AUTO') {
            $twin = DB::table('invoices')
                ->where('academy_id', $academy->id)->where('kind', 'AUTO')->where('guardian_id', $to)
                ->where('currency', $inv->currency)->where('period_year', $inv->period_year)->where('period_month', $inv->period_month)
                ->lockForUpdate()->first();
            if ($twin !== null) {
                if ($inv->status === 'OPEN' && $twin->status === 'OPEN') {
                    $this->moveLines($this->lines((string) $inv->id), $inv, (string) $twin->id);

                    return (string) $twin->id;
                }
                DB::table('invoices')->where('id', $inv->id)->update(['guardian_id' => $to, 'kind' => 'MANUAL', 'updated_at' => now()]);

                return (string) $inv->id;
            }
        }
        DB::table('invoices')->where('id', $inv->id)->update(['guardian_id' => $to, 'updated_at' => now()]);

        return (string) $inv->id;
    }

    /**
     * Lines from one OPEN bill to another, with what has been paid on them and the totals of both.
     *
     * @param  Collection<int, object>  $lines
     */
    private function moveLines(Collection $lines, object $from, string $toInvoiceId): void
    {
        if ($lines->isEmpty() || (string) $from->id === $toInvoiceId) {
            return;
        }
        $ids = $lines->pluck('id')->map(fn ($id) => (string) $id)->all();
        $sum = (int) $lines->sum('amount_minor');

        DB::table('invoices')->where('id', $toInvoiceId)->update([
            'subtotal_minor' => DB::raw("subtotal_minor + {$sum}"),
            'total_minor' => DB::raw("total_minor + {$sum}"),
            'updated_at' => now(),
        ]);
        DB::table('invoice_line_items')->whereIn('id', $ids)->update(['invoice_id' => $toInvoiceId]);
        DB::table('receipt_allocations')->whereIn('invoice_line_id', $ids)->update(['invoice_id' => $toInvoiceId]);
        DB::table('invoices')->where('id', $from->id)->update([
            'subtotal_minor' => DB::raw("subtotal_minor - {$sum}"),
            'total_minor' => DB::raw("total_minor - {$sum}"),
            'updated_at' => now(),
        ]);
        // A package's overdraft lesson travels with its line; the package keeps finding it.
        DB::table('lesson_packages')->where('overdraft_invoice_id', $from->id)
            ->whereIn('student_id', $lines->pluck('student_id')->filter()->unique()->values()->all())
            ->update(['overdraft_invoice_id' => $toInvoiceId, 'updated_at' => now()]);
    }

    /** @return Collection<int, object> every line of the bill, with what receipts cover of it */
    private function lines(string $invoiceId): Collection
    {
        $allocated = DB::table('receipt_allocations')->selectRaw('invoice_line_id, sum(amount_minor) as allocated')->groupBy('invoice_line_id');

        return DB::table('invoice_line_items as li')
            ->leftJoinSub($allocated, 'a', 'a.invoice_line_id', '=', 'li.id')
            ->where('li.invoice_id', $invoiceId)
            ->get(['li.id', 'li.student_id', 'li.amount_minor', DB::raw('coalesce(a.allocated, 0) as allocated')])
            ->map(function ($l) {
                $l->student_id = $l->student_id !== null ? (string) $l->student_id : '';

                return $l;
            });
    }

    /**
     * What is still owed on these lines of the bill. Kept by receipts: line by line. The classic
     * "mark paid" only knows the bill as a whole, so a part-paid bill counts what is left of it.
     *
     * @param  Collection<int, object>  $lines
     */
    private function owed(Collection $lines, object $inv, bool $keeps): int
    {
        if ($keeps) {
            return (int) $lines->sum(fn ($l) => max(0, (int) $l->amount_minor - (int) $l->allocated));
        }

        return match ((string) $inv->status) {
            'OPEN', 'CLOSED' => (int) $lines->sum('amount_minor'),
            'PARTIALLY_PAID' => min((int) $lines->sum('amount_minor'), max(0, (int) $inv->total_minor - (int) $inv->amount_paid_minor)),
            default => 0,
        };
    }
}
