import { describe, expect, it } from "vitest";
import { formatMoney } from "./money";

describe("formatMoney (display-only)", () => {
  it("formats EGP in Arabic with Arabic-Indic numerals and currency (TC-0.5)", () => {
    const out = formatMoney({ amount: 1500, currency: "EGP" }, "ar");

    // Arabic-Indic digits (٠-٩) present, and "15" rendered as ١٥.
    expect(out).toMatch(/[٠-٩]/);
    expect(out).toContain("١٥");
    // EGP currency marker (symbol form ج.م or code), tolerant across ICU versions.
    expect(out).toMatch(/ج\.م|EGP/);
  });

  it("formats USD in English with two decimals", () => {
    expect(formatMoney({ amount: 1500, currency: "USD" }, "en")).toContain("15.00");
  });
});
