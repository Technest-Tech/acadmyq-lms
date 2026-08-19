import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import arMessages from "../../../messages/ar.json";
import enMessages from "../../../messages/en.json";
import { ApiError } from "@/lib/api";
import { LoginScreen } from "./login-screen";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace }),
}));

const login = vi.fn();
const getMe = vi.fn();
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    login: (...args: unknown[]) => login(...args),
    getMe: () => getMe(),
  };
});

const NOOR = { handle: "noor", name: "Noor Academy", logoUrl: null };

function renderLogin(
  brand: { handle: string; name: string; logoUrl: string | null } | null = null,
  locale: "ar" | "en" = "en",
) {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "ar" ? arMessages : enMessages}
    >
      <LoginScreen brand={brand} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  replace.mockClear();
  login.mockReset();
  getMe.mockReset();
  getMe.mockRejectedValue(new ApiError(401, "unauthenticated"));
});

describe("LoginPage (TC-2.1 / TC-2.2)", () => {
  it("submits credentials and redirects to the dashboard on success", async () => {
    login.mockResolvedValue({ role: "ACADEMY_OWNER", academyId: "a1" });
    const user = userEvent.setup();
    renderLogin();

    await user.type(
      screen.getByLabelText(enMessages.auth.email),
      "owner@noor.test",
    );
    await user.type(
      screen.getByLabelText(enMessages.auth.password),
      "password",
    );
    await user.click(
      screen.getByRole("button", { name: enMessages.auth.signIn }),
    );

    await waitFor(() =>
      expect(login).toHaveBeenCalledWith(
        "owner@noor.test",
        "password",
        undefined,
      ),
    );
    expect(replace).toHaveBeenCalledWith("/dashboard");
  });

  it("shows a neutral error and does not redirect on bad credentials", async () => {
    login.mockRejectedValue(new ApiError(422, "nope"));
    const user = userEvent.setup();
    renderLogin();

    await user.type(
      screen.getByLabelText(enMessages.auth.email),
      "owner@noor.test",
    );
    await user.type(screen.getByLabelText(enMessages.auth.password), "wrong");
    await user.click(
      screen.getByRole("button", { name: enMessages.auth.signIn }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      enMessages.auth.invalidCredentials,
    );
    expect(replace).not.toHaveBeenCalled();
  });
});

// ── the client's own door: branded, tenant-bound, and skipped for a live session ──
describe("LoginScreen on a client subdomain", () => {
  it("wears the client's identity and posts its handle with the attempt", async () => {
    login.mockResolvedValue({ role: "ACADEMY_OWNER", academyId: "a1" });
    const user = userEvent.setup();
    renderLogin(NOOR);

    // The card carries the client's identity — their name, and the neutral card line under it.
    expect(await screen.findByRole("heading", { name: NOOR.name })).toBeInTheDocument();
    expect(screen.getByText(enMessages.login.cardSubtitle)).toBeInTheDocument();
    // ...and none of the platform's sales copy.
    expect(screen.queryByText(enMessages.login.heroSubtitle)).not.toBeInTheDocument();

    await user.type(
      screen.getByLabelText(enMessages.auth.email),
      "owner@noor.test",
    );
    await user.type(screen.getByLabelText(enMessages.auth.password), "password");
    await user.click(
      screen.getByRole("button", { name: enMessages.auth.signIn }),
    );

    await waitFor(() =>
      expect(login).toHaveBeenCalledWith("owner@noor.test", "password", "noor"),
    );
    expect(replace).toHaveBeenCalledWith("/dashboard");
  });

  it("sends a visitor who already has a session straight to the dashboard", async () => {
    getMe.mockResolvedValue({ role: "ACADEMY_OWNER", academyId: "a1" });
    renderLogin(NOOR);

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/dashboard"));
    expect(login).not.toHaveBeenCalled();
  });

  it("never checks for a session on the platform login", async () => {
    renderLogin(null);

    expect(screen.getByText(enMessages.auth.signInSubtitle)).toBeInTheDocument();
    expect(getMe).not.toHaveBeenCalled();
  });
});
