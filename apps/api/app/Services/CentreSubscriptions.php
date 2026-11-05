<?php

declare(strict_types=1);

namespace App\Services;

use App\Services\Whatsapp\SubscriptionReminderMessage;
use App\Services\Whatsapp\WhatsAppSender;
use App\Support\AcademyUrl;
use App\Support\Audit;
use App\Support\LessonCount;
use App\Support\MoneyPolicy;
use App\Support\StudentStatus;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * The centre's private subscription (docs/centre-profile/01-PRIVATE-SUBSCRIPTION-SPLIT.md): a block
 * of N lessons sold to a student for one subject, on the same one-to-one lessons as everyone else.
 *
 *  1. Lessons, never minutes: a lesson counts one whatever it ran.
 *  2. Money moves only when the desk acts: sell raises ONE bill line, edit re-issues it in place,
 *     close settles. No auto-renew, no hourly fallback, no overdraft, no backdated import.
 *  3. A lesson beyond the block is a flag, not a charge: an outside row + an alert; the next block
 *     sold for that subject takes those lessons from its start date. Attendance is never blocked.
 *  4. Scope = subject = teacher + course; untied (no teacher) for a student with one teacher.
 *  5. Everything on an open block is editable; a finished one reopens by selling more lessons.
 *  6. OPEN → FINISHED (used = sold) → CLOSED (desk, settled) / CANCELLED (nothing counted, nothing paid).
 *  7. Un-marking a lesson uncounts it; money never followed the lesson so none moves back.
 *  9. Pay-first holds a SALE, never anything automatic: the 422 names the unpaid bill.
 *
 * Every write runs in its own transaction: a refusal after a write must roll the write back, the
 * request transaction commits what it finds ([[request-transaction-commits-on-422]]).
 */
final class CentreSubscriptions
{
    public const ENTITY = 'centre_subscription';

    public const CATEGORY = 'SUBSCRIPTIONS';

    public function __construct(
        private readonly SubscriptionBilling $billing,
        private readonly Ledger $ledger,
        private readonly SubscriptionSettlement $settlement,
        private readonly CentreSubscriptionRows $rows,
    ) {}

    // ── The desk ────────────────────────────────────────────────────────────

    /**
     * Sell a block. One bill line on the family's bill, the outside lessons of this subject taken
     * from `starts_on`.
     *
     * @param  array<string, mixed>  $data  SellInput (student_id, teacher_id?, course?, new_subject?, label?, lessons_sold, lesson_minutes?, lesson_price_minor, price_minor?, currency?, starts_on?, override_pay_first?)
     * @return array{subscription_id: string, invoice_id: ?string, due_minor: int, warnings: list<string>, lessons_taken: int}
     */
    public function sell(array $data, ?string $actorUserId, ?string $actorRole): array
    {
        return DB::transaction(function () use ($data, $actorUserId, $actorRole): array {
            $studentId = (string) $data['student_id'];
            $student = DB::table('students')->where('id', $studentId)->whereNull('deleted_at')->first(['id', 'academy_id', 'full_name', 'guardian_id', 'status']);
            if ($student === null) {
                throw ValidationException::withMessages(['student_id' => ['Student not found. / الطالب غير موجود.']]);
            }
            // A centre still on the hour packages counts its lessons there: a block sold here would
            // never take one. The data move is what switches it over.
            if (! MoneyPolicy::usesSubscriptions((string) $student->academy_id)) {
                throw ValidationException::withMessages(['subscription' => ['This academy still runs on lesson packages. / هذه الأكاديمية ما زالت تعمل بالباقات.']]);
            }
            $academyId = (string) $student->academy_id;
            $academy = DB::table('academies')->where('id', $academyId)->first();
            $tz = (string) ($academy->timezone ?: 'UTC');

            [$teacherId, $course, $newSubject] = $this->resolveSubject($studentId, $data['teacher_id'] ?? null, $data['course'] ?? null, (bool) ($data['new_subject'] ?? false));
            if ($this->openIn($studentId, $teacherId, $course) !== null) {
                throw ValidationException::withMessages(['student_id' => ['This student already has an open subscription for that subject. / لدى الطالب اشتراك مفتوح لهذه المادة بالفعل.']]);
            }
            if (! (bool) ($data['override_pay_first'] ?? false)) {
                $this->assertPaidFirst($academyId, $studentId, $teacherId, $course);
            }

            $sold = (int) $data['lessons_sold'];
            $lessonPrice = (int) $data['lesson_price_minor'];
            $price = isset($data['price_minor']) && $data['price_minor'] !== null ? (int) $data['price_minor'] : $sold * $lessonPrice;
            $currency = strtoupper((string) (($data['currency'] ?? null) ?: $this->familyCurrency($studentId, $academy)));
            $startsOn = isset($data['starts_on']) && $data['starts_on'] !== null
                ? Carbon::parse((string) $data['starts_on'])->toDateString()
                : ($this->firstOutsideOn($studentId, $teacherId, $course) ?? Carbon::now($tz)->toDateString());
            $label = trim((string) ($data['label'] ?? '')) !== '' ? mb_substr(trim((string) $data['label']), 0, 255) : $this->defaultLabel($sold, $course, $teacherId);

            if ($newSubject) {
                DB::table('student_teacher_assignments')->insert([
                    'id' => (string) Str::uuid(), 'academy_id' => $academyId, 'student_id' => $studentId,
                    'teacher_id' => $teacherId, 'course' => $course, 'started_at' => now(), 'ended_at' => null,
                ]);
                Audit::log('student.teacher_added', 'student', $studentId, $academyId, $actorUserId, $actorRole,
                    after: ['teacher_id' => $teacherId, 'course' => $course, 'effective_date' => now()->toDateString(), 'with_subscription' => true]);
            }
            // Selling a block puts the student on the block clock for the rest of the system (the
            // REGULAR rule, the list badges): the `subscriptions` row says PER_PACKAGE, as a package
            // sale always did. Only the centre engine reads it from here on.
            app(LessonPackages::class)->ensurePackageBilling($studentId, $academyId, $lessonPrice, $currency, $startsOn, $actorUserId, $actorRole);

            // Buying a block ends the trial: a student left on TRIAL is never billed.
            if ((string) $student->status === StudentStatus::TRIAL) {
                DB::table('students')->where('id', $studentId)->update(['status' => StudentStatus::REGULAR, 'updated_at' => now()]);
                Audit::log('student.update', 'student', $studentId, $academyId, $actorUserId, $actorRole,
                    after: ['status' => StudentStatus::REGULAR, 'reason' => 'SUBSCRIPTION_SOLD'], before: ['status' => StudentStatus::TRIAL]);
            }

            $id = (string) Str::uuid();
            DB::table('centre_subscriptions')->insert([
                'id' => $id, 'academy_id' => $academyId, 'student_id' => $studentId,
                'teacher_id' => $teacherId, 'course' => $course, 'label' => $label,
                'lessons_sold' => $sold,
                'lesson_minutes' => isset($data['lesson_minutes']) && $data['lesson_minutes'] !== null ? (int) $data['lesson_minutes'] : null,
                'lesson_price_minor' => $lessonPrice, 'price_minor' => $price, 'currency' => $currency,
                'starts_on' => $startsOn, 'status' => 'OPEN',
                'sequence_no' => ((int) DB::table('centre_subscriptions')->where('student_id', $studentId)->max('sequence_no')) + 1,
                'opened_by' => $actorUserId, 'created_at' => now(), 'updated_at' => now(),
            ]);
            $sub = DB::table('centre_subscriptions')->where('id', $id)->first();

            $invoiceId = $this->billing->raise($sub, $academy, $actorUserId, $actorRole);
            $sub = DB::table('centre_subscriptions')->where('id', $id)->first();
            $taken = $this->takeOutside($sub);
            $warnings = $this->flagUnpaidPredecessors($sub);

            Audit::log(self::ENTITY.'.sold', self::ENTITY, $id, $academyId, $actorUserId, $actorRole, after: [
                'student_id' => $studentId, 'teacher_id' => $teacherId, 'course' => $course, 'label' => $label,
                'lessons_sold' => $sold, 'lesson_price_minor' => $lessonPrice, 'price_minor' => $price, 'currency' => $currency,
                'starts_on' => $startsOn, 'invoice_id' => $invoiceId, 'lessons_taken' => $taken,
            ]);

            return ['subscription_id' => $id, 'invoice_id' => $invoiceId, 'due_minor' => $this->billing->dueOn($invoiceId), 'warnings' => $warnings, 'lessons_taken' => $taken];
        });
    }

