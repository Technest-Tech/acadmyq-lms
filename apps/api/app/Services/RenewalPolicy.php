<?php

declare(strict_types=1);

namespace App\Services;

use Illuminate\Support\Facades\DB;

/**
 * Renewal policy (docs/groups/01-ACCOUNTING.md): may a family start a new group month or a new
 * package while the last one is unpaid?
 *
 *   FREE       renew freely — every academy's behaviour until someone says otherwise;
 *   PAY_FIRST  the next charge waits until the previous one is settled.
 *
 * Set on the family (`guardians.renewal_policy`) or on one student (`students.renewal_policy` — a
 * self-guardian, or a single child); either saying PAY_FIRST holds that student. Only an academy
 * kept by receipts knows exactly which charge is paid, so everywhere else renewals stay free.
 *
 * The first charge is never held — joining a group bills its first month, a first package its bill.
 * What a hold skipped is remembered (`class_group_members.renewal_held_from`,
 * `lesson_packages.renewal_held_at`) and released when money comes in (`Ledger::record`), when the
 * policy is relaxed, and by the nightly group billing — so paying raises exactly what was held back
 * and nothing older.
 */
final class RenewalPolicy
{
    public const FREE = 'FREE';

    public const PAY_FIRST = 'PAY_FIRST';

    public const POLICIES = [self::FREE, self::PAY_FIRST];

    /** A release raises charges, which may record credit, which may release again: once is enough. */
    private static bool $releasing = false;

    public function __construct(private readonly GroupBilling $billing) {}

    /**
     * Of these students, the ones whose renewals wait for payment.
     *
     * @param  list<string>  $studentIds
     * @return array<string, true>
     */
    public static function payingFirst(string $academyId, array $studentIds): array
    {
        if ($studentIds === [] || ! Ledger::keeps($academyId)) {
            return [];
        }

        return DB::table('students as s')
            ->leftJoin('guardians as g', 'g.id', '=', 's.guardian_id')
            ->whereIn('s.id', $studentIds)
            ->where(fn ($q) => $q->where('s.renewal_policy', self::PAY_FIRST)->orWhere('g.renewal_policy', self::PAY_FIRST))
            ->pluck('s.id')
            ->mapWithKeys(fn ($id) => [(string) $id => true])
            ->all();
    }

    public static function paysFirst(string $academyId, string $studentId): bool
    {
        return isset(self::payingFirst($academyId, [$studentId])[$studentId]);
    }

    /** Money still owed on one of this student's charges for the group (raised before `$before`). */
    public static function groupOwes(string $groupId, string $studentId, ?string $before = null): bool
    {
        return DB::table('invoice_line_items as li')
            ->join('invoices as i', 'i.id', '=', 'li.invoice_id')
            ->where('i.status', '<>', 'VOID')
            ->where('li.class_group_id', $groupId)
            ->where('li.student_id', $studentId)
            ->when($before !== null, fn ($q) => $q->where('li.group_period', '<', $before))
            ->whereRaw('li.amount_minor > coalesce((select sum(ra.amount_minor) from receipt_allocations ra where ra.invoice_line_id = li.id), 0)')
            ->exists();
    }

    /** Money still owed on one of this student's package bills. */
    public static function packagesOwe(string $studentId): bool
    {
        return DB::table('lesson_packages as p')
            ->join('invoices as i', 'i.id', '=', 'p.invoice_id')
            ->where('p.student_id', $studentId)
            ->where('i.status', '<>', 'VOID')
            ->whereColumn('i.amount_paid_minor', '<', 'i.total_minor')
            ->exists();
    }

    /**
     * The students whose renewals a payment to this payer may release: a guardian's children (the
     * family's account), or the student paid for.
     *
     * @param  array{guardian_id?: ?string, student_id?: ?string}  $payer
     * @return list<string>
     */
    public static function studentsOf(array $payer): array
    {
        if (($payer['guardian_id'] ?? null) !== null) {
            return DB::table('students')->where('guardian_id', $payer['guardian_id'])->whereNull('deleted_at')
                ->pluck('id')->map(fn ($id) => (string) $id)->all();
        }

        return ($payer['student_id'] ?? null) !== null ? [(string) $payer['student_id']] : [];
    }

    /**
     * Raise what a hold skipped for these students and is no longer held — group months, and the
     * package that was waiting to renew. Idempotent; a student still owing stays held.
     *
     * @param  list<string>  $studentIds
     */
    public function release(string $academyId, array $studentIds, ?string $actorUserId, ?string $actorRole): void
    {
        if (self::$releasing || $studentIds === [] || ! Ledger::keeps($academyId)) {
            return;
        }

        self::$releasing = true;
        try {
            $held = DB::table('class_group_members')
                ->whereIn('student_id', $studentIds)
                ->where('status', 'ACTIVE')
                ->whereNotNull('renewal_held_from')
                ->get(['group_id', 'student_id'])
                ->groupBy(fn ($m) => (string) $m->group_id);
            foreach ($held as $groupId => $members) {
                $group = DB::table('class_groups')->where('id', $groupId)->first();
                if ($group !== null) {
                    $this->billing->releaseHeld($group, $members->pluck('student_id')->map(fn ($id) => (string) $id)->all());
                }
            }

            $packages = app(LessonPackages::class);
            foreach (DB::table('lesson_packages')->whereIn('student_id', $studentIds)->whereNotNull('renewal_held_at')->distinct()->pluck('student_id') as $studentId) {
                $packages->releaseHeldRenewal((string) $studentId, $actorUserId, $actorRole);
            }
        } finally {
            self::$releasing = false;
        }
    }
}
