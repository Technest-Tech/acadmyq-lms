import { describe, expect, it } from "vitest";
import { defaultLocale, direction, isLocale, locales } from "./config";

describe("i18n config", () => {
  it("defaults to Arabic (TC-0.12)", () => {
    expect(defaultLocale).toBe("ar");
  });

  it("maps ar -> rtl and en -> ltr (TC-0.12, TC-0.14)", () => {
    expect(direction("ar")).toBe("rtl");
    expect(direction("en")).toBe("ltr");
  });

  it("supports exactly Arabic and English (R-LOC-1)", () => {
    expect([...locales]).toEqual(["ar", "en"]);
  });

  it("validates locale strings", () => {
    expect(isLocale("ar")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });
});