    /**
     * Change an open (or finished) block: label, subject, start date, lessons sold (a top-up, or a
     * reopen), price, length. The bill line is re-issued in place when the money changes.
     *
     * @param  array<string, mixed>  $changes  EditInput
     * @return array{invoice_id: ?string, credited_minor: int, due_minor: int, moved_lessons: int}
     */
    public function edit(string $id, array $changes, ?string $actorUserId, ?string $actorRole): array
    {
        return DB::transaction(function () use ($id, $changes, $actorUserId, $actorRole): array {
            $sub = $this->lock($id);
            if (! in_array($sub->status, ['OPEN', 'FINISHED'], true)) {
                throw ValidationException::withMessages(['subscription' => ['A closed subscription cannot be edited. / لا يمكن تعديل اشتراك منتهٍ.']]);
            }
            $studentId = (string) $sub->student_id;
            $used = $this->used($id);

            $teacherId = $sub->teacher_id !== null ? (string) $sub->teacher_id : null;
            $course = $sub->course;
            if (array_key_exists('teacher_id', $changes) || array_key_exists('course', $changes)) {
                [$teacherId, $course, $newSubject] = $this->resolveSubject($studentId,
                    array_key_exists('teacher_id', $changes) ? $changes['teacher_id'] : $teacherId,
                    array_key_exists('course', $changes) ? $changes['course'] : $course,
                    (bool) ($changes['new_subject'] ?? false));
                if ($newSubject) {
                    DB::table('student_teacher_assignments')->insert([
                        'id' => (string) Str::uuid(), 'academy_id' => (string) $sub->academy_id, 'student_id' => $studentId,
                        'teacher_id' => $teacherId, 'course' => $course, 'started_at' => now(), 'ended_at' => null,
                    ]);
                }
            }
            $sold = array_key_exists('lessons_sold', $changes) && $changes['lessons_sold'] !== null ? (int) $changes['lessons_sold'] : (int) $sub->lessons_sold;
            if ($sold < $used) {
                throw ValidationException::withMessages(['lessons_sold' => [LessonCount::en($used).' already counted on it. / '.LessonCount::ar($used).' محتسبة عليه بالفعل.']]);
            }
            $lessonPrice = array_key_exists('lesson_price_minor', $changes) && $changes['lesson_price_minor'] !== null ? (int) $changes['lesson_price_minor'] : (int) $sub->lesson_price_minor;
            $price = match (true) {
                array_key_exists('price_minor', $changes) && $changes['price_minor'] !== null => (int) $changes['price_minor'],
                $sold !== (int) $sub->lessons_sold || $lessonPrice !== (int) $sub->lesson_price_minor => $sold * $lessonPrice,
                default => (int) $sub->price_minor,
            };
            $startsOn = array_key_exists('starts_on', $changes) && $changes['starts_on'] !== null ? Carbon::parse((string) $changes['starts_on'])->toDateString() : (string) $sub->starts_on;
            $label = array_key_exists('label', $changes) && trim((string) $changes['label']) !== '' ? mb_substr(trim((string) $changes['label']), 0, 255) : (string) $sub->label;
            $status = $used >= $sold ? 'FINISHED' : 'OPEN';

            if ($status === 'OPEN' && ($open = $this->openIn($studentId, $teacherId, $course)) !== null && (string) $open->id !== $id) {
                throw ValidationException::withMessages(['teacher_id' => ['This student already has an open subscription for that subject. / لدى الطالب اشتراك مفتوح لهذه المادة بالفعل.']]);
            }

            DB::table('centre_subscriptions')->where('id', $id)->update([
                'teacher_id' => $teacherId, 'course' => $course, 'label' => $label, 'lessons_sold' => $sold,
                'lesson_minutes' => array_key_exists('lesson_minutes', $changes) ? ($changes['lesson_minutes'] !== null ? (int) $changes['lesson_minutes'] : null) : $sub->lesson_minutes,
                'lesson_price_minor' => $lessonPrice, 'price_minor' => $price, 'starts_on' => $startsOn,
                'status' => $status,
                'finished_at' => $status === 'FINISHED' ? ($sub->finished_at ?? now()) : null,
                'updated_at' => now(),
            ]);
            $after = DB::table('centre_subscriptions')->where('id', $id)->first();
            if ($sub->status === 'FINISHED' && $status === 'OPEN') {
                $this->clearAlert('SUBSCRIPTION_FINISHED', $id);
            }

            // Lessons follow the block's range: those now before its start go outside, those outside
            // and now in range come in (a reopened block takes what was taught after it ran out).
            $moved = $this->releaseBefore($after) + $this->takeOutside($after);

            $money = ['credited_minor' => 0, 'due_minor' => $this->billing->dueOn($sub->invoice_id !== null ? (string) $sub->invoice_id : null)];
            if ($sub->invoice_line_id !== null && ($price !== (int) $sub->price_minor || $label !== (string) $sub->label || $sold !== (int) $sub->lessons_sold)) {
                $money = $this->billing->reissue($after, $price !== (int) $sub->price_minor, $actorUserId, $actorRole);
            }

            Audit::log(self::ENTITY.'.edited', self::ENTITY, $id, (string) $sub->academy_id, $actorUserId, $actorRole,
                before: ['teacher_id' => $sub->teacher_id, 'course' => $sub->course, 'label' => $sub->label, 'lessons_sold' => (int) $sub->lessons_sold, 'price_minor' => (int) $sub->price_minor, 'starts_on' => (string) $sub->starts_on, 'status' => $sub->status],
                after: ['teacher_id' => $teacherId, 'course' => $course, 'label' => $label, 'lessons_sold' => $sold, 'price_minor' => $price, 'starts_on' => $startsOn, 'status' => $status, 'moved_lessons' => $moved] + $money);

            return ['invoice_id' => $sub->invoice_id !== null ? (string) $sub->invoice_id : null, 'moved_lessons' => $moved] + $money;
        });
    }

