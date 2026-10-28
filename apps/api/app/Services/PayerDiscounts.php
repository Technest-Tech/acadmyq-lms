<?php

declare(strict_types=1);

namespace App\Services;

use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Standing discounts on a family's charges (docs/groups/01-ACCOUNTING.md, F2).
 *
 * A discount belongs to a guardian (every child) or to one student, is a percentage or a fixed
 * amount per charge, may be limited to group charges or to private lessons — and within them to any
 * number of targets: groups, and children's private subscriptions (all of a child's private
 * charges, or one subject's teacher) — and runs from a day until it is ended. Every line writer
 * asks {@see apply()} once, right before it inserts: the list price, the discount taken and the net
 * come back together, and the net is what `amount_minor` has always been. Several discounts stack —
 * percentages off the list price, fixed amounts after — and never take more than the charge.
 *
 * Ending one ({@see end()}) or cancelling it ({@see cancel()}) prices again the charges still on open
 * bills, so it comes off them too: from the day it ends, or — cancelled — all of them.
 *
 * Nothing happens for an academy that is not kept by receipts: the classic academies' lines are
 * written exactly as before, and a discount cannot even be recorded for them (the API is behind
 * `entitled:accounting`).
 */
final class PayerDiscounts
{
    public const SCOPE_ALL = 'ALL';

    public const SCOPE_GROUP = 'GROUP';

    public const SCOPE_PRIVATE = 'PRIVATE';

    /**
     * The net a charge should be raised at, with what was taken off and why.
     *
     * @param  string  $scope  GROUP | PRIVATE — what kind of charge this is
     * @param  \Closure|string|null  $teacherId  a private charge's subject teacher (a package's, or the
     *                                          lesson's timetable's); a closure is only asked when a
     *                                          discount names a subject
     * @return array{amount_minor:int, list_amount_minor:?int, discount_minor:int, discount_label:?string}
     */
    public function apply(string $academyId, ?string $studentId, string $scope, ?string $classGroupId, int $amountMinor, string $onDate, \Closure|string|null $teacherId = null): array
    {
        $none = ['amount_minor' => $amountMinor, 'list_amount_minor' => null, 'discount_minor' => 0, 'discount_label' => null];
        if ($amountMinor <= 0 || $studentId === null || ! Ledger::enabledFor($academyId)) {
            return $none;
        }

        $discounts = $this->activeFor($academyId, $studentId, $onDate);
        if ($teacherId instanceof \Closure) {
            $namesSubject = $discounts->contains(fn ($d) => collect($d->targets)->contains(fn ($t) => $t->teacher_id !== null));
            $teacherId = $namesSubject ? $teacherId() : null;
        }
        $discounts = $discounts->filter(fn ($d) => $this->reaches($d, $studentId, $scope, $classGroupId, $teacherId));
        if ($discounts->isEmpty()) {
            return $none;
        }

        $taken = 0;
        foreach ($discounts->where('kind', 'PERCENT') as $d) {
            $taken += (int) round($amountMinor * (int) $d->value / 10000);
        }
        foreach ($discounts->where('kind', 'FIXED') as $d) {
            $taken += (int) $d->value;
        }
        $taken = max(0, min($taken, $amountMinor));
        if ($taken === 0) {
            return $none;
        }

        return [
            'amount_minor' => $amountMinor - $taken,
            'list_amount_minor' => $amountMinor,
            'discount_minor' => $taken,
            'discount_label' => $discounts->pluck('label')->map(fn ($l) => trim((string) $l))->filter()->unique()->implode(' + '),
        ];
    }

    /**
     * Whether a discount covers a charge: its scope first, then — when it names targets — one of
     * them. A group target covers that group's charges; a private target covers one child's private
     * charges, all of them or only those of one subject's teacher.
     */
    private function reaches(object $d, string $studentId, string $scope, ?string $classGroupId, ?string $teacherId): bool
    {
        if ($d->scope !== self::SCOPE_ALL && $d->scope !== $scope) {
            return false;
        }
        if ($d->targets === []) {
            return true;
        }
        foreach ($d->targets as $t) {
            if ($t->class_group_id !== null) {
                if ($scope === self::SCOPE_GROUP && (string) $t->class_group_id === $classGroupId) {
                    return true;
                }

                continue;
            }
            if ($scope !== self::SCOPE_PRIVATE || (string) $t->student_id !== $studentId) {
                continue;
            }
            if ($t->teacher_id === null || (string) $t->teacher_id === $teacherId) {
                return true;
            }
        }

        return false;
    }

