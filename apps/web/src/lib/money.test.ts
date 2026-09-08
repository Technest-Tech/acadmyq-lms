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

/**
 * The storefront's price rule (docs/lms/09 §3): a shop writes "400 ج.م", not "400.00 ج.م". Opt-in,
 * because on an invoice the aligned decimals are the point — see MoneyFormatOptions.
 */
describe("formatMoney trimZeroDecimals", () => {
  it("drops the zero decimals on a whole amount", () => {
    expect(
      formatMoney({ amount: 40000, currency: "USD" }, "en", {
        trimZeroDecimals: true,
      }),
    ).toBe("$400");
  });

  it("keeps the decimals on an amount that actually has them", () => {
    expect(
      formatMoney({ amount: 39950, currency: "USD" }, "en", {
        trimZeroDecimals: true,
      }),
    ).toBe("$399.50");
  });

  it("changes nothing unless it is asked to", () => {
    expect(formatMoney({ amount: 40000, currency: "USD" }, "en")).toBe("$400.00");
    expect(
      formatMoney({ amount: 40000, currency: "USD" }, "en", {
        trimZeroDecimals: false,
      }),
    ).toBe("$400.00");
  });

  it("still renders Arabic-Indic digits and the EGP marker", () => {
    const out = formatMoney({ amount: 40000, currency: "EGP" }, "ar", {
      trimZeroDecimals: true,
    });

    expect(out).toContain("٤٠٠");
    expect(out).not.toMatch(/[.,]٠٠/);
    expect(out).toMatch(/ج\.م|EGP/);
  });
});
