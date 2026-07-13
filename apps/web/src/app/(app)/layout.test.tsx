import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * The shell must be mounted by the (app) layout and nowhere else.
 *
 * A layout stays mounted across navigations within its segment; a page does not. When each page
 * wrapped itself in <AuthProvider><AppShell>, every navigation unmounted and remounted them —
 * blanking the sidebar to a full-screen spinner and re-fetching the session before any chrome
 * could paint. Re-introducing that wrapper anywhere under (app) silently brings the whole problem
 * back, and nothing else in the test suite would notice — hence this guard.
 */
describe("the authenticated shell is mounted once, by the layout", () => {
  const files = (pattern: string) =>
    execSync(
      `grep -rl "${pattern}" "src/app/(app)" --include=*.tsx || true`,
      { encoding: "utf8" },
    )
      .trim()
      .split("\n")
      .filter(Boolean)
      .filter((f) => !f.endsWith(".test.tsx"));

  it("has exactly one AppShell mount point: (app)/layout.tsx", () => {
    expect(files("<AppShell")).toEqual(["src/app/(app)/layout.tsx"]);
  });

  it("has exactly one AuthProvider mount point: (app)/layout.tsx", () => {
    expect(files("<AuthProvider")).toEqual(["src/app/(app)/layout.tsx"]);
  });
});
