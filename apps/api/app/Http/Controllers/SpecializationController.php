<?php

declare(strict_types=1);

namespace App\Http\Controllers;

use App\Support\Audit;
use App\Support\AuthContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Per-academy teacher specializations — a small tenant-scoped catalog managed from the
 * Settings page. RLS scopes every row to the caller's academy; reads are open to anyone who
 * can read teachers (so the teacher form can render the dropdown), writes require
 * `specialization.manage`. Soft-deactivation, not deletion, keeps a teacher's stored value
 * meaningful even after its option is retired.
 */
final class SpecializationController extends Controller
{
    /** GET /api/specializations — list (active first, then by sort_order/name). */
    public function index(): JsonResponse
    {
        Gate::authorize('teacher.read');

        $rows = DB::table('specializations')
            ->orderByDesc('is_active')
            ->orderBy('sort_order')
            ->orderBy('name')
            ->get(['id', 'name', 'is_active', 'sort_order']);

        return response()->json(['specializations' => $rows]);
    }

    /** POST /api/specializations — add one (name unique per academy, case-insensitive). */
    public function store(Request $request): JsonResponse
    {
        Gate::authorize('specialization.manage');

        $data = $this->validatePayload($request, creating: true);
        $ctx = app(AuthContext::class);
        $academyId = $this->academyId($ctx);

        $name = trim($data['name']);

        $dupe = DB::table('specializations')
            ->whereRaw('lower(name) = ?', [mb_strtolower($name)])
            ->exists();
        if ($dupe) {
            throw ValidationException::withMessages(['name' => ['That specialization already exists.']]);
        }

        $id = (string) Str::uuid();
        DB::table('specializations')->insert([
            'id' => $id,
            'academy_id' => $academyId,
            'name' => $name,
            'sort_order' => $data['sort_order'] ?? 0,
            'is_active' => true,
        ]);

        Audit::log('specialization.manage', 'specialization', $id, $academyId, $ctx->userId, $ctx->role, after: ['name' => $name]);

        return response()->json(['specializationId' => $id], 201);
    }

    /** PATCH /api/specializations/{id} — rename, reorder, or (de)activate. */
    public function update(Request $request, string $id): JsonResponse
    {
        Gate::authorize('specialization.manage');

        $data = $this->validatePayload($request, creating: false);
        $ctx = app(AuthContext::class);
        $academyId = $this->academyId($ctx);

        $existing = DB::table('specializations')->where('id', $id)->first();
        if ($existing === null) {
            abort(404, 'Specialization not found.');
        }

        $update = [];
        $before = [];
        if (array_key_exists('name', $data)) {
            $name = trim($data['name']);
            $dupe = DB::table('specializations')
                ->where('id', '!=', $id)
                ->whereRaw('lower(name) = ?', [mb_strtolower($name)])
                ->exists();
            if ($dupe) {
                throw ValidationException::withMessages(['name' => ['That specialization already exists.']]);
            }
            $before['name'] = $existing->name;
            $update['name'] = $name;
        }
        foreach (['sort_order', 'is_active'] as $col) {
            if (array_key_exists($col, $data)) {
                $before[$col] = $existing->{$col};
                $update[$col] = $data[$col];
            }
        }

        if ($update === []) {
            return response()->json(['ok' => true]);
        }

        DB::table('specializations')->where('id', $id)->update($update + ['updated_at' => now()]);
        Audit::log('specialization.manage', 'specialization', $id, $academyId, $ctx->userId, $ctx->role, after: $update, before: $before);

        return response()->json(['ok' => true]);
    }

    /** DELETE /api/specializations/{id} — hard delete (the teacher's free-text value is unaffected). */
    public function destroy(string $id): JsonResponse
    {
        Gate::authorize('specialization.manage');

        $ctx = app(AuthContext::class);
        $academyId = $this->academyId($ctx);

        $existing = DB::table('specializations')->where('id', $id)->first();
        if ($existing === null) {
            abort(404, 'Specialization not found.');
        }

        DB::table('specializations')->where('id', $id)->delete();
        Audit::log('specialization.manage', 'specialization', $id, $academyId, $ctx->userId, $ctx->role, before: ['name' => $existing->name]);

        return response()->json(['ok' => true]);
    }

    private function academyId(AuthContext $ctx): string
    {
        if ($ctx->academyId === null) {
            abort(403, 'Enter an academy to manage its specializations.');
        }

        return $ctx->academyId;
    }

    /** @return array<string,mixed> */
    private function validatePayload(Request $request, bool $creating): array
    {
        $req = $creating ? 'required' : 'sometimes';

        return $request->validate([
            'name' => [$req, 'string', 'max:120'],
            'sort_order' => ['sometimes', 'integer', 'min:0'],
            'is_active' => ['sometimes', 'boolean'],
        ]);
    }
}
