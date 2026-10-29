import type { DataTableQuery, ListResult } from "@/lib/api";

/** The API clamps every page to 100 rows (DataTable's maxPageSize). */
const ROSTER_PAGE_SIZE = 100;
/** A runaway guard, not a product limit: 50 pages = 5,000 people. */
const MAX_PAGES = 50;

/**
 * The WHOLE roster behind a picker — every student or teacher matching `query`, not the first
 * page. Asking for `pageSize: 200` never worked: the server clamps it to 100, so an academy past
 * a hundred students simply could not find the rest by name. The first page says how many there
 * are; the others are fetched together. A row that comes back twice (the students list repeats a
 * student once per teacher) is kept once.
 */
export async function fetchRoster<T>(
  fetcher: (q: DataTableQuery) => Promise<ListResult<T>>,
  query: DataTableQuery = {},
): Promise<ListResult<T>> {
  const first = await fetcher({ ...query, pageSize: ROSTER_PAGE_SIZE });
  let rows = first.rows;
  if (first.rows.length >= ROSTER_PAGE_SIZE && first.total > first.rows.length) {
    const pages = Math.min(Math.ceil(first.total / ROSTER_PAGE_SIZE), MAX_PAGES);
    const rest = await Promise.all(
      Array.from({ length: pages - 1 }, (_, i) => fetcher({ ...query, page: i + 2, pageSize: ROSTER_PAGE_SIZE })),
    );
    rows = [...first.rows, ...rest.flatMap((r) => r.rows)];
  }

  const seen = new Set<unknown>();
  const unique = rows.filter((r) => {
    const id = (r as { id?: unknown }).id;
    if (id === undefined) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  return { rows: unique, total: first.total, page: 1, pageSize: unique.length };
}
