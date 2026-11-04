<?php

declare(strict_types=1);

namespace App\Http\Controllers\Rooms;

use App\Http\Controllers\Controller;
use App\Services\Rooms;
use App\Support\Audit;
use App\Support\AuthContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * The centre's rooms (docs/centre-profile/02-COHERENCE-AUDIT §3) — a Settings list like the
 * levels: add, rename, set a capacity, reorder, switch off, delete. Behind `entitled:centre`; anyone
 * who reads groups sees the list (the group form and the timetable render the dropdown), writes
 * need `specialization.manage` like every other Settings list. A room that groups sit in cannot
 * be deleted, only switched off: their timetable must keep naming a room.
 */
final class RoomController extends Controller
{
    public function __construct(private readonly Rooms $rooms) {}

    /** GET /api/rooms — the list in order, with how many groups sit in each. */
    public function index(): JsonResponse
    {
        if (! Gate::any(['group.read', 'specialization.manage', 'settings.manage'])) {
            abort(403, 'This action is unauthorized.');
        }

        $rows = DB::table('academy_rooms as r')
            ->select(['r.id', 'r.name', 'r.capacity', 'r.position', 'r.is_active'])
            ->selectRaw("(select count(*) from class_groups g where g.room_id = r.id) as groups_count")
            ->orderBy('r.position')->orderBy('r.created_at')
            ->get()
            ->map(fn ($r) => $this->present($r));

        return response()->json(['rooms' => $rows]);
    }

    /** POST /api/rooms — add one; it lands at the end of the list unless a position is given. */
    public function store(Request $request): JsonResponse
    {
        Gate::authorize('specialization.manage');

        $data = $this->validatePayload($request, creating: true);
        $ctx = app(AuthContext::class);
        $academyId = $this->academyId($ctx);
        $name = trim($data['name']);
        $this->assertNameFree($name);

        $id = (string) Str::uuid();
        DB::table('academy_rooms')->insert([
            'id' => $id,
            'academy_id' => $academyId,
            'name' => $name,
            'capacity' => $data['capacity'] ?? null,
            'position' => $data['position'] ?? ((int) DB::table('academy_rooms')->max('position') + 1),
            'is_active' => true,
        ]);

        Audit::log('room.created', 'academy_room', $id, $academyId, $ctx->userId, $ctx->role, after: ['name' => $name, 'capacity' => $data['capacity'] ?? null]);

        return response()->json(['roomId' => $id], 201);
    }

    /**
     * PATCH /api/rooms/{id} — rename, set the capacity, reorder or switch on/off. A rename follows
     * into the groups' `location` text, so every surface that prints the text keeps saying the
     * same thing as the list.
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
        foreach (['capacity', 'position', 'is_active'] as $col) {
            if (array_key_exists($col, $data)) {
                $before[$col] = $existing->{$col};
                $update[$col] = $data[$col];
            }
        }
        if ($update === []) {
            return response()->json(['ok' => true]);
        }

        DB::transaction(function () use ($id, $update, $existing): void {
            DB::table('academy_rooms')->where('id', $id)->update($update + ['updated_at' => now()]);
            if (isset($update['name']) && $update['name'] !== $existing->name) {
                DB::table('class_groups')->where('room_id', $id)->update(['location' => $update['name'], 'updated_at' => now()]);
            }
        });
        Audit::log('room.updated', 'academy_room', $id, $academyId, $ctx->userId, $ctx->role, after: $update, before: $before);

        return response()->json(['ok' => true]);
    }

    /** DELETE /api/rooms/{id} — only a room no group sits in; otherwise 422 (switch it off instead). */
    public function destroy(string $id): JsonResponse
    {
        Gate::authorize('specialization.manage');

        $ctx = app(AuthContext::class);
        $academyId = $this->academyId($ctx);
        $existing = $this->find($id);

        $usage = $this->rooms->usage($id);
        if ($usage['groups'] > 0) {
            throw ValidationException::withMessages([
                'room' => ['This room is in use ('.$usage['groups'].' groups) — switch it off instead. / هذه القاعة مستخدمة ('.$usage['groups'].' مجموعة) — أوقفها بدلًا من حذفها.'],
            ]);
        }

        DB::table('academy_rooms')->where('id', $id)->delete();
        Audit::log('room.deleted', 'academy_room', $id, $academyId, $ctx->userId, $ctx->role, before: ['name' => $existing->name]);

        return response()->json(['ok' => true]);
    }

    private function present(object $r): array
    {
        return [
            'id' => (string) $r->id,
            'name' => (string) $r->name,
            'capacity' => $r->capacity !== null ? (int) $r->capacity : null,
            'position' => (int) $r->position,
            'is_active' => (bool) $r->is_active,
            'groups_count' => (int) ($r->groups_count ?? 0),
        ];
    }

    private function find(string $id): object
    {
        $row = DB::table('academy_rooms')->where('id', $id)->first();
        if ($row === null) {
            abort(404, 'Room not found.');
        }

        return $row;
    }

    /** Names are unique per academy, case- and space-blind — "room 3" and " Room 3 " are one room. */
    private function assertNameFree(string $name, ?string $except = null): void
    {
        $dupe = DB::table('academy_rooms')
            ->when($except !== null, fn ($q) => $q->where('id', '!=', $except))
            ->whereRaw('lower(btrim(name)) = ?', [mb_strtolower($name)])
            ->exists();
        if ($dupe) {
            throw ValidationException::withMessages(['name' => ['That room already exists. / هذه القاعة موجودة بالفعل.']]);
        }
    }

    private function academyId(AuthContext $ctx): string
    {
        if ($ctx->academyId === null) {
            abort(403, 'Enter an academy to manage its rooms.');
        }

        return $ctx->academyId;
    }

    /** @return array<string,mixed> */
    private function validatePayload(Request $request, bool $creating): array
    {
        $req = $creating ? 'required' : 'sometimes';

        return $request->validate([
            'name' => [$req, 'string', 'min:1', 'max:120'],
            'capacity' => ['sometimes', 'nullable', 'integer', 'min:1', 'max:10000'],
            'position' => ['sometimes', 'integer', 'min:0', 'max:100000'],
            'is_active' => ['sometimes', 'boolean'],
        ]);
    }
}
