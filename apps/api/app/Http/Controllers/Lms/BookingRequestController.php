<?php

declare(strict_types=1);

namespace App\Http\Controllers\Lms;

use App\Http\Controllers\Controller;
use App\Http\Controllers\Lms\Concerns\InteractsWithLms;
use App\Support\Audit;
use App\Support\DataTable;
use App\Support\Lms\BookingForms;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

/**
 * The booking inbox (docs/lms/13) — every request the course site's forms have taken, from every
 * form, in one queue.
 *
 * `booking.read` opens it; `booking.manage` moves a request along the pipeline
 * (NEW → CONTACTED → CONFIRMED → COMPLETED, or CANCELLED from anywhere), writes the staff note and
 * deletes spam. The pipeline is deliberately not enforced as a strict sequence: a receptionist who
 * confirms on the first call skips CONTACTED, and one who clicked the wrong status has to be able
 * to put it back.
 */
final class BookingRequestController extends Controller
{
    use InteractsWithLms;

    /** GET /api/courses/bookings — the server-driven inbox (search / filter / sort / page). */
    public function index(Request $request): JsonResponse
    {
        Gate::authorize('booking.read');

        $query = DB::table('booking_requests as r')
            ->leftJoin('booking_forms as f', 'f.id', '=', 'r.form_id')
            ->leftJoin('courses as c', 'c.id', '=', 'r.course_id')
            ->select([
                'r.*',
                'f.slug as form_slug',
                // The live title when the form still exists, else the snapshot it was made under.
                DB::raw('coalesce(f.title, r.form_title) as form_name'),
                DB::raw('coalesce(c.title, r.course_title) as course_name'),
            ]);

        $result = DataTable::paginate($query, $request, [
            'idColumn' => 'r.id',
            'searchable' => ['r.full_name', 'r.phone', 'r.email', 'r.course_title', 'r.choice',
                'r.message', 'r.form_title'],
            'sortable' => [
                'created_at' => 'r.created_at',
                'status' => 'r.status',
                'preferred_date' => 'r.preferred_date',
                'full_name' => 'r.full_name',
            ],
            'filters' => [
                'status' => fn ($q, $v) => $q->where('r.status', strtoupper((string) $v)),
                'form_id' => fn ($q, $v) => $q->where('r.form_id', (string) $v),
                'course_id' => fn ($q, $v) => $q->where('r.course_id', (string) $v),
                'from' => fn ($q, $v) => $q->whereDate('r.created_at', '>=', (string) $v),
                'to' => fn ($q, $v) => $q->whereDate('r.created_at', '<=', (string) $v),
                // The tab the screen opens on: everything that still owes the visitor something.
                'open' => fn ($q, $v) => filter_var($v, FILTER_VALIDATE_BOOLEAN)
                    ? $q->whereIn('r.status', BookingForms::OPEN_STATUSES)
                    : $q,
            ],
            'defaultSort' => '-created_at',
        ]);

        $result['rows'] = $result['rows']->map(fn (object $r): array => $this->rowDto($r));

        return response()->json($result);
    }

    /**
     * GET /api/courses/bookings/summary — the counts the tabs, the stat tiles and the sidebar badge
     * read. `new` is the badge: derived state, it clears when someone actually picks the request up,
     * not when they glance at the list.
     */
    public function summary(): JsonResponse
    {
        Gate::authorize('booking.read');

        $totals = DB::table('booking_requests')
            ->selectRaw('count(*) as total')
            ->selectRaw("count(*) filter (where status = 'NEW') as new")
            ->selectRaw("count(*) filter (where status = 'CONTACTED') as contacted")
            ->selectRaw("count(*) filter (where status = 'CONFIRMED') as confirmed")
            ->selectRaw("count(*) filter (where status = 'COMPLETED') as completed")
            ->selectRaw("count(*) filter (where status = 'CANCELLED') as cancelled")
            ->selectRaw("count(*) filter (where created_at >= date_trunc('month', now())) as this_month")
            ->first();

        return response()->json([
            'stats' => [
                'total' => (int) $totals->total,
                'new' => (int) $totals->new,
                'contacted' => (int) $totals->contacted,
                'confirmed' => (int) $totals->confirmed,
                'completed' => (int) $totals->completed,
                'cancelled' => (int) $totals->cancelled,
                'open' => (int) $totals->new + (int) $totals->contacted + (int) $totals->confirmed,
                'this_month' => (int) $totals->this_month,
            ],
            'forms' => DB::table('booking_forms')->count(),
        ]);
    }

