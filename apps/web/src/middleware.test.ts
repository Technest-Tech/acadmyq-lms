import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Subdomain routing (docs/lms/02): one address space, two products. A course-platform client's
 * handle serves the public course site; every other client's handle serves the management app,
 * opening on their own branded sign-in.
 *
 * `NEXT_PUBLIC_ROOT_DOMAIN` is read when the module loads, so each case (re-)imports the middleware
 * after stubbing the env — that is also what proves the "unset ⇒ pure pass-through" contract.
 */

const resolveTenantSite = vi.fn();
vi.mock("@/lib/tenant-site", () => ({
  resolveTenantSite: (handle: string) => resolveTenantSite(handle),
}));

const MANAGEMENT = {
  kind: "MANAGEMENT",
  academy: {
    name: "Noor",
    displayName: "Noor",
    logoUrl: null,
    subdomain: "noor",
    status: "ACTIVE",
  },
};
const LMS = { ...MANAGEMENT, kind: "LMS" };

/** `root: null` is "subdomain routing not configured" — the opt-in switch being off. */
async function run(host: string, path: string, root: string | null = "acadmyq.com") {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_ROOT_DOMAIN", root ?? "");

  const { middleware } = await import("./middleware");
  const req = new NextRequest(`https://${host}${path}`, {
    headers: { host },
  });

  const res = await middleware(req);

  return {
    /** The internal destination, or null when the request passed through untouched. */
    rewrite: res.headers.get("x-middleware-rewrite"),
    /** The handle handed to the render, if any. */
    academy: res.headers.get("x-middleware-request-x-academy"),
    status: res.status,
    /** Where the visitor is sent, for a real (non-rewrite) redirect. */
    location: res.headers.get("location"),
  };
}

beforeEach(() => resolveTenantSite.mockReset());
afterEach(() => vi.unstubAllEnvs());

describe("subdomain routing", () => {
  it("passes everything through when no root domain is configured", async () => {
    const { rewrite } = await run("noor.acadmyq.com", "/", null);

    expect(rewrite).toBeNull();
    expect(resolveTenantSite).not.toHaveBeenCalled();
  });

  it("matches every configured root, so a second dev host is still a client address", async () => {
    resolveTenantSite.mockResolvedValue(MANAGEMENT);

    const { rewrite, academy } = await run(
      "noor.localhost",
      "/",
      "lvh.me:3000,localhost:3000",
    );

    expect(rewrite).toBe("https://noor.localhost/login");
    expect(academy).toBe("noor");
  });

  it("redirects www to the canonical apex, keeping the path and the port", async () => {
    const { status, location } = await run("www.acadmyq.com", "/course-platform");

    expect(status).toBe(308);
    expect(location).toBe("https://acadmyq.com/course-platform");
    // `www` is the platform, never a client handle — nothing is resolved for it.
    expect(resolveTenantSite).not.toHaveBeenCalled();
  });

  it("keeps the dev port when redirecting www locally", async () => {
    const { location } = await run("www.lvh.me", "/contact", "lvh.me:3000");

    expect(location).toBe("https://lvh.me/contact");
  });

  it("leaves the platform's own hosts alone", async () => {
    expect((await run("acadmyq.com", "/")).rewrite).toBeNull();
    expect((await run("app.acadmyq.com", "/login")).rewrite).toBeNull();
    // A host under no configured root is not a client address either.
    expect((await run("noor.localhost", "/")).rewrite).toBeNull();
    expect(resolveTenantSite).not.toHaveBeenCalled();
  });

  it("opens a management client's host on their branded sign-in", async () => {
    resolveTenantSite.mockResolvedValue(MANAGEMENT);

    const { rewrite, academy } = await run("noor.acadmyq.com", "/");

    expect(rewrite).toBe("https://noor.acadmyq.com/login");
    expect(academy).toBe("noor");
  });

  it("passes the rest of a management client's host to the app, carrying the handle", async () => {
    resolveTenantSite.mockResolvedValue(MANAGEMENT);

    const { rewrite, academy } = await run("noor.acadmyq.com", "/students");

    expect(rewrite).toBeNull(); // the app routes are host-agnostic — no rewrite needed
    expect(academy).toBe("noor");
  });

  it("still serves a course-platform client their course site", async () => {
    resolveTenantSite.mockResolvedValue(LMS);

    expect((await run("skills.acadmyq.com", "/")).rewrite).toBe(
      "https://skills.acadmyq.com/learn/skills",
    );
    expect((await run("skills.acadmyq.com", "/courses")).rewrite).toBe(
      "https://skills.acadmyq.com/learn/skills/courses",
    );
  });

  it("sends an unknown handle to the course site's 404", async () => {
    resolveTenantSite.mockResolvedValue(null);

    expect((await run("nobody.acadmyq.com", "/")).rewrite).toBe(
      "https://nobody.acadmyq.com/learn/nobody",
    );
  });

  it("never re-wraps an already-learner path or an API call", async () => {
    resolveTenantSite.mockResolvedValue(LMS);

    expect((await run("skills.acadmyq.com", "/learn/skills/courses")).rewrite).toBeNull();
    expect((await run("skills.acadmyq.com", "/api/health")).rewrite).toBeNull();
    expect(resolveTenantSite).not.toHaveBeenCalled();
  });
});
