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
 * Platform-level staff department catalog.
 *
 * READ  (GET /api/staff-departments)    — any authenticated user; powers the academy dropdown.
 * WRITE (POST / PATCH / DELETE /admin/) — Super Admin only, guarded by staff_department.manage.
 *
 * Departments are stored as TEXT in `staff.department` (not FK) so renaming or deleting a
 * department never invalidates historical staff records — same pattern as teacher specializations.
 */
final class StaffDepartmentController extends Controller
{
    /** GET /api/staff-departments — active-first list for the academy dropdown. */
    public function index(): JsonResponse
    {
        // Any authenticated user can read the catalog (needed for the staff form dropdown).
        $rows = DB::table('staff_departments')
            ->orderByDesc('is_active')
            ->orderBy('sort_order')
            ->orderBy('name')
            ->get(['id', 'name', 'is_active', 'sort_order']);

        return response()->json(['departments' => $rows]);
    }

    /** POST /api/admin/staff-departments — add a department (Super Admin). */
    public function store(Request $request): JsonResponse
    {
        Gate::authorize('staff_department.manage');

        $data = $request->validate([
            'name'       => ['required', 'string', 'max:120'],
            'sort_order' => ['sometimes', 'integer', 'min:0'],
        ]);

        $name = trim($data['name']);

        if (DB::table('staff_departments')->whereRaw('lower(name) = ?', [mb_strtolower($name)])->exists()) {
            throw ValidationException::withMessages(['name' => ['That department already exists.']]);
        }

        $id = (string) Str::uuid();
        DB::table('staff_departments')->insert([
            'id'         => $id,
            'name'       => $name,
            'sort_order' => $data['sort_order'] ?? 0,
            'is_active'  => true,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $ctx = app(AuthContext::class);
        Audit::log('staff_department.create', 'staff_department', $id, null, $ctx->userId, $ctx->role, after: ['name' => $name]);

        return response()->json(['departmentId' => $id], 201);
    }

    /** PATCH /api/admin/staff-departments/{id} — rename, reorder, or toggle active. */
    public function update(Request $request, string $id): JsonResponse
    {
        Gate::authorize('staff_department.manage');

        $existing = DB::table('staff_departments')->where('id', $id)->first();
        if ($existing === null) {
            abort(404, 'Department not found.');
        }

        $data = $request->validate([
            'name'       => ['sometimes', 'string', 'max:120'],
            'sort_order' => ['sometimes', 'integer', 'min:0'],
            'is_active'  => ['sometimes', 'boolean'],
        ]);

        $update = [];
        $before = [];

        if (array_key_exists('name', $data)) {
            $name = trim($data['name']);
            $dupe = DB::table('staff_departments')
                ->where('id', '!=', $id)
                ->whereRaw('lower(name) = ?', [mb_strtolower($name)])
                ->exists();
            if ($dupe) {
                throw ValidationException::withMessages(['name' => ['That department already exists.']]);
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

        DB::table('staff_departments')->where('id', $id)->update($update + ['updated_at' => now()]);

        $ctx = app(AuthContext::class);
        Audit::log('staff_department.update', 'staff_department', $id, null, $ctx->userId, $ctx->role, after: $update, before: $before);

        return response()->json(['ok' => true]);
    }

    /** DELETE /api/admin/staff-departments/{id} — remove (blocked if still in use). */
    public function destroy(string $id): JsonResponse
    {
        Gate::authorize('staff_department.manage');

        $existing = DB::table('staff_departments')->where('id', $id)->first();
        if ($existing === null) {
            abort(404, 'Department not found.');
        }

        // Guard: refuse if any active staff member still references this department name.
        $inUse = DB::table('staff')
            ->whereRaw('lower(department) = ?', [mb_strtolower((string) $existing->name)])
            ->whereNull('deleted_at')
            ->exists();

        if ($inUse) {
            abort(422, 'This department is still assigned to active staff members. Reassign them first.');
        }

        DB::table('staff_departments')->where('id', $id)->delete();

        $ctx = app(AuthContext::class);
        Audit::log('staff_department.delete', 'staff_department', $id, null, $ctx->userId, $ctx->role, before: ['name' => $existing->name]);

        return response()->json(['ok' => true]);
    }
}
