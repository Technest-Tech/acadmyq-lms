import { afterEach, describe, expect, it, vi } from "vitest";

const mockSupports = vi.fn(() => true);
vi.mock("@livekit/track-processors", () => ({
  supportsBackgroundProcessors: () => mockSupports(),
  BackgroundProcessor: vi.fn(),
}));

import { backgroundSupported, blurRadiusFor } from "./background-processor";

describe("blurRadiusFor", () => {
  it("maps strength to a radius (strong > light)", () => {
    expect(blurRadiusFor("light")).toBe(10);
    expect(blurRadiusFor("strong")).toBe(25);
    expect(blurRadiusFor("strong")).toBeGreaterThan(blurRadiusFor("light"));
  });
});

describe("backgroundSupported", () => {
  afterEach(() => vi.clearAllMocks());

  it("reflects supportsBackgroundProcessors", () => {
    mockSupports.mockReturnValue(true);
    expect(backgroundSupported()).toBe(true);
    mockSupports.mockReturnValue(false);
    expect(backgroundSupported()).toBe(false);
  });

  it("returns false if the support check throws", () => {
    mockSupports.mockImplementation(() => {
      throw new Error("no webgl");
    });
    expect(backgroundSupported()).toBe(false);
  });
});