    /**
     * Take a discount off the charges already raised, not only the ones to come: every line of the
     * family (or the one child) still on an OPEN bill and in the discount's reach — group charges
     * (of its groups, if it names some), private lessons and package bills; never a hand-typed bill —
     * is priced again from its list price under every discount standing on its date. The discount's
     * start moves back to the earliest such charge, so a lesson marked late in that month is priced
     * the same way. A closed bill is never touched.
     *
     * A line that was already paid for in full keeps the money: the database trigger hands what is
     * no longer owed back to the payer as credit, and the credit then pays their next open charge.
     *
     * @return array{lines:int, discount_minor:int} how many charges moved, and by how much in all
     */
    public function applyToExisting(string $academyId, string $discountId): array
    {
        return DB::transaction(function () use ($academyId, $discountId): array {
            $d = $this->lockDiscount($discountId);
            $lines = $d === null ? collect() : $this->openLinesInReach($academyId, $d, null);
            if ($lines->isEmpty()) {
                return ['lines' => 0, 'discount_minor' => 0];
            }

            $earliest = Carbon::parse($lines->first()->session_date)->format('Y-m-d');
            if ($earliest < Carbon::parse($d->starts_on)->format('Y-m-d')) {
                DB::table('payer_discounts')->where('id', $discountId)->update(['starts_on' => $earliest, 'updated_at' => now()]);
            }

            return $this->reprice($academyId, $lines);
        });
    }

    /**
     * End a discount from a day: no charge dated on or after it takes it — the ones still on open
     * bills included, which go back to the price they would have had without it. What it took
     * before that day stays. Ending on (or before) its first day leaves it applying to nothing; a
     * discount already ended earlier keeps its earlier end. Safe to repeat.
     *
     * @return array{lines:int, discount_minor:int} how many charges moved, and the discount they lost (≤ 0)
     */
    public function end(string $academyId, string $discountId, string $endsOn, ?string $userId): array
    {
        return DB::transaction(function () use ($academyId, $discountId, $endsOn, $userId): array {
            $d = $this->lockDiscount($discountId);
            if ($d === null) {
                return ['lines' => 0, 'discount_minor' => 0];
            }
            $endsOn = max($endsOn, Carbon::parse($d->starts_on)->format('Y-m-d'));
            if ($d->ends_on === null || Carbon::parse($d->ends_on)->format('Y-m-d') > $endsOn) {
                DB::table('payer_discounts')->where('id', $discountId)->update(['ends_on' => $endsOn, 'ended_by' => $userId, 'updated_at' => now()]);
            } else {
                $endsOn = Carbon::parse($d->ends_on)->format('Y-m-d');
            }

            return $this->reprice($academyId, $this->openLinesInReach($academyId, $d, $endsOn));
        });
    }

    /**
     * Cancel a discount outright, as if it was never given: it applies on no day, and every charge
     * in its reach still on an open bill goes back to the price it would have had without it — what
     * was paid toward one stays paid. Closed bills never move. Also how a discount that was ended
     * before endings re-priced the open bills is taken off them now.
     *
     * @return array{lines:int, discount_minor:int} how many charges moved, and the discount they lost (≤ 0)
     */
    public function cancel(string $academyId, string $discountId, ?string $userId): array
    {
        return DB::transaction(function () use ($academyId, $discountId, $userId): array {
            $d = $this->lockDiscount($discountId);
            if ($d === null) {
                return ['lines' => 0, 'discount_minor' => 0];
            }
            DB::table('payer_discounts')->where('id', $discountId)->update([
                'ends_on' => Carbon::parse($d->starts_on)->format('Y-m-d'),
                'ended_by' => $d->ended_by ?? $userId,
                'cancelled_at' => $d->cancelled_at ?? now(),
                'cancelled_by' => $d->cancelled_by ?? $userId,
                'updated_at' => now(),
            ]);

            return $this->reprice($academyId, $this->openLinesInReach($academyId, $d, null));
        });
    }

    private function lockDiscount(string $discountId): ?object
    {
        $d = DB::table('payer_discounts')->where('id', $discountId)->lockForUpdate()->first();

        return $d === null ? null : $this->withTargets(collect([$d]))->first();
    }

