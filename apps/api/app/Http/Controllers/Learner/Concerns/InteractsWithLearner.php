<?php

declare(strict_types=1);

namespace App\Http\Controllers\Learner\Concerns;

use App\Models\Learner;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Shared helpers for the LMS public-site (learner) controllers. The academy is already in tenant
 * context (ResolveAcademyContext, from the subdomain) and the authenticated learner — on protected
 * routes — is stashed on the request (EnsureLearner). RLS scopes every query to the academy.
 */
trait InteractsWithLearner
{
    /** The academy this public request is scoped to (resolved from the subdomain). */
    protected function currentAcademyId(): string
    {
        $id = (string) request()->attributes->get('lms_academy_id', '');
        if ($id === '') {
            abort(404, 'Unknown course site.');
        }

        return $id;
    }

    /** The authenticated learner (only on `learner.auth` routes). */
    protected function learner(): Learner
    {
        $learner = request()->attributes->get('learner');
        if (! $learner instanceof Learner) {
            abort(401, 'Sign in to continue.');
        }

        return $learner;
    }

    /** Does the current learner hold an ACTIVE enrollment in $courseId? */
    protected function isEnrolled(string $courseId): bool
    {
        return DB::table('enrollments')
            ->where('learner_id', $this->learner()->getKey())
            ->where('course_id', $courseId)
            ->where('status', 'ACTIVE')
            ->exists();
    }

    /** ACTIVE enrollment in $courseId for the current learner, or 403 — the gate the whole LMS turns on. */
    protected function assertEnrolled(string $courseId): void
    {
        if (! $this->isEnrolled($courseId)) {
            abort(403, 'Enroll with a code to watch this course.');
        }
    }

    /** ISO-8601 UTC (or null). */
    protected function iso(mixed $value): ?string
    {
        return $value === null ? null : Carbon::parse($value)->utc()->toIso8601String();
    }
}
