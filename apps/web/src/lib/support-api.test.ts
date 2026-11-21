import { beforeEach, describe, expect, it, vi } from "vitest";

// The screens' tests mock this module, so nothing there would notice a wrong path. These pin the real
// URLs: `apiFetch` prepends only the API ORIGIN, so every path must carry `/api` itself — without it
// the call reaches nginx as `/support/...` and 404s (live on 2026-11-21 for every client).

vi.mock("@/lib/api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/api")>()),
  apiFetch: vi.fn().mockResolvedValue({}),
}));

import { apiFetch } from "@/lib/api";
import * as support from "./support-api";

const paths = () => vi.mocked(apiFetch).mock.calls.map(([path]) => path as string);

describe("support-api paths", () => {
  beforeEach(() => vi.mocked(apiFetch).mockClear());

  it("sends every academy call under /api/support", async () => {
    await support.getSupportRequests();
    await support.getSupportSummary();
    await support.getSupportRequest("r1");
    await support.createSupportRequest({ kind: "PROBLEM", title: "t", body: "", priority: "NORMAL", files: [] });
    await support.replySupportRequest("r1", "hi", []);
    await support.withdrawSupportRequest("r1");

    expect(paths()).toEqual([
      "/api/support/requests",
      "/api/support/summary",
      "/api/support/requests/r1",
      "/api/support/requests",
      "/api/support/requests/r1/messages",
      "/api/support/requests/r1/withdraw",
    ]);
  });

  it("sends every inbox call under /api/admin/support", async () => {
    await support.getSupportInbox({ status: "OPEN", academyId: "a1" });
    await support.getSupportInboxSummary();
    await support.getSupportInboxRequest("r1");
    await support.respondSupportRequest("r1", { body: "x", files: [] });
    await support.updateSupportRequest("r1", { priority: "URGENT" });
    await support.logSupportRequest({
      academyId: "a1",
      kind: "CHANGE",
      title: "t",
      body: "",
      status: "DONE",
      priority: "NORMAL",
      files: [],
    });

    expect(paths()).toEqual([
      "/api/admin/support?filter%5Bstatus%5D=OPEN&filter%5Bacademy%5D=a1",
      "/api/admin/support/summary",
      "/api/admin/support/r1",
      "/api/admin/support/r1/messages",
      "/api/admin/support/r1",
      "/api/admin/support",
    ]);
    for (const path of paths()) expect(path.startsWith("/api/")).toBe(true);
  });
});