    /**
     * Close a block early, and — when asked — settle what was paid for lessons never had. On a block
     * already CLOSED and waiting (settlement PENDING) this is the settlement alone: the family card
     * decides later through the same door, with an empty reason.
     *
     * @param  array{method?: ?string, cash_account_id?: ?string, reference?: ?string, note?: ?string}|null  $refund
     * @param  ?string  $note  the KEEP reason / a word on the credit (`settlement_note`)
     * @return array{settlement: ?array<string, mixed>}
     */
    public function close(string $id, ?string $reason, ?string $mode, ?array $refund, ?string $note, ?string $actorUserId, ?string $actorRole): array
    {
        return DB::transaction(function () use ($id, $reason, $mode, $refund, $note, $actorUserId, $actorRole): array {
            $sub = $this->lock($id);
            $settleOnly = $sub->status === 'CLOSED' && $sub->settlement === 'PENDING';
            if (! $settleOnly && ! in_array($sub->status, ['OPEN', 'FINISHED'], true)) {
                throw ValidationException::withMessages(['subscription' => ['This subscription is already closed. / هذا الاشتراك منتهٍ بالفعل.']]);
            }
            if (! $settleOnly) {
                DB::table('centre_subscriptions')->where('id', $id)->update([
                    'status' => 'CLOSED', 'closed_at' => now(), 'closed_reason' => mb_substr(trim((string) $reason), 0, 500) ?: 'CLOSED', 'closed_by' => $actorUserId,
                    'settle_note' => $note !== null && trim($note) !== '' ? mb_substr(trim($note), 0, 500) : null, 'updated_at' => now(),
                ]);
                Audit::log(self::ENTITY.'.closed', self::ENTITY, $id, (string) $sub->academy_id, $actorUserId, $actorRole,
                    before: ['status' => $sub->status], after: ['status' => 'CLOSED', 'reason' => $reason, 'note' => $note, 'lessons_used' => $this->used($id)]);
                $this->settlement->markIfOwed($id);
            }
            $settled = null;
            if ($mode !== null && DB::table('centre_subscriptions')->where('id', $id)->value('settlement') === 'PENDING') {
                $settled = $this->settlement->settle($id, $mode, $refund, $note, $actorUserId, $actorRole);
            } elseif ($mode !== null && $settleOnly) {
                throw ValidationException::withMessages(['subscription' => ['This subscription is already settled. / تمت تسوية هذا الاشتراك بالفعل.']]);
            }

            return ['settlement' => $settled];
        });
    }

    /** A block sold by mistake: nothing counted, nothing paid. Its bill is voided. */
    public function cancel(string $id, ?string $note, ?string $actorUserId, ?string $actorRole): void
    {
        DB::transaction(function () use ($id, $note, $actorUserId, $actorRole): void {
            $sub = $this->lock($id);
            if (! in_array($sub->status, ['OPEN', 'FINISHED'], true)) {
                throw ValidationException::withMessages(['subscription' => ['This subscription is already closed. / هذا الاشتراك منتهٍ بالفعل.']]);
            }
            if ($this->used($id) > 0) {
                throw ValidationException::withMessages(['subscription' => ['Lessons were counted on this subscription. End it instead. / احتُسبت حصص على هذا الاشتراك. أنهِه بدلًا من ذلك.']]);
            }
            if ($this->paidOn($sub) > 0) {
                throw ValidationException::withMessages(['subscription' => ['Money was paid on this subscription. End it and settle instead. / دُفع مبلغ على هذا الاشتراك. أنهِه وسوِّه بدلًا من ذلك.']]);
            }
            DB::table('centre_subscriptions')->where('id', $id)->update([
                'status' => 'CANCELLED', 'closed_at' => now(), 'closed_reason' => $note !== null && trim($note) !== '' ? mb_substr(trim($note), 0, 500) : 'CANCELLED',
                'closed_by' => $actorUserId, 'updated_at' => now(),
            ]);
            $voided = false;
            if ($sub->invoice_id !== null) {
                $others = DB::table('invoice_line_items')->where('invoice_id', $sub->invoice_id)->where('id', '<>', $sub->invoice_line_id)->exists();
                $voided = ! $others && DB::table('invoices')->where('id', $sub->invoice_id)->whereIn('status', ['OPEN', 'CLOSED'])
                    ->update(['status' => 'VOID', 'updated_at' => now()]) > 0;
                $this->ledger->afterLinesChanged((string) $sub->invoice_id);
            }
            Audit::log(self::ENTITY.'.cancelled', self::ENTITY, $id, (string) $sub->academy_id, $actorUserId, $actorRole,
                before: ['status' => $sub->status], after: ['note' => $note, 'invoice_voided' => $voided]);
        });
    }

