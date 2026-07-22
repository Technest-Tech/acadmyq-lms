<?php

declare(strict_types=1);

namespace App\Http\Controllers\Quality;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Scheduling\Concerns\InteractsWithScheduling;
use App\Support\Audit;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;

/**
 * The quality RUBRIC — the academy's own definition of what "delivering well" means: categories
 * ("Punctuality") holding criteria ("Started the lesson on time"), each criterion carrying the
 * percent docked when the teacher does NOT meet it.
 *
 * Editable forever, which is exactly why {@see \App\Services\TeacherQuality} snapshots names and
 * percents onto each report as it is written: re-pricing "Late to class" from 5% to 20% changes
 * what FUTURE reports cost and never restates one a teacher has already been docked for.
 *
 * The wire speaks PERCENT (`discount_percent: 12.5`) because that is what the rubric means to the
 * person writing it; storage is integer BASIS POINTS, because the number ends up multiplying a
 * teacher's pay and that arithmetic stays exact (AC-1.10). This controller is the only place the
 * two representations meet.
 *
 * Tenant-scoped by RLS. `teacher_quality.read` to see it, `teacher_quality.manage` to shape it.
 */
final class QualityRubricController extends Controller
{
    use InteractsWithScheduling;

    /** percent (12.5) → basis points (1250). The one lossy step, at the input boundary. */
    private function toBasisPoints(float $percent): int
    {
        return (int) round($percent * 100);
    }

    /** GET /api/quality/rubric — the whole rubric, categories with their criteria nested. */
    public function index(Request $request): JsonResponse
    {
        Gate::authorize('teacher_quality.read');

        $includeInactive = $request->boolean('include_inactive');

        $categories = DB::table('teacher_quality_categories')
            ->whereNull('deleted_at')
            ->when(! $includeInactive, fn ($q) => $q->where('is_active', true))
            ->orderBy('sort_order')
            ->orderBy('name')
            ->get(['id', 'name', 'description', 'sort_order', 'is_active']);

        $criteria = DB::table('teacher_quality_criteria')
            ->whereNull('deleted_at')
            ->when(! $includeInactive, fn ($q) => $q->where('is_active', true))
            ->orderBy('sort_order')
            ->orderBy('name')
            ->get(['id', 'category_id', 'name', 'discount_bp', 'sort_order', 'is_active'])
            ->groupBy('category_id');

        $rubric = $categories->map(function (object $category) use ($criteria): array {
            $own = $criteria->get((string) $category->id, collect());

            return [
                'id'          => (string) $category->id,
                'name'        => (string) $category->name,
                'description' => $category->description,
                'sort_order'  => (int) $category->sort_order,
                'is_active'   => (bool) $category->is_active,
                'criteria'    => $own->map(fn (object $c): array => [
                    'id'          => (string) $c->id,
                    'category_id' => (string) $c->category_id,
                    'name'        => (string) $c->name,
                    // Back to percent for the reader; bp is storage, not vocabulary.
                    'discount_percent' => ((int) $c->discount_bp) / 100,
                    'sort_order'       => (int) $c->sort_order,
                    'is_active'        => (bool) $c->is_active,
                ])->values()->all(),
            ];
        })->values()->all();

        return response()->json(['categories' => $rubric]);
    }

    // -------------------------------------------------------------------------
    // Categories
    // -------------------------------------------------------------------------

    /** POST /api/quality/rubric/categories */
    public function storeCategory(Request $request): JsonResponse
    {
        Gate::authorize('teacher_quality.manage');

        $data = $request->validate([
            'name'        => ['required', 'string', 'max:120'],
            'description' => ['nullable', 'string', 'max:500'],
            'sort_order'  => ['sometimes', 'integer', 'min:0', 'max:1000'],
        ]);

        $academyId  = $this->currentAcademyId();
        $categoryId = (string) Str::uuid();

        DB::table('teacher_quality_categories')->insert([
            'id'          => $categoryId,
            'academy_id'  => $academyId,
            'name'        => $data['name'],
            'description' => $data['description'] ?? null,
            'sort_order'  => $data['sort_order'] ?? 0,
            'created_by'  => $this->ctx()->userId,
            'created_at'  => now(),
            'updated_at'  => now(),
        ]);

        Audit::log(
            'teacher_quality.category_created',
            'teacher_quality_category',
            $categoryId,
            $academyId,
            $this->ctx()->userId,
            $this->ctx()->role,
            after: ['name' => $data['name']],
        );

        return response()->json(['categoryId' => $categoryId], 201);
    }

    /** PATCH /api/quality/rubric/categories/{id} */
    public function updateCategory(Request $request, string $id): JsonResponse
    {
        Gate::authorize('teacher_quality.manage');

        $category = $this->findCategory($id);

        $data = $request->validate([
            'name'        => ['sometimes', 'string', 'max:120'],
            'description' => ['sometimes', 'nullable', 'string', 'max:500'],
            'sort_order'  => ['sometimes', 'integer', 'min:0', 'max:1000'],
            'is_active'   => ['sometimes', 'boolean'],
        ]);

        if ($data === []) {
            return response()->json(['ok' => true, 'changed' => []]);
        }

        DB::table('teacher_quality_categories')
            ->where('id', $id)
            ->update($data + ['updated_at' => now()]);

        Audit::log(
            'teacher_quality.category_updated',
            'teacher_quality_category',
            $id,
            $this->currentAcademyId(),
            $this->ctx()->userId,
            $this->ctx()->role,
            before: ['name' => (string) $category->name],
            after: $data,
        );

        return response()->json(['ok' => true, 'changed' => array_keys($data)]);
    }

