<?php

declare(strict_types=1);

namespace App\Http\Controllers\Public;

use App\Http\Controllers\Controller;
use App\Services\Enrolment\EnrolmentForm;
use App\Support\Audit;
use App\Support\AuthContext;
use App\Support\Phone;
use App\Support\Tenancy;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * The centre's public enrolment page (`/e/{token}`) — what a parent opens from the advert. No
 * account, no password: the token names the academy, and the page is built inside that academy's
 * tenant context under a sentinel role that matches no staff capability (the same shape as the
 * parent portal `/p/` and the family pay page `/f/`).
 *
 * Abuse is handled the way the course site's booking form handles it: a tight per-IP throttle on
 * the route, a honeypot field a person never sees, and a double-submit guard that folds a re-send of
 * the same child from the same phone into the request already waiting.
 */
final class EnrolmentController extends Controller
{
    /** A re-submission inside this window updates the waiting request instead of adding another. */
    private const DUPLICATE_WINDOW_MINUTES = 10;

    public function __construct(private readonly EnrolmentForm $forms) {}

    /** GET /api/e/{token} — the academy's brand, the form's words and switches, and the subjects to pick from. */
    public function show(string $token): JsonResponse
    {
        [$ctx, $formId] = $this->resolve($token);

        $payload = Tenancy::withContext($ctx, function () use ($ctx, $formId): array {
            $form = DB::table('enrolment_forms')->where('id', $formId)->first();
            $academy = DB::table('academies')->where('id', $ctx->academyId)
                ->first(['name', 'brand_display_name', 'brand_logo_url', 'timezone', 'country']);
            $name = trim((string) ($academy->name ?? ''));
            $display = trim((string) ($academy->brand_display_name ?? '')) ?: $name;

            return [
                'academy' => [
                    'name' => $name,
                    'displayName' => $display,
                    'logoUrl' => trim((string) ($academy->brand_logo_url ?? '')) ?: null,
                    'timezone' => (string) ($academy->timezone ?? 'UTC'),
                    'country' => $academy->country !== null ? strtoupper((string) $academy->country) : null,
                ],
                'form' => $this->forms->publicDto($form),
                'subjects' => (bool) $form->ask_subject
                    ? DB::table('specializations')->where('is_active', true)->orderBy('sort_order')->orderBy('name')->get(['id', 'name'])->values()
                    : [],
            ];
        });

        return $this->shielded(response()->json($payload));
    }

