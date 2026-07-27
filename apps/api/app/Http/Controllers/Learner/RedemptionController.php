<?php

declare(strict_types=1);

namespace App\Http\Controllers\Learner;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Learner\Concerns\InteractsWithLearner;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Code redemption (docs/lms/03) — the academy's paywall substitute. A signed-in learner enters a
 * code; if it is live, unexpired, under its redemption cap, and not already used by them, they become
 * enrolled in every course the code unlocks. The whole request already runs inside the
 * ResolveAcademyContext transaction, so the `lockForUpdate` + cap check is race-safe: two learners
 * racing a single-use code cannot both win.
 *
 * A price_minor = 0 course needs no code at all: `enrollFree` is the one-click path for it, creating
 * the same enrollment row with a null `source_code_id` (the column already allows it).
 */
final class RedemptionController extends Controller
{
    use InteractsWithLearner;

    /** POST /api/learn/redeem — redeem a code → enrollment(s). */
    public function redeem(Request $request): JsonResponse
    {
        $academyId = $this->currentAcademyId();
        $learner = $this->learner();

        $data = $request->validate([
            'code' => ['required', 'string', 'max:64'],
        ]);
        $codeStr = trim($data['code']);

        // Row-lock the code so the redemptions_count check can't race (single-use codes).
        $code = DB::table('access_codes')
            ->whereRaw('lower(code) = lower(?)', [$codeStr])
            ->lockForUpdate()
            ->first();

        if ($code === null) {
            throw ValidationException::withMessages(['code' => ['That code is not valid.']]);
        }
        if (! $code->is_active) {
            throw ValidationException::withMessages(['code' => ['That code is no longer active.']]);
        }
        if ($code->expires_at !== null && Carbon::parse($code->expires_at)->isPast()) {
            throw ValidationException::withMessages(['code' => ['That code has expired.']]);
        }

        $already = DB::table('code_redemptions')
            ->where('code_id', $code->id)
            ->where('learner_id', $learner->getKey())
            ->exists();

        if (! $already) {
            if ($code->max_redemptions !== null && $code->redemptions_count >= $code->max_redemptions) {
                throw ValidationException::withMessages(['code' => ['That code has been fully used.']]);
            }

            DB::table('code_redemptions')->insert([
                'id' => (string) Str::uuid(),
                'academy_id' => $academyId,
                'code_id' => $code->id,
                'learner_id' => $learner->getKey(),
            ]);
            DB::table('access_codes')->where('id', $code->id)->update([
                'redemptions_count' => $code->redemptions_count + 1,
                'updated_at' => now(),
            ]);
        }

        // Enroll in every course the code unlocks (idempotent on learner+course).
        $courseIds = DB::table('access_code_courses')->where('code_id', $code->id)->pluck('course_id');
        foreach ($courseIds as $courseId) {
            DB::table('enrollments')->updateOrInsert(
                ['learner_id' => $learner->getKey(), 'course_id' => $courseId],
                [
                    'academy_id' => $academyId,
                    'source_code_id' => $code->id,
                    'status' => 'ACTIVE',
                    'enrolled_at' => now(),
                ],
            );
        }

        // The now-unlocked, published courses (what the learner can immediately open).
        $courses = DB::table('courses')
            ->whereIn('id', $courseIds)
            ->where('status', 'PUBLISHED')
            ->whereNull('deleted_at')
            ->get(['id', 'title', 'slug'])
            ->map(fn (object $c): array => [
                'id' => (string) $c->id,
                'title' => (string) $c->title,
                'slug' => (string) $c->slug,
            ]);

        return response()->json([
            'ok' => true,
            'already_redeemed' => $already,
            'courses' => $courses,
        ]);
    }

    /** POST /api/learn/courses/{slug}/enroll — self-enroll in a FREE course, no code needed. */
    public function enrollFree(string $slug): JsonResponse
    {
        $academyId = $this->currentAcademyId();
        $learner = $this->learner();

        $course = DB::table('courses')
            ->where('slug', $slug)
            ->where('status', 'PUBLISHED')
            ->whereNull('deleted_at')
            ->first(['id', 'title', 'slug', 'price_minor']);
        if ($course === null) {
            abort(404, 'Course not found.');
        }
        // The price is the authorisation: a paid course still has to go through a code.
        if ((int) $course->price_minor !== 0) {
            abort(403, 'This course needs an access code.');
        }

        $existing = DB::table('enrollments')
            ->where('learner_id', $learner->getKey())
            ->where('course_id', $course->id)
            ->first(['status']);

        // A staff-revoked enrollment must NOT be undone by re-enrolling — free is not a way around a ban.
        if ($existing !== null && $existing->status !== 'ACTIVE') {
            abort(403, 'Your access to this course was revoked.');
        }

        if ($existing === null) {
            DB::table('enrollments')->insert([
                'id' => (string) Str::uuid(),
                'academy_id' => $academyId,
                'learner_id' => $learner->getKey(),
                'course_id' => $course->id,
                'source_code_id' => null,
                'status' => 'ACTIVE',
                'enrolled_at' => now(),
            ]);
        }

        return response()->json([
            'ok' => true,
            'already_enrolled' => $existing !== null,
            'course' => [
                'id' => (string) $course->id,
                'title' => (string) $course->title,
                'slug' => (string) $course->slug,
            ],
        ]);
    }
}
