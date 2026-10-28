<?php

declare(strict_types=1);

namespace App\Services;

use App\Support\Audit;
use App\Support\Entitlement;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Letting a charge go — إلغاء المستحق (docs/groups/01-ACCOUNTING.md, "A family suspended, and
 * the dues raised ahead").
 *
 * A curriculum centre bills ahead: the month of a group is raised on the 1st, a private
 * subscription's bill when the block opens. A family that stops part-way (suspended, the child not
 * coming back) should not owe that, yet the charge stayed on the account. Cancelling takes what is
 * still UNPAID off the line — what was paid stays paid — and keeps the line, with how much was let
 * go, by whom and why, so nothing raises it again. Only on an OPEN bill (a closed bill's totals are
 * frozen), and only in a curriculum centre (`centre`) whose books are kept by receipts — no Quran
 * academy is ever touched.
 *
 * A line of a private subscription's own bill is the whole subscription: the bill goes with it,
 * and the subscription ends so no later lesson draws on a block nobody pays for — cancelled when
 * none of it was used (its bill voided outright if nothing was paid), else closed where it stands
 * and never renewed. The lessons it already gave stay given.
 */
final class ChargeCancellation
{
    public function __construct(private readonly LessonPackages $packages, private readonly Ledger $ledger) {}

    /** A curriculum centre (`centre`) on receipts — nobody else ever lets a charge go this way. */
    public static function availableFor(string $academyId): bool
    {
        return Ledger::enabledFor($academyId) && Entitlement::hasCapability($academyId, 'centre');
    }

    /**
     * What a family still owes for lessons it has not had yet: unpaid, on OPEN bills, for one of its
     * children — a group month or course from this month on, and the bill of a private subscription
     * still running. A lesson already given (a private lesson, a group lesson charged by the lesson)
     * is not in it.
     *
     * @return Collection<int, array{id:string, student_id:string, student_name:string, description:string, kind:string, date:?string, remaining_minor:int, currency:string}>
     */
    public function advanceDues(string $academyId, string $guardianId): Collection
    {
        if (! self::availableFor($academyId)) {
            return collect();
        }
        $childIds = DB::table('students')->where('guardian_id', $guardianId)->pluck('id')->map(fn ($v) => (string) $v)->all();
        if ($childIds === []) {
            return collect();
        }
        $timezone = (string) (DB::table('academies')->where('id', $academyId)->value('timezone') ?: 'UTC');
        $monthStart = Carbon::now($timezone)->startOfMonth()->toDateString();
        $runningPackage = "select 1 from lesson_packages p where p.invoice_id = li.invoice_id and p.status = 'ACTIVE'";

        return $this->linesQuery($academyId)
            ->whereIn('li.student_id', $childIds)
            ->where(function ($q) use ($monthStart, $runningPackage): void {
                $q->where(fn ($g) => $g->whereIn('li.group_charge', ['MONTHLY', 'COURSE'])
                    ->whereRaw('coalesce(li.group_period, li.session_date) >= ?::date', [$monthStart]))
                    ->orWhereRaw("exists ({$runningPackage})");
            })
            ->orderByRaw('li.session_date asc nulls last')
            ->orderBy('li.id')
            ->get()
            ->map(fn ($l) => [
                'id' => (string) $l->id,
                'student_id' => (string) $l->student_id,
                'student_name' => (string) $l->student_name,
                'description' => (string) $l->description,
                'kind' => $l->class_group_id !== null ? 'GROUP' : 'PACKAGE',
                'date' => $l->session_date !== null ? Carbon::parse($l->session_date)->format('Y-m-d') : null,
                'remaining_minor' => (int) $l->amount_minor - (int) $l->allocated,
                'currency' => (string) $l->currency,
            ])
            ->values();
    }

