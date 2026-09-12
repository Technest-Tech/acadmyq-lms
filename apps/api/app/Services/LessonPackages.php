<?php

declare(strict_types=1);

namespace App\Services;

use App\Support\Audit;
use App\Support\PublicInvoiceToken;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * The lesson-package engine (docs/lesson-packages). Owns the *balance*: how many minutes a
 * student has bought, how many each lesson burns, when the block runs out and what that costs.
 *
 * It is the second billing mode, and it is mutually exclusive with the monthly one. A student
 * whose subscription reads price_basis = PER_PACKAGE never gets an AUTO monthly invoice line —
 * {@see Invoicing::onSessionBillable} delegates here instead. Two billing clocks running on one
 * student is a double-bill, so the exclusivity is the whole point, not a detail.
 *
 * Three invariants, all of them load-bearing:
 *
 *  1. MINUTES. Everything is an integer minute count. Hours exist only in labels.
 *
 *  2. A LESSON NEVER SPLITS. 90 minutes against a 30-minute balance does not put 30 on the old
 *     package and 60 on the new one. It overdraws: the package closes at −60 and those minutes
 *     are charged at the package's own snapshotted hourly rate, as one line, on one invoice.
 *     `lesson_package_credits.session_id` is UNIQUE, so this is enforced by the database and
 *     not merely by this class.
 *
 *  3. CONSUMPTION IS NEVER GATED ON PAYMENT. {@see consume()} cannot fail because a parent owes
 *     money — a teacher marking attendance must never be blocked by the accounts. An unpaid
 *     previous package raises a notification and shows up in the attention queue; it does not
 *     stop a lesson from being recorded.
 *
 * Everything runs inside the caller's tenant transaction (GUCs already set by
 * TenantContextMiddleware), so every write here is RLS-scoped to the student's academy.
 */
final class LessonPackages
{
    /** The subscription price basis that puts a student on package billing. */
    public const BASIS = 'PER_PACKAGE';

    /** Balance at or below this many minutes fires the "running low" alert. */
    private const DEFAULT_LOW_MINUTES = 60;

    // =========================================================================
    // Reads
    // =========================================================================

    /** True when this student is billed by package rather than by month. */
    public function isPackageStudent(string $studentId): bool
    {
        return $this->activeSubscriptionBasis($studentId) === self::BASIS;
    }

    /** The student's one open package, or null when they have none. */
    public function activeFor(string $studentId): ?object
    {
        return DB::table('lesson_packages')
            ->where('student_id', $studentId)
            ->where('status', 'ACTIVE')
            ->first();
    }

    /**
     * Minutes still available on a package row: what they bought, plus anything carried over,
     * minus what has been burnt. Can be zero but is clamped, never negative — an overdraw is
     * recorded as `minutes_overdrawn`, which is a different fact from "balance".
     */
    public function remainingMinutes(object $package): int
    {
        $balance = (int) $package->minutes_total
            + (int) $package->carried_over_minutes
            - (int) $package->minutes_consumed;

        return max(0, $balance);
    }

    // =========================================================================
    // Billing mode — the switch that used to live on the student's profile
    // =========================================================================

    /**
     * Put this student on package billing, creating a subscription if they have none.
     *
     * Selling someone a block of hours IS putting them on the hour clock, so {@see open()} calls
     * this rather than making the owner set it on the student's profile first. That two-step was
     * the single most confusing thing about the feature: the packages screen's student picker
     * only listed students who had already been flipped, so the step you had to do first was the
     * one you could not see from here.
     *
     * What it writes, and what it deliberately does not:
     *   - NO subscription → create one on PER_PACKAGE, priced at this package's derived hourly
     *     rate, in this package's currency, starting the day the package starts.
     *   - Subscription on another basis → flip `price_basis` IN PLACE (no new row: nothing keys
     *     off the subscription id, and churning it loses the student's start date for nothing),
     *     and adopt the derived hourly rate as their default. `sessions_per_month` is cleared —
     *     a monthly quota means nothing once the boundary is "N hours bought".
     *   - ALREADY on PER_PACKAGE → touch nothing. The running package carries its own snapshotted
     *     rate, so the subscription figure only prices the no-open-package fallback, and silently
     *     rewriting an agreed rate because one block was sold at a discount is worse than leaving
     *     it. The currency is never overwritten either: a package may be sold in another currency
     *     (§3.6) without that becoming the student's agreed one.
     *
     * @return array{switched:bool, created:bool, previous_basis:?string}
     */
    public function ensurePackageBilling(
        string $studentId,
        string $academyId,
        int $hourlyRateMinor,
        string $currency,
        string $startsOn,
        ?string $actorUserId,
        ?string $actorRole,
    ): array {
        $sub = DB::table('subscriptions')
            ->where('student_id', $studentId)
            ->where('status', 'ACTIVE')
            ->whereNull('deleted_at')
            ->orderByDesc('start_date')
            ->first();

        if ($sub !== null && (string) $sub->price_basis === self::BASIS) {
            return ['switched' => false, 'created' => false, 'previous_basis' => self::BASIS];
        }

        if ($sub === null) {
            $subId = (string) Str::uuid();
            DB::table('subscriptions')->insert([
                'id' => $subId,
                'academy_id' => $academyId,
                'student_id' => $studentId,
                'plan_label' => 'Package billing',
                'sessions_per_month' => null,
                'price_minor' => $hourlyRateMinor,
                'currency' => strtoupper($currency),
                'price_basis' => self::BASIS,
                'status' => 'ACTIVE',
                'start_date' => $startsOn,
            ]);

            Audit::log('subscription.set', 'subscription', $subId, $academyId, $actorUserId, $actorRole, after: [
                'price_basis' => self::BASIS,
                'price_minor' => $hourlyRateMinor,
                'currency' => strtoupper($currency),
                'reason' => 'package_opened',
            ]);

            return ['switched' => true, 'created' => true, 'previous_basis' => null];
        }

        $previous = (string) $sub->price_basis;

        DB::table('subscriptions')->where('id', $sub->id)->update([
            'price_basis' => self::BASIS,
            'price_minor' => $hourlyRateMinor,
            'sessions_per_month' => null,
            'updated_at' => now(),
        ]);

        Audit::log('subscription.moved_to_packages', 'subscription', (string) $sub->id, $academyId, $actorUserId, $actorRole,
            before: ['price_basis' => $previous, 'price_minor' => (int) $sub->price_minor, 'sessions_per_month' => $sub->sessions_per_month],
            after: ['price_basis' => self::BASIS, 'price_minor' => $hourlyRateMinor, 'sessions_per_month' => null],
        );

        return ['switched' => true, 'created' => false, 'previous_basis' => $previous];
    }

