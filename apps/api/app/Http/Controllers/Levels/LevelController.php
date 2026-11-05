<?php

declare(strict_types=1);

namespace App\Http\Controllers\Levels;

use App\Http\Controllers\Controller;
use App\Services\StudentLevels;
use App\Support\AcademyLevelLabel;
use App\Support\Audit;
use App\Support\AuthContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * The academy's levels / grades (docs/centre-profile, Phase 2.1) — a Settings list like the
 * specializations: add, rename, reorder, switch off, delete. Behind `entitled:centre`; any signed-in
 * academy user reads it (the student and group forms render the dropdown), writes need
 * `specialization.manage` like every other Settings list. A level that students or groups point
 * at cannot be deleted, only switched off: their classification must keep meaning something.
 */
final class LevelController extends Controller
{
    public function __construct(private readonly StudentLevels $levels) {}

    /** GET /api/levels — the list in order, with how many students and groups sit at each. */
    public function index(): JsonResponse
    {
        Gate::authorize('student.read');

        $rows = DB::table('academy_levels as l')
            ->select(['l.id', 'l.name', 'l.sort_order', 'l.is_active'])
            ->selectRaw('(select count(*) from students s where s.level_id = l.id and s.deleted_at is null) as students_count')
            ->selectRaw('(select count(*) from class_groups g where g.level_id = l.id) as groups_count')
            ->orderBy('l.sort_order')->orderBy('l.created_at')
            ->get()
            ->map(fn ($l) => $this->present($l));

        // The word the academy uses for them (Settings → this card), so the list's own screen and
        // every picker name the classification the same way.
        $academyId = app(AuthContext::class)->academyId;

        return response()->json([
            'levels' => $rows,
            'level_label' => $academyId !== null ? AcademyLevelLabel::forAcademy($academyId) : AcademyLevelLabel::LEVEL,
        ]);
    }

    /** POST /api/levels — add one; it lands at the end of the list unless a position is given. */
    public function store(Request $request): JsonResponse
    {
        Gate::authorize('specialization.manage');

        $data = $this->validatePayload($request, creating: true);
        $ctx = app(AuthContext::class);
        $academyId = $this->academyId($ctx);
        $name = trim($data['name']);
        $this->assertNameFree($name);

        $id = (string) Str::uuid();
        DB::table('academy_levels')->insert([
            'id' => $id,
            'academy_id' => $academyId,
            'name' => $name,
            'sort_order' => $data['sort_order'] ?? ((int) DB::table('academy_levels')->max('sort_order') + 1),
            'is_active' => true,
        ]);

        Audit::log('level.created', 'academy_level', $id, $academyId, $ctx->userId, $ctx->role, after: ['name' => $name]);

        return response()->json(['levelId' => $id], 201);
    }

    /**
     * PATCH /api/levels/{id} — rename, reorder or switch on/off. A rename follows into the groups'
     * level text, so every surface that prints the text keeps saying the same thing as the list.
     */
    public function update(Request $request, string $id): JsonResponse
    {
        Gate::authorize('specialization.manage');

        $data = $this->validatePayload($request, creating: false);
        $ctx = app(AuthContext::class);
        $academyId = $this->academyId($ctx);
        $existing = $this->find($id);

        $update = [];
        $before = [];
        if (array_key_exists('name', $data)) {
            $name = trim($data['name']);
            $this->assertNameFree($name, except: $id);
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

        DB::transaction(function () use ($id, $update, $existing): void {
            DB::table('academy_levels')->where('id', $id)->update($update + ['updated_at' => now()]);
            if (isset($update['name']) && $update['name'] !== $existing->name) {
                DB::table('class_groups')->where('level_id', $id)->update(['level' => $update['name'], 'updated_at' => now()]);
            }
        });
        Audit::log('level.updated', 'academy_level', $id, $academyId, $ctx->userId, $ctx->role, after: $update, before: $before);

        return response()->json(['ok' => true]);
    }

    /** DELETE /api/levels/{id} — only a level nobody stands at; otherwise 422 (switch it off instead). */
    public function destroy(string $id): JsonResponse
    {
        Gate::authorize('specialization.manage');

        $ctx = app(AuthContext::class);
        $academyId = $this->academyId($ctx);
        $existing = $this->find($id);

        $usage = $this->levels->usage($id);
        if ($usage['students'] > 0 || $usage['groups'] > 0) {
            throw ValidationException::withMessages([
                'level' => ['This level is in use ('.$usage['students'].' students, '.$usage['groups'].' groups) — switch it off instead. / هذا المستوى مستخدم ('.$usage['students'].' طالب، '.$usage['groups'].' مجموعة) — أوقفه بدلًا من حذفه.'],
            ]);
        }

        DB::table('academy_levels')->where('id', $id)->delete();
        Audit::log('level.deleted', 'academy_level', $id, $academyId, $ctx->userId, $ctx->role, before: ['name' => $existing->name]);

        return response()->json(['ok' => true]);
    }

    private function present(object $l): array
    {
        return [
            'id' => (string) $l->id,
            'name' => (string) $l->name,
            'sort_order' => (int) $l->sort_order,
            'is_active' => (bool) $l->is_active,
            'students_count' => (int) ($l->students_count ?? 0),
            'groups_count' => (int) ($l->groups_count ?? 0),
        ];
    }

    private function find(string $id): object
    {
        $row = DB::table('academy_levels')->where('id', $id)->first();
        if ($row === null) {
            abort(404, 'Level not found.');
        }

        return $row;
    }

    /** Names are unique per academy, case-blind — "a1" and "A1" are one level. */
    private function assertNameFree(string $name, ?string $except = null): void
    {
        $dupe = DB::table('academy_levels')
            ->when($except !== null, fn ($q) => $q->where('id', '!=', $except))
            ->whereRaw('lower(name) = ?', [mb_strtolower($name)])
            ->exists();
        if ($dupe) {
            throw ValidationException::withMessages(['name' => ['That level already exists. / هذا المستوى موجود بالفعل.']]);
        }
    }

    private function academyId(AuthContext $ctx): string
    {
        if ($ctx->academyId === null) {
            abort(403, 'Enter an academy to manage its levels.');
        }

        return $ctx->academyId;
    }

    /** @return array<string,mixed> */
    private function validatePayload(Request $request, bool $creating): array
    {
        $req = $creating ? 'required' : 'sometimes';

        return $request->validate([
            'name' => [$req, 'string', 'min:1', 'max:120'],
            'sort_order' => ['sometimes', 'integer', 'min:0', 'max:100000'],
            'is_active' => ['sometimes', 'boolean'],
        ]);
    }
}
