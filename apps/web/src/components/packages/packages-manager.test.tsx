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
 * page (Due / Open), keeping Open to the few things a supervisor reads, and saying out loud when
 * a new block was opened over an unpaid one or a student is taught after their block ran out.
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
  view: "due" | "open" = "open",
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

/** An open package's actions all live behind "⋯" (on a Due row, past the first one). */
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

  it("puts a stranded overdraft on Due, says how far past it went, and keeps billing it in the menu", async () => {
    listLessonPackages.mockResolvedValue({
      packages: [
        pkg({
          id: "p2",
          status: "COMPLETED",
          due: true,
          minutes_consumed: 1260,
          minutes_remaining: 0,
          minutes_overdrawn: 60,
          percent_used: 100,
          overdraft_billed: false,
        }),
      ],
    });

    renderManager([], "due");

    const row = await screen.findByTestId("due-package-row");
    expect(row.textContent).toContain(formatHours(60, "ar"));
    // Stranded with no next package to absorb it → the escape hatch exists, but only in the menu.
    expect(within(row).queryByText(arMessages.packages.actions.billOverdraft)).toBeNull();
    await userEvent.click(within(row).getByTestId("package-card-menu"));
    expect(await screen.findByTestId("bill-overdraft")).toBeInTheDocument();
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
    // The page's figures are coloured cards: how many wait, and the money owed.
    const count = screen.getByTestId("due-count");
    expect(count).toHaveTextContent(arMessages.packages.dueStats.packages);
    expect(count).toHaveTextContent(formatNumber(2, "ar"));
    expect(screen.getByTestId("due-stats-amount")).toHaveTextContent(/5,500|٥٬٥٠٠/);
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

  it("shows Due as a compact table: one line per package, the parent named on the family's first line", async () => {
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
          reminders_sent: 2,
          last_reminded_at: "2026-09-10T10:00:00Z",
          outstanding_minor: 40000,
          created_at: "2026-09-05T00:00:00Z",
        }),
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

    renderManager(["invoice.send_link", "invoice.mark_paid"], "due");

    const table = await screen.findByTestId("due-table");
    expect(within(table).getAllByTestId("due-table-family-name").map((n) => n.textContent)).toEqual(["Hassan", "Ali"]);
    const hassan = within(table).getByTestId("due-table-family-g-hassan");
    const rows = within(hassan).getAllByTestId("due-table-row");
    expect(rows).toHaveLength(2);
    // The parent leads the family's first line only, with what the family owes in all; a one-package
    // family shows no separate total (its line already says it).
    expect(within(hassan).getAllByTestId("due-table-family-name")).toHaveLength(1);
    expect(within(rows[0]!).getByTestId("due-table-family-name")).toHaveTextContent("Hassan");
    expect(within(hassan).getByTestId("due-table-family-total").textContent).toContain(formatMoney({ amount: 100000, currency: "EGP" }, "ar"));
    expect(within(within(table).getByTestId("due-table-family-g-ali")).queryByTestId("due-table-family-total")).toBeNull();
    // Maryam was reminded twice: said beside how long she has waited.
    expect(within(rows[1]!).getByTestId("due-table-reminded")).toHaveTextContent(formatNumber(2, "ar"));
    expect(within(hassan).getAllByTestId("due-table-purpose").map((p) => p.textContent)).toEqual([
      arMessages.packages.purpose.NEW,
      arMessages.packages.purpose.AUTO_RENEWAL,
    ]);
    expect(within(rows[0]!).getByTestId("due-table-amount").textContent).toContain(formatMoney({ amount: 60000, currency: "EGP" }, "ar"));
    // Each row leads with Mark as paid.
    expect(within(rows[0]!).getByTestId("mark-package-paid")).toBeInTheDocument();

    // The cards: three packages in two families, one already reminded, the oldest is Yusuf's.
    expect(screen.getByTestId("due-count")).toHaveTextContent(formatNumber(3, "ar"));
    expect(screen.getByTestId("due-stats-not-reminded")).toHaveTextContent(formatNumber(2, "ar"));
    expect(screen.getByTestId("due-stats-oldest")).toHaveTextContent("Yusuf");

    // The family's one payment link, from the table.
    await userEvent.click(within(hassan).getByTestId("due-table-family-send"));
    await waitFor(() => expect(createFamilyPayLink).toHaveBeenCalledWith("g-hassan"));
    await waitFor(() => expect(open.mock.calls.some((c) => String(c[0]).startsWith("https://wa.me/201001112222"))).toBe(true));
    open.mockRestore();
  });

  it("shows Due's paid tab as a table with what came in, and cards for the count and the money", async () => {
    listLessonPackages.mockResolvedValue({
      packages: [
        pkg({
          id: "p-laila",
          student_name: "Laila",
          guardian_name: "Hassan",
          invoice_status: "PAID",
          payment_method: "BANK_TRANSFER",
          payment_reference: "TX-77",
          paid_at: "2026-10-02T10:00:00Z",
        }),
      ],
    });

    renderManager([], "due");
    await userEvent.click(await screen.findByTestId("finished-tab-paid"));

    const table = await screen.findByTestId("paid-table");
    const rows = within(table).getAllByTestId("paid-table-row");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("Laila");
    expect(rows[0]).toHaveTextContent(arMessages.packages.paid.method.BANK_TRANSFER);
    expect(within(rows[0]!).getByTestId("paid-table-reference")).toHaveTextContent("TX-77");
    expect(screen.getByTestId("paid-stats-count")).toHaveTextContent(formatNumber(1, "ar"));
    expect(screen.getByTestId("paid-stats-collected").textContent).toContain(formatMoney({ amount: 400000, currency: "EGP" }, "ar"));
  });

  it("keeps an open package to who, what is left, the next lesson and whether it is paid", async () => {
    listLessonPackages.mockResolvedValue({
      packages: [
        pkg({
          sequence_no: 4,
          opened_automatically: true,
          absorbed_overdraft_minutes: 30,
          next_terms: { price_minor: 450000 },
        }),
      ],
    });

    renderManager();

    const card = await screen.findByTestId("package-card");
    // Raw textContent: the matcher's whitespace folding would eat the hours' no-break space.
    expect(within(card).getByTestId("open-package-left").textContent).toBe(
      arMessages.packages.openTable.leftOf
        .replace("{left}", formatHours(600, "ar"))
        .replace("{total}", formatHours(1200, "ar")),
    );
    expect(within(card).getByTestId("open-package-payment")).toHaveTextContent(arMessages.packages.card.paidBadge);
    expect(card).toHaveTextContent(arMessages.packages.openTable.nextLesson);
    // The rest is one click away in the package, not on the list.
    expect(card).not.toHaveTextContent(arMessages.packages.card.startDate);
    expect(card.textContent).not.toContain("/ساعة");
    expect(within(card).queryByTestId("package-renewed")).toBeNull();
    expect(within(card).queryByTestId("package-auto-renew-note")).toBeNull();
    expect(within(card).queryByTestId("package-next-terms")).toBeNull();

    // The same package is one line of the table on a laptop.
    const table = screen.getByTestId("open-table");
    expect(within(table).getAllByTestId("open-table-row")).toHaveLength(1);
    expect(within(table).getByText("Sara")).toBeInTheDocument();
  });

  it("narrows Due's paid tab to the days the bills were paid", async () => {
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

    renderManager([], "due");
    await userEvent.click(await screen.findByTestId("finished-tab-paid"));
    const table = await screen.findByTestId("paid-table");
    expect(within(table).getAllByTestId("paid-table-row")).toHaveLength(2);

    // Same finish day, different payment days — the paid tab filters on when it was paid.
    await userEvent.type(screen.getByTestId("finished-from"), "2026-10-01");
    await waitFor(() => expect(within(screen.getByTestId("paid-table")).getAllByTestId("paid-table-row")).toHaveLength(1));
    expect(within(screen.getByTestId("paid-table")).getByText("Laila")).toBeInTheDocument();

    await userEvent.type(screen.getByTestId("finished-to"), "2026-10-01");
    expect(await screen.findByText(arMessages.packages.emptyRange)).toBeInTheDocument();
  });

  it("keeps an open package's payment actions behind the menu", async () => {
    listLessonPackages.mockResolvedValue({ packages: [pkg()] });
    renderManager(["invoice.send_link"]);

    // Paid up, so collecting is not the row's job: the payment actions are one tap away.
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

  it("lists siblings' open packages as their own lines, not under a family card", async () => {
    listLessonPackages.mockResolvedValue({
      packages: [
        pkg({ id: "p-y", student_id: "s-y", student_name: "Yusuf", guardian_id: "g-h", guardian_name: "Hassan", purpose: "NEW" }),
        pkg({ id: "p-m", student_id: "s-m", student_name: "Maryam", guardian_id: "g-h", guardian_name: "Hassan", purpose: "AUTO_RENEWAL" }),
      ],
    });
    renderManager();

    expect(await screen.findAllByTestId("package-card")).toHaveLength(2);
    expect(within(screen.getByTestId("open-table")).getAllByTestId("open-table-row")).toHaveLength(2);
    expect(screen.queryByTestId("due-family-g-h")).toBeNull();
    // What the money was for is Due's question, not this page's.
    expect(screen.queryByText(arMessages.packages.purpose.AUTO_RENEWAL)).toBeNull();
    // Search finds a child by the parent's name too.
    await userEvent.type(screen.getByLabelText(arMessages.packages.searchPlaceholder), "Hassan");
    expect(screen.getAllByTestId("package-card")).toHaveLength(2);
  });

  it("names an open package by what was sold, not by its label — lessons × length, else hours", async () => {
    listLessonPackages.mockResolvedValue({
      packages: [
        // The auto-written label says 12 × 40 and it adds up to the minutes sold.
        pkg({ id: "p-a", student_id: "s-a", student_name: "Sara", sequence_no: 3, label: "12 × 40 د — أكتوبر 2026", minutes_total: 480 }),
        // Counted in lessons: the length is known whatever the label says.
        pkg({ id: "p-b", student_id: "s-b", student_name: "Omar", label: "", minutes_total: 480, lesson_minutes: 60 }),
        // No label and no lesson length: the hours, never a guessed length.
        pkg({ id: "p-c", student_id: "s-c", student_name: "Mona", label: "", minutes_total: 1200 }),
      ],
    });
    renderManager();

    const shapes = within(await screen.findByTestId("open-table")).getAllByTestId("open-package-shape");
    const text = shapes.map((s) => s.textContent);
    expect(text[0]).toBe(`#${formatNumber(3, "ar")} ${formatNumber(12, "ar")} حصة × ${formatNumber(40, "ar")} د`);
    expect(text[1]).toContain(`${formatNumber(8, "ar")} حصص × ${formatNumber(60, "ar")} د`);
    expect(text[2]).toContain(`${formatNumber(20, "ar")} ساعة`);
    // A typed name is still there on hover; an empty one adds no tooltip.
    expect(shapes[0]).toHaveAttribute("title", "12 × 40 د — أكتوبر 2026");
    expect(shapes[2]).not.toHaveAttribute("title");
  });

  it("filters Open by its stat cards: running low, not paid, ran out", async () => {
    listLessonPackages.mockResolvedValue({
      packages: [
        pkg({ id: "p-ok", student_id: "s-ok", student_name: "Sara" }),
        pkg({ id: "p-low", student_id: "s-low", student_name: "Omar", minutes_consumed: 1170, minutes_remaining: 30, percent_used: 98 }),
        pkg({ id: "p-owe", student_id: "s-owe", student_name: "Mona", outstanding_minor: 400000, invoice_paid_minor: 0 }),
        pkg({
          id: "p-out",
          student_id: "s-out",
          student_name: "Laila",
          status: "COMPLETED",
          minutes_remaining: 0,
          percent_used: 100,
          awaiting_next_package: true,
          gap: { lessons: 2, minutes: 120, amounts: [{ currency: "EGP", amount_minor: 40000 }] },
        }),
      ],
    });
    renderManager();

    const names = async () => (await screen.findAllByTestId("package-card")).map((c) => c.querySelector("button")?.textContent);
    // Everything, what needs a hand first: ran out, then running low.
    expect(await names()).toEqual(["Laila", "Omar", "Sara", "Mona"]);
    expect(screen.getByTestId("open-stats-all")).toHaveTextContent(formatNumber(3, "ar"));
    expect(screen.getByTestId("open-stats-low")).toHaveTextContent(formatNumber(1, "ar"));

    await userEvent.click(screen.getByTestId("open-stats-low"));
    expect(await names()).toEqual(["Omar"]);
    await userEvent.click(screen.getByTestId("open-stats-unpaid"));
    expect(await names()).toEqual(["Mona"]);
    await userEvent.click(screen.getByTestId("open-stats-ran-out"));
    expect(await names()).toEqual(["Laila"]);
    // Clicking the applied card again shows everything.
    await userEvent.click(screen.getByTestId("open-stats-ran-out"));
    expect(await names()).toHaveLength(4);
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
    const chip = within(card).getByTestId("previous-unpaid");
    expect(chip).toHaveTextContent("سابقة غير مدفوعة");
    expect(chip).toHaveAttribute("title", "الباقة السابقة غير مدفوعة");
    // Raw textContent: the matcher's whitespace folding would eat the currency's no-break space.
    expect(chip.textContent).toContain(formatMoney({ amount: 20000, currency: "EGP" }, "ar"));
  });

  it("sends a reminder from a Due row and shows how many went", async () => {
    listLessonPackages.mockResolvedValue({
      packages: [
        pkg({
          status: "COMPLETED",
          due: true,
          minutes_remaining: 0,
          outstanding_minor: 400000,
          invoice_paid_minor: 0,
          invoice_status: "CLOSED",
        }),
      ],
    });
    renderManager(["invoice.send_link"], "due");

    const row = await screen.findByTestId("due-package-row");
    expect(screen.queryByTestId("due-table-reminded")).toBeNull();

    const tab = { opener: {}, location: { href: "" }, close: vi.fn() };
    const open = vi
      .spyOn(window, "open")
      .mockReturnValue(tab as unknown as Window);

    await userEvent.click(within(row).getByTestId("remind-package"));

    expect(remindLessonPackage).toHaveBeenCalledWith("p1", "ar");
    // WhatsApp opened the ordinary way, with the message written — never sent by the gateway.
    await waitFor(() =>
      expect(tab.location.href).toBe("https://wa.me/201001112222?text=Reminder"),
    );
    expect(open).toHaveBeenCalledTimes(1);
    open.mockRestore();
    expect((await screen.findByTestId("due-table-reminded")).textContent).toContain(formatNumber(3, "ar"));
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

    await openCardMenu();
    await userEvent.click(
      await screen.findByRole("menuitem", { name: arMessages.packages.actions.markPaid }),
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
  it("lists a student still taught after their package ran out on Open, leading with Renew", async () => {
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

    renderManager();

    const card = await screen.findByTestId("package-card");
    const gap = within(card).getByTestId("package-gap");
    expect(gap.textContent).toContain(formatNumber(3, "ar"));
    expect(screen.getByTestId("open-stats-ran-out")).toHaveTextContent(formatNumber(1, "ar"));

    await userEvent.click(within(card).getByTestId("renew-package"));
    expect(await screen.findByTestId("package-student")).toBeInTheDocument();
  });

  // Finished is gone, so a paid block that ran out with no lesson after it yet must still surface
  // here — it waits for the same decision, it just has nothing billed outside it yet.
  it("lists a paid block that ran out and was not renewed on Open, even with no lesson since", async () => {
    listLessonPackages.mockResolvedValue({
      packages: [
        pkg({
          status: "COMPLETED",
          minutes_remaining: 0,
          percent_used: 100,
          invoice_status: "PAID",
          outstanding_minor: 0,
          awaiting_next_package: true,
          gap: null,
        }),
      ],
    });
    renderManager();

    const card = await screen.findByTestId("package-card");
    expect(within(card).getByTestId("package-gap").textContent).toContain("لم تُجدَّد بعد");
    expect(within(card).getByTestId("renew-package")).toBeInTheDocument();
  });

  it("moves a student whose package ran out back to monthly billing from the card menu", async () => {
    listLessonPackages.mockResolvedValue({
      packages: [
        pkg({
          status: "COMPLETED",
          minutes_remaining: 0,
          outstanding_minor: 0,
          awaiting_next_package: true,
          gap: { lessons: 1, minutes: 60, amounts: [{ currency: "EGP", amount_minor: 20000 }] },
        }),
      ],
    });
    renderManager();

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

  it("keeps an owing open package to the menu — collecting is Due's job — with Mark as paid first in it", async () => {
    listLessonPackages.mockResolvedValue({
      packages: [pkg({ outstanding_minor: 400000, invoice_paid_minor: 0 })],
    });
    renderManager(["invoice.send_link", "invoice.mark_paid"]);

    const card = await screen.findByTestId("package-card");
    expect(within(card).getByTestId("open-package-payment").textContent).toContain(
      formatMoney({ amount: 400000, currency: "EGP" }, "ar"),
    );
    expect(within(card).queryByText(arMessages.packages.actions.remind)).toBeNull();
    expect(within(card).queryByText(arMessages.packages.actions.markPaid)).toBeNull();

    await openCardMenu();
    const items = await screen.findAllByRole("menuitem");
    expect(items[0]).toHaveTextContent(arMessages.packages.actions.markPaid);
    expect(screen.getByTestId("edit-package")).toBeInTheDocument();
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

describe("Due packages — row buttons", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getLessonPackageSummary.mockResolvedValue(summary);
  });

  it("puts the packages log, reminder and copy outside, drops early close and sync, and copies a ready message", async () => {
    const due = pkg({ id: "p-due", sequence_no: 3, due: true, outstanding_minor: 100000, invoice_paid_minor: 0, invoice_status: "OPEN" });
    listLessonPackages.mockResolvedValue({ packages: [due] });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    renderManager(["invoice.send_link", "invoice.mark_paid"], "due");
    const row = await screen.findByTestId("due-package-row");
    expect(within(row).getByTestId("due-package-history")).toBeInTheDocument();
    expect(within(row).getByTestId("remind-package")).toBeInTheDocument();
    expect(within(row).queryByTestId("close-package")).not.toBeInTheDocument();

    await userEvent.click(within(row).getByTestId("package-card-menu"));
    expect(screen.queryByText(arMessages.packages.actions.syncLessons)).not.toBeInTheDocument();
    expect(screen.queryByText(arMessages.packages.actions.close)).not.toBeInTheDocument();
    await userEvent.keyboard("{Escape}");

    await userEvent.click(within(row).getByTestId("due-package-copy"));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const text = writeText.mock.calls[0]![0] as string;
    expect(text).toContain("/i/tok");
    expect(text).toContain("#3");
    expect(text).toContain(arMessages.packages.family.messageThanks);

    // The log lists the student's packages, folded.
    await userEvent.click(within(row).getByTestId("due-package-history"));
    expect(await screen.findByTestId("package-history-3")).toBeInTheDocument();
  });
});
