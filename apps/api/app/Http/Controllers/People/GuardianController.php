<?php

declare(strict_types=1);

namespace App\Http\Controllers\People;

use App\Http\Controllers\Controller;
use App\Http\Controllers\People\Concerns\InteractsWithPeople;
use App\Support\Audit;
use App\Support\DataTable;
use App\Support\Phone;
use Illuminate\Database\Query\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;

/**
 * Guardians — the billing anchor (R-STU-1/2). A guardian owns 1..N students; their currency
 * defaults to the academy default but may differ (AC-4.6). Two-layer authorization: a
 * capability Gate first, RLS as the database backstop. Deactivate-not-delete preserves
 * history; a guardian with active children cannot be deactivated (AC-4.12 / TC-4.6).
 *
 * The list and the detail are both FAMILY-shaped, because that is the unit the academy deals
 * with: the list carries each guardian's active child count (so "the families with three kids"
 * is a question the screen can answer), and the detail returns each child with their teacher and
 * billing terms rather than a bare name — the parents page is where a family is read whole.
 */
final class GuardianController extends Controller
{
    use InteractsWithPeople;

    /**
     * How many ACTIVE students hang off a guardian — the family size. Correlated, so it is one
     * query rather than one per row, and it is a constant (no user input) so raw SQL is safe.
     */
    private const ACTIVE_CHILDREN = '(select count(*) from students c where c.guardian_id = guardians.id and c.deleted_at is null)';

    /**
     * The family's active students as a JSON array, so one card on the parents page can name its
     * children without the screen firing a request per row. Deliberately thin — id, name and
     * lifecycle status only; anything more (teacher, rate) is what opening the family is for.
     */
    private const ACTIVE_CHILDREN_JSON = <<<'SQL'
        (select coalesce(json_agg(json_build_object('id', c.id, 'full_name', c.full_name, 'status', c.status) order by c.full_name), '[]'::json)
           from students c where c.guardian_id = guardians.id and c.deleted_at is null)
        SQL;

    /** GET /api/guardians — server-driven DataTable (search/filter/sort/paginate). */
    public function index(Request $request): JsonResponse
    {
        Gate::authorize('guardian.read');

        $query = DB::table('guardians')
            ->select([
                'id', 'full_name', 'whatsapp_phone', 'country', 'currency', 'notes',
                'deleted_at', 'created_at',
            ])
            ->selectRaw(self::ACTIVE_CHILDREN.' as children_count')
            ->selectRaw(self::ACTIVE_CHILDREN_JSON.' as children');

        // Active-only by default; filter[status]=inactive|all reveals soft-deleted rows (TC-4.5).
        $this->applyActiveScope($query, $request);
        // Searching by a CHILD's name is the parents page's own search — a parent is most often
        // looked up as "Yusuf's dad". DataTable's column search cannot reach another table, so
        // this replaces it and `searchable` is left empty below.
        $this->applyFamilySearch($query, $request);

        $result = DataTable::paginate($query, $request, [
            'searchable' => [],
            // `children` sorts on the selected alias — Postgres resolves an ORDER BY against the
            // output column, so the correlated count is evaluated once, not twice.
            'sortable' => ['name' => 'full_name', 'created_at' => 'created_at', 'children' => 'children_count'],
            'filters' => [
                'currency' => fn ($q, $value) => $q->where('currency', strtoupper((string) $value)),
                'family' => fn ($q, $value) => match ((string) $value) {
                    'multi' => $q->whereRaw(self::ACTIVE_CHILDREN.' >= 2'),
                    'single' => $q->whereRaw(self::ACTIVE_CHILDREN.' = 1'),
                    'none' => $q->whereRaw(self::ACTIVE_CHILDREN.' = 0'),
                    default => $q,
                },
            ],
            'defaultSort' => 'name',
        ]);

        // Postgres hands json_agg back as text; without this the array would reach the client
        // double-encoded, as a string that looks like JSON.
        $result['rows'] = $result['rows']->map(function (object $row): object {
            $row->children = json_decode((string) $row->children, true) ?: [];

            return $row;
        });

        return response()->json($result);
    }

