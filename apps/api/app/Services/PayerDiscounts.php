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
 * amount per charge, may be limited to group charges (one group, or all) or to private lessons,
 * and runs from a day until it is ended. Every line writer asks {@see apply()} once, right before
 * it inserts: the list price, the discount taken and the net come back together, and the net is
 * what `amount_minor` has always been. Several discounts stack — percentages off the list price,
 * fixed amounts after — and never take more than the charge.
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
     * @return array{amount_minor:int, list_amount_minor:?int, discount_minor:int, discount_label:?string}
     */
    public function apply(string $academyId, ?string $studentId, string $scope, ?string $classGroupId, int $amountMinor, string $onDate): array
    {
        $none = ['amount_minor' => $amountMinor, 'list_amount_minor' => null, 'discount_minor' => 0, 'discount_label' => null];
        if ($amountMinor <= 0 || $studentId === null || ! Ledger::enabledFor($academyId)) {
            return $none;
        }

        $discounts = $this->activeFor($academyId, $studentId, $onDate)
            ->filter(fn ($d) => $d->scope === self::SCOPE_ALL || $d->scope === $scope)
            ->filter(fn ($d) => $d->class_group_id === null || ($classGroupId !== null && (string) $d->class_group_id === $classGroupId));
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
     * Take a discount off the charges already raised, not only the ones to come: every line of the
     * family (or the one child) still on an OPEN bill and in the discount's reach — group charges
     * (of its group, if it names one), private lessons and package bills; never a hand-typed bill —
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
            $d = DB::table('payer_discounts')->where('id', $discountId)->lockForUpdate()->first();
            $studentIds = $d === null ? [] : ($d->student_id !== null
                ? [(string) $d->student_id]
                : DB::table('students')->where('guardian_id', $d->guardian_id)->pluck('id')->map(fn ($v) => (string) $v)->all());
            if ($studentIds === [] || ! Ledger::enabledFor($academyId)) {
                return ['lines' => 0, 'discount_minor' => 0];
            }

            $lines = DB::table('invoice_line_items as li')
                ->join('invoices as i', 'i.id', '=', 'li.invoice_id')
                ->where('i.academy_id', $academyId)
                ->where('i.status', 'OPEN')
                ->whereIn('li.student_id', $studentIds)
                ->whereNotNull('li.session_date')
                ->whereRaw('coalesce(li.list_amount_minor, li.amount_minor) > 0')
                ->where(function ($q) use ($d): void {
                    if ($d->scope !== self::SCOPE_PRIVATE) {
                        $q->orWhere(fn ($g) => $d->class_group_id !== null
                            ? $g->where('li.class_group_id', $d->class_group_id)
                            : $g->whereNotNull('li.class_group_id'));
                    }
                    if ($d->scope !== self::SCOPE_GROUP) {
                        $q->orWhereNotNull('li.session_id')
                            ->orWhereExists(fn ($p) => $p->selectRaw('1')->from('lesson_packages as p')->whereColumn('p.invoice_id', 'li.invoice_id'));
                    }
                })
                ->orderBy('li.session_date')
                ->get(['li.*']);
            if ($lines->isEmpty()) {
                return ['lines' => 0, 'discount_minor' => 0];
            }

            $earliest = Carbon::parse($lines->first()->session_date)->format('Y-m-d');
            if ($earliest < Carbon::parse($d->starts_on)->format('Y-m-d')) {
                DB::table('payer_discounts')->where('id', $discountId)->update(['starts_on' => $earliest, 'updated_at' => now()]);
            }

            $moved = 0;
            $taken = 0;
            $invoices = [];
            $groupMonths = [];
            foreach ($lines as $line) {
                $list = (int) ($line->list_amount_minor ?? $line->amount_minor);
                $priced = $this->apply(
                    $academyId,
                    (string) $line->student_id,
                    $line->class_group_id !== null ? self::SCOPE_GROUP : self::SCOPE_PRIVATE,
                    $line->class_group_id !== null ? (string) $line->class_group_id : null,
                    $list,
                    Carbon::parse($line->session_date)->format('Y-m-d'),
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
        });
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

        return DB::table('payer_discounts')
            ->where('academy_id', $academyId)
            ->where(function ($q) use ($studentId, $guardianId): void {
                $q->where('student_id', $studentId);
                if ($guardianId !== null) {
                    $q->orWhere(fn ($g) => $g->where('guardian_id', $guardianId)->whereNull('student_id'));
                }
            })
            ->where('starts_on', '<=', $onDate)
            ->where(fn ($q) => $q->whereNull('ends_on')->orWhere('ends_on', '>', $onDate))
            ->orderBy('created_at')
            ->get();
    }

    /**
     * Every discount a family has or had, newest first, for the family card.
     *
     * @param  list<string>  $childIds
     * @return Collection<int, object>
     */
    public function forFamily(string $guardianId, array $childIds): Collection
    {
        return DB::table('payer_discounts as d')
            ->leftJoin('users as u', 'u.id', '=', 'd.created_by')
            ->leftJoin('students as s', 's.id', '=', 'd.student_id')
            ->leftJoin('class_groups as g', 'g.id', '=', 'd.class_group_id')
            ->where(fn ($q) => $q->where('d.guardian_id', $guardianId)->orWhereIn('d.student_id', $childIds ?: ['00000000-0000-0000-0000-000000000000']))
            ->orderByRaw('d.ends_on is not null')
            ->orderByDesc('d.created_at')
            ->get(['d.*', 'u.full_name as created_by_name', 's.full_name as student_name', 'g.name as group_name']);
    }

    /** Today in the academy's clock — the day a new discount starts and an ended one stops. */
    public function today(string $academyId): string
    {
        return Carbon::now((string) (DB::table('academies')->where('id', $academyId)->value('timezone') ?: 'UTC'))->format('Y-m-d');
    }
}