    /** GET /api/courses/bookings/{id} — one request, plus the learner account behind it if any. */
    public function show(string $id): JsonResponse
    {
        Gate::authorize('booking.read');

        $row = $this->findRow($id);

        $learner = $row->learner_id === null ? null : DB::table('learners')
            ->where('id', $row->learner_id)
            ->first(['id', 'full_name', 'email', 'phone', 'status', 'created_at']);

        $handler = $row->handled_by === null ? null
            : DB::table('users')->where('id', $row->handled_by)->value('full_name');

        return response()->json([
            'request' => $this->rowDto($row) + [
                'handled_by_name' => $handler,
                'learner' => $learner === null ? null : [
                    'id' => (string) $learner->id,
                    'full_name' => $learner->full_name,
                    'email' => $learner->email,
                    'phone' => $learner->phone,
                    'status' => (string) $learner->status,
                    'since' => $this->iso($learner->created_at),
                ],
            ],
        ]);
    }

    /** PATCH /api/courses/bookings/{id} — move it along the pipeline and/or write the staff note. */
    public function update(Request $request, string $id): JsonResponse
    {
        Gate::authorize('booking.manage');

        $academyId = $this->currentAcademyId();
        $data = $request->validate([
            'status' => ['sometimes', Rule::in(BookingForms::STATUSES)],
            'staff_note' => ['sometimes', 'nullable', 'string', 'max:2000'],
        ]);

        $before = DB::table('booking_requests')->where('id', $id)->first(['status', 'staff_note']);
        if ($before === null) {
            abort(404, 'Booking request not found.');
        }

        $columns = [];
        if (array_key_exists('status', $data) && $data['status'] !== $before->status) {
            $columns['status'] = $data['status'];
            // The DB's clock, not a bound Carbon (which Postgres would read in the session zone).
            $columns['status_changed_at'] = DB::raw('now()');
        }
        if (array_key_exists('staff_note', $data)) {
            $note = $data['staff_note'] === null ? null : trim((string) $data['staff_note']);
            $columns['staff_note'] = $note === '' ? null : $note;
        }

        if ($columns !== []) {
            // Whoever last acted on it is who the visitor has been talking to.
            $columns['handled_by'] = $this->ctx()->userId;
            $columns['updated_at'] = DB::raw('now()');
            DB::table('booking_requests')->where('id', $id)->update($columns);

            $changed = array_intersect_key($columns, array_flip(['status', 'staff_note']));
            Audit::log('lms_booking.update', 'booking_request', $id, $academyId,
                $this->ctx()->userId, $this->ctx()->role,
                after: $changed,
                before: array_intersect_key((array) $before, $changed));
        }

        return response()->json(['ok' => true, 'request' => $this->rowDto($this->findRow($id))]);
    }

    /** DELETE /api/courses/bookings/{id} — for spam and test submissions. Real ones get CANCELLED. */
    public function destroy(string $id): JsonResponse
    {
        Gate::authorize('booking.manage');

        $academyId = $this->currentAcademyId();
        $row = DB::table('booking_requests')->where('id', $id)->first(['full_name', 'phone', 'form_title']);
        if ($row === null) {
            abort(404, 'Booking request not found.');
        }

        DB::table('booking_requests')->where('id', $id)->delete();

        Audit::log('lms_booking.delete', 'booking_request', $id, $academyId,
            $this->ctx()->userId, $this->ctx()->role, before: (array) $row);

        return response()->json(['ok' => true]);
    }

    // ── helpers ─────────────────────────────────────────────────────────────────────────────────

    private function findRow(string $id): object
    {
        $row = DB::table('booking_requests as r')
            ->leftJoin('booking_forms as f', 'f.id', '=', 'r.form_id')
            ->leftJoin('courses as c', 'c.id', '=', 'r.course_id')
            ->where('r.id', $id)
            ->first([
                'r.*',
                'f.slug as form_slug',
                DB::raw('coalesce(f.title, r.form_title) as form_name'),
                DB::raw('coalesce(c.title, r.course_title) as course_name'),
            ]);

        if ($row === null) {
            abort(404, 'Booking request not found.');
        }

        return $row;
    }

    /** @return array<string,mixed> */
    private function rowDto(object $r): array
    {
        return [
            'id' => (string) $r->id,
            'status' => (string) $r->status,
            'form_id' => $r->form_id === null ? null : (string) $r->form_id,
            'form_title' => (string) ($r->form_name ?? $r->form_title),
            'form_slug' => $r->form_slug ?? null,
            'full_name' => (string) $r->full_name,
            'phone' => (string) $r->phone,
            'email' => $r->email,
            'course_id' => $r->course_id === null ? null : (string) $r->course_id,
            'course_title' => $r->course_name ?? $r->course_title,
            'choice' => $r->choice,
            // Wall-clock, exactly as the visitor picked it — see the migration for why it is not a
            // timestamp.
            'preferred_date' => $r->preferred_date === null ? null : substr((string) $r->preferred_date, 0, 10),
            'preferred_time' => $r->preferred_time,
            'message' => $r->message,
            'staff_note' => $r->staff_note,
            'learner_id' => $r->learner_id === null ? null : (string) $r->learner_id,
            'status_changed_at' => $this->iso($r->status_changed_at),
            'created_at' => $this->iso($r->created_at),
            'updated_at' => $this->iso($r->updated_at),
        ];
    }
}
