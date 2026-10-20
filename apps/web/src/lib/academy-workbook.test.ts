import { inflateRawSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import type { ExportSheet } from "@/lib/api";

// The browser build saves through an <a download>; swap in the node build and keep the bytes.
const written: { name?: string; bytes?: Uint8Array } = {};
vi.mock("write-excel-file/browser", async () => {
  const node = (await import("write-excel-file/node")).default;
  return {
    default: async (...args: Parameters<typeof node>) => {
      const out = await node(...args);
      return {
        toFile: async (name: string) => {
          written.name = name;
          written.bytes = new Uint8Array(await out.toBuffer());
        },
      };
    },
  };
});

const { downloadAcademyWorkbook } = await import("@/lib/academy-workbook");

/** Read a zip's entries by walking its central directory (an .xlsx is a plain zip). */
function unzip(bytes: Uint8Array): Record<string, string> {
  const buf = Buffer.from(bytes);
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  const out: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(at + 10);
    const size = buf.readUInt32LE(at + 20);
    const nameLen = buf.readUInt16LE(at + 28);
    const extraLen = buf.readUInt16LE(at + 30);
    const commentLen = buf.readUInt16LE(at + 32);
    const local = buf.readUInt32LE(at + 42);
    const name = buf.toString("utf8", at + 46, at + 46 + nameLen);
    const dataAt = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(dataAt, dataAt + size);
    out[name] = (method === 8 ? inflateRawSync(data) : data).toString("utf8");
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const students: ExportSheet = {
  key: "students",
  title: { en: "Students", ar: "الطلاب" },
  columns: [
    { key: "full_name", label: { en: "Student", ar: "الطالب" }, type: "text", width: 28 },
    {
      key: "status",
      label: { en: "Status", ar: "الحالة" },
      type: "enum",
      width: 14,
      labels: { REGULAR: { en: "Regular", ar: "منتظم" } },
    },
    { key: "fee", label: { en: "Fee", ar: "الرسوم" }, type: "money", width: 12 },
    { key: "is_active", label: { en: "Active", ar: "نشط" }, type: "bool", width: 10 },
  ],
  rows: [
    ["Student One", "REGULAR", 150.5, true],
    ["Student Two", null, null, false],
  ],
};

describe("downloadAcademyWorkbook", () => {
  it("writes a summary sheet plus one sheet per dataset, with values spelled out", async () => {
    await downloadAcademyWorkbook({
      fileName: "Noor-data-2026-10-20",
      sheets: [students, { ...students, key: "teachers", title: { en: "Teachers", ar: "المعلمون" }, rows: [] }],
      locale: "ar",
      copy: { title: "Noor — data", exportedOn: "2026-10-20", summarySheet: "الملخص", sheetHeader: "الصفحة", rowsHeader: "عدد الصفوف" },
    });

    expect(written.name).toBe("Noor-data-2026-10-20.xlsx");
    const files = unzip(written.bytes!);
    const workbook = files["xl/workbook.xml"]!;
    expect(workbook).toContain('name="الملخص"');
    expect(workbook).toContain('name="الطلاب"');
    expect(workbook).toContain('name="المعلمون"');

    const shared = files["xl/sharedStrings.xml"] ?? "";
    const sheet2 = files["xl/worksheets/sheet2.xml"]!;
    const text = shared + sheet2;
    expect(text).toContain("منتظم");
    expect(text).toContain("نعم");
    expect(text).toContain("لا");
    expect(sheet2).toContain("150.5");
    expect(sheet2).toContain('rightToLeft="1"');
  });
});
