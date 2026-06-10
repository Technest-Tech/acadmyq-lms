import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import arMessages from "../../../messages/ar.json";
import enMessages from "../../../messages/en.json";
import { ApiError } from "@/lib/api";
import LoginPage from "./page";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace }),
}));

const login = vi.fn();
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, login: (...args: unknown[]) => login(...args) };
});

function renderLogin(locale: "ar" | "en" = "en") {
  return render(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "ar" ? arMessages : enMessages}
    >
      <LoginPage />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  replace.mockClear();
  login.mockReset();
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
      expect(login).toHaveBeenCalledWith("owner@noor.test", "password"),
    );
    expect(replace).toHaveBeenCalledWith("/");
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