    /**
     * A student leaving the academy: every open block stops. Untouched and unpaid, it is voided with
     * its bill; otherwise it closes where it stands, and paid lessons never had wait on the family card.
     *
     * @return int blocks ended
     */
    public function windDown(string $studentId, string $reason, ?string $actorUserId, ?string $actorRole): int
    {
        $ended = 0;
        foreach (DB::table('centre_subscriptions')->where('student_id', $studentId)->where('status', 'OPEN')->get() as $sub) {
            if ($this->used((string) $sub->id) === 0 && $this->paidOn($sub) === 0) {
                $this->cancel((string) $sub->id, $reason, $actorUserId, $actorRole);
            } else {
                $this->close((string) $sub->id, $reason, null, null, null, $actorUserId, $actorRole);
            }
            $ended++;
        }

        return $ended;
    }

    // ── The billing hook ────────────────────────────────────────────────────

    /** A lesson was delivered: count it on its subject's open block, or flag it outside any. */
    public function count(object $session): void
    {
        DB::transaction(function () use ($session): void {
            if (DB::table('centre_subscription_lessons')->where('session_id', $session->id)->exists()) {
                return;
            }
            $academyId = (string) $session->academy_id;
            $studentId = (string) $session->student_id;
            [$teacherId, $course] = $this->lessonSubject($session);
            $on = $this->lessonDate($session, $academyId);
            $block = $this->blockFor($studentId, $teacherId, $course, $on);

            DB::table('centre_subscription_lessons')->insert([
                'id' => (string) Str::uuid(), 'academy_id' => $academyId, 'subscription_id' => $block?->id,
                'session_id' => (string) $session->id, 'student_id' => $studentId, 'teacher_id' => $teacherId,
                'course' => $course !== '' ? $course : null, 'lesson_on' => $on,
                'counted_at' => $block !== null ? now()->toIso8601String() : null, 'created_at' => now()->toIso8601String(),
            ]);

            if ($block === null) {
                Audit::log(self::ENTITY.'.lesson_outside', 'student', $studentId, $academyId, null, 'SUPER_ADMIN',
                    after: ['session_id' => (string) $session->id, 'teacher_id' => $teacherId, 'course' => $course, 'lesson_on' => $on]);
                $this->notify($academyId, 'LESSON_OUTSIDE_SUBSCRIPTION', $studentId, [
                    'student_id' => $studentId, 'student_name' => $this->studentName($studentId),
                    'session_id' => (string) $session->id, 'teacher_id' => $teacherId,
                    'teacher_name' => $teacherId !== null ? DB::table('teachers')->where('id', $teacherId)->value('full_name') : null,
                    'course' => $course !== '' ? ($session->course ?? $course) : null,
                    'outside_count' => $this->outsideCount($studentId),
                ]);

                return;
            }
            Audit::log(self::ENTITY.'.counted', self::ENTITY, (string) $block->id, $academyId, null, 'SUPER_ADMIN',
                after: ['session_id' => (string) $session->id, 'lessons_used' => $this->used((string) $block->id)]);
            $this->finishIfFull(DB::table('centre_subscriptions')->where('id', $block->id)->first());
        });
    }

    /** A delivered lesson was undone: it leaves its block (which reopens if it had finished). True when it was ours. */
    public function uncount(object $session): bool
    {
        return DB::transaction(function () use ($session): bool {
            $row = DB::table('centre_subscription_lessons')->where('session_id', $session->id)->first();
            if ($row === null) {
                return false;
            }
            DB::table('centre_subscription_lessons')->where('id', $row->id)->delete();
            $academyId = (string) $row->academy_id;

            if ($row->subscription_id === null) {
                if ($this->outsideCount((string) $row->student_id) === 0) {
                    $this->clearAlert('LESSON_OUTSIDE_SUBSCRIPTION', (string) $row->student_id);
                }

                return true;
            }
            $sub = $this->lock((string) $row->subscription_id);
            $reopened = false;
            if ($sub->status === 'FINISHED' && $this->used((string) $sub->id) < (int) $sub->lessons_sold) {
                DB::table('centre_subscriptions')->where('id', $sub->id)->update(['status' => 'OPEN', 'finished_at' => null, 'updated_at' => now()]);
                $this->clearAlert('SUBSCRIPTION_FINISHED', (string) $sub->id);
                $reopened = true;
            }
            Audit::log(self::ENTITY.'.uncounted', self::ENTITY, (string) $sub->id, $academyId, null, 'SUPER_ADMIN',
                after: ['session_id' => (string) $session->id, 'reopened' => $reopened]);

            return true;
        });
    }

