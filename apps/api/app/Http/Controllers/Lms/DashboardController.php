<?php

declare(strict_types=1);

namespace App\Http\Controllers\Lms;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Lms\Concerns\InteractsWithLms;
use App\Support\LmsMedia;
use App\Support\LmsSite;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * The course platform's own dashboard (docs/lms) — what an LMS client sees instead of the school
 * management dashboard. Everything here is RLS-scoped to the academy, so the numbers are the
 * client's own: their catalogue, their learners, their enrolments, and the public site their
 * subdomain resolves to.
 *
 * `subdomain` is Super-Admin-WRITE under RLS but owner-READ, which is exactly what this needs: the
 * client can see (and link to) their site without being able to change it.
 */
final class DashboardController extends Controller
{
    use InteractsWithLms;

    /** GET /api/courses/dashboard — headline stats + the client's public site + recent activity. */
    public function show(): JsonResponse
    {
        Gate::authorize('course.read');
        $academyId = $this->currentAcademyId();

        $courses = DB::table('courses')->whereNull('deleted_at')
            ->selectRaw("count(*) as total")
            ->selectRaw("count(*) filter (where status = 'PUBLISHED') as published")
            ->selectRaw("count(*) filter (where status = 'DRAFT') as draft")
            ->first();

        $learners = DB::table('learners')
            ->selectRaw('count(*) as total')
            ->selectRaw("count(*) filter (where status = 'ACTIVE') as active")
            ->first();

        $enrollments = DB::table('enrollments')
            ->selectRaw('count(*) as total')
            ->selectRaw("count(*) filter (where status = 'ACTIVE') as active")
            ->first();

        $codes = DB::table('access_codes')
            ->selectRaw('count(*) as total')
            ->selectRaw('count(*) filter (where is_active) as active')
            ->selectRaw('coalesce(sum(redemptions_count), 0) as redeemed')
            ->first();

        $certificates = (int) DB::table('course_certificates')->count();
        $lessons = (int) DB::table('lessons')->count();

        return response()->json([
            'stats' => [
                'courses' => (int) ($courses->total ?? 0),
                'published_courses' => (int) ($courses->published ?? 0),
                'draft_courses' => (int) ($courses->draft ?? 0),
                'lessons' => $lessons,
                'learners' => (int) ($learners->total ?? 0),
                'active_learners' => (int) ($learners->active ?? 0),
                'enrollments' => (int) ($enrollments->total ?? 0),
                'active_enrollments' => (int) ($enrollments->active ?? 0),
                'codes' => (int) ($codes->total ?? 0),
                'active_codes' => (int) ($codes->active ?? 0),
                'redeemed_codes' => (int) ($codes->redeemed ?? 0),
                'certificates' => $certificates,
            ],
            'storage' => [
                'used_bytes' => LmsMedia::usedBytes(),
                'limit_bytes' => LmsMedia::capBytes($academyId),
            ],
            'site' => $this->site($academyId),
            'recent_enrollments' => $this->recentEnrollments(),
            'top_courses' => $this->topCourses(),
        ]);
    }

    /**
     * The client's public learner site. `subdomain` is owner-readable under RLS; the URL is built
     * from LMS_SITE_ROOT_DOMAIN when configured, else the in-app path the learner site also serves.
     */
    private function site(string $academyId): array
    {
        $subdomain = DB::table('academies')->where('id', $academyId)->value('subdomain');

        return LmsSite::block($subdomain !== null ? (string) $subdomain : null) + [
            'published_courses' => (int) DB::table('courses')
                ->where('status', 'PUBLISHED')->whereNull('deleted_at')->count(),
        ];
    }

    /** @return list<array<string,mixed>> the latest enrolments, for the activity feed. */
    private function recentEnrollments(): array
    {
        return DB::table('enrollments as e')
            ->join('learners as l', 'l.id', '=', 'e.learner_id')
            ->join('courses as c', 'c.id', '=', 'e.course_id')
            ->orderByDesc('e.enrolled_at')
            ->limit(8)
            ->get(['e.id', 'e.enrolled_at', 'l.full_name as learner_name', 'c.title as course_title'])
            ->map(fn (object $r): array => [
                'id' => (string) $r->id,
                'learner_name' => (string) $r->learner_name,
                'course_title' => (string) $r->course_title,
                'enrolled_at' => $this->iso($r->enrolled_at),
            ])
            ->all();
    }

    /** @return list<array<string,mixed>> the busiest courses by active enrolment. */
    private function topCourses(): array
    {
        return DB::table('courses as c')
            ->leftJoin('enrollments as e', function ($join): void {
                $join->on('e.course_id', '=', 'c.id')->where('e.status', '=', 'ACTIVE');
            })
            ->whereNull('c.deleted_at')
            ->groupBy('c.id', 'c.title', 'c.slug', 'c.status')
            ->orderByDesc(DB::raw('count(e.id)'))
            ->orderBy('c.title')
            ->limit(5)
            ->get(['c.id', 'c.title', 'c.slug', 'c.status', DB::raw('count(e.id) as learners')])
            ->map(fn (object $r): array => [
                'id' => (string) $r->id,
                'title' => (string) $r->title,
                'slug' => (string) $r->slug,
                'status' => (string) $r->status,
                'learners' => (int) $r->learners,
            ])
            ->all();
    }
}
