<?php

declare(strict_types=1);

namespace App\Services;

use App\Domain\SessionClassifier;
use App\Support\AcademyUrl;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * The student's running month, for the Subscription tab of their profile: how many lessons were
 * taught against the monthly quota, what is still to come, this month's bill and what the family
 * owes overall. A READ over the records billing already writes — nothing here decides a price.
 *
 * "Taught" is {@see SessionClassifier::billableToStudent()} (the matrix the invoice uses), so the
 * count can never disagree with the lines on the bill. Hidden lessons (a removed student's
 * tombstones) are left out, as they are everywhere else.
 */
final class StudentMonth
{
    /**
     * @return array<string, mixed>
     */
    public function summary(string $studentId, string $academyId, bool $withMoney, ?Carbon $now = null): array
    {
        $tz = (string) (DB::table('academies')->where('id', $academyId)->value('timezone') ?: 'UTC');
        $now = ($now ?? Carbon::now())->copy()->utc();
        $local = $now->copy()->setTimezone($tz);
        $from = $local->copy()->startOfMonth()->utc();
        $to = $local->copy()->startOfMonth()->addMonth()->utc();

        $sessions = DB::table('sessions')
            ->where('student_id', $studentId)
            ->whereNull('hidden_at')
            // Bound with an explicit offset: a naive Carbon is read in the DB session's zone.
            ->where('scheduled_at_utc', '>=', $from->toIso8601String())
            ->where('scheduled_at_utc', '<', $to->toIso8601String())
            ->get(['status', 'bill_override', 'duration_minutes', 'scheduled_at_utc']);

        $taught = 0;
        $minutes = 0;
        $cancelled = 0;
        $upcoming = 0;
        $unmarked = 0;
        foreach ($sessions as $s) {
            $status = (string) $s->status;
            if (in_array($status, ['SCHEDULED', 'RESCHEDULED'], true)) {
                Carbon::parse($s->scheduled_at_utc)->lt($now) ? $unmarked++ : $upcoming++;

                continue;
            }
            $override = $s->bill_override === null ? null : (bool) $s->bill_override;
            if (SessionClassifier::classifyValue($status, $override)['billableToStudent']) {
                $taught++;
                $minutes += (int) $s->duration_minutes;
            } elseif (str_starts_with($status, 'CANCELLED')) {
                $cancelled++;
            }
        }

        $next = DB::table('sessions')
            ->where('student_id', $studentId)
            ->whereNull('hidden_at')
            ->whereIn('status', ['SCHEDULED', 'RESCHEDULED'])
            ->where('scheduled_at_utc', '>=', $now->toIso8601String())
            ->min('scheduled_at_utc');

        return [
            'month' => $local->format('Y-m'),
            'lessons' => [
                'taught' => $taught,
                'taught_minutes' => $minutes,
                'cancelled' => $cancelled,
                'upcoming' => $upcoming,
                'unmarked' => $unmarked,
            ],
            'next_lesson_at' => $next !== null ? Carbon::parse($next)->utc()->toIso8601String() : null,
            'bill' => $withMoney ? $this->bill($studentId, $academyId, (int) $local->year, (int) $local->month) : null,
            'family_due' => $withMoney ? $this->familyDue($studentId) : [],
        ];
    }

    /**
     * This month's lesson bill. It may be the family's (one bill for the siblings), so the
     * student's own share is given beside the bill's total.
     *
     * @return array<string, mixed>|null
     */
    private function bill(string $studentId, string $academyId, int $year, int $month): ?array
    {
        $row = DB::table('invoice_line_items as li')
            ->join('invoices as i', 'i.id', '=', 'li.invoice_id')
            ->where('li.student_id', $studentId)
            ->where('i.kind', 'AUTO')
            ->where('i.period_year', $year)
            ->where('i.period_month', $month)
            ->where('i.status', '<>', 'VOID')
            ->groupBy('i.id', 'i.public_token', 'i.status', 'i.currency', 'i.total_minor', 'i.amount_paid_minor')
            ->orderByDesc(DB::raw('sum(li.amount_minor)'))
            ->first([
                'i.id', 'i.public_token', 'i.status', 'i.currency', 'i.total_minor', 'i.amount_paid_minor',
                DB::raw('sum(li.amount_minor) as own_minor'),
                DB::raw('count(li.session_id) as lesson_lines'),
                DB::raw('(select count(distinct x.student_id) from invoice_line_items x where x.invoice_id = i.id) as students'),
            ]);
        if ($row === null) {
            return null;
        }

        $total = (int) $row->total_minor;
        $paid = min($total, max(0, (int) ($row->amount_paid_minor ?? 0)));
        // Read from the money, as the public invoice page does: a covered running month stays OPEN.
        $isPaid = $row->status === 'PAID' || ($total > 0 && $paid >= $total);

        return [
            'id' => (string) $row->id,
            'status' => (string) $row->status,
            'state' => $isPaid ? 'PAID' : ($paid > 0 ? 'PARTIAL' : 'UNPAID'),
            'currency' => (string) $row->currency,
            'total_minor' => $total,
            'own_minor' => (int) $row->own_minor,
            'paid_minor' => $paid,
            'due_minor' => $isPaid ? 0 : $total - $paid,
            'shared' => (int) $row->students > 1,
            'url' => AcademyUrl::origin($academyId).'/i/'.$row->public_token,
        ];
    }

    /**
     * What the family owes across every bill — on the guardian and on any of their children — the
     * same pool the parent portal shows (a family is one account).
     *
     * @return list<array{currency: string, due_minor: int}>
     */
    private function familyDue(string $studentId): array
    {
        $guardianId = DB::table('students')->where('id', $studentId)->value('guardian_id');
        $childIds = $guardianId !== null
            ? DB::table('students')->where('guardian_id', $guardianId)->pluck('id')->all()
            : [$studentId];

        $rows = DB::table('invoices')
            ->where(function ($q) use ($guardianId, $childIds): void {
                $q->whereIn('student_id', $childIds);
                if ($guardianId !== null) {
                    $q->orWhere('guardian_id', $guardianId);
                }
            })
            ->whereNotIn('status', ['VOID', 'PAID'])
            ->where('total_minor', '>', 0)
            ->get(['currency', 'total_minor', 'amount_paid_minor']);

        $due = [];
        foreach ($rows as $r) {
            $left = (int) $r->total_minor - max(0, (int) ($r->amount_paid_minor ?? 0));
            if ($left > 0) {
                $due[$r->currency] = ($due[$r->currency] ?? 0) + $left;
            }
        }
        ksort($due);

        return collect($due)->map(fn (int $minor, string $c): array => ['currency' => $c, 'due_minor' => $minor])->values()->all();
    }
}
