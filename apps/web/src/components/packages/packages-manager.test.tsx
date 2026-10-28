import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import arMessages from "../../../messages/ar.json";
import { makeSession, withAuth } from "@/test/auth";
import { formatMoney, formatNumber } from "@/lib/money";
import { formatHours } from "@/lib/time";
import type { LessonPackageRow, LessonPackageSummary } from "@/lib/api";
import { PackagesManager } from "./packages-manager";

/**
 * The screen is a read of the engine, so these tests pin what the UI is actually responsible
 * for: showing a balance that matches what the server sent, putting each package on the right
 * page (Open / Finished), leading Finished with the rows the sidebar badge counts, and saying
 * out loud when a new block was opened over an unpaid one.
 */

const listLessonPackages = vi.fn();
const getLessonPackageSummary = vi.fn();
const syncLessonPackage = vi.fn();
const updateLessonPackage = vi.fn();
const sendInvoicePaymentLink = vi.fn();
const closeLessonPackage = vi.fn();
const remindLessonPackage = vi.fn();
const createFamilyPayLink = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  listLessonPackages: (...args: unknown[]) => listLessonPackages(...args),
  getLessonPackageSummary: () => getLessonPackageSummary(),
  syncLessonPackage: (id: string) => syncLessonPackage(id),
  updateLessonPackage: (id: string, input: unknown) =>
    updateLessonPackage(id, input),
  sendInvoicePaymentLink: (id: string) => sendInvoicePaymentLink(id),
  closeLessonPackage: (
    id: string,
    reason?: string,
    returnToMonthly?: boolean,
  ) => closeLessonPackage(id, reason, returnToMonthly),
  remindLessonPackage: (id: string, locale: string) =>
    remindLessonPackage(id, locale),
  listPackageStudents: () => Promise.resolve({ students: [] }),
  createFamilyPayLink: (id: string) => createFamilyPayLink(id),
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
    invoice_total_minor: 400000,
    invoice_paid_minor: 400000,
    outstanding_minor: 0,
    payment_method: null,
    payment_reason: null,
    paid_at: null,
    payment_reference: null,
    payment_proof_url: null,
    overdraft_billed: false,
    overdraft_absorbed_into: null,
    absorbed_overdraft_minutes: 0,
    auto_renew: true,
    opened_automatically: false,
    awaiting_next_package: false,
    gap: null,
    follow_up: false,
    due: false,
    previous_unpaid: null,
    reminders_sent: 0,
    last_reminded_at: null,
    created_at: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

const summary: LessonPackageSummary = {
  active: 1,
  completed: 1,
  cancelled: 0,
  lowBalance: 0,
  needsBilling: 0,
  pendingOverdraft: 0,
  unpaid: 1,
  outOfHours: 0,
  finishedAttention: 1,
  due: 2,
  dueAmounts: [{ currency: "EGP", amount_minor: 550000 }],
  total: 1,
  financials: [
    {
      currency: "EGP",
      active_value_minor: 400000,
      completed_value_minor: 200000,
      collected_minor: 450000,
      outstanding_minor: 150000,
      completed_outstanding_minor: 150000,
    },
  ],
};

function renderManager(
  extraPermissions: string[] = [],
  view: "due" | "open" | "finished" = "open",
) {
  return render(
    withAuth(
      makeSession("ACADEMY_OWNER", {
        permissions: ["package.read", "package.manage", ...extraPermissions],
      }),
      <PackagesManager view={view} />,
    ),
  );
}

/** Everything past the card's first two actions lives behind "⋯". */
async function openCardMenu() {
  await userEvent.click(
    within(await screen.findByTestId("package-card")).getByTestId(
      "package-card-menu",
    ),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getLessonPackageSummary.mockResolvedValue(summary);
  updateLessonPackage.mockResolvedValue({
    ok: true,
    changed: ["price_minor"],
    invoice_id: "i1",
  });
  syncLessonPackage.mockResolvedValue({ imported: 2, skipped_locked: 0 });
  closeLessonPackage.mockResolvedValue({
    ok: true,
    invoice_id: "i1",
    returned_to_monthly: true,
  });
  sendInvoicePaymentLink.mockResolvedValue({
    phone: "+201001112222",
    message: "Pay here",
    url: "https://app.test/i/tok",
    transport: "WASENDER",
    sent: true,
  });
  remindLessonPackage.mockResolvedValue({
    kind: "PAYMENT",
    phone: "+201001112222",
    message: "Reminder",
    transport: "DEEPLINK",
    sent: false,
    deeplink: "https://wa.me/201001112222?text=Reminder",
    reminders_sent: 3,
    last_reminded_at: "2026-10-12T09:30:00Z",
  });
});

