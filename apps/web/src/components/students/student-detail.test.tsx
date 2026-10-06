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
  setStudentTeachers: vi.fn(),
  getStudentSchedule: vi.fn(),
}));

import * as api from "@/lib/api";

const teachers = [
  { id: "t1", full_name: "Teacher One" },
  { id: "t2", full_name: "Teacher Two" },
  { id: "t3", full_name: "Teacher Three" },
].map((t) => ({
  ...t,
  user_id: null,
  phone: null,
  specialization: null,
  session_rate_minor: 5000,
  pay_type: "HOURLY" as const,
  fixed_salary_minor: 0,
  currency: "EGP",
  timezone: null,
  payout_method: null,
  payout_handle: null,
  availability: [],
  is_active: true,
  deleted_at: null,
  created_at: "",
}));

const ONE = {
  teacher_id: "t1",
  teacher_name: "Teacher One",
  course: "Quran",
  started_at: "2026-06-01T00:00:00Z",
};
const TWO = {
  teacher_id: "t2",
  teacher_name: "Teacher Two",
  course: "Arabic",
  started_at: "2026-06-01T00:00:00Z",
};

function setup(links: (typeof ONE)[] = [ONE]) {
  vi.mocked(api.listTeachers).mockResolvedValue({
    rows: teachers,
    total: 3,
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
    teachers: links,
    currentTeacher: links[0] ?? null,
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
  vi.mocked(api.setStudentTeachers).mockResolvedValue({
    ok: true,
    added: [],
    removed: [],
    timetables_ended: 0,
    lessons_removed: 0,
  });
  vi.mocked(api.getStudentSchedule).mockResolvedValue({
    schedule: null,
    slots: [],
  });
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

    expect(
      within(await screen.findByTestId("current-teachers")).getByTestId(
        "current-teacher",
      ),
    ).toHaveTextContent("Teacher One");
    expect(screen.getByTestId("subscription-price")).toHaveTextContent("100");
    expect(
      within(screen.getByTestId("teacher-history")).getByText("Teacher One"),
    ).toBeInTheDocument();
  });

  it("reassigns the teacher (history-preserving close+open)", async () => {
    renderDetail();
    await screen.findByTestId("current-teacher");
    const user = userEvent.setup();

    // Open the combobox, then pick "Teacher Two"
    await user.click(screen.getByTestId("change-teacher-select"));
    await user.click(await screen.findByRole("option", { name: "Teacher Two" }));
    await user.click(screen.getByTestId("assign-teacher"));

    await waitFor(() =>
      expect(api.reassignTeacher).toHaveBeenCalledWith(
        "s1",
        expect.objectContaining({ teacher_id: "t2", replaces_teacher_id: "t1" }),
      ),
    );
  });

  it("lists every teacher with the course they teach", async () => {
    setup([ONE, TWO]);
    renderDetail();

    const list = await screen.findByTestId("current-teachers");
    expect(within(list).getAllByTestId("current-teacher")).toHaveLength(2);
    expect(within(list).getByText("Quran")).toBeInTheDocument();
    expect(within(list).getByText("Arabic")).toBeInTheDocument();
    // One timetable editor per teacher, each fetched for its own teacher.
    await waitFor(() => {
      expect(api.getStudentSchedule).toHaveBeenCalledWith("s1", "t1");
      expect(api.getStudentSchedule).toHaveBeenCalledWith("s1", "t2");
    });
  });

  it("asks which teacher is leaving before replacing one of several", async () => {
    setup([ONE, TWO]);
    renderDetail();
    await screen.findByTestId("current-teachers");
    const user = userEvent.setup();

    await user.click(screen.getByTestId("change-teacher-select"));
    await user.click(await screen.findByRole("option", { name: /Teacher Three/ }));
    // The newcomer alone is not enough — nobody has been chosen to leave yet.
    expect(screen.getByTestId("assign-teacher")).toBeDisabled();

    await user.click(screen.getByTestId("replace-leaving-select"));
    await user.click(await screen.findByRole("option", { name: /Teacher Two/ }));
    await user.click(screen.getByTestId("assign-teacher"));

    await waitFor(() =>
      expect(api.reassignTeacher).toHaveBeenCalledWith(
        "s1",
        expect.objectContaining({ teacher_id: "t3", replaces_teacher_id: "t2" }),
      ),
    );
  });

  it("adds a second teacher with their course in one save", async () => {
    renderDetail();
    await screen.findByTestId("current-teachers");
    const user = userEvent.setup();

    await user.click(screen.getByTestId("edit-teachers"));
    await user.click(screen.getByTestId("add-teacher-link"));
    await user.click(screen.getByTestId("teacher-link-select-1"));
    // Teacher One is already on the first row, so it is not offered again.
    expect(screen.queryByRole("option", { name: /Teacher One/ })).not.toBeInTheDocument();
    await user.click(await screen.findByRole("option", { name: /Teacher Two/ }));
    await user.type(screen.getByTestId("teacher-link-course-1"), "Arabic");
    await user.click(screen.getByTestId("save-teachers"));

    await waitFor(() =>
      expect(api.setStudentTeachers).toHaveBeenCalledWith("s1", {
        teachers: [
          { teacher_id: "t1", course: "Quran" },
          { teacher_id: "t2", course: "Arabic" },
        ],
      }),
    );
  });

  it("confirms before a save that removes a teacher", async () => {
    setup([ONE, TWO]);
    renderDetail();
    await screen.findByTestId("current-teachers");
    const user = userEvent.setup();

    await user.click(screen.getByTestId("edit-teachers"));
    await user.click(screen.getByTestId("teacher-link-remove-1"));
    await user.click(screen.getByTestId("save-teachers"));

    // Removing ends their timetable, so nothing is sent until it is confirmed.
    expect(api.setStudentTeachers).not.toHaveBeenCalled();
    await user.click(await screen.findByTestId("confirm-remove-teachers"));

    await waitFor(() =>
      expect(api.setStudentTeachers).toHaveBeenCalledWith("s1", {
        teachers: [{ teacher_id: "t1", course: "Quran" }],
      }),
    );
  });
});
