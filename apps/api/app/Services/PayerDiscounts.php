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
