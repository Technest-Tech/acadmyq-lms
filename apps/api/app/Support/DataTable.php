<?php

declare(strict_types=1);

namespace App\Support;

use Illuminate\Database\Query\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Validation\ValidationException;

/**
 * The single server-driven query engine behind every list screen (Sprint 4 §6). Search,
 * filter, sort and paginate all happen in SQL — within the RLS scope already set by
 * TenantContextMiddleware — so lists scale past a handful of rows and a Teacher can never see
 * another academy's people (the academy_id predicate is the database's, not ours).
 *
 * Security is the whole point of this class:
 *  - The client never names a SQL column. Sort/filter KEYS are validated against a per-entity
 *    allowlist supplied by the controller; the allowlist's VALUES are the only column names or
 *    closures that ever touch the builder (AC-4.9 / TC-4.24). An unknown sort key is a 422,
 *    not a silent ignore, so an injection attempt is visibly rejected.
 *  - Search terms and filter values are always bound parameters, never interpolated.
 *
 * Contract (§6.2):  GET /api/{entity}?search=&filter[k]=&sort=&page=&pageSize=
 *                   → { rows, total, page, pageSize }
 *
 * @phpstan-type DataTableConfig array{
 *   searchable?: list<string>,
 *   sortable?: array<string,string>,
 *   filters?: array<string,callable(Builder,mixed):void>,
 *   defaultSort?: string,
 *   defaultPageSize?: int,
 *   maxPageSize?: int,
 * }
 */
final class DataTable
{
    /**
     * @param  Builder  $query  base query, already RLS-scoped and pre-filtered by the caller
     *                          (e.g. whereNull('deleted_at'), or a teacher's row scope)
     * @param  array<string,mixed>  $config
     * @return array{rows: Collection<int,object>, total: int, page: int, pageSize: int}
     */
    public static function paginate(Builder $query, Request $request, array $config): array
    {
        self::applySearch($query, $request, $config['searchable'] ?? []);
        self::applyFilters($query, $request, $config['filters'] ?? []);

        // Count BEFORE limit/offset, after search+filter, so `total` reflects the real result.
        $total = (clone $query)->count();

        self::applySort($query, $request, $config['sortable'] ?? [], $config['defaultSort'] ?? null, $config['idColumn'] ?? 'id');

        [$page, $pageSize] = self::resolvePaging(
            $request,
            (int) ($config['defaultPageSize'] ?? 25),
            (int) ($config['maxPageSize'] ?? 100),
        );

        $rows = $query->forPage($page, $pageSize)->get();

        return ['rows' => $rows, 'total' => $total, 'page' => $page, 'pageSize' => $pageSize];
    }

    /** Free-text ILIKE across the allowlisted searchable columns, as one OR group. */
    private static function applySearch(Builder $query, Request $request, array $searchable): void
    {
        $term = trim((string) $request->query('search', ''));
        if ($term === '' || $searchable === []) {
            return;
        }

        $like = '%'.str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $term).'%';

        $query->where(function (Builder $q) use ($searchable, $like): void {
            foreach ($searchable as $column) {
                $q->orWhere($column, 'ilike', $like);
            }
        });
    }

    /** Apply only the filters the entity declares; unknown filter keys are ignored. */
    private static function applyFilters(Builder $query, Request $request, array $filters): void
    {
        $requested = $request->query('filter');
        if (! is_array($requested)) {
            return;
        }

        foreach ($requested as $key => $value) {
            if (isset($filters[$key]) && $value !== '' && $value !== null) {
                $filters[$key]($query, $value);
            }
        }
    }

    /**
     * Multi-column, server-side sort. `sort=name,-price` → name asc, price desc. Every key is
     * validated against the allowlist BEFORE any SQL is built; an unknown key throws 422 so a
     * crafted `name);drop table…` never reaches the database (TC-4.24). A stable `id` tiebreak
     * is always appended for non-overlapping pages (TC-4.22).
     */
    private static function applySort(Builder $query, Request $request, array $sortable, ?string $default, string $idColumn): void
    {
        $raw = trim((string) $request->query('sort', ''));
        $spec = $raw !== '' ? $raw : (string) $default;

        foreach (array_filter(explode(',', $spec)) as $token) {
            $token = trim($token);
            if ($token === '') {
                continue;
            }
            $desc = str_starts_with($token, '-');
            $key = ltrim($token, '-');

            if (! array_key_exists($key, $sortable)) {
                throw ValidationException::withMessages([
                    'sort' => ["Unknown sort key: {$key}."],
                ]);
            }

            $query->orderBy($sortable[$key], $desc ? 'desc' : 'asc');
        }

        // Stable tiebreak so pages never overlap (TC-4.22). Qualified for joined queries.
        $query->orderBy($idColumn);
    }

    /** @return array{0:int,1:int} [page, pageSize] */
    private static function resolvePaging(Request $request, int $default, int $max): array
    {
        $page = max(1, (int) $request->query('page', '1'));
        $pageSize = (int) $request->query('pageSize', (string) $default);
        $pageSize = max(1, min($pageSize, $max));

        return [$page, $pageSize];
    }
}
