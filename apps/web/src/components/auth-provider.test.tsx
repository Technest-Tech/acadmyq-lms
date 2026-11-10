import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import arMessages from "../../messages/ar.json";
import { AppShell } from "@/components/app-shell";
import { AuthProvider } from "@/components/auth-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { ApiError } from "@/lib/api";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace }),
  usePathname: () => "/",
}));

const getMe = vi.fn();
const exitAcademy = vi.fn();
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, getMe: () => getMe(), exitAcademy: () => exitAcademy() };
});

/** Mirrors the real tree: root layout supplies ThemeProvider, (app)/layout the auth + shell. */
function renderApp() {
  return render(
    <ThemeProvider>
      <NextIntlClientProvider locale="ar" messages={arMessages}>
        <AuthProvider>
          <AppShell>
            <p>dashboard</p>
          </AppShell>
        </AuthProvider>
      </NextIntlClientProvider>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  replace.mockClear();
  getMe.mockReset();
});

describe("AuthProvider route protection (AC-2.13)", () => {
  it("renders the shell once /auth/me resolves a session", async () => {
    getMe.mockResolvedValue({
      user: { id: "u1", fullName: "Owner Noor", email: "o@x.test" },
      role: "ACADEMY_OWNER",
      academyId: "a1",
      permissions: ["student.read"],
      locale: "ar",
    });

    renderApp();

    expect(await screen.findByTestId("sidebar")).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it("redirects to /login when there is no valid session", async () => {
    getMe.mockRejectedValue(new ApiError(401, "Unauthenticated."));

    renderApp();

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
    expect(getMe).toHaveBeenCalledTimes(1);
  });

  it("does not sign anyone out over one dropped /auth/me — it asks again first", async () => {
    getMe
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue({
        user: { id: "u1", fullName: "Owner Noor", email: "o@x.test" },
        role: "ACADEMY_OWNER",
        academyId: "a1",
        permissions: ["student.read"],
        locale: "ar",
      });

    renderApp();

    expect(await screen.findByTestId("sidebar", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(getMe).toHaveBeenCalledTimes(2);
    expect(replace).not.toHaveBeenCalledWith("/login");
  });

  it("redirects to /login when a session idles out mid-use (any API 401)", async () => {
    getMe.mockResolvedValue({
      user: { id: "u1", fullName: "Owner Noor", email: "o@x.test" },
      role: "ACADEMY_OWNER",
      academyId: "a1",
      permissions: ["student.read"],
      locale: "ar",
    });
    renderApp();
    expect(await screen.findByTestId("sidebar")).toBeInTheDocument();

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "Unauthenticated." }), { status: 401 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { apiFetch } = await import("@/lib/api");
    await expect(apiFetch("/api/courses/products")).rejects.toThrow("Unauthenticated.");
    vi.unstubAllGlobals();

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
  });
});

describe("AuthProvider — leaving an entered academy", () => {
  it("returns to the client's page with a full load, not the academy page it was on", async () => {
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: { ...original, assign } });
    try {
      getMe.mockResolvedValue({
        user: { id: "u1", fullName: "Platform Admin", email: "a@x.test" },
        role: "SUPER_ADMIN",
        academyId: "acad-7",
        permissions: ["academy.read", "academy.enter", "student.read"],
        locale: "ar",
        capabilities: [],
        academy: { name: "Al-Furqan", displayName: "Al-Furqan", logoUrl: null },
      });
      exitAcademy.mockResolvedValue({ ok: true });

      renderApp();
      const banner = await screen.findByTestId("entered-academy");
      await userEvent.click(within(banner).getByRole("button"));

      await waitFor(() => expect(assign).toHaveBeenCalledWith("/admin/clients/acad-7"));
      expect(exitAcademy).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: original });
    }
  });
});
