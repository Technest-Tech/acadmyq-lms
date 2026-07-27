<?php

declare(strict_types=1);

namespace App\Http\Controllers\Learner;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Learner\Concerns\InteractsWithLearner;
use App\Support\LmsSiteProfile;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

/**
 * The public course site's own content (docs/lms/09) — everything the shared template needs to
 * render this academy's version of it: brand, section copy, contact details, SEO. Fetched once,
 * server-side, by the learner-site layout, which is why it also carries the headline counts the
 * stats band shows (a second round-trip for four numbers would be silly).
 *
 * No auth: this IS the public site. RLS scopes it to the subdomain's academy via
 * ResolveAcademyContext, so a site can only ever describe itself.
 */
final class SiteController extends Controller
{
    use InteractsWithLearner;

    /** GET /api/learn/site — the merged site profile + live catalogue counts. */
    public function show(): JsonResponse
    {
        $academyId = $this->currentAcademyId();

        // Readable under the LEARNER context: academies_select is `id = app.current_academy_id()`.
        $academy = DB::table('academies')
            ->where('id', $academyId)
            ->first(['name', 'brand_display_name', 'brand_logo_url', 'subdomain']);

        $stored = DB::table('lms_site_profiles')->where('academy_id', $academyId)->value('content');
        $stored = is_string($stored) ? json_decode($stored, true) : $stored;

        return response()->json([
            'site' => LmsSiteProfile::merge(
                is_array($stored) ? $stored : [],
                $academy === null ? [] : (array) $academy,
            ),
            'stats' => $this->stats(),
            'academy' => [
                'name' => (string) ($academy->name ?? ''),
                'subdomain' => $academy->subdomain ?? null,
            ],
        ]);
    }

    /**
     * The counters the stats band falls back to when the client hasn't written their own — real
     * numbers, so an unconfigured site still says something true about the academy.
     *
     * @return array<string,int>
     */
    private function stats(): array
    {
        $publishedCourses = DB::table('courses')
            ->where('status', 'PUBLISHED')->whereNull('deleted_at');

        return [
            'courses' => (int) (clone $publishedCourses)->count(),
            'lessons' => (int) DB::table('lessons')
                ->whereIn('course_id', (clone $publishedCourses)->select('id'))
                ->count(),
            'learners' => (int) DB::table('learners')->where('status', 'ACTIVE')->count(),
            'certificates' => (int) DB::table('course_certificates')->count(),
        ];
    }
}
