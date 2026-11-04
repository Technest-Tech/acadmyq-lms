<?php

declare(strict_types=1);

namespace App\Http\Controllers\Groups;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Groups\Concerns\InteractsWithClassGroups;
use App\Services\ClassGroups;
use App\Services\GroupWaitlist;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

/**
 * A full group's waiting list (docs/centre-profile, Phase 2 §2). Behind `entitled:centre` +
 * `entitled:groups`: `group.read` reads the queue (a TEACHER their own groups'), `group.manage`
 * adds, seats, reorders and removes. Seating goes through the members path, so the seat limit is
 * the one the members tab enforces.
 */
final class GroupWaitlistController extends Controller
{
    use InteractsWithClassGroups;

    public function __construct(
        private readonly GroupWaitlist $waitlist,
        private readonly ClassGroups $groups,
    ) {}

    /** GET /api/groups/{id}/waitlist — the WAITING queue in order, and the seats still open. */
    public function index(string $id): JsonResponse
    {
        Gate::authorize('group.read');
        $group = $this->findGroup($id);

        return response()->json($this->payload($group));
    }

    /** POST /api/groups/{id}/waitlist — `student_id` OR `name` (+ `phone`), and a `note`; appended at the end. */
    public function store(Request $request, string $id): JsonResponse
    {
        Gate::authorize('group.manage');

        $group = $this->findGroup($id);
        $data = $request->validate([
            'student_id' => ['sometimes', 'nullable', 'uuid'],
            'name' => ['sometimes', 'nullable', 'string', 'max:120'],
            'phone' => ['sometimes', 'nullable', 'string', 'max:40'],
            'note' => ['sometimes', 'nullable', 'string', 'max:500'],
        ]);

        $entryId = $this->waitlist->add($group, $data, $this->ctx()->userId, $this->ctx()->role);

        return response()->json(['entry_id' => $entryId] + $this->payload($group), 201);
    }

    /** DELETE /api/groups/{id}/waitlist/{entryId} — the name is taken off the list. */
    public function destroy(string $id, string $entryId): JsonResponse
    {
        Gate::authorize('group.manage');

        $group = $this->findGroup($id);
        $this->waitlist->remove($group, $entryId, $this->ctx()->userId, $this->ctx()->role);

        return response()->json($this->payload($group));
    }

    /** POST /api/groups/{id}/waitlist/{entryId}/seat — the student joins the group (`joined_on`, default today). */
    public function seat(Request $request, string $id, string $entryId): JsonResponse
    {
        Gate::authorize('group.manage');

        $group = $this->findGroup($id);
        $data = $request->validate(['joined_on' => ['sometimes', 'nullable', 'date_format:Y-m-d']]);

        $this->waitlist->seat($group, $entryId, $data['joined_on'] ?? null, $this->ctx()->userId, $this->ctx()->role);

        return response()->json($this->payload($this->findGroup($id)) + [
            'group' => app(ClassGroupController::class)->payload($id),
        ]);
    }

    /** PATCH /api/groups/{id}/waitlist/reorder — `ids`, the whole WAITING queue in its new order. */
    public function reorder(Request $request, string $id): JsonResponse
    {
        Gate::authorize('group.manage');

        $group = $this->findGroup($id);
        $data = $request->validate([
            'ids' => ['required', 'array', 'min:1', 'max:500'],
            'ids.*' => ['uuid'],
        ]);

        $this->waitlist->reorder($group, $data['ids'], $this->ctx()->userId, $this->ctx()->role);

        return response()->json($this->payload($group));
    }

    /** @return array<string,mixed> */
    private function payload(object $group): array
    {
        $entries = $this->waitlist->queue((string) $group->id);
        $members = $this->groups->activeMemberCount((string) $group->id);

        return [
            'entries' => $entries,
            'waiting_count' => count($entries),
            'member_count' => $members,
            'capacity' => $group->capacity !== null ? (int) $group->capacity : null,
            'free_seats' => $group->capacity !== null ? max(0, (int) $group->capacity - $members) : null,
        ];
    }
}
