<?php

declare(strict_types=1);

namespace App\Http\Controllers\Lms\Concerns;

use App\Support\AuthContext;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Shared helpers for the LMS controllers (docs/lms). Like the CRM/scheduling controllers they run
 * inside the current request's tenant context (Owner's academy, or the academy a Super Admin
 * entered), so RLS already scopes every query and is the backstop on every write. Capability checks
 * (`course.read` / `course.manage` / …) are the controller's job via Gate::authorize.
 */
trait InteractsWithLms
{
    protected function ctx(): AuthContext
    {
        return app(AuthContext::class);
    }

    /** The academy this request is scoped to (Owner's home, or the entered academy). */
    protected function currentAcademyId(): string
    {
        $id = $this->ctx()->academyId;
        if ($id === null) {
            abort(403, 'Enter an academy to manage its courses.');
        }

        return $id;
    }

    /**
     * The current academy's billing currency (ISO 4217) — the denomination of every course price.
     * There is no per-course currency: a client sells in its own currency, so course prices carry
     * this at read time rather than storing it per row. Memoised for the request.
     */
    protected function academyCurrency(): string
    {
        return $this->academyCurrency ??= (string) (DB::table('academies')
            ->where('id', $this->currentAcademyId())
            ->value('default_currency') ?? 'USD');
    }

    private ?string $academyCurrency = null;

    /**
     * Load a course in the current academy (RLS scopes it) or 404. Excludes soft-deleted rows.
     */
    protected function findCourse(string $courseId): object
    {
        $course = DB::table('courses')->where('id', $courseId)->whereNull('deleted_at')->first();
        if ($course === null) {
            abort(404, 'Course not found.');
        }

        return $course;
    }

    /**
     * A slug unique within the academy, derived from $title. Falls back to a short random suffix
     * when the base (or an existing course) already owns it. `$ignoreId` lets an edit keep its slug.
     */
    protected function uniqueCourseSlug(string $academyId, string $title, ?string $ignoreId = null): string
    {
        return $this->uniqueSlugIn('courses', $academyId, $title, 'course', $ignoreId);
    }

    /**
     * The same rule for any slugged, academy-unique catalogue table — courses and digital products
     * both put their slug in the last path segment of a public URL, so they share one generator
     * rather than two that can drift on the fallback shape.
     */
    protected function uniqueSlugIn(
        string $table,
        string $academyId,
        string $title,
        string $fallback,
        ?string $ignoreId = null,
    ): string {
        $base = Str::slug($title);
        if ($base === '') {
            $base = $fallback;
        }

        $slug = $base;
        $suffix = 2;
        while ($this->slugTaken($table, $academyId, $slug, $ignoreId)) {
            $slug = $base.'-'.$suffix;
            $suffix++;
            if ($suffix > 50) {
                $slug = $base.'-'.Str::lower(Str::random(6));
                break;
            }
        }

        return $slug;
    }

    private function slugTaken(string $table, string $academyId, string $slug, ?string $ignoreId): bool
    {
        return DB::table($table)
            ->where('academy_id', $academyId)
            ->where('slug', $slug)
            ->when($ignoreId !== null, fn ($q) => $q->where('id', '!=', $ignoreId))
            ->exists();
    }

    /** Parse the 11-char YouTube video id out of a URL (or accept a bare id). Null if unrecognised. */
    protected function parseYoutubeId(string $input): ?string
    {
        $input = trim($input);
        if (preg_match('/^[A-Za-z0-9_-]{11}$/', $input)) {
            return $input;
        }
        if (preg_match('~(?:youtu\.be/|v=|/embed/|/shorts/)([A-Za-z0-9_-]{11})~', $input, $m)) {
            return $m[1];
        }

        return null;
    }

    /** ISO-8601 UTC (or null) — the timestamp shape the web client expects. */
    protected function iso(mixed $value): ?string
    {
        return $value === null ? null : Carbon::parse($value)->utc()->toIso8601String();
    }
}
