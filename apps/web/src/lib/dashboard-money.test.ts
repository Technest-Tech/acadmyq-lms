import { describe, expect, it } from "vitest";
import { academyCurrency, commonCurrency, rateBetween, sumAs, totalIn, type FxTable } from "./dashboard-money";

// Rates as the server sends them: units of the home currency (EGP) per one unit of each other.
const fx: FxTable = { home: "EGP", toHome: { USD: 50, GBP: 62.5, SAR: 13.25 } };

describe("dashboard money across currencies", () => {
  it("shows a one-currency academy in its own currency, never converted into the setting", () => {
    // A dollar-only academy whose setting was left on Egyptian pounds reads dollars.
    const total = totalIn([{ currency: "USD", minor: 120_000 }], "EGP", fx);
    expect(total).toEqual({ currency: "USD", minor: 120_000, converted: false, parts: [{ currency: "USD", minor: 120_000 }], missing: [] });
  });

  it("adds several currencies up in the academy's currency, biggest share first, real amounts kept", () => {
    const total = totalIn(
      [
        { currency: "EGP", minor: 500_000 }, // 5,000 EGP
        { currency: "USD", minor: 120_000 }, // $1,200 = 60,000 EGP
        { currency: "GBP", minor: 0 },
      ],
      "EGP",
      fx,
    );
    expect(total.currency).toBe("EGP");
    expect(total.minor).toBe(500_000 + 6_000_000);
    expect(total.converted).toBe(true);
    expect(total.parts).toEqual([
      { currency: "USD", minor: 120_000 },
      { currency: "EGP", minor: 500_000 },
    ]);
  });

  it("converts through the home currency when the academy's currency is not the home one", () => {
    expect(rateBetween("GBP", "USD", fx)).toBeCloseTo(1.25);
    const total = totalIn([{ currency: "GBP", minor: 10_000 }, { currency: "EGP", minor: 500_000 }], "USD", fx);
    expect(total.currency).toBe("USD");
    expect(total.minor).toBe(12_500 + 10_000);
  });

  it("gives no single figure for several currencies without rates, and names a currency with no rate", () => {
    expect(totalIn([{ currency: "EGP", minor: 1 }, { currency: "USD", minor: 1 }], "EGP", null).minor).toBeNull();
    const partial = totalIn([{ currency: "EGP", minor: 100 }, { currency: "KWD", minor: 100 }], "EGP", fx);
    expect(partial.minor).toBe(100);
    expect(partial.missing).toEqual(["KWD"]);
  });

  it("subtracts salaries from revenue in one currency, not per currency", () => {
    const revenue = [{ currency: "USD", minor: 300_000 }, { currency: "EGP", minor: 1_000_000 }];
    const salaries = [{ currency: "EGP", minor: 8_000_000 }];
    const cur = commonCurrency([...revenue, ...salaries], "EGP", fx);
    expect(cur).toBe("EGP");
    // $3,000 + 10,000 EGP − 80,000 EGP = 80,000 EGP; per currency it read "$3,000 profit, 70,000 EGP loss".
    expect(sumAs(revenue, cur!, fx) - sumAs(salaries, cur!, fx)).toBe(8_000_000);
    expect(commonCurrency(revenue, "EGP", null)).toBeNull();
    expect(commonCurrency([{ currency: "USD", minor: 5 }], "EGP", null)).toBe("USD");
  });

  it("takes the academy's setting, else the currency most money is in", () => {
    expect(academyCurrency("sar")).toBe("SAR");
    expect(academyCurrency("", [{ currency: "EGP", minor: 10 }, { currency: "USD", minor: 900 }])).toBe("USD");
    expect(academyCurrency(null)).toBe("EGP");
  });
});
