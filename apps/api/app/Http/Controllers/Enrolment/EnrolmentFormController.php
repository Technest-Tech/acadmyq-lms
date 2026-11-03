<?php

declare(strict_types=1);

namespace App\Http\Controllers\Enrolment;

use App\Http\Controllers\Controller;
use App\Services\Enrolment\EnrolmentForm;
use App\Support\AuthContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

/**
 * The "رابط التسجيل" card on the centre's enrolment inbox: the public link, whether the form is
 * open, and the words on it. Reading the link is `trial.read` — the people working the inbox are
 * the ones who paste it into an advert; changing what the form says or asks, pausing it, and
 * cutting a new link are `settings.manage`, like the rest of the academy's own configuration.
 *
 * Behind `entitled:centre`: a Quran academy has no such form and gets a 402 here.
 */
final class EnrolmentFormController extends Controller
{
    public function __construct(private readonly EnrolmentForm $forms) {}

    /** GET /api/enrolment/form — the academy's form, made on first read. */
    public function show(): JsonResponse
    {
        Gate::authorize('trial.read');
        $ctx = app(AuthContext::class);

        $form = $this->forms->ensure((string) $ctx->academyId, $ctx->userId, $ctx->role);

        return response()->json(['form' => $this->forms->staffDto($form)]);
    }

    /** PATCH /api/enrolment/form — title, intro, open/closed, which questions it asks, the thank-you text. */
    public function update(Request $request): JsonResponse
    {
        Gate::authorize('settings.manage');
        $ctx = app(AuthContext::class);

        $data = $request->validate([
            'title' => ['sometimes', 'nullable', 'string', 'max:120'],
            'intro' => ['sometimes', 'nullable', 'string', 'max:2000'],
            'is_open' => ['sometimes', 'boolean'],
            'ask_subject' => ['sometimes', 'boolean'],
            'ask_level' => ['sometimes', 'boolean'],
            'ask_schedule' => ['sometimes', 'boolean'],
            'success_message' => ['sometimes', 'nullable', 'string', 'max:2000'],
        ]);

        $form = $this->forms->ensure((string) $ctx->academyId, $ctx->userId, $ctx->role);
        $form = $this->forms->update($form, $data, $ctx->userId, $ctx->role);

        return response()->json(['form' => $this->forms->staffDto($form)]);
    }

    /** POST /api/enrolment/form/rotate-token — a new link; the old one answers 404 from now on. */
    public function rotateToken(): JsonResponse
    {
        Gate::authorize('settings.manage');
        $ctx = app(AuthContext::class);

        $form = $this->forms->ensure((string) $ctx->academyId, $ctx->userId, $ctx->role);
        $form = $this->forms->rotate($form, $ctx->userId, $ctx->role);

        return response()->json(['form' => $this->forms->staffDto($form)]);
    }
}
