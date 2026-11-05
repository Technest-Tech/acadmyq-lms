import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import arMessages from "../../messages/ar.json";
import { usePlanLabel } from "@/lib/plan-label";
import { makeSession, withAuth } from "@/test/auth";

const label = (capabilities: string[], value: string | null) => {
  const { result } = renderHook(() => usePlanLabel(), {
    wrapper: ({ children }) => withAuth(makeSession("ACADEMY_OWNER", { capabilities }), children),
  });
  return result.current(value);
};

describe("usePlanLabel", () => {
  it("puts the API's English mark in a centre's words", () => {
    expect(label(["centre"], "Package billing")).toBe(arMessages.subscriptions.planPrivate);
  });

  it("changes nothing for any other academy", () => {
    expect(label(["invoicing"], "Package billing")).toBe("Package billing");
  });

  it("leaves a plan the desk named as it is, centre or not", () => {
    expect(label(["centre"], "ساعتان في الأسبوع")).toBe("ساعتان في الأسبوع");
    expect(label(["centre"], null)).toBe("");
  });
});
