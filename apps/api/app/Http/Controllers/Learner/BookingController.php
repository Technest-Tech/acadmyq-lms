<?php

declare(strict_types=1);

namespace App\Http\Controllers\Learner;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Learner\Concerns\InteractsWithLearner;
use App\Models\Learner;
use App\Support\Lms\BookingForms;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Throwable;

/**
 * A booking form on the public course site (docs/lms/13) — "احجز استشارة", "احجز كورس", whatever
 * the client named it.
 *
 * Anonymous on purpose: a sign-up wall in front of "call me back" is exactly where the lead walks
 * away. When the visitor IS signed in, the request is linked to their learner account so staff
 * can see who they are; that is a bonus, never a requirement.
 *
 * Abuse is handled the boring way: a tight per-IP-per-academy throttle on the route, a honeypot
 * field that bots fill and humans never see, and a double-submit guard that folds a re-send of the
 * same form from the same phone into the request already waiting.
 */
final class BookingController extends Controller
{
    use InteractsWithLearner;

    /** A re-submission inside this window updates the waiting request instead of adding another. */
    private const DUPLICATE_WINDOW_MINUTES = 10;

    /** GET /api/learn/bookings/{slug} — the form, plus the courses it can ask about. */
    public function show(string $slug): JsonResponse
    {
        $form = $this->activeForm($slug);

        return response()->json([
            'form' => BookingForms::publicDto($form),
            'courses' => (bool) $form->ask_course ? BookingForms::courseOptions() : [],
        ]);
    }

    /** POST /api/learn/bookings/{slug} — take a request. */
    public function store(Request $request, string $slug): JsonResponse
    {
        $academyId = $this->currentAcademyId();
        $form = $this->activeForm($slug);
        $choices = BookingForms::choices($form->choices);

        // The honeypot: an input the site renders off-screen. A person never fills it; a form-
        // stuffing bot fills everything. Answer exactly as a success would, so the bot learns nothing.
        if (trim((string) $request->input('website', '')) !== '') {
            return response()->json(['ok' => true], 201);
        }

        $data = $request->validate([
            'full_name' => ['required', 'string', 'min:2', 'max:120'],
            'phone' => ['required', 'string', 'max:32', 'regex:/^\+?[0-9\s().\-]{6,32}$/'],
            'email' => ['nullable', 'email', 'max:255'],
            'course_id' => ['nullable', 'uuid'],
            'choice' => $choices === []
                ? ['nullable']
                : ['required', 'string', Rule::in($choices)],
            // Yesterday, not today: the visitor's "today" can be the server's yesterday across a
            // timezone line, and refusing a date the calendar just offered them is a dead end.
            'preferred_date' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:yesterday'],
            'preferred_time' => ['nullable', 'date_format:H:i'],
            'message' => ['nullable', 'string', 'max:2000'],
        ]);

        // A phone number with fewer than six digits is a typo, whatever punctuation surrounds it.
        if (strlen((string) preg_replace('/\D+/', '', $data['phone'])) < 6) {
            throw ValidationException::withMessages(['phone' => 'Enter a phone number we can reach you on.']);
        }

        $course = null;
        if ((bool) $form->ask_course && ! empty($data['course_id'])) {
            // Only what the catalogue shows: a draft or deleted course is not bookable.
            $course = DB::table('courses')
                ->where('id', $data['course_id'])
                ->where('status', 'PUBLISHED')
                ->whereNull('deleted_at')
                ->first(['id', 'title']);
            if ($course === null) {
                throw ValidationException::withMessages(['course_id' => 'That course is not available.']);
            }
        }

        // Only the questions this form actually asks are kept — a crafted request cannot smuggle a
        // date into a form that never asked for one and have it show up in the inbox.
        $columns = [
            'form_title' => (string) $form->title,
            'full_name' => trim($data['full_name']),
            'phone' => trim($data['phone']),
            'email' => (bool) $form->ask_email ? $this->blankToNull($data['email'] ?? null) : null,
            'course_id' => $course?->id,
            'course_title' => $course?->title,
            'choice' => $choices === [] ? null : $data['choice'],
            'preferred_date' => (bool) $form->ask_date ? ($data['preferred_date'] ?? null) : null,
            'preferred_time' => (bool) $form->ask_date ? ($data['preferred_time'] ?? null) : null,
            'message' => (bool) $form->ask_message ? $this->blankToNull($data['message'] ?? null) : null,
            'learner_id' => $this->signedInLearnerId($academyId),
        ];

        // Double-submit guard: the same phone on the same form, still untouched, minutes ago — a
        // second tap, a back button, or "I forgot to say which day". Fold it into the waiting one.
        $existing = DB::table('booking_requests')
            ->where('form_id', $form->id)
            ->where('phone', $columns['phone'])
            ->where('status', 'NEW')
            // Compared in SQL: a bound Carbon is read in the DB session's zone, not UTC.
            ->whereRaw('created_at >= now() - make_interval(mins => ?)', [self::DUPLICATE_WINDOW_MINUTES])
            ->orderByDesc('created_at')
            ->value('id');

        if ($existing !== null) {
            DB::table('booking_requests')->where('id', $existing)->update($columns + ['updated_at' => DB::raw('now()')]);

            return response()->json(['ok' => true], 200);
        }

        DB::table('booking_requests')->insert($columns + [
            'academy_id' => $academyId,
            'form_id' => $form->id,
            'status' => 'NEW',
        ]);

        return response()->json(['ok' => true], 201);
    }

    // ── helpers ─────────────────────────────────────────────────────────────────────────────────

    /** An ACTIVE form of this academy (RLS scopes it), or 404 — a hidden form is not a page. */
    private function activeForm(string $slug): object
    {
        $form = DB::table('booking_forms')
            ->where('slug', $slug)
            ->where('status', 'ACTIVE')
            ->first();

        if ($form === null) {
            abort(404, 'This page does not exist.');
        }

        return $form;
    }

    /**
     * The visitor's learner id when they sent a valid token for THIS academy, else null. The same
     * checks EnsureLearner makes, minus the 401: on this route an anonymous visitor is welcome.
     */
    private function signedInLearnerId(string $academyId): ?string
    {
        try {
            $learner = Auth::guard('learner')->user();
        } catch (Throwable) {
            return null;
        }

        if (! $learner instanceof Learner
            || (string) $learner->academy_id !== $academyId
            || (string) $learner->status !== 'ACTIVE') {
            return null;
        }

        return (string) $learner->getKey();
    }

    private function blankToNull(?string $value): ?string
    {
        $value = $value === null ? null : trim($value);

        return $value === '' ? null : $value;
    }
}