    /**
     * DELETE /api/quality/rubric/categories/{id} — soft-delete the category and its criteria.
     * Past reports are untouched: they carry their own name/percent snapshots.
     */
    public function destroyCategory(string $id): JsonResponse
    {
        Gate::authorize('teacher_quality.manage');

        $category = $this->findCategory($id);

        DB::table('teacher_quality_criteria')
            ->where('category_id', $id)
            ->whereNull('deleted_at')
            ->update(['deleted_at' => now(), 'updated_at' => now()]);

        DB::table('teacher_quality_categories')
            ->where('id', $id)
            ->update(['deleted_at' => now(), 'updated_at' => now()]);

        Audit::log(
            'teacher_quality.category_deleted',
            'teacher_quality_category',
            $id,
            $this->currentAcademyId(),
            $this->ctx()->userId,
            $this->ctx()->role,
            before: ['name' => (string) $category->name],
        );

        return response()->json(['ok' => true]);
    }

    // -------------------------------------------------------------------------
    // Criteria
    // -------------------------------------------------------------------------

    /** POST /api/quality/rubric/criteria */
    public function storeCriterion(Request $request): JsonResponse
    {
        Gate::authorize('teacher_quality.manage');

        $data = $request->validate([
            'category_id'      => ['required', 'uuid'],
            'name'             => ['required', 'string', 'max:200'],
            'discount_percent' => ['required', 'numeric', 'gt:0', 'max:100'],
            'sort_order'       => ['sometimes', 'integer', 'min:0', 'max:1000'],
        ]);

        // RLS scopes the lookup to this academy, so a foreign category simply isn't found.
        $this->findCategory($data['category_id']);

        $academyId   = $this->currentAcademyId();
        $criterionId = (string) Str::uuid();

        DB::table('teacher_quality_criteria')->insert([
            'id'          => $criterionId,
            'academy_id'  => $academyId,
            'category_id' => $data['category_id'],
            'name'        => $data['name'],
            'discount_bp' => $this->toBasisPoints((float) $data['discount_percent']),
            'sort_order'  => $data['sort_order'] ?? 0,
            'created_at'  => now(),
            'updated_at'  => now(),
        ]);

        Audit::log(
            'teacher_quality.criterion_created',
            'teacher_quality_criterion',
            $criterionId,
            $academyId,
            $this->ctx()->userId,
            $this->ctx()->role,
            after: [
                'category_id'  => $data['category_id'],
                'name'         => $data['name'],
                'discount_bp'  => $this->toBasisPoints((float) $data['discount_percent']),
            ],
        );

        return response()->json(['criterionId' => $criterionId], 201);
    }

    /** PATCH /api/quality/rubric/criteria/{id} */
    public function updateCriterion(Request $request, string $id): JsonResponse
    {
        Gate::authorize('teacher_quality.manage');

        $criterion = $this->findCriterion($id);

        $data = $request->validate([
            'name'             => ['sometimes', 'string', 'max:200'],
            'discount_percent' => ['sometimes', 'numeric', 'gt:0', 'max:100'],
            'sort_order'       => ['sometimes', 'integer', 'min:0', 'max:1000'],
            'is_active'        => ['sometimes', 'boolean'],
        ]);

        if ($data === []) {
            return response()->json(['ok' => true, 'changed' => []]);
        }

        // The client speaks percent; the column stores basis points.
        $patch = $data;
        if (array_key_exists('discount_percent', $patch)) {
            $patch['discount_bp'] = $this->toBasisPoints((float) $patch['discount_percent']);
            unset($patch['discount_percent']);
        }

        DB::table('teacher_quality_criteria')
            ->where('id', $id)
            ->update($patch + ['updated_at' => now()]);

        Audit::log(
            'teacher_quality.criterion_updated',
            'teacher_quality_criterion',
            $id,
            $this->currentAcademyId(),
            $this->ctx()->userId,
            $this->ctx()->role,
            before: [
                'name'        => (string) $criterion->name,
                'discount_bp' => (int) $criterion->discount_bp,
            ],
            after: $patch,
        );

        return response()->json(['ok' => true, 'changed' => array_keys($data)]);
    }

    /** DELETE /api/quality/rubric/criteria/{id} — soft-delete; past reports keep their snapshot. */
    public function destroyCriterion(string $id): JsonResponse
    {
        Gate::authorize('teacher_quality.manage');

        $criterion = $this->findCriterion($id);

        DB::table('teacher_quality_criteria')
            ->where('id', $id)
            ->update(['deleted_at' => now(), 'updated_at' => now()]);

        Audit::log(
            'teacher_quality.criterion_deleted',
            'teacher_quality_criterion',
            $id,
            $this->currentAcademyId(),
            $this->ctx()->userId,
            $this->ctx()->role,
            before: ['name' => (string) $criterion->name],
        );

        return response()->json(['ok' => true]);
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    private function findCategory(string $id): object
    {
        $category = DB::table('teacher_quality_categories')
            ->where('id', $id)
            ->whereNull('deleted_at')
            ->first();

        if ($category === null) {
            abort(404, 'Quality category not found.');
        }

        return $category;
    }

    private function findCriterion(string $id): object
    {
        $criterion = DB::table('teacher_quality_criteria')
            ->where('id', $id)
            ->whereNull('deleted_at')
            ->first();

        if ($criterion === null) {
            abort(404, 'Quality criterion not found.');
        }

        return $criterion;
    }
}
