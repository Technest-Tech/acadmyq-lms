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

function renderCard(role: "ACADEMY_OWNER" | "STAFF" = "ACADEMY_OWNER") {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <AuthContext.Provider value={authValue(makeSession(role))}>
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

  it("is read-only without teacher.update", async () => {
    renderCard("STAFF");
    await screen.findByTestId("teacher-pay-editor");
    expect(screen.queryByTestId("save-teacher-pay")).not.toBeInTheDocument();
    expect(screen.getByTestId("pay-type-HOURLY")).toBeDisabled();
  });
});
