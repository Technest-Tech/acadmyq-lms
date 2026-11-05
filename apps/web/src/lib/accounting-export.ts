import { BAND_BG, border, headerCell } from "@/lib/academy-workbook";

/**
 * One accounting list as one .xlsx sheet, styled like Settings → Export data: frozen coloured header,
 * banded rows, and money as real numbers so an accountant can sum it. `write-excel-file` is imported
 * on click, so it never weighs on the page.
 */
export interface SheetColumn<T> {
  header: string;
  width?: number;
  /** `money` takes minor units and writes major units as a number. */
  kind?: "text" | "money" | "number";
  value: (row: T) => string | number | null | undefined;
}

function cell<T>(column: SheetColumn<T>, row: T, banded: boolean) {
  const style = { ...border, alignVertical: "center" as const, ...(banded ? { backgroundColor: BAND_BG } : {}) };
  const raw = column.value(row);
  if (raw === null || raw === undefined || raw === "") return { ...style, value: undefined };
  if (column.kind === "money") return { ...style, type: Number, value: Number(raw) / 100, format: "#,##0.00" };
  if (column.kind === "number") return { ...style, type: Number, value: Number(raw) };
  return { ...style, value: String(raw) };
}

export async function downloadAccountingSheet<T>(opts: { fileName: string; sheetName: string; columns: SheetColumn<T>[]; rows: T[]; rightToLeft: boolean }): Promise<void> {
  const { fileName, sheetName, columns, rows, rightToLeft } = opts;
  const writeXlsxFile = (await import("write-excel-file/browser")).default;

  const sheet = {
    sheet: sheetName.replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 31) || "Sheet",
    rightToLeft,
    stickyRowsCount: 1,
    columns: columns.map((c) => ({ width: c.width ?? 18 })),
    data: [columns.map((c) => headerCell(c.header)), ...rows.map((row, r) => columns.map((c) => cell(c, row, r % 2 === 1)))],
  };

  // The library's typings model each sheet's rows loosely; the shapes above are its cell objects.
  const file = await writeXlsxFile([sheet] as unknown as Parameters<typeof writeXlsxFile>[0], { fontFamily: "Calibri", fontSize: 11 });
  await file.toFile(fileName.endsWith(".xlsx") ? fileName : `${fileName}.xlsx`);
}
