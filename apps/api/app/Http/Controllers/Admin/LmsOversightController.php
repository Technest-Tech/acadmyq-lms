<?php

declare(strict_types=1);

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Services\ModuleBilling;
use App\Support\Audit;
use App\Support\AuthContext;
use App\Support\FeatureCatalog;
use App\Support\LmsSite;
use App\Support\Tenancy;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

/**
 * Super Admin LMS oversight (docs/lms) — the course-platform counterpart of VideoOversightController.
 * Every route is gated by `platform.manage`, and every cross-tenant READ goes through the audited
 * SECURITY DEFINER hatches (`app.admin_lms_stats()`, `app.admin_lms_academy()`, `app.admin_lms_audit()`)
 * — never an RLS-bypassing ad-hoc query, which under a Super Admin's contextless RLS would simply
 * return nothing.
 *
 * Reads:
 *   - usage()    — the LMS client roster: catalogue, learners, enrolments, redemption, storage vs cap.
 *   - academy()  — one client's detail: subscription state, effective caps, courses, learners, activity.
 *   - activity() — the platform-wide LMS activity feed.
 *
 * Writes (the per-client control surface). Deliberately DISJOINT from /admin/clients, which stays the
 * sole place a module subscription is started, paused, trialled or ended (R4, one writer per fact).
 * What lives here is what only makes sense in LMS terms:
 *   - setLimits()       — raise/lower this client's course/learner/storage caps without minting a
 *                         bespoke plan (writes the LMS sub's `overrides.limits` via ModuleBilling).
 *   - setSubdomain()    — the public course-site handle; Super-Admin-write, owner-read by design.
 *   - setCourseStatus() — publish / unpublish / archive a client's course (content moderation).
 *   - setLearnerStatus()— block / unblock a learner (abuse handling).
 *
 * Each write runs in the target academy's tenant context so its RLS policies admit it, and is audited
 * under an `lms.*` action so it also surfaces in the activity feed above.
 */
final class LmsOversightController extends Controller
{
    public function __construct(private readonly ModuleBilling $billing) {}

    /** GET /api/admin/lms/usage — per-academy LMS usage + platform-wide totals. */
    public function usage(): JsonResponse
    {
        Gate::authorize('platform.manage');

        $stats = json_decode(DB::selectOne('select app.admin_lms_stats() as s')->s, true) ?: [];

        return response()->json([
            'academies' => $stats['academies'] ?? [],
            'totals' => $stats['totals'] ?? [],
        ]);
    }

    /**
     * GET /api/admin/lms/academies/{id} — one client's LMS detail (404 when the academy doesn't
     * exist). The public site URL is derived here rather than in SQL so it follows the same
     * LMS_SITE_ROOT_DOMAIN config the client's own dashboard uses.
     */
    public function academy(string $id): JsonResponse
    {
        Gate::authorize('platform.manage');

        $data = $this->readAcademy($id);
        if ($data === null) {
            abort(404, 'Academy not found.');
        }

        return response()->json($data);
    }

    /** GET /api/admin/lms/activity — the platform-wide LMS activity feed. */
    public function activity(Request $request): JsonResponse
    {
        Gate::authorize('platform.manage');

        $filters = $request->validate([
            'academy' => ['nullable', 'uuid'],
            'limit' => ['nullable', 'integer', 'min:1', 'max:200'],
        ]);
        $limit = (int) ($filters['limit'] ?? 100);

        $data = json_decode(
            DB::selectOne('select app.admin_lms_audit(?::uuid, ?, ?) as a', [
                $filters['academy'] ?? null,
                $limit,
                0,
            ])->a,
            true,
        ) ?: ['rows' => [], 'total' => 0];

        return response()->json([
            'rows' => $data['rows'] ?? [],
            'total' => $data['total'] ?? 0,
            'limit' => $limit,
        ]);
    }