    /**
     * The desk picks the block a delivered lesson counts on — any of the student's open blocks, or
     * none (outside). The old block reopens when this frees a seat on it; the new one finishes when
     * this fills it. No money moves: the bill is the block's, and the teacher is paid per lesson.
     * A revert and re-mark goes back to the automatic pick (blockFor).
     */
    public function moveLesson(string $sessionId, ?string $subscriptionId, ?string $actorUserId, ?string $actorRole): void
    {
        DB::transaction(function () use ($sessionId, $subscriptionId, $actorUserId, $actorRole): void {
            $row = DB::table('centre_subscription_lessons')->where('session_id', $sessionId)->lockForUpdate()->first();
            if ($row === null) {
                throw ValidationException::withMessages(['session' => ['Record the lesson as attended first. / سجّل حضور الحصة أولًا.']]);
            }
            $from = $row->subscription_id !== null ? (string) $row->subscription_id : null;
            if ($from === $subscriptionId) {
                return;
            }
            // Lock both blocks in one order, so two desks moving lessons the other way can't deadlock.
            $locked = [];
            foreach (collect([$from, $subscriptionId])->filter()->sort()->values() as $id) {
                $locked[$id] = $this->lock((string) $id);
            }
            $to = $subscriptionId !== null ? $locked[$subscriptionId] : null;
            if ($to !== null) {
                if ((string) $to->student_id !== (string) $row->student_id) {
                    throw ValidationException::withMessages(['subscription_id' => ['That subscription is another student\'s. / هذا الاشتراك لطالب آخر.']]);
                }
                if ($to->status !== 'OPEN' || $this->used((string) $to->id) >= (int) $to->lessons_sold) {
                    throw ValidationException::withMessages(['subscription_id' => ['That subscription has no lessons left. / لا توجد حصص متبقية في هذا الاشتراك.']]);
                }
                if ((string) $to->starts_on > Carbon::parse($row->lesson_on)->toDateString()) {
                    throw ValidationException::withMessages(['subscription_id' => ['That subscription starts after this lesson: move its start date first. / هذا الاشتراك يبدأ بعد هذه الحصة: عدّل تاريخ بدايته أولًا.']]);
                }
            }

            DB::table('centre_subscription_lessons')->where('id', $row->id)->update([
                'subscription_id' => $to?->id, 'counted_at' => $to !== null ? now()->toIso8601String() : null,
            ]);

            $reopened = false;
            if ($from !== null) {
                $old = $locked[$from];
                if ($old->status === 'FINISHED' && $this->used($from) < (int) $old->lessons_sold) {
                    DB::table('centre_subscriptions')->where('id', $from)->update(['status' => 'OPEN', 'finished_at' => null, 'updated_at' => now()]);
                    $this->clearAlert('SUBSCRIPTION_FINISHED', $from);
                    $reopened = true;
                }
            } elseif ($this->outsideCount((string) $row->student_id) === 0) {
                $this->clearAlert('LESSON_OUTSIDE_SUBSCRIPTION', (string) $row->student_id);
            }
            if ($to !== null) {
                $this->finishIfFull(DB::table('centre_subscriptions')->where('id', $to->id)->first());
            }

            Audit::log(self::ENTITY.'.lesson_moved', 'session', $sessionId, (string) $row->academy_id, $actorUserId, $actorRole,
                before: ['subscription_id' => $from], after: ['subscription_id' => $to?->id, 'reopened_from' => $reopened]);
        });
    }

    /**
     * Where a delivered lesson counts and where else it could: the student's open blocks with room
     * from the lesson's day. Null for a lesson the engine never counted (not delivered, or not a centre).
     *
     * @return array{current: ?string, options: list<array<string, mixed>>}|null
     */
    public function lessonChoices(object $session): ?array
    {
        $row = DB::table('centre_subscription_lessons')->where('session_id', $session->id)->first(['subscription_id', 'student_id', 'lesson_on']);
        if ($row === null) {
            return null;
        }
        $on = Carbon::parse($row->lesson_on)->toDateString();
        $current = $row->subscription_id !== null ? (string) $row->subscription_id : null;
        $options = DB::table('centre_subscriptions as cs')
            ->leftJoin('teachers as t', 't.id', '=', 'cs.teacher_id')
            ->where('cs.student_id', $row->student_id)
            ->where(fn ($w) => $w->where(fn ($o) => $o->where('cs.status', 'OPEN')->where('cs.starts_on', '<=', $on))
                ->when($current !== null, fn ($q) => $q->orWhere('cs.id', $current)))
            ->orderBy('cs.sequence_no')
            ->get(['cs.id', 'cs.label', 'cs.course', 'cs.sequence_no', 'cs.lessons_sold', 'cs.status', 't.full_name as teacher_name'])
            ->map(function ($b) use ($current) {
                $used = $this->used((string) $b->id);

                return [
                    'id' => (string) $b->id, 'label' => (string) $b->label, 'course' => $b->course, 'sequence_no' => (int) $b->sequence_no,
                    'teacher_name' => $b->teacher_name, 'lessons_sold' => (int) $b->lessons_sold, 'lessons_used' => $used,
                    'status' => (string) $b->status,
                    // The block it is on always stays pickable; another needs a free seat.
                    'available' => (string) $b->id === $current || ($b->status === 'OPEN' && $used < (int) $b->lessons_sold),
                ];
            })->values()->all();

        return ['current' => $current, 'options' => $options];
    }

    // ── Reads ───────────────────────────────────────────────────────────────

    /**
     * The lesson's number on its block (1..sold), for the parent-facing report.
     *
     * @return array{id: string, label: string, number: int, lessons_sold: int}|null
     */
    public function lessonNumber(object $session): ?array
    {
        $row = DB::table('centre_subscription_lessons as l')
            ->join('centre_subscriptions as cs', 'cs.id', '=', 'l.subscription_id')
            ->where('l.session_id', $session->id)
            ->first(['cs.id', 'cs.label', 'cs.lessons_sold']);
        if ($row === null) {
            return null;
        }
        $number = (int) DB::table('centre_subscription_lessons as l')
            ->join('sessions as se', 'se.id', '=', 'l.session_id')
            ->where('l.subscription_id', $row->id)
            ->where('se.scheduled_at_utc', '<=', $session->scheduled_at_utc)
            ->count();

        return ['id' => (string) $row->id, 'label' => (string) $row->label, 'number' => max(1, $number), 'lessons_sold' => (int) $row->lessons_sold];
    }

    /** @return list<array<string, mixed>> SubscriptionRow[] for one student, newest first */
    public function forStudent(string $studentId): array
    {
        return $this->rows->forStudent($studentId);
    }

    /** @return array<string, mixed> Summary */
    public function summary(): array
    {
        return $this->rows->summary();
    }

    /**
     * The student's lessons attended outside any block, oldest first.
     *
     * @return array{count: int, lessons: list<array<string, mixed>>}
     */
    public function outsideSubscription(string $studentId): array
    {
        $lessons = DB::table('centre_subscription_lessons as l')
            ->join('sessions as se', 'se.id', '=', 'l.session_id')
            ->leftJoin('teachers as t', 't.id', '=', 'l.teacher_id')
            ->where('l.student_id', $studentId)->whereNull('l.subscription_id')
            ->orderBy('l.lesson_on')->orderBy('se.scheduled_at_utc')
            ->get(['l.session_id', 'l.lesson_on', 'l.teacher_id', 'l.course', 't.full_name as teacher_name', 'se.scheduled_at_utc', 'se.duration_minutes'])
            ->map(fn ($l) => [
                'session_id' => (string) $l->session_id,
                'lesson_on' => Carbon::parse($l->lesson_on)->format('Y-m-d'),
                'scheduled_at_utc' => Carbon::parse($l->scheduled_at_utc)->utc()->toIso8601String(),
                'duration_minutes' => (int) $l->duration_minutes,
                'teacher_id' => $l->teacher_id !== null ? (string) $l->teacher_id : null,
                'teacher_name' => $l->teacher_name,
                'course' => $l->course,
            ])->values()->all();

        return ['count' => count($lessons), 'lessons' => $lessons];
    }