describe("PackagesManager", () => {
  it("renders the live balance in hours, not fractions", async () => {
    listLessonPackages.mockResolvedValue({
      packages: [pkg({ minutes_consumed: 630, minutes_remaining: 570 })],
    });

    renderManager();

    const card = await screen.findByTestId("package-card");
    // 570 minutes reads as 9h 30m — never "9.5h", and never a raw minute count. The harness
    // renders in Arabic, so this also pins the Arabic-Indic digits (R-LOC).
    expect(card.textContent).toContain(formatHours(570, "ar"));
    expect(card.textContent).not.toContain("570");
  });

  it("puts an overdrawn package on the finished follow-up list and reports how far past it went", async () => {
    listLessonPackages.mockResolvedValue({
      packages: [
        pkg({
          id: "p2",
          status: "COMPLETED",
          follow_up: true,
          minutes_consumed: 1260,
          minutes_remaining: 0,
          minutes_overdrawn: 60,
          percent_used: 100,
          outstanding_minor: 400000,
          overdraft_billed: false,
        }),
      ],
    });

    renderManager([], "finished");

    const card = await screen.findByTestId("package-card");
    expect(card.textContent).toContain(formatHours(60, "ar"));
    // Stranded with no next package to absorb it → the escape hatch exists, but only in the menu.
    expect(
      within(card).queryByText(arMessages.packages.actions.billOverdraft),
    ).toBeNull();
    await openCardMenu();
    expect(await screen.findByTestId("bill-overdraft")).toBeInTheDocument();
  });

  it("says an overdraft went into the next package, and offers nothing to bill for it", async () => {
    listLessonPackages.mockResolvedValue({
      packages: [
        pkg({
          id: "p2",
          status: "COMPLETED",
          minutes_consumed: 1260,
          minutes_remaining: 0,
          minutes_overdrawn: 60,
          percent_used: 100,
          overdraft_absorbed_into: 2,
        }),
      ],
    });

    renderManager([], "finished");

    // Paid up front and the extra minutes are the next block's — nothing left to collect, so it
    // sits on the Paid tab, green.
    await userEvent.click(await screen.findByTestId("finished-tab-paid"));
    const card = await screen.findByTestId("package-card");
    expect(within(card).getByTestId("overdraft-absorbed")).toBeInTheDocument();
    expect(card).toHaveAttribute("data-paid", "true");
    expect(screen.queryByTestId("bill-overdraft")).toBeNull();
  });

  it("leads an unpaid finished package with Mark as paid, and its number", async () => {
    listLessonPackages.mockResolvedValue({
      packages: [
        pkg({
          id: "p2",
          status: "COMPLETED",
          sequence_no: 3,
          follow_up: true,
          minutes_remaining: 0,
          outstanding_minor: 400000,
          invoice_paid_minor: 0,
        }),
      ],
    });

    renderManager(["invoice.send_link", "invoice.mark_paid"], "finished");

    const card = await screen.findByTestId("package-card");
    expect(within(card).getByTestId("package-number")).toHaveTextContent(
      arMessages.packages.card.packageNo.replace("{n}", "3"),
    );
    // On the card itself, ahead of the reminder — not behind "⋯".
    const markPaid = within(card).getByTestId("mark-package-paid");
    const remind = within(card).getByTestId("remind-package");
    expect(
      markPaid.compareDocumentPosition(remind) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("puts every package with money owed on Due — open or finished — oldest first, and totals it", async () => {
    listLessonPackages.mockResolvedValue({
      packages: [
        // Opened today, paid up front, not yet paid: due on day one.
        pkg({
          id: "p-open",
          student_id: "s-mona",
          student_name: "Mona",
          due: true,
          outstanding_minor: 400000,
          invoice_paid_minor: 0,
          created_at: "2026-10-20T00:00:00Z",
        }),
        // Finished and still unpaid.
        pkg({
          id: "p-old",
          student_id: "s-sara",
          student_name: "Sara",
          status: "COMPLETED",
          due: true,
          outstanding_minor: 150000,
          invoice_paid_minor: 250000,
          created_at: "2026-09-01T00:00:00Z",
        }),
        // Paid: not on this page at all.
        pkg({ id: "p-paid", student_name: "Omar" }),
      ],
    });

    renderManager(["invoice.mark_paid"], "due");

    const cards = await screen.findAllByTestId("due-package-row");
    expect(cards.map((c) => within(c).getByRole("button", { name: /Sara|Mona/ }).textContent)).toEqual([
      "Sara",
      "Mona",
    ]);
    // Arabic dual: "باقتان" carries the two, no digit needed.
    expect(screen.getByTestId("due-count")).toHaveTextContent("باقتان بانتظار الدفع");
    expect(screen.getByText(/5,500|٥٬٥٠٠/)).toBeInTheDocument();
    // Each line leads with Mark as paid.
    expect(within(cards[0]!).getByTestId("mark-package-paid")).toBeInTheDocument();
  });

  it("gathers siblings' due packages under their parent, says what each is for, and sends ONE family link", async () => {
    listLessonPackages.mockResolvedValue({
      packages: [
        pkg({
          id: "p-yusuf",
          student_id: "s-yusuf",
          student_name: "Yusuf",
          guardian_id: "g-hassan",
          guardian_name: "Hassan",
          guardian_phone: "+20 100 111 2222",
          due: true,
          invoice_token: "tok-yusuf",
          purpose: "NEW",
          lesson_count: 0,
          outstanding_minor: 60000,
          created_at: "2026-09-01T00:00:00Z",
        }),
        pkg({
          id: "p-maryam",
          student_id: "s-maryam",
          student_name: "Maryam",
          guardian_id: "g-hassan",
          guardian_name: "Hassan",
          guardian_phone: "+20 100 111 2222",
          due: true,
          invoice_token: "tok-maryam",
          purpose: "AUTO_RENEWAL",
          lesson_count: 8,
          outstanding_minor: 40000,
          created_at: "2026-09-05T00:00:00Z",
        }),
        // Another family, alone under its own parent.
        pkg({
          id: "p-sara",
          student_id: "s-sara",
          student_name: "Sara",
          guardian_id: "g-ali",
          guardian_name: "Ali",
          due: true,
          outstanding_minor: 10000,
          created_at: "2026-10-01T00:00:00Z",
        }),
      ],
    });
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    createFamilyPayLink.mockResolvedValue({ url: "https://noor.acadmyq.com/f/fam-token" });

    renderManager(["invoice.send_link"], "due");

    const families = await screen.findAllByTestId("due-family-name");
    expect(families.map((f) => f.textContent)).toEqual(["Hassan", "Ali"]);

    const hassan = screen.getByTestId("due-family-g-hassan");
    expect(within(hassan).getAllByTestId("due-package-row")).toHaveLength(2);
    expect(hassan).toHaveTextContent("Yusuf، Maryam");
    expect(within(hassan).getByTestId("due-family-total").textContent).toContain(
      formatMoney({ amount: 100000, currency: "EGP" }, "ar"),
    );

    // What each bill is for, and the lessons behind it.
    const purposes = within(hassan).getAllByTestId("due-package-purpose").map((p) => p.textContent);
    expect(purposes).toEqual([arMessages.packages.purpose.NEW, arMessages.packages.purpose.AUTO_RENEWAL]);
    expect(within(hassan).getAllByTestId("due-package-usage")[1]).toHaveTextContent("حُضرت");

    await userEvent.click(within(hassan).getByTestId("due-family-send"));
    await waitFor(() => expect(createFamilyPayLink).toHaveBeenCalledWith("g-hassan"));
    await waitFor(() => expect(open.mock.calls.some((c) => String(c[0]).startsWith("https://wa.me/"))).toBe(true));
    const url = decodeURIComponent(String(open.mock.calls.find((c) => String(c[0]).startsWith("https://wa.me/"))?.[0]));
    expect(url).toContain("https://wa.me/201001112222?text=");
    // One link for the whole family — not a link per child.
    expect(url).toContain("https://noor.acadmyq.com/f/fam-token");
    expect(url).not.toContain("/i/tok-");
    expect(url).toContain(formatMoney({ amount: 100000, currency: "EGP" }, "ar"));
    open.mockRestore();
  });

  it("marks a package the renewal opened, with the minutes it took from the last block", async () => {
    listLessonPackages.mockResolvedValue({
      packages: [
        pkg({
          sequence_no: 4,
          opened_automatically: true,
          absorbed_overdraft_minutes: 30,
        }),
      ],
    });

    renderManager();

    const note = await screen.findByTestId("package-renewed");
    expect(note).toHaveTextContent(
      arMessages.packages.card.autoOpened.replace("{previous}", "3"),
    );
    expect(note.textContent).toContain(formatHours(30, "ar"));
    expect(screen.getByTestId("package-auto-renew-note")).toHaveTextContent(
      arMessages.packages.card.autoRenewNext.replace("{n}", "5"),
    );
  });

  it("splits Finished into not paid and paid, and keeps a paid package on the page in green", async () => {
    listLessonPackages.mockResolvedValue({
      packages: [
        pkg(),
        pkg({
          id: "p2",
          status: "COMPLETED",
          student_name: "Mona",
          follow_up: true,
          invoice_status: "CLOSED",
          invoice_paid_minor: 0,
          outstanding_minor: 400000,
        }),
        pkg({
          id: "p3",
          status: "COMPLETED",
          student_name: "Laila",
          invoice_status: "PAID",
          paid_at: "2026-09-20T10:00:00Z",
        }),
      ],
    });

    renderManager([], "finished");

    // Not paid first; the open package is never on this page.
    const unpaid = await screen.findAllByTestId("package-card");
    expect(unpaid).toHaveLength(1);
    expect(unpaid[0]).toHaveTextContent("Mona");
    expect(unpaid[0]).not.toHaveAttribute("data-paid");

    await userEvent.click(screen.getByTestId("finished-tab-paid"));
    const paid = await screen.findAllByTestId("package-card");
    expect(paid).toHaveLength(1);
    expect(paid[0]).toHaveTextContent("Laila");
    expect(paid[0]).toHaveAttribute("data-paid", "true");
    expect(within(paid[0]!).getByTestId("package-paid")).toHaveTextContent(
      arMessages.packages.card.paidBadge,
    );
  });

  it("narrows the paid tab to the days the bills were paid", async () => {
    listLessonPackages.mockResolvedValue({
      packages: [
        pkg({
          id: "p2",
          status: "COMPLETED",
          student_name: "Mona",
          invoice_status: "PAID",
          closed_at: "2026-09-01T10:00:00Z",
          paid_at: "2026-09-05T10:00:00Z",
        }),
        pkg({
          id: "p3",
          status: "COMPLETED",
          student_name: "Laila",
          invoice_status: "PAID",
          closed_at: "2026-09-01T10:00:00Z",
          paid_at: "2026-10-02T10:00:00Z",
        }),
      ],
    });

    renderManager([], "finished");
    await userEvent.click(await screen.findByTestId("finished-tab-paid"));
    expect(await screen.findAllByTestId("package-card")).toHaveLength(2);

    // Same finish day, different payment days — the paid tab filters on when it was paid.
    await userEvent.type(screen.getByTestId("finished-from"), "2026-10-01");
    const cards = await screen.findAllByTestId("package-card");
    expect(cards).toHaveLength(1);
    expect(cards[0]).toHaveTextContent("Laila");

    await userEvent.type(screen.getByTestId("finished-to"), "2026-10-01");
    expect(
      await screen.findByText(arMessages.packages.emptyRange),
    ).toBeInTheDocument();
  });

  it("shows lesson, date, package total and payment actions on the richer card", async () => {
    listLessonPackages.mockResolvedValue({ packages: [pkg()] });
    renderManager(["invoice.send_link"]);

    const card = await screen.findByTestId("package-card");

    // The subscription in one line each: what is left of what was bought, the price and the hourly
    // rate, when it started, lessons taken, and whether it renews.
    expect(card).toHaveTextContent(arMessages.packages.card.startDate);
    expect(card).toHaveTextContent("حُضرت");
    expect(card.textContent).toContain("/ساعة");
    expect(within(card).getByTestId("package-auto-renew-note")).toBeInTheDocument();

    // Paid up, so collecting is not the card's job right now: the payment actions are one tap
    // away behind the menu rather than sitting on the card.
    await openCardMenu();
    expect(
      await screen.findByRole("menuitem", {
        name: arMessages.packages.actions.paymentLink,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", {
        name: arMessages.packages.actions.sendPayment,
      }),
    ).toBeInTheDocument();
  });

  it("gathers a family's open packages under the parent, each with its subscription details", async () => {
    listLessonPackages.mockResolvedValue({
      packages: [
        pkg({ id: "p-y", student_id: "s-y", student_name: "Yusuf", guardian_id: "g-h", guardian_name: "Hassan", purpose: "NEW" }),
        pkg({ id: "p-m", student_id: "s-m", student_name: "Maryam", guardian_id: "g-h", guardian_name: "Hassan", purpose: "AUTO_RENEWAL" }),
      ],
    });
    renderManager();

    const family = await screen.findByTestId("due-family-g-h");
    expect(within(family).getByTestId("due-family-name")).toHaveTextContent("Hassan");
    expect(within(family).getAllByTestId("package-card")).toHaveLength(2);
    // Both blocks are paid up front: the family reads as settled.
    expect(within(family).getByTestId("family-paid-up")).toHaveTextContent(arMessages.packages.family.nothingDue);
    expect(family).toHaveTextContent(arMessages.packages.purpose.AUTO_RENEWAL);
  });

  it("shows only open packages on the open page", async () => {
    listLessonPackages.mockResolvedValue({
      packages: [
        pkg(),
        pkg({ id: "p2", status: "COMPLETED", student_name: "Mona", follow_up: true }),
      ],
    });
    renderManager();

    const cards = await screen.findAllByTestId("package-card");
    expect(cards).toHaveLength(1);
    expect(cards[0]).toHaveTextContent("Sara");
    expect(screen.queryByText("Mona")).toBeNull();
  });

  it("marks a new package opened over an unpaid one in its own colour and says what is owed", async () => {
    listLessonPackages.mockResolvedValue({
      packages: [
        pkg({
          sequence_no: 2,
          previous_unpaid: {
            packages: 1,
            sequence_nos: [1],
            amounts: [{ currency: "EGP", amount_minor: 20000 }],
          },
        }),
      ],
    });
    renderManager();

    const card = await screen.findByTestId("package-card");
    expect(card).toHaveAttribute("data-previous-unpaid", "true");
    const banner = within(card).getByTestId("previous-unpaid");
    expect(banner).toHaveTextContent("الباقة السابقة غير مدفوعة");
    // Raw textContent: the matcher's whitespace folding would eat the currency's no-break space.
    expect(banner.textContent).toContain(
      formatMoney({ amount: 20000, currency: "EGP" }, "ar"),
    );
    expect(banner.textContent).toContain("#1");
  });

  it("sends a reminder from a finished package and shows how many and when", async () => {
    listLessonPackages.mockResolvedValue({
      packages: [
        pkg({
          status: "COMPLETED",
          follow_up: true,
          minutes_remaining: 0,
          outstanding_minor: 400000,
          invoice_paid_minor: 0,
          invoice_status: "CLOSED",
        }),
      ],
    });
    renderManager(["invoice.send_link"], "finished");

    const card = await screen.findByTestId("package-card");
    expect(within(card).getByTestId("package-reminders")).toHaveTextContent(
      arMessages.packages.card.noReminders,
    );

    const tab = { opener: {}, location: { href: "" }, close: vi.fn() };
    const open = vi
      .spyOn(window, "open")
      .mockReturnValue(tab as unknown as Window);

    await userEvent.click(within(card).getByTestId("remind-package"));

    expect(remindLessonPackage).toHaveBeenCalledWith("p1", "ar");
    // WhatsApp opened the ordinary way, with the message written — never sent by the gateway.
    await waitFor(() =>
      expect(tab.location.href).toBe("https://wa.me/201001112222?text=Reminder"),
    );
    expect(open).toHaveBeenCalledTimes(1);
    open.mockRestore();
    expect(
      (await within(card).findByTestId("package-reminders")).textContent,
    ).toContain(formatNumber(3, "ar"));
    expect(
      within(card).getByTestId("package-reminders"),
    ).not.toHaveTextContent(arMessages.packages.card.noReminders);
  });

  it("opens invoice-style payment evidence fields from an unpaid package", async () => {
    listLessonPackages.mockResolvedValue({
      packages: [
        pkg({
          outstanding_minor: 100000,
          invoice_paid_minor: 300000,
          invoice_status: "PARTIALLY_PAID",
        }),
      ],
    });
    renderManager(["invoice.mark_paid"]);

    await userEvent.click(
      within(await screen.findByTestId("package-card")).getByText(
        arMessages.packages.actions.markPaid,
      ),
    );
    expect(
      await screen.findByText(arMessages.invoices.markPaidTitle),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/مرجع المعاملة/)).toBeInTheDocument();
    expect(screen.getByLabelText(/إثبات الدفع/)).toBeInTheDocument();
  });

  it("syncs historical lessons into an existing active package", async () => {
    listLessonPackages.mockResolvedValue({ packages: [pkg()] });
    renderManager();

    await openCardMenu();
    await userEvent.click(
      await screen.findByRole("menuitem", {
        name: arMessages.packages.actions.syncLessons,
      }),
    );

    expect(syncLessonPackage).toHaveBeenCalledWith("p1");
    expect(await screen.findByRole("status")).toHaveTextContent("2");
  });

  // Editing is a correction of the terms, so the form opens seeded with what the package
  // currently says — in the open form's fields, lessons of a length — and sends hours back.
  it("corrects an open package's terms from the card", async () => {
    listLessonPackages.mockResolvedValue({ packages: [pkg()] });
    renderManager();

    await openCardMenu();
    await userEvent.click(await screen.findByTestId("edit-package"));

    const price = await screen.findByLabelText(arMessages.packages.form.price);
    expect(price).toHaveValue(4000);
    expect(screen.getByLabelText(arMessages.packages.form.lessons)).toHaveValue(20);
    expect(screen.getByTestId("pkg-edit-count-length")).toHaveValue("60");

    await userEvent.clear(price);
    await userEvent.type(price, "3600");
    await userEvent.click(screen.getByTestId("edit-applies-current"));
    await userEvent.click(screen.getByTestId("save-package-edit"));

    expect(updateLessonPackage).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ hours: 20, price_minor: 360000, applies_to: "CURRENT" }),
    );
  });

  // A renewing block's new terms: asked, never assumed — this one too, or the next renewal only.
  it("asks whether new terms apply to this package or only from the next renewal", async () => {
    listLessonPackages.mockResolvedValue({ packages: [pkg()] });
    renderManager();

    await openCardMenu();
    await userEvent.click(await screen.findByTestId("edit-package"));
    expect(screen.queryByTestId("edit-applies-to")).toBeNull();

    const price = await screen.findByLabelText(arMessages.packages.form.price);
    await userEvent.clear(price);
    await userEvent.type(price, "4500");

    // The question appears, and nothing saves until it is answered.
    expect(await screen.findByTestId("edit-applies-to")).toBeInTheDocument();
    expect(screen.getByTestId("save-package-edit")).toBeDisabled();

    await userEvent.click(screen.getByTestId("edit-applies-next"));
    await userEvent.click(screen.getByTestId("save-package-edit"));

    expect(updateLessonPackage).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ price_minor: 450000, applies_to: "NEXT" }),
    );
  });

  it("does not ask for a package that does not renew — there is no next one", async () => {
    listLessonPackages.mockResolvedValue({ packages: [pkg({ auto_renew: false })] });
    renderManager();

    await openCardMenu();
    await userEvent.click(await screen.findByTestId("edit-package"));
    const price = await screen.findByLabelText(arMessages.packages.form.price);
    await userEvent.clear(price);
    await userEvent.type(price, "4500");

    expect(screen.queryByTestId("edit-applies-to")).toBeNull();
    await userEvent.click(screen.getByTestId("save-package-edit"));
    expect(updateLessonPackage).toHaveBeenCalledWith("p1", expect.not.objectContaining({ applies_to: expect.anything() }));
  });

  it("shows the terms waiting for the next renewal on the card", async () => {
    listLessonPackages.mockResolvedValue({ packages: [pkg({ next_terms: { price_minor: 450000 } })] });
    renderManager();

    expect((await screen.findByTestId("package-next-terms")).textContent).toContain(
      formatMoney({ amount: 450000, currency: "EGP" }, "ar"),
    );
  });

  // The floor is what has already been taught: a package cannot be sold backwards, and the
  // form says so before the API has to.
  it("refuses to shrink a package to the hours already used", async () => {
    listLessonPackages.mockResolvedValue({ packages: [pkg()] });
    renderManager();

    await openCardMenu();
    await userEvent.click(await screen.findByTestId("edit-package"));

    const lessons = await screen.findByLabelText(arMessages.packages.form.lessons);
    await userEvent.clear(lessons);
    await userEvent.type(lessons, "10");

    expect(await screen.findByTestId("package-too-small")).toBeInTheDocument();
    expect(screen.getByTestId("save-package-edit")).toBeDisabled();
    expect(updateLessonPackage).not.toHaveBeenCalled();
  });

  // The size is stored in minutes only; the auto-written label says how it was sold.
  it("reads a block back as the lessons of a length it was sold as", async () => {
    listLessonPackages.mockResolvedValue({
      packages: [pkg({ label: "12 × 40 د — أكتوبر 2026", minutes_total: 480 })],
    });
    renderManager();

    await openCardMenu();
    await userEvent.click(await screen.findByTestId("edit-package"));

    expect(await screen.findByLabelText(arMessages.packages.form.lessons)).toHaveValue(12);
    expect(screen.getByTestId("pkg-edit-count-length")).toHaveValue("40");
  });

  /**
   * Closing is the one way back to the monthly clock — the exit that pairs with opening a package
   * putting a student on the hour clock. Both directions of the switch live on this screen, which
   * is the point: a billing mode that could be changed from two places is a billing mode that can
   * disagree with the packages themselves.
   */
  it("offers the way back to monthly billing when a package is closed, and leaves it off by default", async () => {
    listLessonPackages.mockResolvedValue({ packages: [pkg()] });

    renderManager();

    await openCardMenu();
    await userEvent.click(await screen.findByTestId("close-package"));

    const toggle = within(
      await screen.findByTestId("return-to-monthly"),
    ).getByRole("checkbox");
    expect(toggle).not.toBeChecked();

    await userEvent.click(toggle);
    await userEvent.click(
      screen.getByRole("button", { name: arMessages.packages.close.confirm }),
    );

    expect(closeLessonPackage).toHaveBeenCalledWith("p1", undefined, true);
    expect(
      await screen.findByText(arMessages.packages.alerts.closedAndReturned),
    ).toBeInTheDocument();
  });
  // The block ran out, the bill was even paid, and the student is still coming: the lessons are
  // billed by the hour somewhere else, so the card has to say so and lead with the decision.
  it("shows a student still taught after their package ran out, and leads with the next package", async () => {
    const outOfHours = pkg({
      status: "COMPLETED",
      follow_up: true,
      minutes_consumed: 1200,
      minutes_remaining: 0,
      percent_used: 100,
      invoice_status: "PAID",
      outstanding_minor: 0,
      awaiting_next_package: true,
      gap: {
        lessons: 3,
        minutes: 270,
        amounts: [{ currency: "EGP", amount_minor: 90000 }],
      },
    });
    listLessonPackages.mockResolvedValue({ packages: [outOfHours] });
    getLessonPackageSummary.mockResolvedValue({
      ...summary,
      unpaid: 0,
      outOfHours: 1,
      total: 1,
    });

    renderManager([], "finished");

    // Paid, so it sits under "Paid" — the gap banner still says lessons are running on.
    await userEvent.click(await screen.findByTestId("finished-tab-paid"));
    const card = await screen.findByTestId("package-card");
    const gap = within(card).getByTestId("package-gap");
    // Raw textContent: the matcher's whitespace folding would eat the currency's no-break space.
    expect(gap.textContent).toContain(formatHours(270, "ar"));
    expect(gap.textContent).toContain(formatNumber(3, "ar"));
    expect(gap.textContent).toContain(
      formatMoney({ amount: 90000, currency: "EGP" }, "ar"),
    );

    await userEvent.click(within(card).getByTestId("renew-package"));
    expect(await screen.findByTestId("package-student")).toBeInTheDocument();
  });

  it("moves a student whose package ran out back to monthly billing from the card menu", async () => {
    listLessonPackages.mockResolvedValue({
      packages: [
        pkg({
          status: "COMPLETED",
          minutes_remaining: 0,
          outstanding_minor: 0,
          awaiting_next_package: true,
        }),
      ],
    });
    renderManager([], "finished");

    await userEvent.click(await screen.findByTestId("finished-tab-paid"));
    await openCardMenu();
    await userEvent.click(await screen.findByTestId("package-to-monthly"));
    await userEvent.click(await screen.findByTestId("confirm-to-monthly"));

    expect(closeLessonPackage).toHaveBeenCalledWith("p1", undefined, true);
    expect(
      await screen.findByText(
        arMessages.packages.alerts.returnedToMonthly.replace("{name}", "Sara"),
      ),
    ).toBeInTheDocument();
  });

  it("keeps an owing card to two buttons and puts the rest behind the menu", async () => {
    listLessonPackages.mockResolvedValue({
      packages: [pkg({ outstanding_minor: 400000, invoice_paid_minor: 0 })],
    });
    renderManager(["invoice.send_link", "invoice.mark_paid"]);

    const card = await screen.findByTestId("package-card");

    // Money is owed, so chasing and recording it is what the card offers first…
    expect(
      within(card).getByText(arMessages.packages.actions.remind),
    ).toBeInTheDocument();
    expect(
      within(card).getByText(arMessages.packages.actions.markPaid),
    ).toBeInTheDocument();
    // …and the repairs are one level down.
    expect(within(card).queryByTestId("edit-package")).toBeNull();

    await openCardMenu();
    expect(await screen.findByTestId("edit-package")).toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", {
        name: arMessages.packages.actions.viewLessons,
      }),
    ).toBeInTheDocument();
  });
});

