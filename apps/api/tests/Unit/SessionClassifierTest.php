<?php

declare(strict_types=1);

use App\Domain\SessionClassifier;
use App\Enums\SessionStatus;

/**
 * The §4 matrix, asserted row-by-row (TC-6.1–6.6). This pure function is the single source of
 * billing/payout truth (decision §3.1); these unit tests are the contract Sprints 7 & 8 inherit.
 */

it('classifies ATTENDED as billable to student and counting for teacher', function (): void {
    // TC-6.1 — §4 row ATTENDED
    expect(SessionClassifier::classify(SessionStatus::Attended))
        ->toBe(['billableToStudent' => true, 'countsForTeacher' => true]);
});

it('classifies ABSENT_UNEXCUSED as billable but not counting for teacher', function (): void {
    // TC-6.2 — §4 row ABSENT_UNEXCUSED (charged, no-show without notice)
    expect(SessionClassifier::classify(SessionStatus::AbsentUnexcused))
        ->toBe(['billableToStudent' => true, 'countsForTeacher' => false]);
});

it('classifies ABSENT_EXCUSED as neither billable nor counting', function (): void {
    // TC-6.3 — §4 row ABSENT_EXCUSED (absent with prior notice)
    expect(SessionClassifier::classify(SessionStatus::AbsentExcused))
        ->toBe(['billableToStudent' => false, 'countsForTeacher' => false]);
});

it('classifies CANCELLED_BY_TEACHER as neither billable nor counting', function (): void {
    // TC-6.4 — §4 row CANCELLED_BY_TEACHER
    expect(SessionClassifier::classify(SessionStatus::CancelledByTeacher))
        ->toBe(['billableToStudent' => false, 'countsForTeacher' => false]);
});

it('classifies CANCELLED_BY_STUDENT as neither billable nor counting', function (): void {
    // TC-6.5 — §4 row CANCELLED_BY_STUDENT (cancelled with notice)
    expect(SessionClassifier::classify(SessionStatus::CancelledByStudent))
        ->toBe(['billableToStudent' => false, 'countsForTeacher' => false]);
});

it('treats not-yet-outcome statuses as non-billable, non-counting', function (): void {
    // §4 — SCHEDULED | RESCHEDULED carry no billing outcome
    expect(SessionClassifier::classify(SessionStatus::Scheduled))
        ->toBe(['billableToStudent' => false, 'countsForTeacher' => false])
        ->and(SessionClassifier::classify(SessionStatus::Rescheduled))
        ->toBe(['billableToStudent' => false, 'countsForTeacher' => false]);
});

it('defines the matrix exhaustively for every enum value with no override path', function (): void {
    // TC-6.6 — feed ALL enum values; classify() must return a well-formed verdict for each and
    // be the ONLY definition. The match() is total: a new status would force a compile-time-style
    // UnhandledMatchError here, proving no value silently slips past the single matrix.
    $billableStatuses = [SessionStatus::Attended, SessionStatus::AbsentUnexcused];

    foreach (SessionStatus::cases() as $status) {
        $verdict = SessionClassifier::classify($status);

        expect($verdict)->toHaveKeys(['billableToStudent', 'countsForTeacher'])
            ->and($verdict['billableToStudent'])->toBeBool()
            ->and($verdict['countsForTeacher'])->toBeBool();

        // billableToStudent is true for EXACTLY the two charged outcomes, nowhere else.
        expect($verdict['billableToStudent'])->toBe(in_array($status, $billableStatuses, true));

        // countsForTeacher is true for EXACTLY ATTENDED.
        expect($verdict['countsForTeacher'])->toBe($status === SessionStatus::Attended);

        // A session never pays the teacher without also billing the student (no row in §4 does).
        if ($verdict['countsForTeacher']) {
            expect($verdict['billableToStudent'])->toBeTrue();
        }
    }
});

it('classifies from a raw status string identically to the enum', function (): void {
    // The string overload (used by Sprints 7/8 reading sessions.status) must agree with classify().
    foreach (SessionStatus::cases() as $status) {
        expect(SessionClassifier::classifyValue($status->value))
            ->toBe(SessionClassifier::classify($status));
    }
});