    /**
     * A WhatsApp reminder to the family — about the bill (PAYMENT) or the block that ran out
     * (FINISHED) — through the same deep link the package reminder uses.
     *
     * @return array<string, mixed>
     */
    public function remind(string $id, string $kind, string $locale, ?string $actorUserId, ?string $actorRole): array
    {
        $row = $this->rows->one($id);
        if ($row === null) {
            abort(404, 'Subscription not found.');
        }
        if ($kind === SubscriptionReminderMessage::PAYMENT && $row['outstanding_minor'] <= 0) {
            throw ValidationException::withMessages(['kind' => ['This subscription is paid. / هذا الاشتراك مدفوع.']]);
        }
        if ($kind === SubscriptionReminderMessage::FINISHED && $row['status'] === 'OPEN') {
            throw ValidationException::withMessages(['kind' => ['This subscription is still running. / هذا الاشتراك ما زال جاريًا.']]);
        }
        $sub = DB::table('centre_subscriptions')->where('id', $id)->first();
        $academy = DB::table('academies')->where('id', $sub->academy_id)->first(['name', 'timezone']);
        $invoice = $sub->invoice_id !== null ? DB::table('invoices')->where('id', $sub->invoice_id)->first(['guardian_id', 'public_token']) : null;
        $phone = $this->recipientPhone((string) $sub->student_id, $invoice?->guardian_id !== null ? (string) $invoice->guardian_id : null);
        if ($phone === '') {
            throw ValidationException::withMessages(['phone' => ['No WhatsApp number on file for this student or their guardian. / لا يوجد رقم واتساب مسجّل للطالب أو ولي الأمر.']]);
        }
        $message = SubscriptionReminderMessage::build($kind, $locale, [
            'academy' => (string) $academy->name, 'student' => $row['student']['full_name'], 'label' => $row['label'],
            'sequence_no' => $row['sequence_no'], 'course' => $row['course'], 'lessons_sold' => $row['lessons_sold'], 'lessons_left' => $row['lessons_left'],
            'finished' => $row['status'] !== 'OPEN',
            'finished_on' => $row['finished_at'] !== null ? Carbon::parse($row['finished_at'])->setTimezone((string) ($academy->timezone ?: 'UTC'))->toDateString() : null,
            'total_minor' => $row['price_minor'], 'paid_minor' => $row['invoice_paid_minor'], 'balance_minor' => $row['outstanding_minor'],
            'currency' => $row['currency'],
            'url' => $kind === SubscriptionReminderMessage::PAYMENT && $invoice?->public_token !== null ? AcademyUrl::invoice((string) $sub->academy_id, (string) $invoice->public_token) : null,
        ]);
        $now = now();
        DB::table('centre_subscriptions')->where('id', $id)->update(['reminders_sent' => DB::raw('reminders_sent + 1'), 'last_reminded_at' => $now->toIso8601String(), 'updated_at' => $now->toIso8601String()]);
        $count = (int) DB::table('centre_subscriptions')->where('id', $id)->value('reminders_sent');
        Audit::log(self::ENTITY.'.reminder_sent', self::ENTITY, $id, (string) $sub->academy_id, $actorUserId, $actorRole,
            after: ['kind' => $kind, 'phone' => $phone, 'transport' => 'DEEPLINK', 'sent' => false, 'reminders_sent' => $count]);

        return ['sent' => false, 'preview' => $message, 'kind' => $kind, 'phone' => $phone, 'transport' => 'DEEPLINK',
            'deeplink' => app(WhatsAppSender::class)->deeplink($phone, $message), 'reminders_sent' => $count, 'last_reminded_at' => $now->utc()->toIso8601String()];
    }

    // ── Scope ───────────────────────────────────────────────────────────────

    /** A subject's name as it is compared. */
    public static function courseKey(?string $course): string
    {
        return mb_strtolower(trim((string) $course));
    }

    /** The block that takes a lesson of this subject on this day, if one is open. */
    public function blockFor(string $studentId, ?string $teacherId, string $courseKey, string $on): ?object
    {
        $open = DB::table('centre_subscriptions')->where('student_id', $studentId)->where('status', 'OPEN')
            ->where('starts_on', '<=', $on)->orderBy('sequence_no')->get();
        if ($teacherId !== null) {
            $tied = $open->filter(fn ($b) => (string) $b->teacher_id === $teacherId);
            if ($tied->isNotEmpty()) {
                return ($courseKey !== '' ? $tied->first(fn ($b) => self::courseKey($b->course) === $courseKey) : null) ?? $tied->first();
            }
        }

        return $open->first(fn ($b) => $b->teacher_id === null);
    }

    /**
     * Whose subject a lesson is: its timetable's teacher (else its own) and the subject it names.
     *
     * @return array{0: ?string, 1: string} [teacherId, courseKey]
     */
    public function lessonSubject(object $session): array
    {
        $scheduleTeacher = isset($session->schedule_id) && $session->schedule_id !== null
            ? DB::table('schedules')->where('id', $session->schedule_id)->value('teacher_id') : null;
        $teacher = $scheduleTeacher ?? ($session->teacher_id ?? null);

        return [$teacher !== null ? (string) $teacher : null, self::courseKey($session->course ?? null)];
    }

    // ── internals ───────────────────────────────────────────────────────────

