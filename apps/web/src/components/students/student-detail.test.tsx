import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext } from "@/components/auth-provider";
import { authValue, makeSession } from "@/test/auth";
import enMessages from "../../../messages/en.json";
import { StudentDetail } from "./student-detail";

vi.mock("@/lib/api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/api")>()),
  getStudent: vi.fn(),
  getTeacherHistory: vi.fn(),
  listTeachers: vi.fn(),
  reassignTeacher: vi.fn(),
  changeSubscriptionPrice: vi.fn(),
}));

import * as api from "@/lib/api";

const teachers = [
  { id: "t1", full_name: "Teacher One" },
  { id: "t2", full_name: "Teacher Two" },
].map((t) => ({
  ...t,
  user_id: null,
  phone: null,
  specialization: null,
  session_rate_minor: 5000,
  currency: "EGP",
  timezone: null,
  availability: [],
  is_active: true,
  deleted_at: null,
  created_at: "",
}));

function setup() {
  vi.mocked(api.listTeachers).mockResolvedValue({
    rows: teachers,
    total: 2,
    page: 1,
    pageSize: 50,
  });
  vi.mocked(api.getStudent).mockResolvedValue({
    student: {
      id: "s1",
      full_name: "Yusuf",
      guardian_id: "g1",
      is_self_guardian: false,
      status: "REGULAR",
      deleted_at: null,
    },
    guardian: null,
    subscription: {
      id: "sub1",
      price_minor: 10000,
      currency: "EGP",
      price_basis: "PER_SESSION",
      plan_label: "8/month",
      sessions_per_month: 8,
      start_date: "2026-06-01",
    },
    currentTeacher: {
      teacher_id: "t1",
      teacher_name: "Teacher One",
      started_at: "2026-06-01T00:00:00Z",
    },
  });
  vi.mocked(api.getTeacherHistory).mockResolvedValue({
    history: [
      {
        id: "a2",
        teacher_id: "t1",
        teacher_name: "Teacher One",
        started_at: "2026-06-01T00:00:00Z",
        ended_at: null,
      },
    ],
  });
  vi.mocked(api.reassignTeacher).mockResolvedValue({ ok: true });
  vi.mocked(api.changeSubscriptionPrice).mockResolvedValue({ ok: true });
}

function renderDetail() {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <AuthContext.Provider value={authValue(makeSession("ACADEMY_OWNER"))}>
        <StudentDetail studentId="s1" onBack={vi.fn()} />
      </AuthContext.Provider>
    </NextIntlClientProvider>,
  );
}

describe("StudentDetail (Sprint 4 §5.2/5.3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setup();
  });

  it("shows the current teacher, subscription price and assignment history", async () => {
    renderDetail();

    expect(await screen.findByTestId("current-teacher")).toHaveTextContent(
      "Teacher One",
    );
    expect(screen.getByTestId("subscription-price")).toHaveTextContent("100");
    expect(
      within(screen.getByTestId("teacher-history")).getByText("Teacher One"),
    ).toBeInTheDocument();
  });

  it("reassigns the teacher (history-preserving close+open)", async () => {
    renderDetail();
    await screen.findByTestId("current-teacher");
    const user = userEvent.setup();

    await user.selectOptions(screen.getByTestId("change-teacher-select"), "t2");
    await user.click(screen.getByTestId("assign-teacher"));

    await waitFor(() =>
      expect(api.reassignTeacher).toHaveBeenCalledWith(
        "s1",
        expect.objectContaining({ teacher_id: "t2" }),
      ),
    );
  });

  it("changes the subscription price", async () => {
    renderDetail();
    await screen.findByTestId("current-teacher");
    const user = userEvent.setup();

    await user.click(screen.getByTestId("edit-price"));
    await user.type(screen.getByLabelText("New price"), "120");
    await user.click(screen.getByTestId("save-price"));

    await waitFor(() =>
      expect(api.changeSubscriptionPrice).toHaveBeenCalledWith("s1", {
        price_minor: 12000,
      }),
    );
  });
});
