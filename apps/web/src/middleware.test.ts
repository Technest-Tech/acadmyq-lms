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
  resolveTenantSite: (key: string | { host: string }) => resolveTenantSite(key),
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
async function run(
  host: string,
  path: string,
  root: string | null = "acadmyq.com",
  customDomains = false,
) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_ROOT_DOMAIN", root ?? "");
  vi.stubEnv("NEXT_PUBLIC_CUSTOM_DOMAINS", customDomains ? "1" : "");

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
    /** The route the root layout is told is rendering (after any rewrite). */
    pathname: res.headers.get("x-middleware-request-x-pathname"),
    status: res.status,
    /** Where the visitor is sent, for a real (non-rewrite) redirect. */
    location: res.headers.get("location"),
  };
}

beforeEach(() => resolveTenantSite.mockReset());
afterEach(() => vi.unstubAllEnvs());

/**
 * The root layout decides how much of the translation catalogue to serialise from this header, so
 * it has to name the route that actually RENDERS — which after a rewrite is not the path the
 * visitor typed. Getting this wrong would hand a client's course site the marketing page's tiny
 * message set and blank every label on it.
 */
describe("the pathname handed to the render", () => {
  it("names the requested path on the platform host", async () => {
    expect((await run("acadmyq.com", "/course-platform")).pathname).toBe("/course-platform");
  });

  it("is set even when subdomain routing is switched off", async () => {
    expect((await run("acadmyq.com", "/contact", null)).pathname).toBe("/contact");
  });

  it("names the REWRITTEN path for a course-platform client's home page", async () => {
    resolveTenantSite.mockResolvedValue(LMS);

    expect((await run("skills.acadmyq.com", "/")).pathname).toBe("/learn/skills");
    expect((await run("skills.acadmyq.com", "/courses")).pathname).toBe("/learn/skills/courses");
  });

  it("names /login for a management client's branded front door", async () => {
    resolveTenantSite.mockResolvedValue(MANAGEMENT);

    expect((await run("noor.acadmyq.com", "/")).pathname).toBe("/login");
  });
});

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

  it("serves the public invoice page on any client host — payment links live there", async () => {
    resolveTenantSite.mockResolvedValue(LMS);

    // A course-platform host would otherwise wrap it into /learn/<handle>/i/…, a 404.
    expect((await run("skills.acadmyq.com", "/i/tok123")).rewrite).toBeNull();
    expect((await run("courses.skills.eg", "/i/tok123", "acadmyq.com", true)).rewrite).toBeNull();
  });
});

/**
 * A client's own domain (docs/custom-domains). The host spells no handle, so it is resolved by
 * lookup — and everything after that lookup is the same routing the platform subdomain gets.
 */
describe("custom domains", () => {
  const OWN_LMS = {
    kind: "LMS",
    academy: {
      name: "Skills",
      displayName: "Skills",
      logoUrl: null,
      subdomain: "skills",
      status: "ACTIVE",
    },
  };
  const OWN_MANAGEMENT = { ...OWN_LMS, kind: "MANAGEMENT", academy: { ...OWN_LMS.academy, subdomain: "noor" } };

  it("is off by default — an unknown host is not a client address", async () => {
    const { rewrite, status } = await run("portal.noor.edu", "/");

    expect(rewrite).toBeNull();
    expect(status).not.toBe(404);
    expect(resolveTenantSite).not.toHaveBeenCalled();
  });

  it("opens a management client's own domain on their branded sign-in", async () => {
    resolveTenantSite.mockResolvedValue(OWN_MANAGEMENT);

    const { rewrite, academy } = await run("portal.noor.edu", "/", "acadmyq.com", true);

    // Looked up by HOST — the handle is the answer, not the key.
    expect(resolveTenantSite).toHaveBeenCalledWith({ host: "portal.noor.edu" });
    expect(rewrite).toBe("https://portal.noor.edu/login");
    expect(academy).toBe("noor");
  });

  it("serves a course site from the client's own domain at its root", async () => {
    resolveTenantSite.mockResolvedValue(OWN_LMS);

    expect((await run("courses.skills.eg", "/", "acadmyq.com", true)).rewrite).toBe(
      "https://courses.skills.eg/learn/skills",
    );
    expect((await run("courses.skills.eg", "/courses", "acadmyq.com", true)).rewrite).toBe(
      "https://courses.skills.eg/learn/skills/courses",
    );
  });

  it("404s a host nobody has claimed instead of serving it the marketing site", async () => {
    resolveTenantSite.mockResolvedValue(null);

    const { status, rewrite } = await run("someone-elses.example", "/", "acadmyq.com", true);

    expect(status).toBe(404);
    expect(rewrite).toBeNull();
  });

  it("never mistakes the platform's own hosts for a custom domain", async () => {
    expect((await run("acadmyq.com", "/", "acadmyq.com", true)).rewrite).toBeNull();
    expect((await run("app.acadmyq.com", "/login", "acadmyq.com", true)).rewrite).toBeNull();
    // `connect` is the real DNS-only CNAME target clients aim at — a reserved platform host, not
    // a handle. It was missing from the router's list and served a course-site 404 instead.
    expect((await run("connect.acadmyq.com", "/", "acadmyq.com", true)).rewrite).toBeNull();
    expect(resolveTenantSite).not.toHaveBeenCalled();
  });

  it("leaves an already-routed path alone on a custom domain too", async () => {
    expect((await run("courses.skills.eg", "/learn/skills/x", "acadmyq.com", true)).rewrite).toBeNull();
    expect((await run("courses.skills.eg", "/api/health", "acadmyq.com", true)).rewrite).toBeNull();
    expect(resolveTenantSite).not.toHaveBeenCalled();
  });
});