    /** POST /api/e/{token} — take a request. */
    public function store(Request $request, string $token): JsonResponse
    {
        [$ctx, $formId] = $this->resolve($token);

        // The honeypot: an input the page renders off-screen. A person never fills it; a form-
        // stuffing bot fills everything. Answer exactly as a success would, so the bot learns nothing.
        if (trim((string) $request->input('website', '')) !== '') {
            return $this->shielded(response()->json(['ok' => true, 'success_message' => null], 201));
        }

        $data = $request->validate([
            'student_name' => ['required', 'string', 'min:2', 'max:120'],
            'guardian_name' => ['nullable', 'string', 'max:120'],
            'phone' => ['required', 'string', 'max:32'],
            'email' => ['nullable', 'email', 'max:255'],
            'age' => ['nullable', 'integer', 'min:1', 'max:120'],
            'subject_id' => ['nullable', 'uuid'],
            'subject_text' => ['nullable', 'string', 'max:120'],
            // TODO(levels): once the academy-defined levels list lands, accept a `level_id` here
            // beside the free text and store it on enrolment_requests.
            'level_text' => ['nullable', 'string', 'max:120'],
            'preferred_days' => ['nullable', 'array', 'max:7'],
            'preferred_days.*' => ['integer', 'min:0', 'max:6'],
            'preferred_time' => ['nullable', 'date_format:H:i'],
            'message' => ['nullable', 'string', 'max:2000'],
        ]);

        // Stored canonical (E.164) so the placement lesson booked from it carries a number the
        // trials board and WhatsApp can use as-is.
        $phone = Phone::normalize($data['phone'], 'phone');
        if ($phone === null) {
            throw ValidationException::withMessages(['phone' => ['Enter a phone number we can reach you on.']]);
        }

        $result = Tenancy::withContext($ctx, function () use ($ctx, $formId, $data, $phone): array {
            $form = DB::table('enrolment_forms')->where('id', $formId)->first();
            if (! (bool) $form->is_open) {
                abort(410, 'Registration is closed at the moment. / التسجيل مغلق حاليًا.');
            }

            $subjectId = null;
            if ((bool) $form->ask_subject && ! empty($data['subject_id'])) {
                // Only what the page offered: a retired subject is not a choice.
                $subjectId = DB::table('specializations')->where('id', $data['subject_id'])->where('is_active', true)->value('id');
                if ($subjectId === null) {
                    throw ValidationException::withMessages(['subject_id' => ['That subject is not available.']]);
                }
            }

            // Only the questions this form asks are kept — a crafted request cannot smuggle a
            // schedule into a form that never asked for one and have it show up in the inbox.
            $days = (bool) $form->ask_schedule ? array_values(array_unique(array_map('intval', $data['preferred_days'] ?? []))) : [];
            sort($days);
            $columns = [
                'student_name' => trim($data['student_name']),
                'guardian_name' => $this->blankToNull($data['guardian_name'] ?? null),
                'phone' => $phone,
                'email' => $this->blankToNull($data['email'] ?? null),
                'age' => $data['age'] ?? null,
                'subject_id' => $subjectId,
                'subject_text' => (bool) $form->ask_subject ? $this->blankToNull($data['subject_text'] ?? null) : null,
                'level_text' => (bool) $form->ask_level ? $this->blankToNull($data['level_text'] ?? null) : null,
                'preferred_days' => '{'.implode(',', $days).'}',
                'preferred_time' => (bool) $form->ask_schedule ? ($data['preferred_time'] ?? null) : null,
                'message' => $this->blankToNull($data['message'] ?? null),
            ];

            // Double-submit guard: the same child from the same phone, still untouched, minutes ago —
            // a second tap, a back button, "I forgot to say which day". Fold it into the waiting one.
            $existing = DB::table('enrolment_requests')
                ->where('form_id', $formId)
                ->where('phone', $phone)
                ->whereRaw('lower(student_name) = lower(?)', [$columns['student_name']])
                ->where('status', 'NEW')
                // Compared in SQL: a bound Carbon is read in the DB session's zone, not UTC.
                ->whereRaw('created_at >= now() - make_interval(mins => ?)', [self::DUPLICATE_WINDOW_MINUTES])
                ->orderByDesc('created_at')
                ->value('id');

            if ($existing !== null) {
                DB::table('enrolment_requests')->where('id', $existing)->update($columns + ['updated_at' => DB::raw('now()')]);

                return ['id' => (string) $existing, 'created' => false, 'form' => $form];
            }

            $id = (string) Str::uuid();
            DB::table('enrolment_requests')->insert($columns + [
                'id' => $id,
                'academy_id' => $ctx->academyId,
                'form_id' => $formId,
                'source' => 'LINK',
                'status' => 'NEW',
            ]);
            Audit::log('enrolment.request_received', 'enrolment_request', $id, $ctx->academyId, null, null, after: [
                'student_name' => $columns['student_name'],
                'phone' => $phone,
            ]);

            return ['id' => $id, 'created' => true, 'form' => $form];
        });

        return $this->shielded(response()->json([
            'ok' => true,
            'success_message' => $result['form']->success_message,
        ], $result['created'] ? 201 : 200));
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    /**
     * The token → the academy and form, through the pre-context hatch. Every miss (unknown token,
     * suspended academy) is the same 404, so nothing tells a guess apart from a dead link.
     *
     * @return array{0: AuthContext, 1: string}
     */
    private function resolve(string $token): array
    {
        $row = DB::selectOne('select form_id, academy_id from app.enrolment_form_lookup(?)', [$token]);
        if ($row === null) {
            abort(404, 'Page not found.');
        }

        $ctx = new AuthContext(userId: '', academyId: (string) $row->academy_id, role: 'GUARDIAN', permissions: []);
        app()->instance(AuthContext::class, $ctx);

        return [$ctx, (string) $row->form_id];
    }

    /** Never cached by a proxy or the browser, never indexed — the link is the academy's to hand out. */
    private function shielded(JsonResponse $response): JsonResponse
    {
        return $response
            ->header('Cache-Control', 'no-store')
            ->header('X-Robots-Tag', 'noindex, nofollow');
    }

    private function blankToNull(?string $value): ?string
    {
        $value = $value === null ? null : trim($value);

        return $value === '' ? null : $value;
    }
}
