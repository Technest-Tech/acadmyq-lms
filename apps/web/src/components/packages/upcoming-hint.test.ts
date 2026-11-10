import { describe, expect, it } from "vitest";
import { upcomingHint } from "@/components/packages/package-card";

const t = (key: string, v?: Record<string, string | number>) => `${key}:${JSON.stringify(v ?? {})}`;

describe("upcomingHint", () => {
  it("counts only the upcoming lessons a running block still covers, never the ones past its end", () => {
    expect(upcomingHint({ status: "ACTIVE", upcoming_lesson_count: 15, upcoming_in_package_count: 9 }, t)).toBe('card.upcomingCount:{"count":9}');
  });

  it("keeps the plain count on a finished block, and says nothing with none to come", () => {
    expect(upcomingHint({ status: "COMPLETED", upcoming_lesson_count: 4, upcoming_in_package_count: 0 }, t)).toBe('card.upcomingCount:{"count":4}');
    expect(upcomingHint({ status: "ACTIVE", upcoming_lesson_count: 3, upcoming_in_package_count: 0 }, t)).toBeUndefined();
    expect(upcomingHint({ status: "ACTIVE", upcoming_lesson_count: 0, upcoming_in_package_count: 0 }, t)).toBeUndefined();
  });
});