describe("Due packages — Paid tab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getLessonPackageSummary.mockResolvedValue(summary);
  });

  it("lists paid packages with each receipt's details, newest paid first, and leaves due ones out", async () => {
    listLessonPackages.mockResolvedValue({
      packages: [
        pkg({ id: "p-due", student_name: "Mona", due: true, outstanding_minor: 100000, invoice_paid_minor: 0 }),
        pkg({
          id: "p-old",
          student_name: "Omar",
          invoice_status: "PAID",
          paid_at: "2026-10-01T10:00:00Z",
          payment_method: "CASH",
          payment_reference: "OLD-1",
        }),
        pkg({
          id: "p-new",
          student_name: "Sara",
          paid_at: "2026-10-20T10:00:00Z",
          receipts: [
            {
              id: "r1",
              number: "R-000007",
              amount_minor: 400000,
              currency: "EGP",
              method: "BANK_TRANSFER",
              reference: "TRX-99",
              note: "paid by the father",
              source: "MANUAL",
              received_on: "2026-10-20",
              received_by_name: "Ahmed",
              proof_url: "/api/receipts/r1/proof",
              public_url: "https://noor.academiq.test/rc/tok",
            },
          ],
        }),
        // A void bill is not a payment.
        pkg({ id: "p-void", student_name: "Void", invoice_status: "VOID", invoice_paid_minor: 0 }),
      ],
    });

    renderManager(["invoice.mark_paid"], "due");
    await userEvent.click(await screen.findByTestId("finished-tab-paid"));

    const cards = await screen.findAllByTestId("paid-package");
    expect(cards.map((c) => within(c).getByText(/Sara|Omar/).textContent)).toEqual(["Sara", "Omar"]);
    expect(within(cards[0]!).getByText(/R-000007/)).toBeInTheDocument();
    expect(within(cards[0]!).getByTestId("paid-reference")).toHaveTextContent("TRX-99");
    expect(within(cards[0]!).getByText("paid by the father")).toBeInTheDocument();
    expect(within(cards[0]!).getByTestId("paid-receipt")).toHaveAttribute("href", "https://noor.academiq.test/rc/tok");
    // A classic bill: the payment written on the bill itself.
    expect(within(cards[1]!).getByTestId("paid-reference")).toHaveTextContent("OLD-1");
    expect(screen.queryByText("Mona")).not.toBeInTheDocument();
    expect(screen.queryByText("Void")).not.toBeInTheDocument();
  });
});