    /**
     * Put this student back on the monthly clock.
     *
     * Offered when a package is closed, because that is the moment an owner actually decides the
     * student is done buying blocks — and it is the one way back, so that every billing-mode
     * decision stays on the packages screen. Refuses while a package is still open: a PER_HOUR
     * student with a live balance would bill monthly AND hold hours, which is the double-bill the
     * two modes exist to prevent.
     *
     * The package's own derived rate stays as their hourly price — it is the last rate anyone
     * agreed with this family, and inventing a different one here would be a silent re-price.
     *
     * @return bool True when the student moved, false when they were not on package billing.
     */
    public function returnToMonthly(string $studentId, string $academyId, ?string $actorUserId, ?string $actorRole): bool
    {
        if ($this->activeFor($studentId) !== null) {
            throw ValidationException::withMessages([
                'student_id' => ['Close the open package before returning this student to monthly billing. / أغلق الباقة المفتوحة قبل إعادة الطالب إلى الفوترة الشهرية.'],
            ]);
        }

        $sub = DB::table('subscriptions')
            ->where('student_id', $studentId)
            ->where('status', 'ACTIVE')
            ->whereNull('deleted_at')
            ->orderByDesc('start_date')
            ->first();

        if ($sub === null || (string) $sub->price_basis !== self::BASIS) {
            return false;
        }

        DB::table('subscriptions')->where('id', $sub->id)->update([
            'price_basis' => 'PER_HOUR',
            'updated_at' => now(),
        ]);

        Audit::log('subscription.left_packages', 'subscription', (string) $sub->id, $academyId, $actorUserId, $actorRole,
            before: ['price_basis' => self::BASIS],
            after: ['price_basis' => 'PER_HOUR'],
        );

        return true;
    }

    // =========================================================================
    // Consumption — driven by the attendance outcome, via Invoicing
    // =========================================================================

    /**
     * A lesson became billable to a package student → burn its full duration.
     *
     * Returns TRUE when the package engine has taken responsibility for this lesson, FALSE when
     * it has not and the caller must fall back to normal invoicing. The false case is deliberate
     * and important: a package student with no open package still had a lesson delivered, and
     * silently swallowing it would be lost revenue. The lesson bills the ordinary way and the
     * owner gets a NO_ACTIVE_PACKAGE alert telling them to open the next block.
     */
    public function consume(object $session): bool
    {
        $studentId = (string) $session->student_id;

        if (! $this->isPackageStudent($studentId)) {
            return false;
        }

        $package = $this->activeFor($studentId);

        if ($package === null) {
            $this->notify(
                (string) $session->academy_id,
                'NO_ACTIVE_PACKAGE',
                $studentId,
                [
                    'student_id' => $studentId,
                    'student_name' => $this->studentName($studentId),
                    'session_id' => (string) $session->id,
                ],
            );

            return false;
        }

        return $this->creditSession($package, $session);
    }

    /**
     * Burn one lesson out of ONE NAMED package — the single consumption rule set.
     *
     * Split out of {@see consume()} so a hand-made attachment ({@see attachSession()}) and the
     * automatic path can never drift apart: the overdraft arithmetic, the exhaustion close and
     * the low-balance warning live here and nowhere else. Only the GATES differ — automatic
     * consumption first asks whether the student is on package billing at all, while a manual
     * attach is the owner deliberately overriding exactly that question — and what happens to
     * the minutes afterwards is identical either way.
     */
    private function creditSession(object $package, object $session): bool
    {
        $studentId = (string) $session->student_id;

        $minutes = max(1, (int) $session->duration_minutes);
        $available = $this->remainingMinutes($package);

        // The whole lesson lands on THIS package. Whatever part of it exceeds the balance is an
        // overdraw, priced at the package's snapshotted hourly rate — never a second package.
        $overdrawn = max(0, $minutes - $available);
        $overdraftAmount = $this->rateFor($package, $overdrawn);

        $inserted = DB::table('lesson_package_credits')->insertOrIgnore([
            'id' => (string) Str::uuid(),
            'academy_id' => $session->academy_id,
            'package_id' => $package->id,
            'student_id' => $studentId,
            'session_id' => $session->id,
            'minutes' => $minutes,
            'minutes_overdrawn' => $overdrawn,
            'amount_minor' => $overdraftAmount,
            'currency' => $package->currency,
            'description' => $this->creditDescription($session, $minutes, $overdrawn),
            'consumed_at' => now(),
            'created_at' => now(),
        ]);

        if (! $inserted) {
            // Already recorded (concurrency backstop on the unique session_id) — nothing to do.
            return true;
        }

        DB::table('lesson_packages')->where('id', $package->id)->update([
            'minutes_consumed' => DB::raw("minutes_consumed + {$minutes}"),
            'minutes_overdrawn' => DB::raw("minutes_overdrawn + {$overdrawn}"),
            'updated_at' => now(),
        ]);

        Audit::log(
            'lesson_package.consumed',
            'lesson_package',
            (string) $package->id,
            (string) $session->academy_id,
            null,
            'SUPER_ADMIN',
            after: [
                'session_id' => (string) $session->id,
                'minutes' => $minutes,
                'minutes_overdrawn' => $overdrawn,
                'overdraft_minor' => $overdraftAmount,
            ],
        );

        $left = $available - $minutes;

        if ($left <= 0) {
            $this->complete((string) $package->id, 'EXHAUSTED', null, null);
        } elseif ($left <= max(self::DEFAULT_LOW_MINUTES, $minutes)) {
            // "Low" is measured against the lesson the student actually takes: the meaningful
            // moment is when the NEXT lesson of this size will overdraw, not some fixed number.
            $this->notify(
                (string) $session->academy_id,
                'PACKAGE_LOW',
                (string) $package->id,
                [
                    'package_id' => (string) $package->id,
                    'student_id' => $studentId,
                    'student_name' => $this->studentName($studentId),
                    'label' => (string) $package->label,
                    'minutes_left' => $left,
                ],
            );
        }

        return true;
    }

    /**
     * A lesson stopped being billable (an outcome corrected before the money was settled) →
     * hand the minutes back.
     *
     * Refuses once the package has been closed AND its bill is no longer OPEN, mirroring the
     * closed-invoice immutability guard in AttendanceService: you cannot un-consume minutes a
     * parent has already been billed for. The throw rolls back the whole attendance change.
     */
    public function release(object $session): bool
    {
        $credit = DB::table('lesson_package_credits')
            ->where('session_id', $session->id)
            ->first();

        if ($credit === null) {
            return false;
        }

        $package = DB::table('lesson_packages')->where('id', $credit->package_id)->first();

        if ($package !== null && $package->status !== 'ACTIVE' && $this->packageIsSettled($package)) {
            throw ValidationException::withMessages([
                'status' => ["This lesson's package is already closed and billed, so it can no longer be changed. / باقة هذه الحصة مُقفلة وتمّت فوترتها ولا يمكن تعديلها."],
            ]);
        }

        DB::table('lesson_package_credits')->where('id', $credit->id)->delete();

        if ($package !== null) {
            $minutes = (int) $credit->minutes;
            $overdrawn = (int) $credit->minutes_overdrawn;

            DB::table('lesson_packages')->where('id', $package->id)->update([
                'minutes_consumed' => DB::raw("greatest(0, minutes_consumed - {$minutes})"),
                'minutes_overdrawn' => DB::raw("greatest(0, minutes_overdrawn - {$overdrawn})"),
                // Giving minutes back re-opens a package that closed only because it ran out.
                'status' => $package->status === 'COMPLETED' && $package->closed_reason === 'EXHAUSTED'
                    ? 'ACTIVE'
                    : $package->status,
                'closed_at' => $package->closed_reason === 'EXHAUSTED' ? null : $package->closed_at,
                'closed_reason' => $package->closed_reason === 'EXHAUSTED' ? null : $package->closed_reason,
                'updated_at' => now(),
            ]);

            Audit::log(
                'lesson_package.released',
                'lesson_package',
                (string) $package->id,
                (string) $session->academy_id,
                null,
                'SUPER_ADMIN',
                after: ['session_id' => (string) $session->id, 'minutes' => $minutes],
            );
        }

        return true;
    }

