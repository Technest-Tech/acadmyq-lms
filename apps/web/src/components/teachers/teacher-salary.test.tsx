import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext } from "@/components/auth-provider";
import { authValue, makeSession } from "@/test/auth";
import enMessages from "../../../messages/en.json";
import { TeacherSalary } from "./teacher-salary";

vi.mock("@/lib/api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/api")>()),
  getTeacher: vi.fn(),
  listPayouts: vi.fn(),
  listStudents: vi.fn().mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 8 }),
}));

import * as api from "@/lib/api";

const TEACHER = {
  id: "t1", user_id: null, full_name: "Ustadh Kareem", phone: null, specialization: null, session_rate_minor: 8000, pay_type: "HOURLY",
  fixed_salary_minor: 0, currency: "EGP", timezone: null, payout_method: null, payout_handle: null, availability: [], is_active: true, deleted_at: null, created_at: "",
} as api.TeacherRow;

function renderTab(permissions: string[]) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <AuthContext.Provider value={authValue(makeSession("ACADEMY_OWNER", { permissions }))}>
        <TeacherSalary teacherId="t1" />
      </AuthContext.Provider>
    </NextIntlClientProvider>,
  );
}

describe("TeacherSalary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getTeacher).mockResolvedValue({ teacher: TEACHER, students: [], student_rates: [] } as never);
    vi.mocked(api.listPayouts).mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 50 });
  });

  it("lets whoever sets pay edit the hourly rate — without reading payroll", async () => {
    renderTab(["teacher.read", "teacher.set_pay"]);

    expect(await screen.findByTestId("save-teacher-pay")).toBeInTheDocument();
    expect(api.listPayouts).not.toHaveBeenCalled();
    expect(screen.queryByText(enMessages.teachers.salary.title)).toBeNull();
  });

  it("shows the statements to payroll as well", async () => {
    renderTab(["teacher.read", "teacher.set_pay", "payout.read"]);

    expect(await screen.findByTestId("save-teacher-pay")).toBeInTheDocument();
    expect(api.listPayouts).toHaveBeenCalled();
    expect(screen.getByText(enMessages.teachers.salary.title)).toBeInTheDocument();
  });
});
