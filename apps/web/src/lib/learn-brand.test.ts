import { describe, expect, it } from "vitest";
import { isHandleName, logoAlt, resolveSiteName } from "./learn-brand";

/**
 * Who the storefront says it is (docs/lms/09 §1).
 *
 * The case that made this function exist: an academy created for the course platform is seeded with
 * its own subdomain as its name, so the demo tenant's site rendered "تعلّم مع lms" in 48px type on
 * its own home page. A URL handle is an address, not a brand — `null` here means "the caller
 * renders translated neutral copy instead".
 */
describe("resolveSiteName", () => {
  it("uses the brand name the client typed", () => {
    expect(resolveSiteName("Noor Academy", "Noor Ltd", "noor")).toBe(
      "Noor Academy",
    );
  });

  it("falls back to the academy's own name when no brand name is set", () => {
    expect(resolveSiteName("", "Noor Ltd", "noor")).toBe("Noor Ltd");
    expect(resolveSiteName("   ", "Noor Ltd", "noor")).toBe("Noor Ltd");
    expect(resolveSiteName(null, "Noor Ltd", "noor")).toBe("Noor Ltd");
  });

  it("refuses the subdomain handle as a name, at either level", () => {
    expect(resolveSiteName("lms", "lms", "lms")).toBeNull();
    expect(resolveSiteName("", "lms", "lms")).toBeNull();
  });

  it("skips a handle-shaped brand name but still uses a real academy name", () => {
    expect(resolveSiteName("noor", "Noor Academy", "noor")).toBe("Noor Academy");
  });

  it("returns null when nothing but the handle is known", () => {
    expect(resolveSiteName("", "", "academy-2")).toBeNull();
    expect(resolveSiteName(undefined, undefined, "lms")).toBeNull();
  });

  it("trims what it returns", () => {
    expect(resolveSiteName("  Noor Academy  ", "", "noor")).toBe("Noor Academy");
  });
});

describe("isHandleName", () => {
  it("matches regardless of case, spacing and punctuation", () => {
    expect(isHandleName("Al-Furqan", "alfurqan")).toBe(true);
    expect(isHandleName("AL FURQAN", "alfurqan")).toBe(true);
    expect(isHandleName("al.furqan", "al-furqan")).toBe(true);
  });

  it("does not match a real name that merely starts with the handle", () => {
    expect(isHandleName("Noor Academy", "noor")).toBe(false);
  });

  it("treats an empty name as no match, so it falls through normally", () => {
    expect(isHandleName("", "")).toBe(false);
    expect(isHandleName("   ", "noor")).toBe(false);
  });
});

describe("logoAlt", () => {
  it("stays empty beside a visible name, so the brand is not announced twice", () => {
    expect(logoAlt("Noor", false)).toBe("");
  });

  it("names the site when the logo stands alone", () => {
    expect(logoAlt("Noor", true)).toBe("Noor");
  });
});