    // =========================================================================
    // Manual control — the owner moving lessons on and off a package by hand
    // =========================================================================

    /**
     * Put an already-taught lesson onto THIS package by hand.
     *
     * The automatic path only ever credits the student's *active* package, and only while their
     * subscription says PER_PACKAGE. Both of those are the right default and both are wrong at
     * least once per academy: a lesson taught before the block was sold, a lesson that landed on
     * the wrong sibling, a student moved onto package billing halfway through a month. This is
     * that correction, and it is deliberately an explicit act rather than a rule — the owner is
     * naming the package, so no gate about billing mode applies.
     *
     * The lesson must still be one that HAPPENED (a scheduled lesson has no minutes to give) and
     * must not already be on a package — {@see lesson_package_credits.session_id} is unique, and
     * this refuses loudly rather than letting insertOrIgnore swallow a double-attach. Any invoice
     * line the lesson was carrying is removed first: a lesson is billed by the package or by the
     * invoice, never by both, which is the whole reason the two modes are exclusive.
     *
     * @return array{minutes:int, minutes_overdrawn:int, invoice_id:?string}
     */
    public function attachSession(string $packageId, string $sessionId, ?string $actorUserId, ?string $actorRole): array
    {
        return DB::transaction(function () use ($packageId, $sessionId, $actorUserId, $actorRole): array {
            $package = DB::table('lesson_packages')->where('id', $packageId)->lockForUpdate()->first();

            if ($package === null) {
                throw ValidationException::withMessages([
                    'package_id' => ['Package not found. / الباقة غير موجودة.'],
                ]);
            }

            if ($package->status !== 'ACTIVE') {
                throw ValidationException::withMessages([
                    'package_id' => ['Only an open package can take another lesson. / لا يمكن إضافة حصة إلا إلى باقة مفتوحة.'],
                ]);
            }

            $session = DB::table('sessions')->where('id', $sessionId)->first();

            if ($session === null || (string) $session->academy_id !== (string) $package->academy_id) {
                throw ValidationException::withMessages([
                    'session_id' => ['Lesson not found. / الحصة غير موجودة.'],
                ]);
            }

            if ((string) $session->student_id !== (string) $package->student_id) {
                throw ValidationException::withMessages([
                    'session_id' => ['That lesson belongs to a different student. / هذه الحصة تخص طالبًا آخر.'],
                ]);
            }

            if ((string) $session->status !== 'ATTENDED') {
                throw ValidationException::withMessages([
                    'session_id' => ['Only an attended lesson consumes hours. / لا تُحتسب الساعات إلا لحصة تم حضورها.'],
                ]);
            }

            $existing = DB::table('lesson_package_credits')->where('session_id', $sessionId)->first();

            if ($existing !== null) {
                throw ValidationException::withMessages([
                    'session_id' => ['That lesson is already on a package. / هذه الحصة مُضافة إلى باقة بالفعل.'],
                ]);
            }

            // A lesson is billed by the package OR by the invoice, never by both. Drop the line
            // and recompute the invoice from what is left, rather than subtracting blindly —
            // safe under retries and it preserves a sibling's lines on a shared invoice.
            $line = DB::table('invoice_line_items as li')
                ->join('invoices as i', 'i.id', '=', 'li.invoice_id')
                ->where('li.session_id', $sessionId)
                ->first(['li.id', 'li.invoice_id', 'i.status as invoice_status']);

            $invoiceId = null;

            if ($line !== null) {
                if ((string) $line->invoice_status !== 'OPEN') {
                    throw ValidationException::withMessages([
                        'session_id' => ['That lesson is on an invoice which is no longer open, so it cannot move onto a package. / هذه الحصة على فاتورة لم تعد مفتوحة، لذا لا يمكن نقلها إلى باقة.'],
                    ]);
                }

                $invoiceId = (string) $line->invoice_id;
                DB::table('invoice_line_items')->where('id', $line->id)->delete();
                $this->resettleInvoice($invoiceId);
            }

            $before = (int) $package->minutes_consumed;
            $this->creditSession($package, $session);
            $after = (int) DB::table('lesson_packages')->where('id', $packageId)->value('minutes_consumed');

            Audit::log(
                'lesson_package.lesson_attached',
                'lesson_package',
                $packageId,
                (string) $package->academy_id,
                $actorUserId,
                $actorRole,
                before: ['minutes_consumed' => $before],
                after: [
                    'session_id' => $sessionId,
                    'minutes_consumed' => $after,
                    'invoice_id' => $invoiceId,
                ],
            );

            $credit = DB::table('lesson_package_credits')->where('session_id', $sessionId)->first();

            return [
                'minutes' => (int) ($credit->minutes ?? 0),
                'minutes_overdrawn' => (int) ($credit->minutes_overdrawn ?? 0),
                'invoice_id' => $invoiceId,
            ];
        });
    }

    /**
     * Take a lesson back off this package.
     *
     * Two honest outcomes, and the caller must choose — silently picking either one would be a
     * money decision made behind the owner's back:
     *   - $rebill TRUE  → the lesson still happened, so it goes back onto the student's open
     *     invoice priced the ordinary way. This is the reversible one: {@see syncBackdatedLessons()}
     *     can pull it back in later, because that sweep looks for billed lessons with no credit.
     *   - $rebill FALSE → the lesson leaves the ledger entirely and nobody is charged for it.
     *     This is the "it was never this student's lesson" case (a shared record split between
     *     siblings, a mis-clicked attendance) and it stays out of the sync sweep precisely
     *     because it has no invoice line to be found by.
     *
     * The minutes come back through {@see release()}, which is also what an attendance reversal
     * uses — so a package re-opens if it had closed only because it ran out, and refuses if its
     * bill has already been settled.
     *
     * @return array{minutes_returned:int, rebilled:bool}
     */
    public function detachCredit(string $packageId, string $creditId, bool $rebill, ?string $actorUserId, ?string $actorRole): array
    {
        return DB::transaction(function () use ($packageId, $creditId, $rebill, $actorUserId, $actorRole): array {
            $credit = DB::table('lesson_package_credits')
                ->where('id', $creditId)
                ->where('package_id', $packageId)
                ->first();

            if ($credit === null) {
                throw ValidationException::withMessages([
                    'credit_id' => ['That lesson is not on this package. / هذه الحصة ليست ضمن هذه الباقة.'],
                ]);
            }

            $session = DB::table('sessions')->where('id', $credit->session_id)->first();

            if ($session === null) {
                throw ValidationException::withMessages([
                    'credit_id' => ['Lesson not found. / الحصة غير موجودة.'],
                ]);
            }

            $minutes = (int) $credit->minutes;

            // release() owns the give-back arithmetic and the closed-and-billed guard.
            $this->release($session);

            if ($rebill) {
                // Bill it the ordinary way. The package path is switched OFF for this call or
                // consume() would simply put the lesson straight back where it came from.
                app(Invoicing::class)->onSessionBillable($session, allowPackage: false);
            }

            Audit::log(
                'lesson_package.lesson_detached',
                'lesson_package',
                $packageId,
                (string) $session->academy_id,
                $actorUserId,
                $actorRole,
                before: ['session_id' => (string) $session->id, 'minutes' => $minutes],
                after: ['rebilled' => $rebill],
            );

            return ['minutes_returned' => $minutes, 'rebilled' => $rebill];
        });
    }

