import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __clearTenantSiteCache, resolveTenantSite } from "@/lib/tenant-site";

/**
 * The subdomain → product resolver runs in middleware, on every request to every client host, so
 * what matters as much as the mapping is what it does when it cannot ask: memoise, then fall back
 * (docs/lms/02).
 */

const OK = {
  kind: "MANAGEMENT",
  academy: {
    name: "Noor Academy",
    display_name: "Noor",
    logo_url: "https://cdn.test/noor.png",
    subdomain: "noor",
    status: "ACTIVE",
  },
};

function answer(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

const fetchMock = vi.fn();

beforeEach(() => {
  __clearTenantSiteCache();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("resolveTenantSite", () => {
  it("maps the API's answer and asks for the handle it was given", async () => {
    fetchMock.mockImplementation(() => answer(OK));

    const site = await resolveTenantSite("NOOR");

    expect(site).toEqual({
      kind: "MANAGEMENT",
      academy: {
        name: "Noor Academy",
        displayName: "Noor",
        logoUrl: "https://cdn.test/noor.png",
        subdomain: "noor",
        status: "ACTIVE",
      },
    });
    // Handles are case-insensitive; the API is asked in lower case.
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init.headers as Record<string, string>)["X-Academy"]).toBe("noor");
  });

  it("answers a repeat from memory instead of the network", async () => {
    fetchMock.mockImplementation(() => answer(OK));

    await resolveTenantSite("noor");
    await resolveTenantSite("noor");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports a handle nobody owns as null", async () => {
    fetchMock.mockImplementation(() => answer({}, 404));

    await expect(resolveTenantSite("nobody")).resolves.toBeNull();
  });

  it("keeps serving the last known answer when the API is unreachable", async () => {
    fetchMock.mockImplementationOnce(() => answer({ ...OK, kind: "LMS" }));
    expect((await resolveTenantSite("skills"))?.kind).toBe("LMS");

    // Past the freshness window, so it really does re-ask — and the API is down.
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 61_000);
    fetchMock.mockImplementation(() => Promise.reject(new Error("down")));

    expect((await resolveTenantSite("skills"))?.kind).toBe("LMS");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("assumes the management sign-in when it has never resolved the handle", async () => {
    fetchMock.mockImplementation(() => Promise.reject(new Error("down")));

    const site = await resolveTenantSite("brandnew");

    expect(site?.kind).toBe("MANAGEMENT");
    expect(site?.academy.displayName).toBe(""); // unbranded, so the login renders generically
  });
});
