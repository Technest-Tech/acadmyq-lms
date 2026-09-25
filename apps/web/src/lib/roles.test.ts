import { describe, expect, it } from "vitest";
import { isSystemRole, roleLabel } from "./roles";

const t = Object.assign((key: string) => `label:${key}`, {
  has: (key: string) => ["ACADEMY_OWNER", "SUPERVISOR", "STAFF", "other"].includes(key),
});

describe("roleLabel", () => {
  it("translates a system role", () => {
    expect(roleLabel(t, "SUPERVISOR")).toBe("label:SUPERVISOR");
  });

  it("shows a custom role's own name when it is known", () => {
    expect(roleLabel(t, "CR_9f3a", "HR Manager")).toBe("HR Manager");
  });

  it("falls back to the generic custom label, never the raw key", () => {
    expect(roleLabel(t, "CR_9f3a")).toBe("label:other");
  });

  it("dashes out a missing role", () => {
    expect(roleLabel(t, null)).toBe("—");
  });

  it("knows which codes are built in", () => {
    expect(isSystemRole("STAFF")).toBe(true);
    expect(isSystemRole("CR_9f3a")).toBe(false);
  });
});