    /** Recompute an invoice from the lines it still has. Never subtract a delta blindly. */
    private function resettleInvoice(string $invoiceId): void
    {
        $total = (int) DB::table('invoice_line_items')->where('invoice_id', $invoiceId)->sum('amount_minor');

        DB::table('invoices')->where('id', $invoiceId)->update([
            'subtotal_minor' => $total,
            'total_minor' => $total,
            'updated_at' => now(),
        ]);
    }

    // =========================================================================
    // Lifecycle — open, close, bill
    // =========================================================================

    /**
     * Open a new package for a student.
     *
     * The hourly rate is DERIVED from the agreed total and the size, then SNAPSHOTTED onto the
     * row — the same discipline as invoice_line_items.amount_minor. Changing the student's
     * default rate later never re-prices a package that is already running.
     *
     * Opening a package also PUTS the student on package billing ({@see ensurePackageBilling}),
     * creating their subscription if they have none. That is what lets the packages screen be the
     * only place a package is set up — and it means a package can never sit on a student whom
     * Invoicing still bills monthly.
     *
     * Two things happen here that answer the "he started a new package without paying the old
     * one" case, and neither of them blocks anything:
     *   - an unpaid previous package raises a PACKAGE_UNPAID alert;
     *   - an unbilled overdraft from the previous package rolls onto THIS package's invoice
     *     (the ON_START case, where the previous invoice was already issued and is immutable).
     *
     * @param  array{student_id:string,label:string,minutes_total:int,price_minor:int,currency?:?string,bill_timing?:?string,starts_on?:?string,expires_on?:?string,carry_over?:bool}  $data
     * @return array{package_id:string, invoice_id:?string, carried_over_minutes:int, imported_lessons:int, skipped_locked_lessons:int, switched_to_package_billing:bool}
     */
    public function open(array $data, ?string $actorUserId, ?string $actorRole): array
    {
        $studentId = (string) $data['student_id'];
        $student = DB::table('students')->where('id', $studentId)->first(['id', 'academy_id', 'full_name']);

        if ($student === null) {
            throw ValidationException::withMessages([
                'student_id' => ['Student not found. / الطالب غير موجود.'],
            ]);
        }

        if ($this->activeFor($studentId) !== null) {
            throw ValidationException::withMessages([
                'student_id' => ['This student already has an open package. Close it before opening another. / لدى هذا الطالب باقة مفتوحة بالفعل. أغلقها قبل فتح باقة جديدة.'],
            ]);
        }

        $academyId = (string) $student->academy_id;
        $academy = DB::table('academies')->where('id', $academyId)->first();
        $minutesTotal = (int) $data['minutes_total'];
        $priceMinor = (int) $data['price_minor'];
        $currency = strtoupper((string) ($data['currency'] ?? $this->studentCurrency($studentId, $academy)));
        $billTiming = (string) ($data['bill_timing'] ?? $academy->package_bill_timing ?? 'ON_START');
        $startsOn = (string) ($data['starts_on'] ?? Carbon::now($academy->timezone ?: 'UTC')->toDateString());

        $previous = $this->latestClosedFor($studentId);

        // Carry-over is deliberately an explicit choice, never automatic: unused minutes are the
        // academy's money to forgive or keep, and silently moving them is how disputes start.
        $carried = 0;
        if (($data['carry_over'] ?? false) === true && $previous !== null) {
            $carried = $this->remainingMinutes($previous);
        }

        // Selling a block IS putting this student on the hour clock. Doing it here, before the
        // row is written, is what makes the packages screen the single place a package is set
        // up: the owner never has to go and flip a basis on the student's profile first, and a
        // package can therefore never exist on a student the invoicing engine still bills
        // monthly — which would be the double-bill the two modes exist to prevent.
        $billing = $this->ensurePackageBilling(
            $studentId,
            $academyId,
            $this->deriveHourlyRate($priceMinor, $minutesTotal),
            $currency,
            $startsOn,
            $actorUserId,
            $actorRole,
        );

        $packageId = (string) Str::uuid();
        $sequenceNo = ((int) DB::table('lesson_packages')->where('student_id', $studentId)->max('sequence_no')) + 1;

        DB::table('lesson_packages')->insert([
            'id' => $packageId,
            'academy_id' => $academyId,
            'student_id' => $studentId,
            'label' => (string) $data['label'],
            'minutes_total' => $minutesTotal,
            'minutes_consumed' => 0,
            'carried_over_minutes' => $carried,
            'minutes_overdrawn' => 0,
            'price_minor' => $priceMinor,
            'currency' => $currency,
            'hourly_rate_minor' => $this->deriveHourlyRate($priceMinor, $minutesTotal),
            'bill_timing' => $billTiming,
            'status' => 'ACTIVE',
            'sequence_no' => $sequenceNo,
            'starts_on' => $startsOn,
            'expires_on' => $data['expires_on'] ?? null,
            'opened_by_user_id' => $actorUserId,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        if ($carried > 0 && $previous !== null) {
            DB::table('lesson_packages')->where('id', $previous->id)->update([
                'closed_reason' => 'CARRIED_OVER',
                'updated_at' => now(),
            ]);
        }

        $invoiceId = null;
        if ($billTiming === 'ON_START') {
            $lines = [[
                'description' => $this->packageLineDescription($data['label'], $minutesTotal, $carried),
                'amount_minor' => $priceMinor,
            ]];

            // Roll the previous package's unbilled overdraft onto this bill. Its own invoice was
            // raised (and possibly paid) up front and is immutable — the debt has to travel.
            $overdraft = $this->pendingOverdraft($studentId, $currency);
            if ($overdraft !== null) {
                $lines[] = [
                    'description' => $overdraft['description'],
                    'amount_minor' => $overdraft['amount_minor'],
                ];
            }

            $invoiceId = $this->raiseInvoice($academyId, $studentId, $currency, $lines, $startsOn, $actorUserId, $actorRole);

            if ($overdraft !== null) {
                DB::table('lesson_packages')->where('id', $overdraft['package_id'])->update([
                    'overdraft_invoice_id' => $invoiceId,
                    'updated_at' => now(),
                ]);
            }

            DB::table('lesson_packages')->where('id', $packageId)->update([
                'invoice_id' => $invoiceId,
                'updated_at' => now(),
            ]);
        }

        $this->flagUnpaidPredecessors($academyId, $studentId, $packageId);

        Audit::log(
            'lesson_package.opened',
            'lesson_package',
            $packageId,
            $academyId,
            $actorUserId,
            $actorRole,
            after: [
                'student_id' => $studentId,
                'minutes_total' => $minutesTotal,
                'carried_over_minutes' => $carried,
                'price_minor' => $priceMinor,
                'currency' => $currency,
                'bill_timing' => $billTiming,
                'invoice_id' => $invoiceId,
            ],
        );

        // A package may deliberately start before the day it is entered. Move lessons already
        // billed on still-open monthly invoices onto this package immediately, so a package that
        // starts on 24 Aug and is entered on 6 Sep does not misleadingly begin at zero. Settled
        // invoices are immutable and are reported back instead of being touched.
        $sync = $this->syncBackdatedLessons($packageId, $actorUserId, $actorRole);
        $invoiceId = DB::table('lesson_packages')->where('id', $packageId)->value('invoice_id');

        return [
            'package_id' => $packageId,
            'invoice_id' => $invoiceId !== null ? (string) $invoiceId : null,
            'carried_over_minutes' => $carried,
            'imported_lessons' => $sync['imported'],
            'skipped_locked_lessons' => $sync['skipped_locked'],
            // Reported back so the form can say what else it just did. A billing mode changing
            // underneath someone is only acceptable when they are told it changed.
            'switched_to_package_billing' => $billing['switched'],
        ];
    }

    /**
     * Move already-billed lessons between this package's start and now from OPEN monthly bills
     * into the package ledger. This is both the creation-time backfill and the repair action for
     * packages created before that behavior existed.
     *
     * A settled invoice is never modified. A lesson without an invoice line is also left alone:
     * `sessions.billed` is only an idempotency flag, while the line/credit ledger is the financial
     * evidence needed to move it safely.
     *
     * @return array{imported:int, skipped_locked:int}
     */
    public function syncBackdatedLessons(string $packageId, ?string $actorUserId, ?string $actorRole): array
    {
        $package = DB::table('lesson_packages')->where('id', $packageId)->first();

        if ($package === null) {
            throw ValidationException::withMessages([
                'package_id' => ['Package not found. / الباقة غير موجودة.'],
            ]);
        }

        if ($package->status !== 'ACTIVE') {
            return ['imported' => 0, 'skipped_locked' => 0];
        }

        if (! $this->isPackageStudent((string) $package->student_id)) {
            throw ValidationException::withMessages([
                'student_id' => ['The student is no longer on package billing. / لم يعد نظام فوترة الطالب بنظام الباقات.'],
            ]);
        }

        $timezone = (string) (DB::table('academies')->where('id', $package->academy_id)->value('timezone') ?: 'UTC');
        // Query Builder serializes Carbon values without their offset. PostgreSQL then interprets
        // that wall-clock string in the connection timezone, which made a just-finished Cairo
        // lesson appear two hours *after* "now" and excluded it from the backfill. Keep an
        // explicit offset at the SQL boundary so the selected start date really owns every
        // billable lesson from its local midnight through the current instant.
        $from = Carbon::parse((string) $package->starts_on, $timezone)
            ->startOfDay()
            ->utc()
            ->toIso8601String();
        $through = Carbon::now()->utc()->toIso8601String();

        $sessions = DB::table('sessions as sess')
            ->join('invoice_line_items as li', 'li.session_id', '=', 'sess.id')
            ->join('invoices as i', 'i.id', '=', 'li.invoice_id')
            ->leftJoin('lesson_package_credits as credit', 'credit.session_id', '=', 'sess.id')
            ->leftJoin('session_reports as report', 'report.session_id', '=', 'sess.id')
            ->where('sess.student_id', $package->student_id)
            ->where('sess.billed', true)
            ->whereBetween('sess.scheduled_at_utc', [$from, $through])
            ->whereNull('credit.id')
            // A free trial intentionally carries a zero invoice line for visibility but must not
            // burn paid package minutes.
            ->whereRaw("coalesce((report.values->>'is_free_trial')::boolean, false) = false")
            ->orderBy('sess.scheduled_at_utc')
            ->select('sess.*', 'li.id as line_id', 'li.invoice_id', 'i.status as invoice_status')
            ->get();

        $imported = 0;
        $skippedLocked = 0;

        foreach ($sessions as $session) {
            // Once an imported lesson exhausts the package, later lessons remain on their
            // original invoices; this mirrors real-time consumption after a package runs out.
            if ((string) (DB::table('lesson_packages')->where('id', $packageId)->value('status') ?? '') !== 'ACTIVE') {
                break;
            }

            if ($session->invoice_status !== 'OPEN') {
                $skippedLocked++;

                continue;
            }

            $invoiceId = (string) $session->invoice_id;
            DB::table('invoice_line_items')->where('id', $session->line_id)->delete();

            // Recalculate from the remaining ledger rather than subtracting blindly. It is safe
            // under retries and preserves unrelated children on a guardian's shared invoice.
            $newTotal = (int) DB::table('invoice_line_items')
                ->where('invoice_id', $invoiceId)
                ->sum('amount_minor');
            DB::table('invoices')->where('id', $invoiceId)->update([
                'subtotal_minor' => $newTotal,
                'total_minor' => $newTotal,
                'updated_at' => now(),
            ]);

            $before = DB::table('lesson_package_credits')->where('session_id', $session->id)->exists();
            $this->consume($session);
            $after = DB::table('lesson_package_credits')->where('session_id', $session->id)->exists();
            if (! $before && $after) {
                $imported++;
            }
        }

        if ($imported > 0 || $skippedLocked > 0) {
            Audit::log(
                'lesson_package.lessons_synced',
                'lesson_package',
                $packageId,
                (string) $package->academy_id,
                $actorUserId,
                $actorRole,
                after: ['imported' => $imported, 'skipped_locked' => $skippedLocked, 'from' => (string) $package->starts_on],
            );
        }

        return ['imported' => $imported, 'skipped_locked' => $skippedLocked];
    }

    /**
     * Correct a package that was entered wrong.
     *
     * Four facts only — the label, the hours sold, the price and the expiry — and only while the
     * package is still ACTIVE. Everything else about a package is a record of things that already
     * happened (which lessons burnt it, what was paid), and an edit form is the wrong instrument
     * for history: a package that should end is CLOSED, one that should never have existed is
     * CANCELLED. An ACTIVE package also always has `minutes_overdrawn = 0` — the engine completes
     * a package the moment it overdraws — so an edit can never have to unpick an overdraft.
     *
     * The hourly rate stays DERIVED, never typed, recomputed from whichever of price/hours moved.
     * An edited package and a freshly opened one with the same terms are then indistinguishable.
     *
     * The bill is the hard edge. An ON_START package raised its invoice the moment it opened; if
     * money has moved against that invoice, or it has left OPEN, the price is settled and this
     * refuses rather than let the package and the bill quietly disagree. While the invoice is
     * still OPEN and untouched, its package line moves with the package.
     *
     * @param  array{label?:string, minutes_total?:int, price_minor?:int, expires_on?:?string}  $changes
     * @return array{changed: list<string>, invoice_id: ?string}
     */
    public function edit(string $packageId, array $changes, ?string $actorUserId, ?string $actorRole): array
    {
        $package = DB::table('lesson_packages')->where('id', $packageId)->first();

        if ($package === null) {
            throw ValidationException::withMessages([
                'package_id' => ['Package not found. / الباقة غير موجودة.'],
            ]);
        }

        if ((string) $package->status !== 'ACTIVE') {
            throw ValidationException::withMessages([
                'package_id' => ['Only an open package can be edited. / لا يمكن تعديل سوى باقة مفتوحة.'],
            ]);
        }

        $label = array_key_exists('label', $changes)
            ? (string) $changes['label']
            : (string) $package->label;
        $minutes = array_key_exists('minutes_total', $changes)
            ? (int) $changes['minutes_total']
            : (int) $package->minutes_total;
        $price = array_key_exists('price_minor', $changes)
            ? (int) $changes['price_minor']
            : (int) $package->price_minor;
        $expires = array_key_exists('expires_on', $changes)
            ? $changes['expires_on']
            : $package->expires_on;

        $carried = (int) $package->carried_over_minutes;
        $consumed = (int) $package->minutes_consumed;

        // Shrinking a package to exactly (or below) what has been taught leaves it ACTIVE with no
        // balance — a state the engine itself never produces, since a lesson that empties a
        // package closes it. Closing bills the used hours pro-rata, which is what is actually
        // wanted here, so point at that rather than manufacturing the dead state.
        if ($minutes + $carried <= $consumed) {
            throw ValidationException::withMessages([
                'hours' => [
                    'This package has already used '.$this->humanHours($consumed).'. Close it instead of shrinking it to what was taught.'
                    .' / استُهلك من هذه الباقة '.$this->humanHours($consumed).' بالفعل. أغلقها بدلاً من تقليصها إلى ما تم تدريسه.',
                ],
            ]);
        }

        $before = [];
        $after = [];
        foreach ([
            'label' => $label,
            'minutes_total' => $minutes,
            'price_minor' => $price,
            'expires_on' => $expires,
        ] as $col => $value) {
            if ((string) $value !== (string) $package->{$col}) {
                $before[$col] = $package->{$col};
                $after[$col] = $value;
            }
        }

        if ($after === []) {
            return ['changed' => [], 'invoice_id' => $package->invoice_id !== null ? (string) $package->invoice_id : null];
        }

        // The rate is a function of the other two, so it follows them rather than being asked for.
        if (array_key_exists('minutes_total', $after) || array_key_exists('price_minor', $after)) {
            $after['hourly_rate_minor'] = $this->deriveHourlyRate($price, $minutes);
            $before['hourly_rate_minor'] = (int) $package->hourly_rate_minor;
        }

        $invoiceId = $package->invoice_id !== null ? (string) $package->invoice_id : null;
        // The invoice line spells out the label, the hours AND the price, so any of the three
        // moving makes the bill stale.
        $billStale = $invoiceId !== null && (
            array_key_exists('label', $after)
            || array_key_exists('minutes_total', $after)
            || array_key_exists('price_minor', $after)
        );

        DB::transaction(function () use ($packageId, $package, $after, $before, $invoiceId, $billStale, $label, $minutes, $carried, $price, $actorUserId, $actorRole): void {
            if ($billStale) {
                $this->rewritePackageInvoiceLine(
                    (string) $invoiceId,
                    $package,
                    $label,
                    $minutes,
                    $carried,
                    $price,
                    $actorUserId,
                    $actorRole,
                );
            }

            DB::table('lesson_packages')->where('id', $packageId)->update($after + ['updated_at' => now()]);

            Audit::log(
                'lesson_package.edited',
                'lesson_package',
                $packageId,
                (string) $package->academy_id,
                $actorUserId,
                $actorRole,
                after: $after,
                before: $before,
            );
        });

        return ['changed' => array_keys($after), 'invoice_id' => $invoiceId];
    }

    /**
     * Move a package's own invoice line to match the edited package, and recompute the invoice
     * total from its lines.
     *
     * The line is found by the exact description open() wrote for it, which is the only handle
     * that exists — `invoice_line_items` carries no package id. That is a feature here: if the
     * invoice has been reworked by hand the match fails and this refuses, rather than guessing at
     * which line is the package's and silently rewriting the wrong one.
     */
    private function rewritePackageInvoiceLine(
        string $invoiceId,
        object $package,
        string $label,
        int $minutes,
        int $carried,
        int $price,
        ?string $actorUserId,
        ?string $actorRole,
    ): void {
        $invoice = DB::table('invoices')->where('id', $invoiceId)->first();

        if ($invoice === null) {
            return;
        }

        if ((string) $invoice->status !== 'OPEN' || (int) $invoice->amount_paid_minor > 0) {
            throw ValidationException::withMessages([
                'price_minor' => [
                    'This package has already been billed and settled. Correct the invoice itself.'
                    .' / تم إصدار فاتورة هذه الباقة وتسويتها. عدّل الفاتورة نفسها.',
                ],
            ]);
        }

        $line = DB::table('invoice_line_items')
            ->where('invoice_id', $invoiceId)
            ->whereNull('session_id')
            ->where('description', $this->packageLineDescription(
                (string) $package->label,
                (int) $package->minutes_total,
                $carried,
            ))
            ->first();

        if ($line === null) {
            throw ValidationException::withMessages([
                'price_minor' => [
                    "This package's invoice line has been changed by hand. Edit the invoice directly."
                    .' / تم تعديل بند هذه الباقة في الفاتورة يدويًا. عدّل الفاتورة مباشرة.',
                ],
            ]);
        }

        DB::table('invoice_line_items')->where('id', $line->id)->update([
            'description' => $this->packageLineDescription($label, $minutes, $carried),
            'amount_minor' => $price,
        ]);

        // Recomputed from the lines, never adjusted by a delta — a total that is derived cannot
        // drift away from what the invoice actually says.
        $total = (int) DB::table('invoice_line_items')->where('invoice_id', $invoiceId)->sum('amount_minor');

        DB::table('invoices')->where('id', $invoiceId)->update([
            'subtotal_minor' => $total,
            'total_minor' => $total,
            'updated_at' => now(),
        ]);

        Audit::log(
            'invoice.updated',
            'invoice',
            $invoiceId,
            (string) $package->academy_id,
            $actorUserId,
            $actorRole,
            after: ['total_minor' => $total, 'mode' => 'PACKAGE_EDITED'],
            before: ['total_minor' => (int) $invoice->total_minor],
        );
    }

    /**
     * Close a package: exhausted by its last lesson, or closed early by the owner.
     *
     * ON_COMPLETION packages are billed HERE, from what was actually consumed — a package closed
     * early bills pro-rata at the snapshotted rate rather than the full agreed block, which is
     * the only fair reading of "pay at the end". A package that ran its full course bills exactly
     * the agreed price, so full consumption never drifts by a rounding unit.
     *
     * @return array{package_id:string, invoice_id:?string}
     */
    public function complete(string $packageId, string $reason, ?string $actorUserId, ?string $actorRole): array
    {
        $package = DB::table('lesson_packages')->where('id', $packageId)->first();

        if ($package === null) {
            throw ValidationException::withMessages([
                'package_id' => ['Package not found. / الباقة غير موجودة.'],
            ]);
        }

        if ($package->status !== 'ACTIVE') {
            return ['package_id' => $packageId, 'invoice_id' => $package->invoice_id !== null ? (string) $package->invoice_id : null];
        }

        $invoiceId = $package->invoice_id !== null ? (string) $package->invoice_id : null;

        if ($package->bill_timing === 'ON_COMPLETION') {
            $lines = [];
            $sold = (int) $package->minutes_total + (int) $package->carried_over_minutes;
            $insideMinutes = min((int) $package->minutes_consumed, $sold);
            $overdrawn = (int) $package->minutes_overdrawn;

            // Full block → the agreed price verbatim. Partial → pro-rata at the snapshot rate.
            $base = $insideMinutes >= $sold
                ? (int) $package->price_minor
                : $this->rateFor($package, $insideMinutes);

            if ($base > 0 || $insideMinutes > 0) {
                $lines[] = [
                    'description' => $this->packageLineDescription($package->label, (int) $package->minutes_total, (int) $package->carried_over_minutes)
                        .' — '.$this->humanHours($insideMinutes).' used',
                    'amount_minor' => $base,
                ];
            }

            if ($overdrawn > 0) {
                $lines[] = [
                    'description' => 'Extra '.$this->humanHours($overdrawn).' beyond the package',
                    'amount_minor' => $this->rateFor($package, $overdrawn),
                ];
            }

            if ($lines !== []) {
                $invoiceId = $this->raiseInvoice(
                    (string) $package->academy_id,
                    (string) $package->student_id,
                    (string) $package->currency,
                    $lines,
                    (string) $package->starts_on,
                    $actorUserId,
                    $actorRole,
                );
            }
        }

        DB::table('lesson_packages')->where('id', $packageId)->update([
            'status' => 'COMPLETED',
            'closed_at' => now(),
            'closed_reason' => $reason,
            'invoice_id' => $invoiceId,
            // ON_COMPLETION settles the overdraft on the same bill; ON_START leaves it pending
            // so it can travel to the next package (or be billed on its own from the UI).
            'overdraft_invoice_id' => $package->bill_timing === 'ON_COMPLETION'
                ? $invoiceId
                : $package->overdraft_invoice_id,
            'updated_at' => now(),
        ]);

        $this->notify(
            (string) $package->academy_id,
            'PACKAGE_COMPLETED',
            $packageId,
            [
                'package_id' => $packageId,
                'student_id' => (string) $package->student_id,
                'student_name' => $this->studentName((string) $package->student_id),
                'label' => (string) $package->label,
                'reason' => $reason,
                'minutes_consumed' => (int) $package->minutes_consumed,
                'minutes_overdrawn' => (int) $package->minutes_overdrawn,
                'invoice_id' => $invoiceId,
                'currency' => (string) $package->currency,
            ],
        );

        Audit::log(
            'lesson_package.completed',
            'lesson_package',
            $packageId,
            (string) $package->academy_id,
            $actorUserId,
            $actorRole,
            after: ['reason' => $reason, 'invoice_id' => $invoiceId],
            before: ['status' => (string) $package->status],
        );

        return ['package_id' => $packageId, 'invoice_id' => $invoiceId];
    }

    /**
     * Void a package that was opened by mistake. Only possible while nothing has been consumed —
     * once a lesson has burnt minutes the package has to be CLOSED (and billed for what was
     * used), never made to disappear underneath a delivered lesson.
     */
    public function cancel(string $packageId, ?string $note, ?string $actorUserId, ?string $actorRole): void
    {
        $package = DB::table('lesson_packages')->where('id', $packageId)->first();

        if ($package === null) {
            throw ValidationException::withMessages([
                'package_id' => ['Package not found. / الباقة غير موجودة.'],
            ]);
        }

        if ((int) $package->minutes_consumed > 0) {
            throw ValidationException::withMessages([
                'package_id' => ['This package has already been used. Close it instead so the used hours are billed. / تم استخدام هذه الباقة بالفعل. أغلقها بدلًا من ذلك ليتم احتساب الساعات المستهلكة.'],
            ]);
        }

        DB::table('lesson_packages')->where('id', $packageId)->update([
            'status' => 'CANCELLED',
            'closed_at' => now(),
            'closed_reason' => $note ?? 'CANCELLED',
            'updated_at' => now(),
        ]);

        Audit::log(
            'lesson_package.cancelled',
            'lesson_package',
            $packageId,
            (string) $package->academy_id,
            $actorUserId,
            $actorRole,
            after: ['note' => $note],
            before: ['status' => (string) $package->status],
        );
    }

    /**
     * Bill a completed ON_START package's leftover overdraft on its own invoice — the escape
     * hatch for when no next package is ever opened, so the debt would otherwise sit pending
     * forever. Idempotent: a package whose overdraft is already on an invoice is left alone.
     */
    public function billOverdraft(string $packageId, ?string $actorUserId, ?string $actorRole): ?string
    {
        $package = DB::table('lesson_packages')->where('id', $packageId)->first();

        if ($package === null || (int) $package->minutes_overdrawn <= 0 || $package->overdraft_invoice_id !== null) {
            return null;
        }

        $amount = $this->rateFor($package, (int) $package->minutes_overdrawn);

        $invoiceId = $this->raiseInvoice(
            (string) $package->academy_id,
            (string) $package->student_id,
            (string) $package->currency,
            [[
                'description' => 'Extra '.$this->humanHours((int) $package->minutes_overdrawn).' beyond package "'.$package->label.'"',
                'amount_minor' => $amount,
            ]],
            (string) ($package->closed_at ?? $package->starts_on),
            $actorUserId,
            $actorRole,
        );

        DB::table('lesson_packages')->where('id', $packageId)->update([
            'overdraft_invoice_id' => $invoiceId,
            'updated_at' => now(),
        ]);

        Audit::log(
            'lesson_package.overdraft_billed',
            'lesson_package',
            $packageId,
            (string) $package->academy_id,
            $actorUserId,
            $actorRole,
            after: ['invoice_id' => $invoiceId, 'amount_minor' => $amount],
        );

        return $invoiceId;
    }

    // =========================================================================
    // Private helpers
    // =========================================================================

    /** price for N minutes at the package's snapshotted hourly rate. */
    private function rateFor(object $package, int $minutes): int
    {
        if ($minutes <= 0) {
            return 0;
        }

        return (int) round((int) $package->hourly_rate_minor * $minutes / 60);
    }

    /** The agreed total spread over the block, expressed per hour. */
    private function deriveHourlyRate(int $priceMinor, int $minutesTotal): int
    {
        return $minutesTotal > 0 ? (int) round($priceMinor * 60 / $minutesTotal) : $priceMinor;
    }

    private function activeSubscriptionBasis(string $studentId): ?string
    {
        $basis = DB::table('subscriptions')
            ->where('student_id', $studentId)
            ->where('status', 'ACTIVE')
            ->whereNull('deleted_at')
            ->orderByDesc('start_date')
            ->value('price_basis');

        return $basis !== null ? (string) $basis : null;
    }

    private function studentCurrency(string $studentId, ?object $academy): string
    {
        $currency = DB::table('subscriptions')
            ->where('student_id', $studentId)
            ->where('status', 'ACTIVE')
            ->whereNull('deleted_at')
            ->orderByDesc('start_date')
            ->value('currency');

        return (string) ($currency ?? $academy?->default_currency ?? 'EGP');
    }

    private function studentName(string $studentId): string
    {
        return (string) (DB::table('students')->where('id', $studentId)->value('full_name') ?? '');
    }

    /** The student's most recently closed package (the one a carry-over would come from). */
    private function latestClosedFor(string $studentId): ?object
    {
        return DB::table('lesson_packages')
            ->where('student_id', $studentId)
            ->where('status', 'COMPLETED')
            ->orderByDesc('sequence_no')
            ->first();
    }

    /** Whether a package's bill has moved past OPEN (and so can no longer be edited). */
    private function packageIsSettled(object $package): bool
    {
        if ($package->invoice_id === null) {
            return false;
        }

        $status = DB::table('invoices')->where('id', $package->invoice_id)->value('status');

        return $status !== null && $status !== 'OPEN';
    }

    /**
     * A previous package's overdraft that has been recorded but never put on a bill, in the same
     * currency as the package about to be opened. Cross-currency debt is deliberately left alone
     * rather than converted (§3.6: no FX inside invoicing).
     *
     * @return array{package_id:string, description:string, amount_minor:int}|null
     */
    private function pendingOverdraft(string $studentId, string $currency): ?array
    {
        $package = DB::table('lesson_packages')
            ->where('student_id', $studentId)
            ->where('status', 'COMPLETED')
            ->where('bill_timing', 'ON_START')
            ->where('minutes_overdrawn', '>', 0)
            ->whereNull('overdraft_invoice_id')
            ->where('currency', $currency)
            ->orderByDesc('sequence_no')
            ->first();

        if ($package === null) {
            return null;
        }

        return [
            'package_id' => (string) $package->id,
            'description' => 'Extra '.$this->humanHours((int) $package->minutes_overdrawn).' beyond package "'.$package->label.'"',
            'amount_minor' => $this->rateFor($package, (int) $package->minutes_overdrawn),
        ];
    }

    /**
     * Raise the alert when a student starts a new block while an earlier one is still unpaid.
     * Visibility, not enforcement: the lessons keep running, the owner gets told.
     */
    private function flagUnpaidPredecessors(string $academyId, string $studentId, string $newPackageId): void
    {
        $unpaid = DB::table('lesson_packages as p')
            ->join('invoices as i', 'i.id', '=', 'p.invoice_id')
            ->where('p.student_id', $studentId)
            ->where('p.id', '!=', $newPackageId)
            ->whereIn('i.status', ['OPEN', 'CLOSED', 'PARTIALLY_PAID'])
            ->select(['p.id', 'p.label', 'p.sequence_no', 'i.total_minor', 'i.amount_paid_minor', 'i.currency'])
            ->get();

        if ($unpaid->isEmpty()) {
            return;
        }

        $outstanding = $unpaid->sum(fn ($row) => (int) $row->total_minor - (int) $row->amount_paid_minor);

        if ($outstanding <= 0) {
            return;
        }

        $this->notify($academyId, 'PACKAGE_UNPAID', $newPackageId, [
            'package_id' => $newPackageId,
            'student_id' => $studentId,
            'student_name' => $this->studentName($studentId),
            'unpaid_packages' => $unpaid->map(fn ($row) => [
                'id' => (string) $row->id,
                'label' => (string) $row->label,
                'sequence_no' => (int) $row->sequence_no,
            ])->values()->all(),
            'outstanding_minor' => (int) $outstanding,
            'currency' => (string) $unpaid->first()->currency,
        ]);
    }

    /**
     * Create the MANUAL, per-student invoice a package bills onto.
     *
     * Always PER_STUDENT even in a PER_GUARDIAN academy: a package belongs to one child, so
     * folding it into a shared guardian invoice would make "which of my kids used their hours"
     * unanswerable. Lines carry no session_id — manual invoices allow that since Sprint 9 — the
     * per-lesson breakdown lives on the package page, where it belongs.
     *
     * @param  list<array{description:string, amount_minor:int}>  $lines
     */
    private function raiseInvoice(
        string $academyId,
        string $studentId,
        string $currency,
        array $lines,
        string $periodDate,
        ?string $actorUserId,
        ?string $actorRole,
    ): string {
        $invoiceId = (string) Str::uuid();
        $period = Carbon::parse($periodDate);
        $total = array_sum(array_map(static fn (array $l): int => (int) $l['amount_minor'], $lines));

        DB::table('invoices')->insert([
            'id' => $invoiceId,
            'academy_id' => $academyId,
            'kind' => 'MANUAL',
            'guardian_id' => null,
            'student_id' => $studentId,
            'period_year' => (int) $period->year,
            'period_month' => (int) $period->month,
            'status' => 'OPEN',
            'currency' => $currency,
            'subtotal_minor' => $total,
            'total_minor' => $total,
            'public_token' => PublicInvoiceToken::forAcademyId($academyId),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        foreach ($lines as $line) {
            DB::table('invoice_line_items')->insert([
                'id' => (string) Str::uuid(),
                'academy_id' => $academyId,
                'invoice_id' => $invoiceId,
                'session_id' => null,
                'student_id' => $studentId,
                'description' => (string) $line['description'],
                'amount_minor' => (int) $line['amount_minor'],
                'currency' => $currency,
                'session_date' => $period->toDateString(),
                'created_at' => now(),
            ]);
        }

        Audit::log(
            'invoice.created',
            'invoice',
            $invoiceId,
            $academyId,
            $actorUserId,
            $actorRole,
            after: ['kind' => 'MANUAL', 'mode' => 'PACKAGE', 'total_minor' => $total, 'currency' => $currency],
        );

        return $invoiceId;
    }

    /**
     * Write an owner alert, deduped on (subject_id, type) by the partial unique index — the same
     * one-alert-per-subject guarantee the overdue-report job gets per session.
     *
     * @param  array<string,mixed>  $data
     */
    private function notify(string $academyId, string $type, string $subjectId, array $data): void
    {
        DB::table('notifications')->insertOrIgnore([
            'id' => (string) Str::uuid(),
            'academy_id' => $academyId,
            'type' => $type,
            'category' => 'PACKAGES',
            'audience_role' => 'ACADEMY_OWNER',
            'recipient_user_id' => null,
            'session_id' => null,
            'subject_id' => $subjectId,
            'data' => json_encode($data),
            'created_at' => now(),
        ]);
    }

    private function creditDescription(object $session, int $minutes, int $overdrawn): string
    {
        $date = Carbon::parse($session->scheduled_at_utc)->toDateString();
        $label = $this->humanHours($minutes).' — '.$date;

        return $overdrawn > 0
            ? $label.' ('.$this->humanHours($overdrawn).' beyond the package)'
            : $label;
    }

    private function packageLineDescription(string $label, int $minutesTotal, int $carried): string
    {
        $text = 'Package: '.$label.' — '.$this->humanHours($minutesTotal);

        return $carried > 0 ? $text.' (+'.$this->humanHours($carried).' carried over)' : $text;
    }

    /** Minutes → "2h 30m" / "45m". Display only; the stored quantity is always minutes. */
    public function humanHours(int $minutes): string
    {
        $h = intdiv($minutes, 60);
        $m = $minutes % 60;

        if ($h === 0) {
            return $m.'m';
        }

        return $m === 0 ? $h.'h' : $h.'h '.$m.'m';
    }
}
