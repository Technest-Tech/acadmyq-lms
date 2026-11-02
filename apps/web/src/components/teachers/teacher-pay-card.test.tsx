import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext } from "@/components/auth-provider";
import { authValue, makeSession } from "@/test/auth";
import enMessages from "../../../messages/en.json";
import { TeacherPayCard } from "./teacher-pay-card";

vi.mock("@/lib/api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/api")>()),
  getTeacher: vi.fn(),
  updateTeacher: vi.fn(),
  getPayRecalc: vi.fn(),
  repricePayout: vi.fn(),
  carryPayoutReprice: vi.fn(),
  listStudents: vi.fn().mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 8 }),
}));

import * as api from "@/lib/api";

const TEACHER: api.TeacherRow = {
  id: "t1",
  user_id: null,
  full_name: "Ustadh Kareem",
  phone: null,
  specialization: null,
  session_rate_minor: 8000,
  pay_type: "PER_STUDENT",
  fixed_salary_minor: 0,
  currency: "EGP",
  timezone: null,
  payout_method: null,
  payout_handle: null,
  availability: [],
  is_active: true,
  deleted_at: null,
  created_at: "",
};

function renderCard(
  role: "ACADEMY_OWNER" | "ACCOUNTANT" | "STAFF" | "CUSTOMER_SERVICE" = "ACADEMY_OWNER",
  extraPermissions: string[] = [],
) {
  const session = makeSession(role);
  session.permissions = [...session.permissions, ...extraPermissions];
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <AuthContext.Provider value={authValue(session)}>
        <TeacherPayCard teacherId="t1" />
      </AuthContext.Provider>
    </NextIntlClientProvider>,
  );
}

