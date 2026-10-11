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

        // Statuses of any uploaded media the served lessons reference (so the player knows an
        // upload is READY before it asks for a playback url). One query, RLS-scoped.
        $mediaIds = $lessons->pluck('media_asset_id')->filter()->map('strval')->unique()->all();
        $mediaStatus = $mediaIds === []
            ? []
            : DB::table('media_assets')->whereIn('id', $mediaIds)->pluck('status', 'id')->all();

        // How many questions hang off each lesson (a QUIZ lesson's, or another lesson's optional
        // ones) — so the player knows to render them without a request per lesson.
        $quizIds = $lessons->pluck('quiz_id')->filter()->map('strval')->unique()->all();
        $questionCounts = $quizIds === []
            ? []
            : DB::table('quiz_questions')->whereIn('quiz_id', $quizIds)
                ->groupBy('quiz_id')->selectRaw('quiz_id, count(*) as n')->pluck('n', 'quiz_id')->all();

        $bySection = [];
        foreach ($lessons as $l) {
            $bySection[(string) $l->section_id][] = $this->presentLesson($l, $includeContent, $mediaStatus, $questionCounts);
        }

        return $sections->map(fn (object $s): array => [
            'id' => (string) $s->id,
            'title' => (string) $s->title,
            'lessons' => $bySection[(string) $s->id] ?? [],
        ])->all();
    }

    /**
     * @param  array<string,string>  $mediaStatus  media_asset_id → status
     * @param  array<string,int|string>  $questionCounts  quiz_id → question count
     * @return array<string,mixed>
     */
    protected function presentLesson(object $l, bool $includeContent, array $mediaStatus = [], array $questionCounts = []): array
    {
        $out = [
            'id' => (string) $l->id,
            'title' => (string) $l->title,
            'type' => (string) $l->type,
            'is_preview' => (bool) $l->is_preview,
            'duration_seconds' => $l->duration_seconds !== null ? (int) $l->duration_seconds : null,
            // A count, never the questions: those come from /lessons/{id}/quiz, enrollment-gated.
            'question_count' => $l->quiz_id !== null ? (int) ($questionCounts[(string) $l->quiz_id] ?? 0) : 0,
        ];

        // Content is served for enrolled viewers, or for a free-preview lesson to anyone.
        if ($includeContent || (bool) $l->is_preview) {
            $out['youtube_video_id'] = $l->youtube_video_id;
            $out['body'] = $l->body;
            $out['attachment_path'] = $l->attachment_path;
            // Uploaded media (VIDEO_UPLOAD / uploaded AUDIO): expose only whether it's READY — never
            // the storage key. The client fetches a short-lived playback url from /lessons/{id}/playback.
            if ($l->media_asset_id !== null) {
                $out['has_media'] = true;
                $out['media_status'] = (string) ($mediaStatus[(string) $l->media_asset_id] ?? 'PENDING');
            }
        }

        return $out;
    }
}