    /**
     * The subject a block is sold for. A teacher named must be one the student takes a subject with
     * (or `new_subject` makes the link); untied is for a student with at most one teacher.
     *
     * @return array{0: ?string, 1: ?string, 2: bool} [teacherId, course, newSubject]
     */
    private function resolveSubject(string $studentId, mixed $teacherId, mixed $course, bool $newSubject): array
    {
        $teacherId = $teacherId !== null && $teacherId !== '' ? (string) $teacherId : null;
        $asked = trim((string) ($course ?? '')) !== '' ? mb_substr(trim((string) $course), 0, 80) : null;
        $links = DB::table('student_teacher_assignments')->where('student_id', $studentId)->whereNull('ended_at')->get(['teacher_id', 'course']);

        if ($teacherId === null) {
            if ($links->pluck('teacher_id')->unique()->count() > 1) {
                throw ValidationException::withMessages(['teacher_id' => ['This student takes more than one subject: choose which. / هذا الطالب يدرس أكثر من مادة: اختر المادة.']]);
            }

            return [null, null, false];
        }
        $link = $links->first(fn ($l) => (string) $l->teacher_id === $teacherId && ($asked === null || self::courseKey($l->course) === self::courseKey($asked) || trim((string) $l->course) === ''))
            ?? $links->first(fn ($l) => (string) $l->teacher_id === $teacherId);
        if ($link === null && ! $newSubject) {
            throw ValidationException::withMessages(['teacher_id' => ['This student is not taking a subject with that teacher. / الطالب لا يدرس مادة مع هذا المعلم.']]);
        }
        if (DB::table('teachers')->where('id', $teacherId)->whereNull('deleted_at')->doesntExist()) {
            throw ValidationException::withMessages(['teacher_id' => ['Unknown or inactive teacher. / معلم غير موجود أو غير نشط.']]);
        }
        $course = $asked ?? ($link !== null && trim((string) $link->course) !== '' ? trim((string) $link->course) : null);
        // The link with this teacher had no subject yet: this is its first.
        if ($link !== null && trim((string) $link->course) === '' && $course !== null) {
            DB::table('student_teacher_assignments')->where('student_id', $studentId)->where('teacher_id', $teacherId)->whereNull('ended_at')->update(['course' => $course]);
        }

        return [$teacherId, $course, $link === null];
    }

    private function openIn(string $studentId, ?string $teacherId, ?string $course): ?object
    {
        $q = DB::table('centre_subscriptions')->where('student_id', $studentId)->where('status', 'OPEN');

        return ($teacherId === null ? $q->whereNull('teacher_id') : $q->where('teacher_id', $teacherId)->whereRaw("lower(trim(coalesce(course, ''))) = ?", [self::courseKey($course)]))->first();
    }

    /** Pay first: the last block of this subject must be paid before the next is sold. The 422 names the bill. */
    private function assertPaidFirst(string $academyId, string $studentId, ?string $teacherId, ?string $course): void
    {
        if (! RenewalPolicy::paysFirst($academyId, $studentId)) {
            return;
        }
        $q = DB::table('centre_subscriptions as cs')->join('invoices as i', 'i.id', '=', 'cs.invoice_id')
            ->where('cs.student_id', $studentId)->where('i.status', '<>', 'VOID')->whereColumn('i.amount_paid_minor', '<', 'i.total_minor');
        $owed = ($teacherId === null ? $q->whereNull('cs.teacher_id') : $q->where('cs.teacher_id', $teacherId)->whereRaw("lower(trim(coalesce(cs.course, ''))) = ?", [self::courseKey($course)]))
            ->orderByDesc('cs.sequence_no')->first(['cs.id', 'cs.sequence_no', 'cs.label', 'i.id as invoice_id', 'i.total_minor', 'i.amount_paid_minor', 'i.currency']);
        if ($owed === null) {
            return;
        }
        $due = number_format(((int) $owed->total_minor - (int) $owed->amount_paid_minor) / 100, 2).' '.$owed->currency;
        throw PayFirstRefusal::of(
            "This family pays first: subscription #{$owed->sequence_no} ({$owed->label}) still owes {$due} on its bill. / هذه الأسرة تدفع أولًا: الاشتراك رقم {$owed->sequence_no} ({$owed->label}) ما زال عليه {$due} على فاتورته.",
            (string) $owed->invoice_id,
            (string) $owed->id,
        );
    }

    /** Outside lessons of the block's subject from its start, oldest first, up to what it has free. Returns how many. */
    private function takeOutside(object $sub): int
    {
        $free = (int) $sub->lessons_sold - $this->used((string) $sub->id);
        if ($free <= 0 || $sub->status === 'CANCELLED' || $sub->status === 'CLOSED') {
            return 0;
        }
        $ids = $this->outsideQuery((string) $sub->student_id, $sub->teacher_id !== null ? (string) $sub->teacher_id : null, $sub->course)
            ->where('lesson_on', '>=', (string) $sub->starts_on)
            ->orderBy('lesson_on')->orderBy('created_at')->limit($free)->pluck('id')->all();
        if ($ids === []) {
            return 0;
        }
        DB::table('centre_subscription_lessons')->whereIn('id', $ids)->update(['subscription_id' => $sub->id, 'counted_at' => now()->toIso8601String()]);
        if ($this->outsideCount((string) $sub->student_id) === 0) {
            $this->clearAlert('LESSON_OUTSIDE_SUBSCRIPTION', (string) $sub->student_id);
        }
        $this->finishIfFull(DB::table('centre_subscriptions')->where('id', $sub->id)->first());

        return count($ids);
    }

    /** Lessons on the block dated before its (new) start go back outside. Returns how many. */
    private function releaseBefore(object $sub): int
    {
        $n = DB::table('centre_subscription_lessons')->where('subscription_id', $sub->id)->where('lesson_on', '<', (string) $sub->starts_on)
            ->update(['subscription_id' => null, 'counted_at' => null]);
        if ($n > 0 && $sub->status === 'FINISHED' && $this->used((string) $sub->id) < (int) $sub->lessons_sold) {
            DB::table('centre_subscriptions')->where('id', $sub->id)->update(['status' => 'OPEN', 'finished_at' => null, 'updated_at' => now()]);
        }

        return $n;
    }

    private function finishIfFull(object $sub): void
    {
        if ($sub->status !== 'OPEN' || $this->used((string) $sub->id) < (int) $sub->lessons_sold) {
            return;
        }
        DB::table('centre_subscriptions')->where('id', $sub->id)->update(['status' => 'FINISHED', 'finished_at' => now()->toIso8601String(), 'updated_at' => now()]);
        $this->notify((string) $sub->academy_id, 'SUBSCRIPTION_FINISHED', (string) $sub->id, [
            'subscription_id' => (string) $sub->id, 'student_id' => (string) $sub->student_id, 'student_name' => $this->studentName((string) $sub->student_id),
            'label' => (string) $sub->label, 'course' => $sub->course, 'lessons_sold' => (int) $sub->lessons_sold, 'sequence_no' => (int) $sub->sequence_no,
        ]);
    }

