import type { DataTableQuery, ListResult } from "@/lib/api";

/**
 * Client-side Excel (.xlsx) export for the academy admin list screens.
 *
 * `write-excel-file` is dynamically imported so its workbook code only loads when a
 * user actually clicks "Export" — it never weighs on the initial page bundle. Real
 * .xlsx (not CSV) is deliberate: the app is bilingual, and Arabic text + numbers land
 * cleanly in a worksheet without the BOM / delimiter quirks that plague CSV in Excel.
 */

/** One exported column: a header and a plain-value extractor for each row. */
export interface ExcelColumn<T> {
  header: string;
  /** Plain cell value. null/undefined/"" render as a blank cell. */
  value: (row: T) => string | number | boolean | null | undefined;
  /** Column width in characters (default 22). */
  width?: number;
}

/** Hard ceiling so a huge result set can't loop forever or exhaust memory. */
export const MAX_EXPORT_ROWS = 10_000;

/** The list endpoints cap pageSize server-side (DataTable.php), so we walk pages. */
const EXPORT_PAGE_SIZE = 100;

export interface FetchAllResult<T> {
  rows: T[];
  /** True when the result was clipped at MAX_EXPORT_ROWS (not everything exported). */
  truncated: boolean;
}

/**
 * Pull every row matching `query` by walking the server's pages. The API clamps
 * pageSize (default max 100), so a single giant request won't return everything —
 * we page until we've collected `total` rows or hit MAX_EXPORT_ROWS.
 */
export async function fetchAllRows<T>(
  fetcher: (q: DataTableQuery) => Promise<ListResult<T>>,
  query: DataTableQuery = {},
): Promise<FetchAllResult<T>> {
  const first = await fetcher({ ...query, page: 1, pageSize: EXPORT_PAGE_SIZE });
  const size = first.pageSize || EXPORT_PAGE_SIZE;
  const reportedTotal = first.total ?? first.rows.length;
  const target = Math.min(reportedTotal, MAX_EXPORT_ROWS);

  const rows: T[] = [...first.rows];
  const pages = Math.ceil(target / size);
  for (let page = 2; page <= pages && rows.length < MAX_EXPORT_ROWS; page++) {
    const res = await fetcher({ ...query, page, pageSize: size });
    if (res.rows.length === 0) break;
    rows.push(...res.rows);
  }

  return {
    rows: rows.slice(0, MAX_EXPORT_ROWS),
    truncated: reportedTotal > MAX_EXPORT_ROWS,
  };
}

/** Build, then download, an .xlsx file with one worksheet of the given rows. */
export async function exportRowsToExcel<T>(opts: {
  /** File name (a `.xlsx` extension is added if missing). */
  fileName: string;
  /** Worksheet tab name (clamped to Excel's 31-char limit). */
  sheetName?: string;
  columns: ExcelColumn<T>[];
  rows: T[];
  /** Lay the sheet out right-to-left (set for Arabic). */
  rightToLeft?: boolean;
}): Promise<void> {
  const { fileName, sheetName, columns, rows, rightToLeft } = opts;

  // write-excel-file exposes no root entry — the browser build is a named subpath.
  const writeXlsxFile = (await import("write-excel-file/browser")).default;

  // Everything is coerced to text: it keeps one consistent cell type per column and
  // sidesteps locale/format surprises for money strings, phone numbers, IDs, etc.
  const schema = columns.map((col) => ({
    header: col.header,
    width: col.width ?? 22,
    cell: (row: T): string | null => {
      const v = col.value(row);
      return v == null || v === "" ? null : String(v);
    },
  }));

  const file = await writeXlsxFile(rows, {
    columns: schema,
    sheet: (sheetName ?? "Export").slice(0, 31),
    rightToLeft,
  });

  await file.toFile(fileName.endsWith(".xlsx") ? fileName : `${fileName}.xlsx`);
}
