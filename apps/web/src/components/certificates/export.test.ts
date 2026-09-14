import { describe, expect, it } from "vitest";
import { safeFileName, serialAt } from "./export";
import { fitText, shade, signatures } from "./kit";
import { bulkNames, BULK_LIMIT, type RecipientState } from "./recipient-panel";
import type { CertificateContent } from "@/lib/api";

describe("serialAt", () => {
  it("counts the trailing number up and keeps its padding", () => {
    expect(serialAt("2026-009", 0)).toBe("2026-009");
    expect(serialAt("2026-009", 1)).toBe("2026-010");
    expect(serialAt("CERT-099", 1)).toBe("CERT-100");
    expect(serialAt("A7B", 2)).toBe("A9B");
  });

  it("suffixes a start with no digits, and numbers nothing when empty", () => {
    expect(serialAt("HIFZ", 0)).toBe("HIFZ");
    expect(serialAt("HIFZ", 2)).toBe("HIFZ-3");
    expect(serialAt("   ", 4)).toBe("");
  });
});

describe("bulkNames", () => {
  const base: RecipientState = { mode: "bulk", name: "", courseTitle: "", date: "2026-09-14", serial: "", students: [], extraNames: "" };

  it("merges ticked students with typed names, trimmed and de-duplicated, in order", () => {
    expect(
      bulkNames({ ...base, students: [{ id: "1", name: "Yusuf" }, { id: "2", name: "Maryam" }], extraNames: " Layla \n\nYusuf\n" }),
    ).toEqual(["Yusuf", "Maryam", "Layla"]);
  });

  it("keeps two ticked students who share a name", () => {
    expect(
      bulkNames({ ...base, students: [{ id: "1", name: "Ahmed Ali" }, { id: "2", name: "Ahmed Ali" }], extraNames: "Ahmed Ali" }),
    ).toEqual(["Ahmed Ali", "Ahmed Ali"]);
  });

  it("caps a batch", () => {
    const extraNames = Array.from({ length: BULK_LIMIT + 20 }, (_, i) => `Student ${i}`).join("\n");
    expect(bulkNames({ ...base, extraNames })).toHaveLength(BULK_LIMIT);
  });
});

describe("certificate kit", () => {
  it("prints a second signature only when it has a name or title", () => {
    const content = { signatoryNameEn: "A", signatoryTitleEn: "Director", signatory2NameEn: "", signatory2TitleEn: "" } as CertificateContent;
    expect(signatures(content, "en")).toHaveLength(1);
    expect(signatures({ ...content, signatory2TitleEn: "Teacher" }, "en")).toHaveLength(2);
  });

  it("shrinks long display text, never below its floor", () => {
    expect(fitText("Short", 50, 20)).toBe(50);
    expect(fitText("x".repeat(40), 50, 20)).toBe(26);
    expect(fitText("x".repeat(400), 50, 20)).toBe(26);
  });

  it("shades hex colours toward white or black", () => {
    expect(shade("#808080", 1)).toBe("#ffffff");
    expect(shade("#808080", -1)).toBe("#000000");
    expect(shade("not-a-colour", 0.5)).toBe("not-a-colour");
  });

  it("makes file names safe", () => {
    expect(safeFileName("Yusuf Ahmad", "Al-Noor")).toBe("Yusuf_Ahmad-Al-Noor");
    expect(safeFileName("  ")).toBe("certificate");
  });
});