    /**
     * The family's (or the one child's) charges on OPEN bills that a discount reaches, oldest first,
     * each with what {@see apply()} needs to price it: kind, group and subject teacher. From
     * `$fromDate` on, or all of them. Hand-typed bills are never in reach.
     *
     * @return Collection<int, object>
     */
    private function openLinesInReach(string $academyId, object $d, ?string $fromDate): Collection
    {
        $studentIds = $d->student_id !== null
            ? [(string) $d->student_id]
            : DB::table('students')->where('guardian_id', $d->guardian_id)->pluck('id')->map(fn ($v) => (string) $v)->all();
        if ($studentIds === [] || ! Ledger::enabledFor($academyId)) {
            return collect();
        }

        $packageOf = 'from lesson_packages p where p.invoice_id = li.invoice_id or p.overdraft_invoice_id = li.invoice_id';

        return DB::table('invoice_line_items as li')
            ->join('invoices as i', 'i.id', '=', 'li.invoice_id')
            ->leftJoin('sessions as s', 's.id', '=', 'li.session_id')
            ->leftJoin('schedules as sc', 'sc.id', '=', 's.schedule_id')
            ->where('i.academy_id', $academyId)
            ->where('i.status', 'OPEN')
            ->whereIn('li.student_id', $studentIds)
            ->whereNotNull('li.session_date')
            ->when($fromDate !== null, fn ($q) => $q->where('li.session_date', '>=', $fromDate))
            ->whereRaw('coalesce(li.list_amount_minor, li.amount_minor) > 0')
            ->where(function ($q) use ($d, $packageOf): void {
                if ($d->scope !== self::SCOPE_PRIVATE) {
                    $q->orWhereNotNull('li.class_group_id');
                }
                if ($d->scope !== self::SCOPE_GROUP) {
                    $q->orWhereNotNull('li.session_id')->orWhereRaw("exists (select 1 {$packageOf})");
                }
            })
            ->orderBy('li.session_date')
            ->get([
                'li.*',
                DB::raw('coalesce(sc.teacher_id, s.teacher_id) as lesson_teacher_id'),
                DB::raw("(select p.teacher_id {$packageOf} order by p.sequence_no desc limit 1) as package_teacher_id"),
            ])
            ->map(function ($line) {
                $line->charge_scope = $line->class_group_id !== null ? self::SCOPE_GROUP : self::SCOPE_PRIVATE;
                $teacher = $line->class_group_id !== null ? null : ($line->session_id !== null ? $line->lesson_teacher_id : $line->package_teacher_id);
                $line->subject_teacher_id = $teacher !== null ? (string) $teacher : null;

                return $line;
            })
            ->filter(fn ($line) => $this->reaches($d, (string) $line->student_id, $line->charge_scope, $line->class_group_id !== null ? (string) $line->class_group_id : null, $line->subject_teacher_id))
            ->values();
    }

    /**
     * Price each line again from its list price under the discounts standing on its date, and carry
     * the change through: the bill's totals, what was paid (an overpaid line hands the difference
     * back as credit; a dearer one takes the family's credit first), and a teacher paid a share of
     * the group's charges.
     *
     * @param  Collection<int, object>  $lines  from {@see openLinesInReach()}
     * @return array{lines:int, discount_minor:int}
     */
    private function reprice(string $academyId, Collection $lines): array
    {
        $moved = 0;
        $taken = 0;
        $invoices = [];
        $groupMonths = [];
        foreach ($lines as $line) {
            $list = (int) ($line->list_amount_minor ?? $line->amount_minor);
            $priced = $this->apply(
                $academyId,
                (string) $line->student_id,
                $line->charge_scope,
                $line->class_group_id !== null ? (string) $line->class_group_id : null,
                $list,
                Carbon::parse($line->session_date)->format('Y-m-d'),
                $line->subject_teacher_id,
            );
            $delta = $priced['amount_minor'] - (int) $line->amount_minor;
            if ($delta === 0 && $priced['discount_label'] === $line->discount_label) {
                continue;
            }

            DB::table('invoice_line_items')->where('id', $line->id)->update([
                'amount_minor' => $priced['amount_minor'],
                'list_amount_minor' => $priced['list_amount_minor'],
                'discount_minor' => $priced['discount_minor'],
                'discount_label' => $priced['discount_label'],
            ]);
            if ($delta !== 0) {
                DB::table('invoices')->where('id', $line->invoice_id)->update([
                    'subtotal_minor' => DB::raw("subtotal_minor + ({$delta})"),
                    'total_minor' => DB::raw("total_minor + ({$delta})"),
                    'updated_at' => now(),
                ]);
            }
            $moved++;
            $taken -= $delta;
            $invoices[(string) $line->invoice_id] = true;
            if ($line->class_group_id !== null && $line->group_period !== null) {
                $groupMonths[$line->class_group_id.'|'.Carbon::parse($line->group_period)->format('Y-m')] = true;
            }
        }

        foreach (array_keys($invoices) as $invoiceId) {
            DB::select('select app.ledger_refresh_invoice(?)', [$invoiceId]);
            app(Ledger::class)->afterLinesChanged($invoiceId);
        }
        // A teacher paid a share of the group's charges is paid on what the families now owe.
        foreach (array_keys($groupMonths) as $key) {
            [$groupId, $ym] = explode('|', $key);
            $group = DB::table('class_groups')->where('id', $groupId)->first();
            if ($group !== null) {
                app(GroupPayroll::class)->syncRevenueShare($group, (int) substr($ym, 0, 4), (int) substr($ym, 5, 2));
            }
        }

        return ['lines' => $moved, 'discount_minor' => $taken];
    }

