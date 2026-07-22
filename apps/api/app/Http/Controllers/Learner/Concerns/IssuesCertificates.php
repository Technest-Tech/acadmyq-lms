<?php

declare(strict_types=1);

namespace App\Http\Controllers\Learner\Concerns;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Course-completion certificates (docs/lms/04 §certificates). A certificate is issued once the learner
 * has completed EVERY lesson of a course — and a QUIZ lesson only reaches COMPLETED once passed, so
 * "all lessons complete" already implies "all quizzes passed". Issuance is idempotent (unique
 * learner+course) and just records that it happened with a printable, verifiable `serial`.
 *
 * Called from wherever a lesson flips to COMPLETED — the enrolled player (video/text/pdf) and the quiz
 * submit (on pass) — so the final lesson, whatever its type, triggers the certificate.
 */
trait IssuesCertificates
{
    /** Issue the course certificate if every lesson is COMPLETED. Returns the row (new or existing), or null. */
    protected function maybeIssueCertificate(string $academyId, string $learnerId, string $courseId): ?object
    {
        $total = DB::table('lessons')->where('course_id', $courseId)->count();
        if ($total === 0) {
            return null;
        }

        $completed = DB::table('lesson_progress')
            ->where('learner_id', $learnerId)
            ->where('course_id', $courseId)
            ->where('status', 'COMPLETED')
            ->count();
        if ($completed < $total) {
            return null;
        }

        $existing = DB::table('course_certificates')
            ->where('learner_id', $learnerId)
            ->where('course_id', $courseId)
            ->first();
        if ($existing !== null) {
            return $existing;
        }

        DB::table('course_certificates')->insertOrIgnore([
            'id' => (string) Str::uuid(),
            'academy_id' => $academyId,
            'learner_id' => $learnerId,
            'course_id' => $courseId,
            'serial' => $this->makeSerial(),
        ]);

        return DB::table('course_certificates')
            ->where('learner_id', $learnerId)
            ->where('course_id', $courseId)
            ->first();
    }

    /** A readable, unambiguous verification code, e.g. C-7KLM-3QPR-9TVX (no 0/O/1/I). */
    private function makeSerial(): string
    {
        $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        $chunks = [];
        for ($c = 0; $c < 3; $c++) {
            $chunk = '';
            for ($i = 0; $i < 4; $i++) {
                $chunk .= $alphabet[random_int(0, strlen($alphabet) - 1)];
            }
            $chunks[] = $chunk;
        }

        return 'C-'.implode('-', $chunks);
    }
}
