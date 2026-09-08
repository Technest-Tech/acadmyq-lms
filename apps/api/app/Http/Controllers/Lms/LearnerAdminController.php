<?php

declare(strict_types=1);

namespace App\Http\Controllers\Lms;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Lms\Concerns\InteractsWithLms;
use App\Support\Audit;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

/**
 * The staff view of the academy's learners + their enrollments (LMS module, entitled:lms). Reading is
 * gated by `learner.read`; access changes (block a learner, revoke an enrollment) by
 * `access_code.manage` — the "who may get in" capability. RLS scopes to the academy.
 */
final class LearnerAdminController extends Controller
{
    use InteractsWithLms;

    /** GET /api/courses/learners — every learner with their enrollment count + last activity. */
    public function index(): JsonResponse
    {
        Gate::authorize('learner.read');

        $learners = DB::table('learners as l')
            ->orderByDesc('l.created_at')
            ->get([
                'l.id', 'l.full_name', 'l.email', 'l.phone', 'l.status', 'l.last_login_at', 'l.created_at',
                DB::raw("(select count(*) from enrollments e where e.learner_id = l.id and e.status = 'ACTIVE') as enrollment_count"),
                DB::raw("(select count(*) from product_entitlements pe where pe.learner_id = l.id and pe.status = 'ACTIVE') as product_count"),
            ])
            ->map(fn (object $l): array => [
                'id' => (string) $l->id,
                'full_name' => (string) $l->full_name,
                'email' => (string) $l->email,
                'phone' => $l->phone,
                'status' => (string) $l->status,
                'enrollment_count' => (int) $l->enrollment_count,
                'product_count' => (int) $l->product_count,
                'last_login_at' => $l->last_login_at !== null ? Carbon::parse($l->last_login_at)->utc()->toIso8601String() : null,
            ]);

        return response()->json(['learners' => $learners]);
    }

    /** GET /api/courses/learners/{id} — one learner + their enrollments. */
    public function show(string $id): JsonResponse
    {
        Gate::authorize('learner.read');

        $learner = DB::table('learners')->where('id', $id)->first(['id', 'full_name', 'email', 'phone', 'status']);
        if ($learner === null) {
            abort(404, 'Learner not found.');
        }

        $enrollments = DB::table('enrollments as e')
            ->join('courses as c', 'c.id', '=', 'e.course_id')
            ->where('e.learner_id', $id)
            ->orderByDesc('e.enrolled_at')
            ->get(['e.course_id', 'c.title', 'e.status', 'e.enrolled_at'])
            ->map(fn (object $e): array => [
                'course_id' => (string) $e->course_id,
                'title' => (string) $e->title,
                'status' => (string) $e->status,
                'enrolled_at' => Carbon::parse($e->enrolled_at)->utc()->toIso8601String(),
            ]);

        // What this learner OWNS, as opposed to what they are enrolled in (docs/lms/11). Kept as a
        // separate list rather than folded into `enrollments`: a book has no progress and no
        // certificate, and pretending otherwise would put empty columns on the screen.
        $products = DB::table('product_entitlements as e')
            ->join('digital_products as p', 'p.id', '=', 'e.product_id')
            ->where('e.learner_id', $id)
            ->orderByDesc('e.granted_at')
            ->get(['e.product_id', 'p.title', 'p.kind', 'e.status', 'e.granted_at', 'e.download_count'])
            ->map(fn (object $e): array => [
                'product_id' => (string) $e->product_id,
                'title' => (string) $e->title,
                'kind' => (string) $e->kind,
                'status' => (string) $e->status,
                'granted_at' => Carbon::parse($e->granted_at)->utc()->toIso8601String(),
                'download_count' => (int) $e->download_count,
            ]);

        return response()->json([
            'learner' => [
                'id' => (string) $learner->id,
                'full_name' => (string) $learner->full_name,
                'email' => (string) $learner->email,
                'phone' => $learner->phone,
                'status' => (string) $learner->status,
            ],
            'enrollments' => $enrollments,
            'products' => $products,
        ]);
    }

    /**
     * POST /api/courses/learners/{id}/product — hand a book over, or pull it back.
     *
     * The manual door next to a paid order: a client who sold a book on WhatsApp, or is making good
     * on a complaint, grants it here. `updateOrInsert`, so granting is also how a revoked
     * entitlement is restored — one action, no "does it exist yet" branch for the caller.
     */
    public function setProductAccess(Request $request, string $id): JsonResponse
    {
        Gate::authorize('access_code.manage');

        $academyId = $this->currentAcademyId();
        if (DB::table('learners')->where('id', $id)->doesntExist()) {
            abort(404, 'Learner not found.');
        }

        $data = $request->validate([
            'product_id' => ['required', 'uuid'],
            'status' => ['required', Rule::in(['ACTIVE', 'REVOKED'])],
        ]);

        if (DB::table('digital_products')->where('id', $data['product_id'])->whereNull('deleted_at')->doesntExist()) {
            abort(404, 'Product not found.');
        }

        DB::table('product_entitlements')->updateOrInsert(
            ['learner_id' => $id, 'product_id' => $data['product_id']],
            [
                'academy_id' => $academyId,
                'status' => $data['status'],
                'granted_at' => now(),
            ],
        );

        Audit::log('product_entitlement.set_status', 'digital_product', (string) $data['product_id'],
            $academyId, $this->ctx()->userId, $this->ctx()->role,
            after: ['status' => $data['status'], 'learner_id' => $id]);

        return response()->json(['ok' => true]);
    }

    /** POST /api/courses/learners/{id}/status — block or unblock a learner. */
    public function setStatus(Request $request, string $id): JsonResponse
    {
        Gate::authorize('access_code.manage');

        $academyId = $this->currentAcademyId();
        $learner = DB::table('learners')->where('id', $id)->first(['id', 'status']);
        if ($learner === null) {
            abort(404, 'Learner not found.');
        }

        $data = $request->validate([
            'status' => ['required', Rule::in(['ACTIVE', 'BLOCKED'])],
        ]);

        DB::table('learners')->where('id', $id)->update(['status' => $data['status'], 'updated_at' => now()]);

        Audit::log('learner.set_status', 'learner', $id, $academyId, $this->ctx()->userId, $this->ctx()->role,
            after: ['status' => $data['status']], before: ['status' => $learner->status]);

        return response()->json(['ok' => true, 'status' => $data['status']]);
    }

    /** POST /api/courses/learners/{id}/enrollment — revoke or restore a learner's course access. */
    public function setEnrollment(Request $request, string $id): JsonResponse
    {
        Gate::authorize('access_code.manage');

        $academyId = $this->currentAcademyId();
        if (DB::table('learners')->where('id', $id)->doesntExist()) {
            abort(404, 'Learner not found.');
        }

        $data = $request->validate([
            'course_id' => ['required', 'uuid'],
            'status' => ['required', Rule::in(['ACTIVE', 'REVOKED'])],
        ]);

        $enrollment = DB::table('enrollments')
            ->where('learner_id', $id)
            ->where('course_id', $data['course_id'])
            ->first(['id']);
        if ($enrollment === null) {
            abort(404, 'Enrollment not found.');
        }

        DB::table('enrollments')->where('id', $enrollment->id)->update(['status' => $data['status']]);

        Audit::log('enrollment.set_status', 'enrollment', (string) $enrollment->id, $academyId, $this->ctx()->userId, $this->ctx()->role,
            after: ['status' => $data['status'], 'course_id' => $data['course_id']]);

        return response()->json(['ok' => true]);
    }
}
