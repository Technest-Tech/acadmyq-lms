import { describe, expect, it } from "vitest";
import { upcomingHint } from "@/components/packages/package-card";

const t = (key: string, v?: Record<string, string | number>) => `${key}:${JSON.stringify(v ?? {})}`;

describe("upcomingHint", () => {
  it("splits the lessons past a running block's balance", () => {
    expect(upcomingHint({ status: "ACTIVE", upcoming_lesson_count: 15, upcoming_in_package_count: 9 }, t)).toBe(
      'card.upcomingSplit:{"inPackage":9,"after":6}',
    );
  });

  it("keeps the plain count when the block covers them all, or is finished", () => {
    expect(upcomingHint({ status: "ACTIVE", upcoming_lesson_count: 4, upcoming_in_package_count: 4 }, t)).toBe('card.upcomingCount:{"count":4}');
    expect(upcomingHint({ status: "COMPLETED", upcoming_lesson_count: 4, upcoming_in_package_count: 0 }, t)).toBe('card.upcomingCount:{"count":4}');
    expect(upcomingHint({ status: "ACTIVE", upcoming_lesson_count: 0, upcoming_in_package_count: 0 }, t)).toBeUndefined();
  });
});
