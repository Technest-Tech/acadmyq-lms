<?php

declare(strict_types=1);

namespace App\Http\Controllers\Lms;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Lms\Concerns\InteractsWithLms;
use App\Support\Audit;
use App\Support\DataTable;
use App\Support\LmsMedia;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Courses (LMS module, entitled:lms). A course is a publishable unit of learning — sections of
 * lessons (video / YouTube / audio / PDF / text / quiz) an academy's learners watch on the public
 * subdomain (docs/lms). This controller is the authoring side: staff build and publish courses.
 *
 * Two capabilities gate the surface: `course.read` (list + open the editor) and `course.manage`
 * (create / edit / publish / archive / delete). Both are OWNER-only by default, delegated to a
 * course-team employee through a custom role. RLS scopes every query to the current academy.
 */
final class CourseController extends Controller
{
    use InteractsWithLms;

    private const STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'];

    /** A sanity ceiling on a course price: 10,000,000 major units in minor (e.g. 10M EGP). */
    private const MAX_PRICE_MINOR = 1_000_000_000;

    /** How hard the course is — a closed set, because the catalogue filters on it. */
    private const LEVELS = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'ALL_LEVELS'];

    /** The three sales lists (docs/lms/09 §4) and how many bullets each may hold. */
    private const SALES_LISTS = ['outcomes' => 12, 'requirements' => 8, 'audience' => 8];

    /** GET /api/courses — the server-driven list view. */
    public function index(Request $request): JsonResponse
    {
        Gate::authorize('course.read');

        $query = DB::table('courses as c')
            ->whereNull('c.deleted_at')
            ->select([
                'c.id', 'c.title', 'c.slug', 'c.subtitle', 'c.status',
                'c.cover_image_path', 'c.price_minor', 'c.checkout_enabled', 'c.code_enabled',
                'c.published_at', 'c.created_at',
                DB::raw('(select count(*) from lessons l where l.course_id = c.id) as lesson_count'),
            ]);

        $result = DataTable::paginate($query, $request, [
            'idColumn' => 'c.id',
            'searchable' => ['c.title', 'c.subtitle'],
            'sortable' => [
                'created_at' => 'c.created_at',
                'title' => 'c.title',
                'status' => 'c.status',
            ],
            'filters' => [
                'status' => fn ($q, $value) => $q->where('c.status', strtoupper((string) $value)),
            ],
            'defaultSort' => '-created_at',
        ]);

        // One query for the whole page, not one per row.
        $acceptsPayments = $this->hasActivePaymentMethod();
        $result['rows'] = $result['rows']
            ->map(fn (object $r): object => $this->presentCourse($r, $acceptsPayments));

        return response()->json($result);
    }

    /** GET /api/courses/summary — headline counts for the page. */
    public function summary(): JsonResponse
    {
        Gate::authorize('course.read');

        $byStatus = DB::table('courses')
            ->whereNull('deleted_at')
            ->select('status', DB::raw('count(*) as c'))
            ->groupBy('status')
            ->pluck('c', 'status');

        $counts = [];
        foreach (self::STATUSES as $status) {
            $counts[strtolower($status)] = (int) ($byStatus[$status] ?? 0);
        }

        // The academy currency travels with the summary so the "new course" form can label its price
        // field even before the first course (and thus the first priced row) exists.
        return response()->json($counts + [
            'total' => array_sum($counts),
            'currency' => $this->academyCurrency(),
        ]);
    }

    /** POST /api/courses — create a draft course. */
    public function store(Request $request): JsonResponse
    {
        Gate::authorize('course.manage');

        $academyId = $this->currentAcademyId();
        $data = $request->validate([
            'title' => ['required', 'string', 'max:255'],
            'subtitle' => ['sometimes', 'nullable', 'string', 'max:255'],
            'description' => ['sometimes', 'nullable', 'string', 'max:10000'],
            // Integer minor units, in the academy's currency. 0 (or omitted) = free.
            'price_minor' => ['sometimes', 'integer', 'min:0', 'max:'.self::MAX_PRICE_MINOR],
            // How this course may be unlocked (docs/lms/10 §1). Both default on: checkout is the
            // main door, codes stay for offline sales, and a course can offer either or both.
            'checkout_enabled' => ['sometimes', 'boolean'],
            'code_enabled' => ['sometimes', 'boolean'],
        ] + $this->coverRules() + $this->salesRules());

        $courseId = (string) Str::uuid();
        DB::table('courses')->insert([
            'id' => $courseId,
            'academy_id' => $academyId,
            'title' => trim($data['title']),
            'slug' => $this->uniqueCourseSlug($academyId, $data['title']),
            'subtitle' => $data['subtitle'] ?? null,
            'description' => $data['description'] ?? null,
            'price_minor' => $data['price_minor'] ?? 0,
            'checkout_enabled' => $data['checkout_enabled'] ?? true,
            'code_enabled' => $data['code_enabled'] ?? true,
            'cover_image_path' => $this->resolveCover($data),
            'status' => 'DRAFT',
            'created_by' => $this->ctx()->userId,
        ] + $this->salesColumns($data));

        Audit::log('course.create', 'course', $courseId, $academyId, $this->ctx()->userId, $this->ctx()->role, after: [
            'title' => $data['title'],
        ]);

        return response()->json(['courseId' => $courseId], 201);
    }

    /** GET /api/courses/{id} — one course with its full section→lesson outline (the editor payload). */
    public function show(string $id): JsonResponse
    {
        Gate::authorize('course.read');

        $course = $this->findCourse($id);

        $sections = DB::table('course_sections')
            ->where('course_id', $id)
            ->orderBy('position')
            ->orderBy('created_at')
            ->get(['id', 'title', 'position']);

        $lessons = DB::table('lessons')
            ->where('course_id', $id)
            ->orderBy('position')
            ->orderBy('created_at')
            ->get([
                'id', 'section_id', 'title', 'type', 'position', 'is_preview',
                'duration_seconds', 'media_asset_id', 'youtube_video_id',
                'attachment_path', 'body', 'quiz_id',
            ]);

        $bySection = [];
        foreach ($lessons as $lesson) {
            $bySection[(string) $lesson->section_id][] = [
                'id' => (string) $lesson->id,
                'title' => (string) $lesson->title,
                'type' => (string) $lesson->type,
                'position' => (int) $lesson->position,
                'is_preview' => (bool) $lesson->is_preview,
                'duration_seconds' => $lesson->duration_seconds !== null ? (int) $lesson->duration_seconds : null,
                'media_asset_id' => $lesson->media_asset_id,
                'youtube_video_id' => $lesson->youtube_video_id,
                'attachment_path' => $lesson->attachment_path,
                'body' => $lesson->body,
                'quiz_id' => $lesson->quiz_id,
            ];
        }

        return response()->json([
            'course' => $this->presentCourse($course),
            'sections' => $sections->map(fn (object $s): array => [
                'id' => (string) $s->id,
                'title' => (string) $s->title,
                'position' => (int) $s->position,
                'lessons' => $bySection[(string) $s->id] ?? [],
            ]),
        ]);
    }

    /** PATCH /api/courses/{id} — edit metadata (title/subtitle/description/slug/cover). */
    public function update(Request $request, string $id): JsonResponse
    {
        Gate::authorize('course.manage');

        $academyId = $this->currentAcademyId();
        $course = $this->findCourse($id);

        $data = $request->validate([
            'title' => ['sometimes', 'string', 'max:255'],
            'subtitle' => ['sometimes', 'nullable', 'string', 'max:255'],
            'description' => ['sometimes', 'nullable', 'string', 'max:10000'],
            'slug' => ['sometimes', 'string', 'max:255', 'regex:/^[a-z0-9-]+$/'],
            // Integer minor units, in the academy's currency. 0 = free.
            'price_minor' => ['sometimes', 'integer', 'min:0', 'max:'.self::MAX_PRICE_MINOR],
            'checkout_enabled' => ['sometimes', 'boolean'],
            'code_enabled' => ['sometimes', 'boolean'],
        ] + $this->coverRules() + $this->salesRules());

        $update = [];
        foreach (['title', 'subtitle', 'description', 'price_minor', 'checkout_enabled', 'code_enabled'] as $field) {
            if (array_key_exists($field, $data)) {
                $update[$field] = is_string($data[$field]) ? trim($data[$field]) : $data[$field];
            }
        }
        $update += $this->salesColumns($data, partial: true);
        // An uploaded cover wins over a pasted url; either being present (even as null) is an edit.
        if (array_key_exists('cover_media_asset_id', $data) || array_key_exists('cover_image_path', $data)) {
            $update['cover_image_path'] = $this->resolveCover($data);
        }
        if (array_key_exists('slug', $data)) {
            $update['slug'] = $this->uniqueCourseSlug($academyId, $data['slug'], $id);
        }

        if ($update === []) {
            return response()->json(['ok' => true, 'changed' => []]);
        }

        DB::table('courses')->where('id', $id)->update($update + ['updated_at' => now()]);

        Audit::log('course.update', 'course', $id, $academyId, $this->ctx()->userId, $this->ctx()->role,
            after: $update, before: ['title' => $course->title]);

        return response()->json(['ok' => true, 'changed' => array_keys($update)]);
    }

    /** POST /api/courses/{id}/publish — set the course's status (DRAFT ↔ PUBLISHED ↔ ARCHIVED). */
    public function setStatus(Request $request, string $id): JsonResponse
    {
        Gate::authorize('course.manage');

        $academyId = $this->currentAcademyId();
        $course = $this->findCourse($id);

        $data = $request->validate([
            'status' => ['required', Rule::in(self::STATUSES)],
        ]);
        $status = $data['status'];

        // Publishing needs at least one lesson — an empty course on the public site is a dead link.
        if ($status === 'PUBLISHED' && DB::table('lessons')->where('course_id', $id)->doesntExist()) {
            return response()->json([
                'message' => 'Add at least one lesson before publishing this course.',
                'errors' => ['status' => ['Add at least one lesson before publishing this course.']],
            ], 422);
        }

        DB::table('courses')->where('id', $id)->update([
            'status' => $status,
            'published_at' => $status === 'PUBLISHED' ? ($course->published_at ?? now()) : $course->published_at,
            'updated_at' => now(),
        ]);

        Audit::log('course.set_status', 'course', $id, $academyId, $this->ctx()->userId, $this->ctx()->role,
            after: ['status' => $status], before: ['status' => $course->status]);

        return response()->json(['ok' => true, 'status' => $status]);
    }

    /** DELETE /api/courses/{id} — soft-delete (enrollments/history outlive an editorial delete). */
    public function destroy(string $id): JsonResponse
    {
        Gate::authorize('course.manage');

        $academyId = $this->currentAcademyId();
        $course = $this->findCourse($id);

        DB::table('courses')->where('id', $id)->update(['deleted_at' => now(), 'updated_at' => now()]);

        Audit::log('course.delete', 'course', $id, $academyId, $this->ctx()->userId, $this->ctx()->role,
            before: ['title' => $course->title, 'status' => $course->status]);

        return response()->json(['ok' => true]);
    }

    // ── internals ────────────────────────────────────────────────────────────

    /** Normalise a course row for the client (ISO timestamps, typed counts, priced money). */
    /**
     * A cover can arrive two ways: as an uploaded IMAGE asset (the normal path — reserve → PUT →
     * confirm, same pipeline as lesson media) or as a plain url. Both land in the one
     * `cover_image_path` column; reads resolve whichever it is via LmsMedia::coverUrl().
     *
     * @return array<string, list<mixed>>
     */
    private function coverRules(): array
    {
        return [
            'cover_media_asset_id' => ['sometimes', 'nullable', 'uuid'],
            'cover_image_path' => ['sometimes', 'nullable', 'string', 'max:1024'],
        ];
    }

    /**
     * The value to store in `cover_image_path` — an uploaded asset's storage key, else the pasted
     * url, else null (clearing the cover). The asset must be a READY IMAGE; RLS already scopes the
     * lookup to this academy, so another tenant's id simply fails the check.
     *
     * @param  array<string,mixed>  $data
     */
    private function resolveCover(array $data): ?string
    {
        $assetId = $data['cover_media_asset_id'] ?? null;
        if ($assetId !== null) {
            $asset = DB::table('media_assets')->where('id', $assetId)
                ->first(['storage_key', 'kind', 'status']);
            if ($asset === null || (string) $asset->kind !== 'IMAGE' || (string) $asset->status !== 'READY') {
                throw ValidationException::withMessages([
                    'cover_media_asset_id' => ['That image is not ready yet — please re-upload it.'],
                ]);
            }

            return (string) $asset->storage_key;
        }

        $url = $data['cover_image_path'] ?? null;

        return is_string($url) && trim($url) !== '' ? trim($url) : null;
    }

    /**
     * Does the client have any live receiving account?
     *
     * Deliberately NOT memoised on the instance: Laravel caches the controller object on the Route,
     * so an instance property outlives the request and would serve a stale answer after the client
     * switched their last method off. A list calls this once and reuses the boolean per row.
     */
    private function hasActivePaymentMethod(): bool
    {
        return DB::table('lms_payment_methods')->where('is_active', true)->exists();
    }

    /**
     * Validation for the sales half of a course (docs/lms/09 §4). Every field is optional and every
     * list may be emptied — a client removing their "what you'll learn" bullets is a real edit, not
     * a mistake, so `[]` has to be accepted as a value rather than treated as "unchanged".
     *
     * @return array<string, list<string>>
     */
    private function salesRules(): array
    {
        $rules = [
            'level' => ['sometimes', 'nullable', Rule::in(self::LEVELS)],
            'category' => ['sometimes', 'nullable', 'string', 'max:80'],
        ];
        foreach (self::SALES_LISTS as $field => $max) {
            $rules[$field] = ['sometimes', 'array', 'max:'.$max];
            // `nullable`, because a repeatable form submits the blank row the user left behind and
            // Laravel's ConvertEmptyStringsToNull turns it into null on the way in. That is an
            // ordinary edit, not a validation failure — `cleanList` drops it.
            $rules[$field.'.*'] = ['nullable', 'string', 'max:300'];
        }

        return $rules;
    }

    /**
     * The validated sales fields as database columns. `$partial` is the PATCH case: only the keys
     * the request actually sent are written, so a form that edits the price alone cannot blank out
     * the outcomes it never showed.
     *
     * @param  array<string,mixed>  $data
     * @return array<string,mixed>
     */
    private function salesColumns(array $data, bool $partial = false): array
    {
        $out = [];

        foreach (['level', 'category'] as $field) {
            if (array_key_exists($field, $data)) {
                $value = is_string($data[$field]) ? trim($data[$field]) : $data[$field];
                $out[$field] = ($value === '' || $value === null) ? null : $value;
            } elseif (! $partial) {
                $out[$field] = null;
            }
        }

        foreach (array_keys(self::SALES_LISTS) as $field) {
            if (array_key_exists($field, $data)) {
                $out[$field] = json_encode($this->cleanList($data[$field]));
            } elseif (! $partial) {
                $out[$field] = '[]';
            }
        }

        return $out;
    }

    /**
     * Trim, drop the blanks a repeatable form leaves behind, and re-index — a stored `[""]` would
     * render as an empty bullet on the sales page.
     *
     * @return list<string>
     */
    private function cleanList(mixed $value): array
    {
        if (! is_array($value)) {
            return [];
        }

        return array_values(array_filter(
            array_map(fn ($v): string => is_string($v) ? trim($v) : '', $value),
            fn (string $v): bool => $v !== '',
        ));
    }

    /**
     * jsonb comes back as a string; the client wants an array. Applied on read so every surface —
     * the editor, the catalogue and the sales page — sees the same shape.
     *
     * @return list<string>
     */
    private function decodeList(mixed $value): array
    {
        if (is_array($value)) {
            return array_values(array_filter($value, 'is_string'));
        }
        $decoded = is_string($value) ? json_decode($value, true) : null;

        return is_array($decoded) ? array_values(array_filter($decoded, 'is_string')) : [];
    }

    private function presentCourse(object $c, ?bool $acceptsPayments = null): object
    {
        $c->created_at = $this->iso($c->created_at ?? null);
        // The column holds a storage key or a url; the client only ever sees a loadable url.
        if (property_exists($c, 'cover_image_path')) {
            $c->cover_image_path = LmsMedia::coverUrl($c->cover_image_path);
        }
        if (property_exists($c, 'published_at')) {
            $c->published_at = $this->iso($c->published_at);
        }
        if (property_exists($c, 'lesson_count')) {
            $c->lesson_count = (int) $c->lesson_count;
        }
        // Price is money: integer minor units + the academy's currency. `is_free` is derived so the
        // client renders a "Free" pill without reimplementing the 0-means-free rule.
        $c->price_minor = (int) ($c->price_minor ?? 0);
        $c->currency = $this->academyCurrency();
        $c->is_free = $c->price_minor === 0;
        // The unlock channels (docs/lms/10 §1). `sells_online` is the honest answer the editor needs:
        // the Buy button also depends on the client having a live receiving account, which is a
        // site-wide fact the course editor cannot see from the row alone.
        if (property_exists($c, 'checkout_enabled')) {
            $c->checkout_enabled = (bool) $c->checkout_enabled;
            $c->code_enabled = (bool) $c->code_enabled;
            $acceptsPayments ??= $this->hasActivePaymentMethod();
            $c->sells_online = $c->checkout_enabled && ! $c->is_free && $acceptsPayments;
        }
        foreach (array_keys(self::SALES_LISTS) as $field) {
            if (property_exists($c, $field)) {
                $c->{$field} = $this->decodeList($c->{$field});
            }
        }

        return $c;
    }
}