    /**
     * Cancel what is still owed on a charge (and, for a private subscription's bill, on the whole
     * bill — see the class note).
     *
     * @return array{lines:int, cancelled_minor:int, currency:string}
     */
    public function cancel(string $academyId, string $lineId, ?string $reason, ?string $userId, ?string $role): array
    {
        if (! self::availableFor($academyId)) {
            throw ValidationException::withMessages(['charge' => ['Cancelling a charge is for centres on the accounts. / إلغاء المستحق متاح للمراكز مع الحسابات.']]);
        }

        return DB::transaction(function () use ($academyId, $lineId, $reason, $userId, $role): array {
            $line = DB::table('invoice_line_items as li')
                ->join('invoices as i', 'i.id', '=', 'li.invoice_id')
                ->where('i.academy_id', $academyId)
                ->where('li.id', $lineId)
                ->first(['li.id', 'li.invoice_id', 'i.status as invoice_status']);
            if ($line === null) {
                throw ValidationException::withMessages(['charge' => ['Charge not found. / المستحق غير موجود.']]);
            }
            if ((string) $line->invoice_status !== 'OPEN') {
                throw ValidationException::withMessages(['charge' => ['Only a charge on an open bill can be cancelled. / يُلغى فقط مستحق على فاتورة مفتوحة.']]);
            }
            $invoiceId = (string) $line->invoice_id;
            DB::table('invoices')->where('id', $invoiceId)->lockForUpdate()->first();

            $package = DB::table('lesson_packages')->where('invoice_id', $invoiceId)->first();
            $owed = $this->linesQuery($academyId)
                ->where('li.invoice_id', $invoiceId)
                ->when($package === null, fn ($q) => $q->where('li.id', $lineId))
                ->get();
            if ($owed->isEmpty()) {
                throw ValidationException::withMessages(['charge' => ['Nothing is owed on this charge. / لا شيء مستحق على هذا البند.']]);
            }
            $currency = (string) $owed->first()->currency;
            $total = (int) $owed->sum(fn ($l) => (int) $l->amount_minor - (int) $l->allocated);

            if ($package !== null && (string) $package->status === 'ACTIVE') {
                $this->endPackage($package, $userId, $role);
                if (DB::table('invoices')->where('id', $invoiceId)->value('status') === 'VOID') {
                    $this->audit($academyId, $invoiceId, $owed, $total, $reason, $userId, $role, voided: true);

                    return ['lines' => $owed->count(), 'cancelled_minor' => $total, 'currency' => $currency];
                }
            }

            foreach ($owed as $l) {
                $remaining = (int) $l->amount_minor - (int) $l->allocated;
                DB::table('invoice_line_items')->where('id', $l->id)->update([
                    'amount_minor' => (int) $l->allocated,
                    'cancelled_minor' => DB::raw("cancelled_minor + {$remaining}"),
                    'cancelled_at' => now(),
                    'cancelled_by' => $userId,
                    'cancel_reason' => $reason,
                ]);
            }
            DB::table('invoices')->where('id', $invoiceId)->update([
                'subtotal_minor' => DB::raw("subtotal_minor - {$total}"),
                'total_minor' => DB::raw("total_minor - {$total}"),
                'updated_at' => now(),
            ]);
            DB::select('select app.ledger_refresh_invoice(?)', [$invoiceId]);
            $this->ledger->afterLinesChanged($invoiceId);

            // A teacher paid a share of the group's charges is paid on what the families now owe.
            foreach ($owed->whereNotNull('class_group_id')->whereNotNull('group_period')->unique(fn ($l) => $l->class_group_id.'|'.$l->group_period) as $l) {
                $group = DB::table('class_groups')->where('id', $l->class_group_id)->first();
                $period = Carbon::parse($l->group_period);
                if ($group !== null) {
                    app(GroupPayroll::class)->syncRevenueShare($group, (int) $period->year, (int) $period->month);
                }
            }
            $this->audit($academyId, $invoiceId, $owed, $total, $reason, $userId, $role, voided: false);

            return ['lines' => $owed->count(), 'cancelled_minor' => $total, 'currency' => $currency];
        });
    }

    /** A subscription whose bill is let go stops: cancelled if none of it was used, else closed as it stands. */
    private function endPackage(object $package, ?string $userId, ?string $role): void
    {
        if ((int) $package->minutes_consumed - (int) $package->absorbed_overdraft_minutes <= 0) {
            $this->packages->cancel((string) $package->id, 'CHARGE_CANCELLED', $userId, $role);

            return;
        }
        DB::table('lesson_packages')->where('id', $package->id)->update(['auto_renew' => false, 'updated_at' => now()]);
        $this->packages->complete((string) $package->id, 'CHARGE_CANCELLED', $userId, $role);
    }

    /** Lines still owed (not cancelled, something unpaid), with what was paid toward each. */
    private function linesQuery(string $academyId)
    {
        $allocated = DB::table('receipt_allocations')
            ->selectRaw('invoice_line_id, sum(amount_minor) as allocated')
            ->groupBy('invoice_line_id');

        return DB::table('invoice_line_items as li')
            ->join('invoices as i', 'i.id', '=', 'li.invoice_id')
            ->leftJoinSub($allocated, 'a', 'a.invoice_line_id', '=', 'li.id')
            ->leftJoin('students as st', 'st.id', '=', 'li.student_id')
            ->where('i.academy_id', $academyId)
            ->where('i.status', 'OPEN')
            ->whereNull('li.cancelled_at')
            ->whereRaw('li.amount_minor > coalesce(a.allocated, 0)')
            ->select([
                'li.id', 'li.invoice_id', 'li.student_id', 'li.description', 'li.amount_minor', 'li.currency',
                'li.session_date', 'li.class_group_id', 'li.group_charge', 'li.group_period',
                'st.full_name as student_name',
                DB::raw('coalesce(a.allocated, 0) as allocated'),
            ]);
    }

    /** @param  Collection<int, object>  $owed */
    private function audit(string $academyId, string $invoiceId, Collection $owed, int $total, ?string $reason, ?string $userId, ?string $role, bool $voided): void
    {
        Audit::log('invoice_line.cancelled', 'invoice', $invoiceId, $academyId, $userId, $role,
            before: ['lines' => $owed->map(fn ($l) => ['id' => (string) $l->id, 'amount_minor' => (int) $l->amount_minor, 'paid_minor' => (int) $l->allocated])->values()->all()],
            after: ['cancelled_minor' => $total, 'reason' => $reason, 'bill_voided' => $voided]);
    }
}
