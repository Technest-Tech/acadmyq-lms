<?php

declare(strict_types=1);

namespace App\Http\Controllers\Lms;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Lms\Concerns\InteractsWithLms;
use App\Support\LmsSite;
use App\Support\LmsSiteProfile;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * The client's editor for their public course site (docs/lms/09) — the write side of the same
 * content the learner site reads. Every LMS client shares one template; this is where they supply
 * their half of it.
 *
 * The subdomain stays Super-Admin-owned (it is the client's address, and handing out addresses is a
 * platform decision), so this controller never touches `academies.subdomain` — it only reports the
 * site URL through LmsSite so the editor can link to "my site".
 *
 * Reads need `course.read` (the whole LMS workspace's read gate); writes need `course.manage`.
 * LmsSiteProfile::sanitize is the only validator: it degrades bad values rather than rejecting a
 * large form wholesale, which is the right trade for marketing copy.
 */
final class SiteProfileController extends Controller
{
    use InteractsWithLms;

    /** GET /api/courses/site — the merged document to edit, plus the site it renders on. */
    public function show(): JsonResponse
    {
        Gate::authorize('course.read');
        $academyId = $this->currentAcademyId();

        return response()->json($this->payload($academyId));
    }

    /** PUT /api/courses/site — replace the client's content with a sanitised document. */
    public function update(Request $request): JsonResponse
    {
        Gate::authorize('course.manage');
        $academyId = $this->currentAcademyId();

        $content = LmsSiteProfile::sanitize($request->all());

        // upsert() writes through RLS like any tenant write; the unique academy_id is the conflict
        // target, so a client's second save updates rather than duplicating their site.
        DB::table('lms_site_profiles')->upsert(
            [[
                'academy_id' => $academyId,
                'content' => json_encode($content),
                'updated_at' => now(),
            ]],
            ['academy_id'],
            ['content', 'updated_at'],
        );

        return response()->json($this->payload($academyId));
    }

    /**
     * The shape both verbs return: the merged document (what the site renders), the structural
     * defaults (so the editor can show what a blank field will fall back to), and the site URL.
     *
     * @return array<string,mixed>
     */
    private function payload(string $academyId): array
    {
        $academy = DB::table('academies')
            ->where('id', $academyId)
            ->first(['name', 'brand_display_name', 'brand_logo_url', 'subdomain']);

        $stored = DB::table('lms_site_profiles')->where('academy_id', $academyId)->value('content');
        $stored = is_string($stored) ? json_decode($stored, true) : $stored;

        $academyArray = $academy === null ? [] : (array) $academy;

        return [
            'content' => LmsSiteProfile::merge(is_array($stored) ? $stored : [], $academyArray),
            'defaults' => LmsSiteProfile::defaults($academyArray),
            'configured' => $stored !== null,
            'site' => LmsSite::block(
                isset($academy->subdomain) ? (string) $academy->subdomain : null,
                LmsSite::ownsRoot($academyId),
            ),
        ];
    }
}
