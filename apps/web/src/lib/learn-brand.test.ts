import { describe, expect, it } from "vitest";
import { logoAlt, resolveSiteName } from "./learn-brand";

/**
 * Who the storefront says it is (docs/lms/09 §1).
 *
 * The case that rewrote this function: a client created as `zad` on `zad.acadmyq.com` had its own
 * assigned name swapped for "المنصة التعليمية" on its public site, because the name folded to the
 * handle. A name the platform was given is a name — `null` here now means only that nobody has
 * supplied one at all, and the caller renders translated neutral copy instead.
 */
describe("resolveSiteName", () => {
  it("uses the brand name the client typed", () => {
    expect(resolveSiteName("Noor Academy", "Noor Ltd")).toBe("Noor Academy");
  });

  it("falls back to the academy's own name when no brand name is set", () => {
    expect(resolveSiteName("", "Noor Ltd")).toBe("Noor Ltd");
    expect(resolveSiteName("   ", "Noor Ltd")).toBe("Noor Ltd");
    expect(resolveSiteName(null, "Noor Ltd")).toBe("Noor Ltd");
  });

  it("keeps a short one-word name that reads like the handle", () => {
    expect(resolveSiteName("", "zad")).toBe("zad");
    expect(resolveSiteName("zad", "zad")).toBe("zad");
  });

  it("returns null only when no name exists at either level", () => {
    expect(resolveSiteName("", "")).toBeNull();
    expect(resolveSiteName(undefined, undefined)).toBeNull();
    expect(resolveSiteName("   ", null)).toBeNull();
  });

  it("trims what it returns", () => {
    expect(resolveSiteName("  Noor Academy  ", "")).toBe("Noor Academy");
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