    /** POST /api/guardians — create. */
    public function store(Request $request): JsonResponse
    {
        Gate::authorize('guardian.create');

        $academyId = $this->currentAcademyId();
        $data = $this->validatePayload($request, creating: true);

        $id = (string) Str::uuid();
        $row = [
            'id' => $id,
            'academy_id' => $academyId,
            'full_name' => $data['full_name'],
            'whatsapp_phone' => Phone::normalize($data['whatsapp_phone'], 'whatsapp_phone'),
            'country' => $data['country'] ?? null,
            'currency' => strtoupper($data['currency'] ?? $this->academyDefaultCurrency($academyId)),
            'notes' => $data['notes'] ?? null,
        ];

        DB::table('guardians')->insert($row);
        Audit::log('guardian.create', 'guardian', $id, $academyId, $this->ctx()->userId, $this->ctx()->role, after: [
            'full_name' => $row['full_name'],
            'whatsapp_phone' => $row['whatsapp_phone'],
            'currency' => $row['currency'],
        ]);

        return response()->json(['guardianId' => $id], 201);
    }

    /**
     * GET /api/guardians/{id} — the family file: the billing contact, and every child with the
     * details you would otherwise open four student profiles to read (teacher, plan, rate,
     * lifecycle status). Money is blanked for a role that may not price (SUPERVISOR/STAFF), the
     * same redaction the students list applies — the keys stay present and null so a redacted
     * child never reads as "no subscription".
     */
    public function show(string $id): JsonResponse
    {
        Gate::authorize('guardian.read');

        $guardian = DB::table('guardians')->where('id', $id)->first();
        if ($guardian === null) {
            abort(404, 'Guardian not found.');
        }

        $seesPricing = Gate::allows('student.set_price');

        $children = DB::table('students as s')
            ->leftJoin('subscriptions as sub', function ($j): void {
                $j->on('sub.student_id', '=', 's.id')
                    ->whereNull('sub.deleted_at')
                    ->where('sub.status', '=', 'ACTIVE');
            })
            ->leftJoin('student_teacher_assignments as sta', function ($j): void {
                $j->on('sta.student_id', '=', 's.id')->whereNull('sta.ended_at');
            })
            ->leftJoin('teachers as t', 't.id', '=', 'sta.teacher_id')
            ->where('s.guardian_id', $id)
            // Active children first, then by name: a family's current students are the point,
            // and the ones who left sit underneath rather than interleaved alphabetically.
            ->orderByRaw('(s.deleted_at is not null)')
            ->orderBy('s.full_name')
            ->get([
                's.id', 's.full_name', 's.whatsapp_phone', 's.country', 's.status',
                's.is_self_guardian', 's.notes', 's.deleted_at', 's.created_at',
                'sta.teacher_id', 't.full_name as teacher_name',
                'sub.id as subscription_id', 'sub.plan_label', 'sub.sessions_per_month',
                'sub.price_minor', 'sub.currency as price_currency', 'sub.price_basis',
                'sub.start_date',
            ])
            ->map(function (object $row) use ($seesPricing): object {
                if (! $seesPricing) {
                    $row->price_minor = null;
                    $row->price_currency = null;
                    $row->price_basis = null;
                }

                return $row;
            });

        return response()->json(['guardian' => $guardian, 'children' => $children]);
    }

    /** PATCH /api/guardians/{id} — edit; before/after audit of exactly the changed fields. */
    public function update(Request $request, string $id): JsonResponse
    {
        Gate::authorize('guardian.update');

        $existing = DB::table('guardians')->where('id', $id)->first();
        if ($existing === null) {
            abort(404, 'Guardian not found.');
        }

        $data = $this->validatePayload($request, creating: false);
        if (array_key_exists('whatsapp_phone', $data)) {
            $data['whatsapp_phone'] = Phone::normalize($data['whatsapp_phone'], 'whatsapp_phone');
        }
        // `guardians.currency` is NOT NULL, and the validation rule admits null so that the
        // create form can send "no preference" and get the academy default. On an EDIT the same
        // null would diff to a real change and hand Postgres a NOT NULL violation — a 500 out of
        // an empty field. An absent currency here means "leave it", which is what a blank input
        // meant all along.
        if (array_key_exists('currency', $data) && ($data['currency'] === null || $data['currency'] === '')) {
            unset($data['currency']);
        } elseif (array_key_exists('currency', $data)) {
            $data['currency'] = strtoupper($data['currency']);
        }

        [$before, $after] = $this->diff($existing, $data, ['full_name', 'whatsapp_phone', 'country', 'currency', 'notes']);
        if ($after === []) {
            return response()->json(['ok' => true, 'changed' => []]);
        }

        DB::table('guardians')->where('id', $id)->update($after + ['updated_at' => now()]);
        Audit::log('guardian.update', 'guardian', $id, $this->currentAcademyId(), $this->ctx()->userId, $this->ctx()->role, after: $after, before: $before);

        return response()->json(['ok' => true, 'changed' => array_keys($after)]);
    }