    /**
     * The discounts a student's charge on `$onDate` is under: their own, and their family's for
     * every child.
     *
     * @return Collection<int, object>
     */
    public function activeFor(string $academyId, string $studentId, string $onDate): Collection
    {
        $guardianId = DB::table('students')->where('id', $studentId)->value('guardian_id');

        return $this->withTargets(DB::table('payer_discounts')
            ->where('academy_id', $academyId)
            ->where(function ($q) use ($studentId, $guardianId): void {
                $q->where('student_id', $studentId);
                if ($guardianId !== null) {
                    $q->orWhere(fn ($g) => $g->where('guardian_id', $guardianId)->whereNull('student_id'));
                }
            })
            ->whereNull('cancelled_at')
            ->where('starts_on', '<=', $onDate)
            ->where(fn ($q) => $q->whereNull('ends_on')->orWhere('ends_on', '>', $onDate))
            ->orderBy('created_at')
            ->get());
    }

    /**
     * Each discount with its targets (`targets`, empty = everything in its scope), named for the
     * family card: the group, or the child and the subject's teacher.
     *
     * @param  Collection<int, object>  $discounts
     * @return Collection<int, object>
     */
    private function withTargets(Collection $discounts): Collection
    {
        $targets = $discounts->isEmpty() ? collect() : DB::table('payer_discount_targets as t')
            ->leftJoin('class_groups as g', 'g.id', '=', 't.class_group_id')
            ->leftJoin('students as s', 's.id', '=', 't.student_id')
            ->leftJoin('teachers as tc', 'tc.id', '=', 't.teacher_id')
            ->whereIn('t.discount_id', $discounts->pluck('id')->all())
            ->orderBy('t.created_at')
            ->get(['t.discount_id', 't.class_group_id', 't.student_id', 't.teacher_id', 'g.name as group_name', 's.full_name as student_name', 'tc.full_name as teacher_name'])
            ->groupBy(fn ($t) => (string) $t->discount_id);

        return $discounts->map(function ($d) use ($targets) {
            $d->targets = ($targets[(string) $d->id] ?? collect())->values()->all();

            return $d;
        });
    }

    /**
     * Every discount a family has or had, newest first, for the family card.
     *
     * @param  list<string>  $childIds
     * @return Collection<int, object>
     */
    public function forFamily(string $guardianId, array $childIds): Collection
    {
        return $this->withTargets(DB::table('payer_discounts as d')
            ->leftJoin('users as u', 'u.id', '=', 'd.created_by')
            ->leftJoin('students as s', 's.id', '=', 'd.student_id')
            ->where(fn ($q) => $q->where('d.guardian_id', $guardianId)->orWhereIn('d.student_id', $childIds ?: ['00000000-0000-0000-0000-000000000000']))
            ->orderByRaw('d.ends_on is not null')
            ->orderByDesc('d.created_at')
            ->get(['d.*', 'u.full_name as created_by_name', 's.full_name as student_name']));
    }

    /** Today in the academy's clock — the day a new discount starts and an ended one stops. */
    public function today(string $academyId): string
    {
        return Carbon::now((string) (DB::table('academies')->where('id', $academyId)->value('timezone') ?: 'UTC'))->format('Y-m-d');
    }
}