    /**
     * POST /api/admin/lms/academies/{id}/limits — set (or clear) this client's LMS capacity caps.
     * A blank/omitted value clears that key; an all-blank payload clears the override entirely and
     * the client falls back to its LMS plan's limits. 422 when the client has no live LMS module —
     * enabling the module belongs to the client page.
     */
    public function setLimits(Request $request, string $id): JsonResponse
    {
        Gate::authorize('platform.manage');
        $this->assertAcademyExists($id);

        $data = $request->validate([
            'limits' => ['present', 'nullable', 'array'],
            'limits.maxCourses' => ['nullable', 'integer', 'min:0', 'max:100000'],
            'limits.maxLearners' => ['nullable', 'integer', 'min:0', 'max:10000000'],
            'limits.maxStorageGb' => ['nullable', 'integer', 'min:0', 'max:1000000'],
        ]);

        $limits = [];
        foreach (FeatureCatalog::LMS_LIMIT_KEYS as $key) {
            $value = $data['limits'][$key] ?? null;
            if ($value !== null && $value !== '') {
                $limits[$key] = (int) $value;
            }
        }

        $before = $this->currentOverrideLimits($id);
        $sub = $this->inAcademyContext($id, fn () => $this->billing->setLimitOverrides($id, 'LMS', $limits));

        if ($sub === null) {
            return response()->json([
                'message' => 'This client has no active LMS module. Enable it on the client page first.',
                'errors' => ['limits' => ['This client has no active LMS module.']],
            ], 422);
        }

        $this->audit($id, 'lms.limits_set', 'academy', $id, after: ['limits' => $limits], before: ['limits' => $before]);

        return response()->json(['ok' => true, ...$this->readAcademy($id) ?? []]);
    }

    /**
     * PUT /api/admin/lms/academies/{id}/subdomain — the client's public course-site handle. Unique
     * platform-wide and DNS-safe (same rule as the academy form); null detaches the site.
     */
    public function setSubdomain(Request $request, string $id): JsonResponse
    {
        Gate::authorize('platform.manage');
        $this->assertAcademyExists($id);

        $data = $request->validate([
            'subdomain' => [
                'present', 'nullable', 'string', 'max:63',
                'regex:/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/',
                Rule::unique('academies', 'subdomain')->ignore($id),
            ],
        ]);

        $before = DB::table('academies')->where('id', $id)->value('subdomain');
        $subdomain = $data['subdomain'] !== null && $data['subdomain'] !== '' ? $data['subdomain'] : null;

        $this->inAcademyContext($id, function () use ($id, $subdomain): void {
            DB::table('academies')->where('id', $id)->update(['subdomain' => $subdomain, 'updated_at' => now()]);
        });

        $this->audit($id, 'lms.subdomain_set', 'academy', $id,
            after: ['subdomain' => $subdomain], before: ['subdomain' => $before]);

        return response()->json(['ok' => true, ...$this->readAcademy($id) ?? []]);
    }

    /**
     * POST /api/admin/lms/academies/{id}/courses/{courseId}/status — platform moderation of a
     * client's course. Mirrors the client's own publish rule (a published course needs a lesson, or
     * the public site gets a dead link); the course must belong to {id}, so a Super Admin can't
     * reach another client's course by guessing an id against the wrong academy.
     */
    public function setCourseStatus(Request $request, string $id, string $courseId): JsonResponse
    {
        Gate::authorize('platform.manage');
        $this->assertAcademyExists($id);

        $data = $request->validate([
            'status' => ['required', Rule::in(['DRAFT', 'PUBLISHED', 'ARCHIVED'])],
            'reason' => ['nullable', 'string', 'max:500'],
        ]);
        $status = $data['status'];

        $course = $this->inAcademyContext($id, fn () => DB::table('courses')
            ->where('id', $courseId)->where('academy_id', $id)->whereNull('deleted_at')
            ->first(['id', 'title', 'status', 'published_at']));
        if ($course === null) {
            abort(404, 'Course not found.');
        }

        if ($status === 'PUBLISHED') {
            $hasLesson = $this->inAcademyContext($id, fn () => DB::table('lessons')->where('course_id', $courseId)->exists());
            if (! $hasLesson) {
                return response()->json([
                    'message' => 'Add at least one lesson before publishing this course.',
                    'errors' => ['status' => ['This course has no lessons.']],
                ], 422);
            }
        }

        $this->inAcademyContext($id, function () use ($courseId, $status, $course): void {
            DB::table('courses')->where('id', $courseId)->update([
                'status' => $status,
                'published_at' => $status === 'PUBLISHED' ? ($course->published_at ?? now()) : $course->published_at,
                'updated_at' => now(),
            ]);
        });

        $this->audit($id, 'lms.course_moderated', 'course', $courseId,
            after: ['status' => $status, 'reason' => $data['reason'] ?? null, 'title' => $course->title],
            before: ['status' => $course->status]);

        return response()->json(['ok' => true, 'status' => $status]);
    }

