<?php

declare(strict_types=1);

namespace App\Http\Controllers\Learner\Concerns;

use Illuminate\Support\Facades\DB;

/**
 * Builds the section→lesson outline of a course for the learner site (docs/lms/04). Shared by the
 * public catalog (content withheld unless a lesson is a free preview) and the enrolled player
 * (all content served). RLS already scopes the queries to the subdomain's academy.
 */
trait BuildsCourseOutline
{
    /**
     * @return list<array<string,mixed>>
     */
    protected function outline(string $courseId, bool $includeContent): array
    {
        $sections = DB::table('course_sections')
            ->where('course_id', $courseId)
            ->orderBy('position')->orderBy('created_at')
            ->get(['id', 'title', 'position']);

        $lessons = DB::table('lessons')
            ->where('course_id', $courseId)
            ->orderBy('position')->orderBy('created_at')
            ->get();

        $bySection = [];
        foreach ($lessons as $l) {
            $bySection[(string) $l->section_id][] = $this->presentLesson($l, $includeContent);
        }

        return $sections->map(fn (object $s): array => [
            'id' => (string) $s->id,
            'title' => (string) $s->title,
            'lessons' => $bySection[(string) $s->id] ?? [],
        ])->all();
    }

    /** @return array<string,mixed> */
    protected function presentLesson(object $l, bool $includeContent): array
    {
        $out = [
            'id' => (string) $l->id,
            'title' => (string) $l->title,
            'type' => (string) $l->type,
            'is_preview' => (bool) $l->is_preview,
            'duration_seconds' => $l->duration_seconds !== null ? (int) $l->duration_seconds : null,
        ];

        // Content is served for enrolled viewers, or for a free-preview lesson to anyone.
        if ($includeContent || (bool) $l->is_preview) {
            $out['youtube_video_id'] = $l->youtube_video_id;
            $out['body'] = $l->body;
            $out['attachment_path'] = $l->attachment_path;
        }

        return $out;
    }
}
