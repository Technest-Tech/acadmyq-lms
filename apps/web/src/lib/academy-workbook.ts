import type { BilingualLabel, ExportColumn, ExportSheet } from "@/lib/api";

/**
 * Settings → Export data: lays the API's sheets out as ONE styled .xlsx — a summary sheet first,
 * then a sheet per dataset with a coloured, frozen header row, banded rows, money as real
 * numbers (so the client can sum them in Excel) and coded values (statuses, days) spelled out
 * in the reader's language.
 *
 * `write-excel-file` is imported on click, like lib/export-excel.ts, so it never weighs on the
 * Settings bundle.
 */

type Locale = "ar" | "en";

const HEADER_BG = "#047857";
const HEADER_TEXT = "#FFFFFF";
const BAND_BG = "#F1F7F4";
const BORDER = "#D5E0DA";
const TITLE_TEXT = "#065F46";

const pick = (label: BilingualLabel, locale: Locale) => (locale === "ar" ? label.ar : label.en) || label.en;

/** Excel sheet names: ≤31 chars, none of []:*?/\ , unique in the book. */
function sheetName(raw: string, used: Set<string>): string {
  const base = raw.replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 31) || "Sheet";
  let name = base;
  for (let i = 2; used.has(name.toLowerCase()); i++) {
    const suffix = ` (${i})`;
    name = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(name.toLowerCase());
  return name;
}

const border = { borderColor: BORDER, borderStyle: "thin" as const };

function headerCell(value: string) {
  return {
    value,
    fontWeight: "bold" as const,
    textColor: HEADER_TEXT,
    backgroundColor: HEADER_BG,
    align: "center" as const,
    alignVertical: "center" as const,
    height: 26,
    wrap: true,
    ...border,
  };
}

function bodyCell(column: ExportColumn, raw: string | number | boolean | null, banded: boolean, locale: Locale) {
  const style = { ...border, alignVertical: "center" as const, ...(banded ? { backgroundColor: BAND_BG } : {}) };
  if (raw === null || raw === "") return { ...style, value: undefined };

  switch (column.type) {
    case "money":
      return { ...style, type: Number, value: Number(raw), format: "#,##0.00" };
    case "number":
      return typeof raw === "number" ? { ...style, type: Number, value: raw } : { ...style, value: String(raw) };
    case "bool":
      return {
        ...style,
        value: raw ? (locale === "ar" ? "نعم" : "Yes") : locale === "ar" ? "لا" : "No",
        align: "center" as const,
      };
    case "enum": {
      const label = column.labels?.[String(raw)];
      return { ...style, value: label ? pick(label, locale) : String(raw) };
    }
    case "date":
      return { ...style, value: String(raw), align: "center" as const };
    default:
      return { ...style, value: String(raw), wrap: column.width >= 30 };
  }
}

export interface WorkbookCopy {
  /** Big title on the summary sheet, e.g. "Al-Noor Academy — data export". */
  title: string;
  /** "Exported on 2026-10-20 14:05". */
  exportedOn: string;
  summarySheet: string;
  sheetHeader: string;
  rowsHeader: string;
}

/** Build the workbook and hand it to the browser as a download. */
export async function downloadAcademyWorkbook(opts: {
  fileName: string;
  sheets: ExportSheet[];
  locale: Locale;
  copy: WorkbookCopy;
}): Promise<void> {
  const { fileName, sheets, locale, copy } = opts;
  const writeXlsxFile = (await import("write-excel-file/browser")).default;
  const rtl = locale === "ar";
  const used = new Set<string>();

  const summaryName = sheetName(copy.summarySheet, used);
  const names = sheets.map((sheet) => sheetName(pick(sheet.title, locale), used));

  const summary = {
    sheet: summaryName,
    rightToLeft: rtl,
    showGridLines: false,
    columns: [{ width: 34 }, { width: 14 }],
    data: [
      [{ value: copy.title, fontWeight: "bold" as const, fontSize: 16, textColor: TITLE_TEXT, height: 30, columnSpan: 2 }, null],
      [{ value: copy.exportedOn, textColor: "#6B7280", columnSpan: 2 }, null],
      [],
      [headerCell(copy.sheetHeader), headerCell(copy.rowsHeader)],
      ...sheets.map((sheet, i) => {
        const banded = i % 2 === 1;
        const bg = banded ? { backgroundColor: BAND_BG } : {};
        return [
          { value: names[i], ...border, ...bg },
          { value: sheet.rows.length, type: Number, format: "#,##0", align: "center" as const, ...border, ...bg },
        ];
      }),
    ],
  };

  const dataSheets = sheets.map((sheet, i) => ({
    sheet: names[i],
    rightToLeft: rtl,
    stickyRowsCount: 1,
    columns: sheet.columns.map((c) => ({ width: c.width })),
    data: [
      sheet.columns.map((c) => headerCell(pick(c.label, locale))),
      ...sheet.rows.map((row, r) => sheet.columns.map((c, ci) => bodyCell(c, row[ci] ?? null, r % 2 === 1, locale))),
    ],
  }));

  // The library's typings model each sheet's rows loosely; the shapes above are its cell objects.
  const file = await writeXlsxFile([summary, ...dataSheets] as Parameters<typeof writeXlsxFile>[0], {
    fontFamily: "Calibri",
    fontSize: 11,
  });
  await file.toFile(fileName.endsWith(".xlsx") ? fileName : `${fileName}.xlsx`);
}
