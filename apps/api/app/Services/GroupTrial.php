<?php

declare(strict_types=1);

namespace App\Services;

use App\Support\Audit;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * One trial lesson in a group, charged at the lesson's price written on the group (Lingo 2026-11-15:
 * "when adding a group subscription, let us pick one trial lesson, billed at the group's lesson
 * value"). The student gets a membership for that one day only — on that lesson's sheet, nowhere
 * else — marked `is_trial`, which the group's month and hours billing skip (GroupBilling::
 * billableMembers). The one lesson is charged as a LESSON line on the family's bill. Joining for real
 * afterwards is the ordinary join (or "back to the group" on the card) from a later lesson.
 */
final class GroupTrial
{
    /**
     * One lesson's price in this group: an hours month → price × this lesson's length ÷ the month's
     * minutes; a calendar month → price ÷ that month's lessons; per lesson → its price; a course →
     * price ÷ its lessons. Null when the group has no price.
     */
    public function lessonPrice(object $group, object $lesson): ?int
    {
        if (! GroupBilling::priced($group)) {
            return null;
        }
        $price = (int) $group->price_minor;
        $date = Carbon::parse($lesson->occurrence_local_date);
        if ($group->billing_mode === GroupBilling::MONTHLY) {
            if (GroupBilling::byHours($group)) {
                return (int) round($price * (int) $lesson->duration_minutes / max(1, (int) $group->month_minutes));
            }
            $count = DB::table('class_group_lessons')->where('group_id', $group->id)->where('status', '<>', 'CANCELLED')
                ->whereBetween('occurrence_local_date', [$date->copy()->startOfMonth()->format('Y-m-d'), $date->copy()->endOfMonth()->format('Y-m-d')])
                ->count();

            return (int) round($price / max(1, $count));
        }
        if ($group->billing_mode === 'COURSE') {
            $count = (int) ($group->lessons_planned ?? 0) ?: DB::table('class_group_lessons')->where('group_id', $group->id)->where('status', '<>', 'CANCELLED')->count();

            return (int) round($price / max(1, $count));
        }

        return $price;
    }

    /**
     * Put the student on that one lesson and charge it.
     *
     * @return array{member_id:string, line_id:?string, amount_minor:int}
     */
    public function book(object $group, string $studentId, object $lesson, ?int $amountMinor, ?string $userId, ?string $role): array
    {
        if ((string) $lesson->group_id !== (string) $group->id || $lesson->status === 'CANCELLED') {
            throw ValidationException::withMessages(['lesson_id' => ['Pick one of this group\'s lessons. / اختر حصة من حصص هذه المجموعة.']]);
        }
        $date = Carbon::parse($lesson->occurrence_local_date)->format('Y-m-d');
        $covered = DB::table('class_group_members')->where('group_id', $group->id)->where('student_id', $studentId)
            ->where('joined_on', '<=', $date)->where(fn ($q) => $q->whereNull('left_on')->orWhere('left_on', '>', $date))->exists();
        if ($covered) {
            throw ValidationException::withMessages(['student_id' => ['Already in this group on that day. / الطالب في المجموعة بالفعل في هذا اليوم.']]);
        }
        if (DB::table('class_group_members')->where('group_id', $group->id)->where('student_id', $studentId)->where('status', 'ACTIVE')->exists()) {
            throw ValidationException::withMessages(['student_id' => ['Already a member of this group. / الطالب عضو في المجموعة بالفعل.']]);
        }
        $amount = $amountMinor ?? ($this->lessonPrice($group, $lesson) ?? 0);

        return DB::transaction(function () use ($group, $studentId, $lesson, $date, $amount, $userId, $role): array {
            $memberId = (string) Str::uuid();
            DB::table('class_group_members')->insert([
                'id' => $memberId,
                'academy_id' => $group->academy_id,
                'group_id' => $group->id,
                'student_id' => $studentId,
                'joined_on' => $date,
                'left_on' => Carbon::parse($date)->addDay()->format('Y-m-d'),
                'status' => 'LEFT',
                'left_reason' => 'حصة تجريبية / Trial lesson',
                'is_trial' => true,
                'added_by' => $userId,
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            $lineId = null;
            if ($amount > 0 && $group->currency !== null) {
                $d = Carbon::parse($date);
                $lineId = app(Invoicing::class)->addGroupLine((string) $group->academy_id, $studentId, (string) $group->currency, (int) $d->year, (int) $d->month, [
                    'class_group_id' => (string) $group->id,
                    'class_group_lesson_id' => (string) $lesson->id,
                    'group_charge' => 'LESSON',
                    'group_period' => $date,
                    'description' => "{$group->name} — trial lesson {$date} / حصة تجريبية",
                    'amount_minor' => $amount,
                    'session_date' => $date,
                ]);
                if ($lineId !== null) {
                    app(Ledger::class)->afterLinesChanged((string) DB::table('invoice_line_items')->where('id', $lineId)->value('invoice_id'));
                }
            }
            Audit::log('class_group.trial_booked', 'class_group', (string) $group->id, (string) $group->academy_id, $userId, $role,
                after: ['student_id' => $studentId, 'lesson_id' => (string) $lesson->id, 'date' => $date, 'amount_minor' => $amount, 'line_id' => $lineId]);

            return ['member_id' => $memberId, 'line_id' => $lineId, 'amount_minor' => $amount];
        });
    }
}
