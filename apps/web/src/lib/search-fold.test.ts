import { describe, expect, it } from "vitest";
import { searchMatches } from "@/lib/search-fold";

describe("searchMatches", () => {
  it("finds an Arabic name however its hamza, taa marbuta or alif maqsura were typed", () => {
    expect(searchMatches("أحمد إبراهيم", "احمد ابراهيم")).toBe(true);
    expect(searchMatches("فاطمة", "فاطمه")).toBe(true);
    expect(searchMatches("مصطفى", "مصطفي")).toBe(true);
    expect(searchMatches("آمنة", "امنه")).toBe(true);
    // Typed WITH the hamza, stored without — the other direction.
    expect(searchMatches("احمد", "أحمد")).toBe(true);
  });

  it("ignores diacritics and case, and still says no to a different name", () => {
    expect(searchMatches("مُحَمَّد", "محمد")).toBe(true);
    expect(searchMatches("Sara Ali", "sara")).toBe(true);
    expect(searchMatches("أحمد", "محمود")).toBe(false);
    expect(searchMatches(null, "x")).toBe(false);
  });
});