    /**
     * POST /api/admin/lms/academies/{id}/learners/{learnerId}/status — block or unblock one of the
     * client's learners (abuse handling). BLOCKED stops the learner signing in to the course site.
     */
    public function setLearnerStatus(Request $request, string $id, string $learnerId): JsonResponse
    {
        Gate::authorize('platform.manage');
        $this->assertAcademyExists($id);

        $data = $request->validate([
            'status' => ['required', Rule::in(['ACTIVE', 'BLOCKED'])],
            'reason' => ['nullable', 'string', 'max:500'],
        ]);

        $learner = $this->inAcademyContext($id, fn () => DB::table('learners')
            ->where('id', $learnerId)->where('academy_id', $id)
            ->first(['id', 'full_name', 'status']));
        if ($learner === null) {
            abort(404, 'Learner not found.');
        }

        $this->inAcademyContext($id, function () use ($learnerId, $data): void {
            DB::table('learners')->where('id', $learnerId)
                ->update(['status' => $data['status'], 'updated_at' => now()]);
        });

        $this->audit($id, 'lms.learner_moderated', 'learner', $learnerId,
            after: ['status' => $data['status'], 'reason' => $data['reason'] ?? null, 'name' => $learner->full_name],
            before: ['status' => $learner->status]);

        return response()->json(['ok' => true, 'status' => $data['status']]);
    }

    // ── internals ────────────────────────────────────────────────────────────

    /**
     * The cross-tenant detail read + the derived public-site block. Returns null when the academy
     * doesn't exist (the SQL reader's own 404 signal).
     *
     * @return array<string,mixed>|null
     */
    private function readAcademy(string $id): ?array
    {
        $json = DB::selectOne('select app.admin_lms_academy(?::uuid) as d', [$id])->d;
        if ($json === null) {
            return null;
        }

        $data = json_decode($json, true);
        // `ownsRoot` reads the client's entitlement, which is tenant-scoped — resolve it inside that
        // academy's context, or a Super Admin (who has none) would read an empty subscription set
        // and mislabel every client's site link.
        $data['site'] = LmsSite::block(
            $data['academy']['subdomain'] ?? null,
            $this->inAcademyContext($id, static fn (): bool => LmsSite::ownsRoot($id)),
        );

        return $data;
    }

    /** 404 unless the academy exists — the writes below never leak "does this id exist?" via RLS. */
    private function assertAcademyExists(string $id): void
    {
        $exists = DB::selectOne('select app.admin_lms_academy(?::uuid) as d', [$id])->d !== null;
        if (! $exists) {
            abort(404, 'Academy not found.');
        }
    }

    /**
     * The LMS sub's current override limits, for the audit `before` snapshot.
     *
     * @return array<string,mixed>
     */
    private function currentOverrideLimits(string $id): array
    {
        $raw = $this->inAcademyContext($id, fn () => DB::table('module_subscriptions')
            ->where('academy_id', $id)->where('module', 'LMS')->where('status', '<>', 'ENDED')
            ->value('overrides'));

        $decoded = is_string($raw) ? json_decode($raw, true) : (is_array($raw) ? $raw : null);

        return is_array($decoded['limits'] ?? null) ? $decoded['limits'] : [];
    }

    /** Audit a Super Admin LMS action against the target academy (surfaces in the activity feed). */
    private function audit(string $academyId, string $action, string $entityType, ?string $entityId, array $after, array $before): void
    {
        $ctx = app(AuthContext::class);
        $this->inAcademyContext($academyId, fn () => Audit::log(
            $action, $entityType, $entityId, $academyId, $ctx->userId, 'SUPER_ADMIN',
            after: $after, before: $before,
        ));
    }

    /** Run $fn in the target academy's tenant context (SUPER_ADMIN) so its policies admit the write. */
    private function inAcademyContext(string $academyId, callable $fn): mixed
    {
        $ctx = app(AuthContext::class);
        $target = new AuthContext(
            userId: $ctx->userId,
            academyId: $academyId,
            role: 'SUPER_ADMIN',
            permissions: $ctx->permissions,
        );

        return Tenancy::withContext($target, $fn);
    }
}