    /** POST /api/guardians/{id}/deactivate — soft-delete; blocked while active children exist. */
    public function deactivate(string $id): JsonResponse
    {
        Gate::authorize('guardian.update');

        $guardian = DB::table('guardians')->where('id', $id)->whereNull('deleted_at')->first();
        if ($guardian === null) {
            abort(404, 'Guardian not found.');
        }

        $activeChildren = DB::table('students')->where('guardian_id', $id)->whereNull('deleted_at')->count();
        if ($activeChildren > 0) {
            abort(422, 'Deactivate this guardian\'s active students first.');
        }

        DB::table('guardians')->where('id', $id)->update(['deleted_at' => now(), 'updated_at' => now()]);
        Audit::log('guardian.deactivate', 'guardian', $id, $this->currentAcademyId(), $this->ctx()->userId, $this->ctx()->role, after: ['deleted_at' => now()->toIso8601String()]);

        return response()->json(['ok' => true]);
    }

    /**
     * POST /api/guardians/{id}/reactivate — the way back. Deactivating a guardian was a one-way
     * door: a family paused over the summer could only be restored from the database, while the
     * student beside them has had a reactivate endpoint all along. Nothing else is restored —
     * their children were deactivated separately and come back the same way.
     */
    public function reactivate(string $id): JsonResponse
    {
        Gate::authorize('guardian.update');

        $guardian = DB::table('guardians')->where('id', $id)->whereNotNull('deleted_at')->first();
        if ($guardian === null) {
            abort(404, 'Guardian not found or already active.');
        }

        DB::table('guardians')->where('id', $id)->update(['deleted_at' => null, 'updated_at' => now()]);
        Audit::log('guardian.reactivate', 'guardian', $id, $this->currentAcademyId(), $this->ctx()->userId, $this->ctx()->role,
            after: ['deleted_at' => null],
            before: ['deleted_at' => $guardian->deleted_at]);

        return response()->json(['ok' => true]);
    }

    /**
     * The parents-page search: the guardian's own name or number, OR any of their children's
     * names. Mirrors DataTable::applySearch's escaping (the LIKE metacharacters are escaped and
     * the term is always a bound parameter) and runs as ONE parenthesised OR group, so a later
     * `filter[...]` narrows the result instead of widening it.
     */
    private function applyFamilySearch(Builder $query, Request $request): void
    {
        $term = trim((string) $request->query('search', ''));
        if ($term === '') {
            return;
        }

        $like = '%'.str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $term).'%';

        $query->where(function (Builder $q) use ($like): void {
            $q->where('full_name', 'ilike', $like)
                ->orWhere('whatsapp_phone', 'ilike', $like)
                ->orWhereExists(function (Builder $sub) use ($like): void {
                    $sub->selectRaw('1')
                        ->from('students as c')
                        ->whereColumn('c.guardian_id', 'guardians.id')
                        ->where('c.full_name', 'ilike', $like);
                });
        });
    }

    /**
     * Compute the before/after of changed columns only (mirrors AcademyController::update).
     *
     * @param  array<string,mixed>  $data
     * @param  list<string>  $cols
     * @return array{0: array<string,mixed>, 1: array<string,mixed>}
     */
    private function diff(object $existing, array $data, array $cols): array
    {
        $before = [];
        $after = [];
        foreach ($cols as $col) {
            if (array_key_exists($col, $data) && (string) $data[$col] !== (string) $existing->{$col}) {
                $before[$col] = $existing->{$col};
                $after[$col] = $data[$col];
            }
        }

        return [$before, $after];
    }

    /** @return array<string,mixed> */
    private function validatePayload(Request $request, bool $creating): array
    {
        $req = $creating ? 'required' : 'sometimes';

        return $request->validate([
            'full_name' => [$req, 'string', 'max:255'],
            'whatsapp_phone' => [$req, 'string', 'max:32'],
            'country' => ['nullable', 'string', 'max:2'],
            'currency' => ['sometimes', 'nullable', 'string', 'size:3'],
            'notes' => ['nullable', 'string', 'max:2000'],
        ]);
    }
}
