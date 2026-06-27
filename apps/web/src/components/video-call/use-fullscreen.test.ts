import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useFullscreen } from "./use-fullscreen";

function define(prop: string, value: unknown) {
  Object.defineProperty(document, prop, { value, configurable: true });
}
function setFullscreenElement(el: Element | null) {
  define("fullscreenElement", el);
}

describe("useFullscreen", () => {
  afterEach(() => {
    setFullscreenElement(null);
    vi.restoreAllMocks();
  });

  it("reports support from document.fullscreenEnabled", () => {
    define("fullscreenEnabled", true);
    expect(renderHook(() => useFullscreen()).result.current.supported).toBe(true);
    define("fullscreenEnabled", false);
    expect(renderHook(() => useFullscreen()).result.current.supported).toBe(false);
  });

  it("requests fullscreen when inactive and exits when active", async () => {
    define("fullscreenEnabled", true);
    const req = vi.fn().mockResolvedValue(undefined);
    const exit = vi.fn().mockResolvedValue(undefined);
    document.documentElement.requestFullscreen = req;
    document.exitFullscreen = exit;

    const { result } = renderHook(() => useFullscreen());

    setFullscreenElement(null);
    await act(async () => {
      await result.current.toggle();
    });
    expect(req).toHaveBeenCalledTimes(1);
    expect(exit).not.toHaveBeenCalled();

    setFullscreenElement(document.body);
    await act(async () => {
      await result.current.toggle();
    });
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it("tracks fullscreenchange events", () => {
    define("fullscreenEnabled", true);
    const { result } = renderHook(() => useFullscreen());
    expect(result.current.isFullscreen).toBe(false);

    setFullscreenElement(document.body);
    act(() => document.dispatchEvent(new Event("fullscreenchange")));
    expect(result.current.isFullscreen).toBe(true);

    setFullscreenElement(null);
    act(() => document.dispatchEvent(new Event("fullscreenchange")));
    expect(result.current.isFullscreen).toBe(false);
  });
});
