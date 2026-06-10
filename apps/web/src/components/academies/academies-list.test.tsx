import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import type { AcademyListItem } from "@/lib/api";
import enMessages from "../../../messages/en.json";
import { AcademiesList } from "./academies-list";

function row(overrides: Partial<AcademyListItem> = {}): AcademyListItem {
  return {
    id: "a1",
    name: "Noor Academy",
    status: "ACTIVE",
    plan_id: "p1",
    plan_code: "PRO",
    default_currency: "EGP",
    timezone: "Africa/Cairo",
    invoice_grouping: "PER_GUARDIAN",
    subdomain: "noor",
    student_count: 12,
    teacher_count: 3,
    ...overrides,
  };
}

function renderList(
  academies: AcademyListItem[],
  onNew = vi.fn(),
  onOpen = vi.fn(),
) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <AcademiesList academies={academies} onNew={onNew} onOpen={onOpen} />
    </NextIntlClientProvider>,
  );
  return { onNew, onOpen };
}

describe("AcademiesList (Sprint 3 §7)", () => {
  it("renders status, plan, currency and counts per academy", () => {
    renderList([row({ student_count: 12, teacher_count: 3 })]);

    const tr = screen.getByText("Noor Academy").closest("tr")!;
    expect(tr).toHaveTextContent("Active");
    expect(tr).toHaveTextContent("PRO");
    expect(tr).toHaveTextContent("EGP");
    expect(tr).toHaveTextContent("12");
    expect(tr).toHaveTextContent("3");
  });

  // TC-3.26 (UI side): branding (subdomain/logo) is reserved — never surfaced.
  it("does not surface the subdomain/branding anywhere", () => {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <AcademiesList
          academies={[row({ subdomain: "secret-sub" })]}
          onNew={vi.fn()}
          onOpen={vi.fn()}
        />
      </NextIntlClientProvider>,
    );
    expect(container.textContent).not.toContain("secret-sub");
  });

  it("invokes onNew and onOpen", async () => {
    const user = userEvent.setup();
    const { onNew, onOpen } = renderList([row()]);

    await user.click(screen.getByTestId("new-academy"));
    expect(onNew).toHaveBeenCalledOnce();

    await user.click(screen.getByText(enMessages.academies.manage));
    expect(onOpen).toHaveBeenCalledWith("a1");
  });

  it("shows the empty state with no academies", () => {
    renderList([]);
    expect(screen.getByText(enMessages.academies.empty)).toBeInTheDocument();
  });
});