describe("TeacherPayCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getTeacher).mockResolvedValue({
      teacher: TEACHER,
      students: [
        { id: "s1", full_name: "Yusuf", started_at: "2026-06-01", rate_minor: 12000 },
        { id: "s2", full_name: "Maryam", started_at: "2026-06-01", rate_minor: null },
      ],
      // A rate still on file for a student who moved to another teacher.
      student_rates: [
        { student_id: "s1", full_name: "Yusuf", rate_minor: 12000, is_current: true },
        { student_id: "s9", full_name: "Omar", rate_minor: 5000, is_current: false },
      ],
      login: { has_login: false, email: null, is_active: null },
    });
    vi.mocked(api.updateTeacher).mockResolvedValue({ ok: true, changed: [] });
    vi.mocked(api.getPayRecalc).mockResolvedValue({ statements: [] });
  });

  it("lists every current student plus any rate still on file", async () => {
    renderCard();
    const list = await screen.findByTestId("student-rates");
    expect(list).toHaveTextContent("Yusuf");
    expect(list).toHaveTextContent("Maryam");
    expect(list).toHaveTextContent("Omar");
    expect(screen.getByLabelText("Hourly rate for Yusuf")).toHaveValue(120);
    // Empty is not zero: it means "the default", shown as the placeholder.
    expect(screen.getByLabelText("Hourly rate for Maryam")).toHaveValue(null);
    expect(screen.getByLabelText("Hourly rate for Maryam")).toHaveAttribute("placeholder", "80");
  });

  // The whole set is sent, and a student with an empty rate is simply left out of it — that is
  // how they go back to the default.
  it("saves per-student rates in minor units, leaving empty ones on the default", async () => {
    renderCard();
    await screen.findByTestId("student-rates");
    const user = userEvent.setup();

    const maryam = screen.getByLabelText("Hourly rate for Maryam");
    await user.type(maryam, "95");
    await user.click(screen.getByLabelText("Remove Omar"));
    await user.click(screen.getByTestId("save-teacher-pay"));

    await waitFor(() => expect(api.updateTeacher).toHaveBeenCalled());
    const patch = vi.mocked(api.updateTeacher).mock.calls[0]![1];
    expect(patch).toMatchObject({ pay_type: "PER_STUDENT", session_rate_minor: 8000 });
    expect(patch.student_rates).toEqual([
      { student_id: "s1", rate_minor: 12000 },
      { student_id: "s2", rate_minor: 9500 },
    ]);
  });

  // Alrayan: a teacher who has lost their students still has their lessons on last month's salary.
  it("lists students they taught before, so last month's lessons can be priced", async () => {
    vi.mocked(api.getTeacher).mockResolvedValue({
      teacher: TEACHER,
      students: [],
      student_rates: [],
      past_students: [{ id: "s7", full_name: "Salma" }],
      login: { has_login: false, email: null, is_active: null },
    });
    renderCard();
    expect(await screen.findByLabelText("Hourly rate for Salma")).toHaveValue(null);
  });

  describe("recalculating statements already written", () => {
    const statement = (over: Partial<api.PayRecalcStatement>): api.PayRecalcStatement => ({
      id: "p10",
      period_year: 2026,
      period_month: 10,
      finalized: false,
      currency: "EGP",
      total_minor: 400000,
      delta_minor: 50000,
      lines_changed: 5,
      carried_minor: 0,
      currency_changed: false,
      ...over,
    });

    it("re-prices an open month only after a confirm", async () => {
      vi.mocked(api.getPayRecalc).mockResolvedValue({ statements: [statement({})] });
      vi.mocked(api.repricePayout).mockResolvedValue({ ok: true, delta_minor: 50000 });
      renderCard("ACADEMY_OWNER", ["payout.adjust"]);
      const user = userEvent.setup();

      await user.click(await screen.findByTestId("recalc-open-2026-10"));
      expect(api.repricePayout).not.toHaveBeenCalled();
      await user.click(screen.getByTestId("recalc-confirm"));

      await waitFor(() => expect(api.repricePayout).toHaveBeenCalledWith("p10"));
      expect(api.carryPayoutReprice).not.toHaveBeenCalled();
    });

    it("carries a finalized month's difference instead of touching it", async () => {
      vi.mocked(api.getPayRecalc).mockResolvedValue({ statements: [statement({ finalized: true })] });
      vi.mocked(api.carryPayoutReprice).mockResolvedValue({ ok: true, delta_minor: 50000 });
      renderCard("ACADEMY_OWNER", ["payout.adjust"]);
      const user = userEvent.setup();

      await user.click(await screen.findByTestId("recalc-open-2026-10"));
      await user.click(screen.getByTestId("recalc-confirm"));

      await waitFor(() => expect(api.carryPayoutReprice).toHaveBeenCalledWith("p10"));
      expect(api.repricePayout).not.toHaveBeenCalled();
    });

    it("waits for unsaved rates, and offers nothing where nothing moves", async () => {
      vi.mocked(api.getPayRecalc).mockResolvedValue({
        statements: [statement({}), statement({ id: "p9", period_month: 9, delta_minor: 0 })],
      });
      renderCard("ACADEMY_OWNER", ["payout.adjust"]);
      const user = userEvent.setup();

      const button = await screen.findByTestId("recalc-open-2026-10");
      expect(button).toBeEnabled();
      expect(screen.queryByTestId("recalc-open-2026-9")).not.toBeInTheDocument();

      await user.type(screen.getByLabelText("Hourly rate for Maryam"), "95");
      expect(button).toBeDisabled();
      await user.click(screen.getByTestId("save-teacher-pay"));
      await waitFor(() => expect(api.getPayRecalc).toHaveBeenCalledTimes(2));
    });

    it("is not offered without payout.adjust", async () => {
      vi.mocked(api.getPayRecalc).mockResolvedValue({ statements: [statement({})] });
      renderCard();
      await screen.findByTestId("teacher-pay-editor");
      expect(api.getPayRecalc).not.toHaveBeenCalled();
      expect(screen.queryByTestId("pay-recalc")).not.toBeInTheDocument();
    });
  });

  it("switches to a fixed monthly salary", async () => {
    renderCard();
    await screen.findByTestId("student-rates");
    const user = userEvent.setup();

    await user.click(screen.getByTestId("pay-type-FIXED"));
    expect(screen.queryByTestId("student-rates")).not.toBeInTheDocument();
    await user.type(screen.getByTestId("pay-fixed-salary"), "6000");
    await user.click(screen.getByTestId("save-teacher-pay"));

    await waitFor(() =>
      expect(api.updateTeacher).toHaveBeenCalledWith(
        "t1",
        expect.objectContaining({ pay_type: "FIXED", fixed_salary_minor: 600000 }),
      ),
    );
  });

  // Pay is teacher.set_pay's: without it the API redacts the rates, so there is no card at all —
  // a supervisor edits the teacher, never what they earn.
  it("is not there without teacher.set_pay", async () => {
    renderCard("CUSTOMER_SERVICE");
    await waitFor(() => expect(screen.queryByTestId("teacher-pay")).not.toBeInTheDocument());
    expect(api.getTeacher).not.toHaveBeenCalled();
  });

  it("lets the accountant set pay without teacher.update", async () => {
    renderCard("ACCOUNTANT");
    await screen.findByTestId("teacher-pay-editor");
    expect(screen.getByTestId("save-teacher-pay")).toBeInTheDocument();
  });
});
