import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import arMessages from "../../../messages/ar.json";
import { makeSession, withAuth } from "@/test/auth";
import { formatHours } from "@/lib/time";
import type { LessonPackageRow, LessonPackageSummary } from "@/lib/api";
import { PackagesManager } from "./packages-manager";

/**
 * The screen is a read of the engine, so these tests pin the two things the UI is actually
 * responsible for: showing a balance that matches what the server sent, and putting the right
 * rows behind the "needs attention" cut — the same set the sidebar badge counts.
 */

const listLessonPackages = vi.fn();
const getLessonPackageSummary = vi.fn();
const syncLessonPackage = vi.fn();
const sendInvoicePaymentLink = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  listLessonPackages: (...args: unknown[]) => listLessonPackages(...args),
  getLessonPackageSummary: () => getLessonPackageSummary(),
  syncLessonPackage: (id: string) => syncLessonPackage(id),
  sendInvoicePaymentLink: (id: string) => sendInvoicePaymentLink(id),
  listPackageStudents: () => Promise.resolve({ students: [] }),
}));

function pkg(overrides: Partial<LessonPackageRow> = {}): LessonPackageRow {
  return {
    id: "p1",
    student_id: "s1",
    student_name: "Sara",
    label: "20 hours",
    sequence_no: 1,
    status: "ACTIVE",
    bill_timing: "ON_START",
    minutes_total: 1200,
    carried_over_minutes: 0,
    minutes_sold: 1200,
    minutes_consumed: 600,
    minutes_remaining: 600,
    minutes_overdrawn: 0,
    lesson_count: 10,
    upcoming_lesson_count: 4,
    next_lesson_at: "2026-09-08T10:00:00Z",
    percent_used: 50,
    price_minor: 400000,
    hourly_rate_minor: 20000,
    currency: "EGP",
    starts_on: "2026-09-01",
    expires_on: null,
    closed_at: null,
    closed_reason: null,
    invoice_id: "i1",
    invoice_status: "OPEN",
    invoice_token: "tok",
    outstanding_minor: 0,
    overdraft_billed: false,
    created_at: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

const summary: LessonPackageSummary = {
  active: 1,
  lowBalance: 0,
  needsBilling: 0,
  pendingOverdraft: 0,
  unpaid: 1,
  total: 1,
};

function renderManager(extraPermissions: string[] = []) {
  return render(
    withAuth(
      makeSession("ACADEMY_OWNER", {
        permissions: ["package.read", "package.manage", ...extraPermissions],
      }),
      <PackagesManager />,
    ),
  );
}

beforeEach(() => {
  getLessonPackageSummary.mockResolvedValue(summary);
  syncLessonPackage.mockResolvedValue({ imported: 2, skipped_locked: 0 });
  sendInvoicePaymentLink.mockResolvedValue({
    phone: "+201001112222",
    message: "Pay here",
    url: "https://app.test/i/tok",
    transport: "WASENDER",
    sent: true,
  });
});

describe("PackagesManager", () => {
  it("renders the live balance in hours, not fractions", async () => {
    listLessonPackages.mockResolvedValue({
      packages: [pkg({ minutes_consumed: 630, minutes_remaining: 570 })],
    });

    renderManager();

    // The screen opens on the work queue, and a half-used healthy package is not work — so the
    // whole record has to be asked for before this row exists at all.
    await userEvent.click(
      await screen.findByRole("button", {
        name: arMessages.packages.segments.all,
      }),
    );

    const card = await screen.findByTestId("package-card");
    // 570 minutes reads as 9h 30m — never "9.5h", and never a raw minute count. The harness
    // renders in Arabic, so this also pins the Arabic-Indic digits (R-LOC).
    expect(card.textContent).toContain(formatHours(570, "ar"));
    expect(card.textContent).not.toContain("570");
  });

  it("puts an overdrawn package in the attention cut and reports how far past it went", async () => {
    listLessonPackages.mockResolvedValue({
      packages: [
        pkg({
          id: "p2",
          status: "COMPLETED",
          minutes_consumed: 1260,
          minutes_remaining: 0,
          minutes_overdrawn: 60,
          percent_used: 100,
          outstanding_minor: 400000,
          overdraft_billed: false,
        }),
      ],
    });

    renderManager();

    const card = await screen.findByTestId("package-card");
    expect(card.textContent).toContain(formatHours(60, "ar"));
    // Stranded overdraft on a paid-up-front package → the escape-hatch action is offered.
    expect(
      within(card).getByText(arMessages.packages.actions.billOverdraft),
    ).toBeInTheDocument();
  });

  it("hides a healthy package from the attention cut but shows it under All", async () => {
    listLessonPackages.mockResolvedValue({ packages: [pkg()] });

    renderManager();

    // Default cut is "needs attention", and a half-used, paid package is not that.
    expect(
      await screen.findByText(arMessages.packages.emptyAttention),
    ).toBeInTheDocument();

    await userEvent.click(
      screen.getByRole("button", { name: arMessages.packages.segments.all }),
    );
    expect(await screen.findByTestId("package-card")).toBeInTheDocument();
  });

  it("shows lesson, date, package total and payment actions on the richer card", async () => {
    listLessonPackages.mockResolvedValue({ packages: [pkg()] });
    renderManager(["invoice.send_link"]);

    await userEvent.click(
      await screen.findByRole("button", {
        name: arMessages.packages.segments.all,
      }),
    );
    const card = await screen.findByTestId("package-card");

    expect(card).toHaveTextContent(arMessages.packages.card.totalHours);
    expect(card).toHaveTextContent(arMessages.packages.card.lessonsUsed);
    expect(card).toHaveTextContent(arMessages.packages.card.startDate);
    expect(
      within(card).getByText(arMessages.packages.actions.paymentLink),
    ).toBeInTheDocument();
    expect(
      within(card).getByText(arMessages.packages.actions.sendPayment),
    ).toBeInTheDocument();
  });

  it("syncs historical lessons into an existing active package", async () => {
    listLessonPackages.mockResolvedValue({ packages: [pkg()] });
    renderManager();

    await userEvent.click(
      await screen.findByRole("button", {
        name: arMessages.packages.segments.all,
      }),
    );
    await userEvent.click(
      within(await screen.findByTestId("package-card")).getByText(
        arMessages.packages.actions.syncLessons,
      ),
    );

    expect(syncLessonPackage).toHaveBeenCalledWith("p1");
    expect(await screen.findByRole("status")).toHaveTextContent("2");
  });
});
