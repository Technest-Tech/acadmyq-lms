import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import arMessages from "../../messages/ar.json";
import { LocaleSwitcher } from "./locale-switcher";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

function renderSwitcher() {
  return render(
    <NextIntlClientProvider locale="ar" messages={arMessages}>
      <LocaleSwitcher />
    </NextIntlClientProvider>,
  );
}

describe("LocaleSwitcher", () => {
  it("switches to English: persists cookie + refreshes (TC-0.13)", async () => {
    const user = userEvent.setup();
    renderSwitcher();

    await user.click(screen.getByRole("button", { name: "English" }));

    expect(document.cookie).toContain("NEXT_LOCALE=en");
    expect(refresh).toHaveBeenCalled();
  });

  it("switches back to Arabic: persists cookie (TC-0.14)", async () => {
    const user = userEvent.setup();
    renderSwitcher();

    await user.click(screen.getByRole("button", { name: "العربية" }));

    expect(document.cookie).toContain("NEXT_LOCALE=ar");
  });

  it("marks the active locale as pressed", () => {
    renderSwitcher();
    expect(screen.getByRole("button", { name: "العربية" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
