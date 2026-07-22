<?php

declare(strict_types=1);

namespace App\Http\Controllers\Lms;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Lms\Concerns\InteractsWithLms;
use App\Support\Audit;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Access codes (LMS module, entitled:lms). Staff generate BATCHES of codes scoped to one or more
 * courses, hand them out, and a learner redeems one to enroll (docs/lms/03). `access_code.manage`
 * gates the whole surface; RLS scopes to the academy.
 */
final class CodeController extends Controller
{
    use InteractsWithLms;

    /** A code alphabet without ambiguous characters (no 0/O, 1/I/L). */
    private const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

    /** GET /api/courses/codes — the code list with live redemption counts + which courses each unlocks. */
    public function index(): JsonResponse
    {
        Gate::authorize('access_code.manage');

        $codes = DB::table('access_codes')
            ->orderByDesc('created_at')
            ->get()
            ->map(fn (object $c): array => $this->present($c));

        return response()->json(['codes' => $codes]);
    }

    /** POST /api/courses/codes/batch — generate N codes for the given course(s). */
    public function batch(Request $request): JsonResponse
    {
        Gate::authorize('access_code.manage');

        $academyId = $this->currentAcademyId();
        $data = $request->validate([
            'course_ids' => ['required', 'array', 'min:1'],
            'course_ids.*' => ['uuid'],
            'count' => ['required', 'integer', 'min:1', 'max:500'],
            'max_redemptions' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:100000'],
            'expires_at' => ['sometimes', 'nullable', 'date'],
            'label' => ['sometimes', 'nullable', 'string', 'max:120'],
        ]);

        // Every course must belong to this academy (RLS scopes the check).
        $valid = DB::table('courses')
            ->whereIn('id', $data['course_ids'])
            ->whereNull('deleted_at')
            ->pluck('id')->map('strval')->all();
        if (count($valid) !== count(array_unique($data['course_ids']))) {
            throw ValidationException::withMessages(['course_ids' => ['One or more courses were not found.']]);
        }

        $created = [];
        for ($i = 0; $i < (int) $data['count']; $i++) {
            $codeId = (string) Str::uuid();
            $code = $this->uniqueCode($academyId);
            DB::table('access_codes')->insert([
                'id' => $codeId,
                'academy_id' => $academyId,
                'code' => $code,
                'label' => $data['label'] ?? null,
                'max_redemptions' => $data['max_redemptions'] ?? null,
                'expires_at' => $data['expires_at'] ?? null,
                'is_active' => true,
                'created_by' => $this->ctx()->userId,
            ]);
            foreach ($valid as $courseId) {
                DB::table('access_code_courses')->insert([
                    'academy_id' => $academyId,
                    'code_id' => $codeId,
                    'course_id' => $courseId,
                ]);
            }
            $created[] = ['id' => $codeId, 'code' => $code];
        }

        Audit::log('access_code.batch', 'access_code', null, $academyId, $this->ctx()->userId, $this->ctx()->role,
            after: ['count' => (int) $data['count'], 'course_ids' => $valid, 'label' => $data['label'] ?? null]);

        return response()->json(['codes' => $created], 201);
    }

    /** PATCH /api/courses/codes/{id} — toggle active / edit label / expiry. */
    public function update(Request $request, string $id): JsonResponse
    {
        Gate::authorize('access_code.manage');

        $academyId = $this->currentAcademyId();
        $code = DB::table('access_codes')->where('id', $id)->first();
        if ($code === null) {
            abort(404, 'Code not found.');
        }

        $data = $request->validate([
            'is_active' => ['sometimes', 'boolean'],
            'label' => ['sometimes', 'nullable', 'string', 'max:120'],
            'expires_at' => ['sometimes', 'nullable', 'date'],
        ]);
        if ($data === []) {
            return response()->json(['ok' => true]);
        }

        DB::table('access_codes')->where('id', $id)->update($data + ['updated_at' => now()]);

        Audit::log('access_code.update', 'access_code', $id, $academyId, $this->ctx()->userId, $this->ctx()->role,
            after: $data);

        return response()->json(['ok' => true]);
    }

    /** DELETE /api/courses/codes/{id}. */
    public function destroy(string $id): JsonResponse
    {
        Gate::authorize('access_code.manage');

        $academyId = $this->currentAcademyId();
        $code = DB::table('access_codes')->where('id', $id)->first(['id', 'code']);
        if ($code === null) {
            abort(404, 'Code not found.');
        }

        DB::table('access_codes')->where('id', $id)->delete();

        Audit::log('access_code.delete', 'access_code', $id, $academyId, $this->ctx()->userId, $this->ctx()->role,
            before: ['code' => $code->code]);

        return response()->json(['ok' => true]);
    }

    // ── internals ────────────────────────────────────────────────────────────

    /** @return array<string,mixed> */
    private function present(object $c): array
    {
        $courses = DB::table('access_code_courses as acc')
            ->join('courses as co', 'co.id', '=', 'acc.course_id')
            ->where('acc.code_id', $c->id)
            ->pluck('co.title')->all();

        return [
            'id' => (string) $c->id,
            'code' => (string) $c->code,
            'label' => $c->label,
            'max_redemptions' => $c->max_redemptions !== null ? (int) $c->max_redemptions : null,
            'redemptions_count' => (int) $c->redemptions_count,
            'expires_at' => $c->expires_at !== null ? \Illuminate\Support\Carbon::parse($c->expires_at)->utc()->toIso8601String() : null,
            'is_active' => (bool) $c->is_active,
            'course_titles' => $courses,
        ];
    }

    /** A per-academy-unique code like "K7F3-QD9M". */
    private function uniqueCode(string $academyId): string
    {
        for ($attempt = 0; $attempt < 20; $attempt++) {
            $raw = '';
            for ($i = 0; $i < 8; $i++) {
                $raw .= self::ALPHABET[random_int(0, strlen(self::ALPHABET) - 1)];
            }
            $code = substr($raw, 0, 4).'-'.substr($raw, 4, 4);
            if (DB::table('access_codes')->where('academy_id', $academyId)->where('code', $code)->doesntExist()) {
                return $code;
            }
        }

        // Astronomically unlikely; fall back to a longer random tail.
        return 'C-'.strtoupper(Str::random(10));
    }
}