    /** @return list<string> warnings for the desk */
    private function flagUnpaidPredecessors(object $sub): array
    {
        $unpaid = DB::table('centre_subscriptions as cs')->join('invoices as i', 'i.id', '=', 'cs.invoice_id')
            ->where('cs.student_id', $sub->student_id)->where('cs.id', '<>', $sub->id)
            ->where('i.status', '<>', 'VOID')->whereColumn('i.amount_paid_minor', '<', 'i.total_minor')
            ->get(['cs.id', 'cs.label', 'cs.sequence_no', 'i.total_minor', 'i.amount_paid_minor', 'i.currency']);
        if ($unpaid->isEmpty()) {
            return [];
        }
        $outstanding = (int) $unpaid->sum(fn ($r) => (int) $r->total_minor - (int) $r->amount_paid_minor);
        $this->notify((string) $sub->academy_id, 'SUBSCRIPTION_UNPAID', (string) $sub->id, [
            'subscription_id' => (string) $sub->id, 'student_id' => (string) $sub->student_id, 'student_name' => $this->studentName((string) $sub->student_id),
            'label' => (string) $sub->label, 'invoice_id' => $sub->invoice_id !== null ? (string) $sub->invoice_id : null,
            'unpaid_subscriptions' => $unpaid->map(fn ($r) => ['id' => (string) $r->id, 'label' => (string) $r->label, 'sequence_no' => (int) $r->sequence_no])->values()->all(),
            'outstanding_minor' => $outstanding, 'currency' => (string) $unpaid->first()->currency,
        ]);
        $amount = number_format($outstanding / 100, 2).' '.$unpaid->first()->currency;

        return ["An earlier subscription still owes {$amount}. / اشتراك سابق ما زال عليه {$amount}."];
    }

    private function outsideQuery(string $studentId, ?string $teacherId, ?string $course)
    {
        $q = DB::table('centre_subscription_lessons')->where('student_id', $studentId)->whereNull('subscription_id');
        if ($teacherId === null) {
            return $q;
        }

        return $q->where('teacher_id', $teacherId)
            ->where(fn ($w) => $w->whereNull('course')->orWhereRaw("lower(trim(course)) = ?", [self::courseKey($course)]));
    }

    private function firstOutsideOn(string $studentId, ?string $teacherId, ?string $course): ?string
    {
        $on = $this->outsideQuery($studentId, $teacherId, $course)->min('lesson_on');

        return $on !== null ? Carbon::parse($on)->toDateString() : null;
    }

    private function outsideCount(string $studentId): int
    {
        return (int) DB::table('centre_subscription_lessons')->where('student_id', $studentId)->whereNull('subscription_id')->count();
    }

    private function used(string $subscriptionId): int
    {
        return (int) DB::table('centre_subscription_lessons')->where('subscription_id', $subscriptionId)->count();
    }

    private function paidOn(object $sub): int
    {
        if ($sub->invoice_id === null) {
            return 0;
        }

        return max((int) DB::table('invoices')->where('id', $sub->invoice_id)->value('amount_paid_minor'), $sub->invoice_line_id !== null ? $this->billing->allocatedTo((string) $sub->invoice_line_id) : 0);
    }

    private function lock(string $id): object
    {
        $sub = DB::table('centre_subscriptions')->where('id', $id)->lockForUpdate()->first();
        if ($sub === null) {
            throw ValidationException::withMessages(['subscription' => ['Subscription not found. / الاشتراك غير موجود.']]);
        }

        return $sub;
    }

    private function lessonDate(object $session, string $academyId): string
    {
        $tz = (string) (DB::table('academies')->where('id', $academyId)->value('timezone') ?: 'UTC');

        return Carbon::parse($session->scheduled_at_utc)->setTimezone($tz)->toDateString();
    }

    private function defaultLabel(int $sold, ?string $course, ?string $teacherId): string
    {
        $subject = $course ?? ($teacherId !== null ? DB::table('teachers')->where('id', $teacherId)->value('full_name') : null);

        return LessonCount::ar($sold).($subject !== null ? ' — '.$subject : '');
    }

    private function familyCurrency(string $studentId, object $academy): string
    {
        $guardian = DB::table('students as s')->join('guardians as g', 'g.id', '=', 's.guardian_id')->where('s.id', $studentId)->value('g.currency');
        $sub = DB::table('subscriptions')->where('student_id', $studentId)->where('status', 'ACTIVE')->whereNull('deleted_at')->orderByDesc('start_date')->value('currency');

        return (string) ($guardian ?: $sub ?: $academy->default_currency ?: 'EGP');
    }

    private function studentName(string $studentId): string
    {
        return (string) (DB::table('students')->where('id', $studentId)->value('full_name') ?? '');
    }

    /** The guardian the bill is addressed to, else the student's guardian, else the student. */
    private function recipientPhone(string $studentId, ?string $invoiceGuardianId): string
    {
        $s = DB::table('students as s')->leftJoin('guardians as g', 'g.id', '=', 's.guardian_id')->where('s.id', $studentId)
            ->first(['s.whatsapp_phone as student_phone', 'g.whatsapp_phone as guardian_phone']);
        $billed = $invoiceGuardianId !== null ? DB::table('guardians')->where('id', $invoiceGuardianId)->value('whatsapp_phone') : null;

        return trim((string) ($billed ?: $s?->guardian_phone ?: $s?->student_phone ?: ''));
    }

    /** @param  array<string, mixed>  $data */
    private function notify(string $academyId, string $type, string $subjectId, array $data): void
    {
        DB::table('notifications')->insertOrIgnore([
            'id' => (string) Str::uuid(), 'academy_id' => $academyId, 'type' => $type, 'category' => self::CATEGORY,
            'audience_role' => 'ACADEMY_OWNER', 'recipient_user_id' => null, 'session_id' => null, 'subject_id' => $subjectId,
            'data' => json_encode($data), 'created_at' => now()->toIso8601String(),
        ]);
    }

    /** The alert is anchored to its subject (one per subject and type): clear it so the next one can fire. */
    private function clearAlert(string $type, string $subjectId): void
    {
        DB::table('notifications')->where('type', $type)->where('subject_id', $subjectId)->delete();
    }
}
