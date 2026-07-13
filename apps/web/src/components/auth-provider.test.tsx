import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import arMessages from "../../messages/ar.json";
import { AppShell } from "@/components/app-shell";
import { AuthProvider } from "@/components/auth-provider";
import { ThemeProvider } from "@/components/theme-provider";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace }),
  usePathname: () => "/",
}));

const getMe = vi.fn();
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, getMe: () => getMe() };
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
    getMe.mockRejectedValue(new Error("401"));

    renderApp();

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
  });
});
