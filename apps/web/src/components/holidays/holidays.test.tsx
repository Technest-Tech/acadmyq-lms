import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import arMessages from "../../../messages/ar.json";
import { makeSession, withAuth } from "@/test/auth";
import type { GroupLesson } from "@/lib/groups-api";
import type { Holiday } from "@/lib/holidays-api";
import { HolidaysManager } from "./holidays-manager";
import { SubstituteModal } from "./substitute-modal";

/**
 * Settings → أجازات المركز, and the substitute picker on one group lesson: the list says what each
 * holiday cancelled, adding one shows what it WILL cancel before it does, deleting asks first, and
 * the substitute modal offers the group's own teacher next to every other.
 */

const listHolidays = vi.fn();
const previewHoliday = vi.fn();
const createHoliday = vi.fn();
const deleteHoliday = vi.fn();
const setGroupLessonSubstitute = vi.fn();

vi.mock("@/lib/holidays-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/holidays-api")>()),
  listHolidays: () => listHolidays(),
  previewHoliday: (from: string, to: string) => previewHoliday(from, to),
  createHoliday: (input: unknown) => createHoliday(input),
  deleteHoliday: (id: string) => deleteHoliday(id),
  setGroupLessonSubstitute: (id: string, teacherId: string | null) => setGroupLessonSubstitute(id, teacherId),
}));

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  listTeachers: () =>
    Promise.resolve({
      rows: [
        { id: "t1", full_name: "Mona", session_rate_minor: 6000, pay_type: "HOURLY", currency: "EGP" },
        { id: "t2", full_name: "Karim", session_rate_minor: 6000, pay_type: "HOURLY", currency: "EGP" },
      ],
      total: 2,
      page: 1,
      pageSize: 200,
    }),
}));

const ar = arMessages.holidays;

const session = makeSession("ACADEMY_OWNER", {
  permissions: ["settings.manage", "group.read", "group.manage", "teacher.read"],
  capabilities: ["groups", "centre", "accounting", "payroll"],
});

function holiday(over: Partial<Holiday> = {}): Holiday {
  return {
    id: "h1",
    name: "عيد الفطر",
    starts_on: "2026-06-22",
    ends_on: "2026-06-24",
    cancelled: { group_lessons: 3, sessions: 1 },
    created_at: "2026-06-17T09:00:00Z",
    ...over,
  };
}

function lesson(over: Partial<GroupLesson> = {}): GroupLesson {
  return {
    id: "l1",
    group_id: "g1",
    teacher_id: "t1",
    teacher_name: "Mona",
    is_substitute: false,
    group_teacher_name: "Mona",
    slot_id: "s1",
    occurrence_local_date: "2026-06-22",
    scheduled_at_utc: "2026-06-22T14:00:00Z",
    duration_minutes: 60,
    status: "SCHEDULED",
    cancel_reason: null,
    moved: false,
    extra: false,
    topic: null,
    homework: null,
    notes: null,
    outcome_set_at: null,
    counts: null,
    ...over,
  };
}

describe("HolidaysManager — the centre's closed days", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listHolidays.mockResolvedValue({ holidays: [holiday()] });
  });

  it("lists each holiday with its dates and what it cancelled", async () => {
    render(withAuth(session, <HolidaysManager />));

    const row = await screen.findByTestId("holiday-h1");
    expect(within(row).getByText("عيد الفطر")).toBeInTheDocument();
    expect(within(row).getByText(/4 حصة ملغاة/)).toBeInTheDocument();
    expect(within(row).getByText(/3 مجموعات · 1 فردية/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: ar.makeUpLink })).toHaveAttribute("href", "/groups");
  });

  it("previews what a new holiday will cancel, then declares it on confirm", async () => {
    previewHoliday.mockResolvedValue({ group_lessons: 2, sessions: 1 });
    createHoliday.mockResolvedValue({ holiday: holiday({ id: "h2", name: "إجازة نصف السنة" }), cancelled: { group_lessons: 2, sessions: 1 } });
    const user = userEvent.setup();
    render(withAuth(session, <HolidaysManager />));

    await user.click(await screen.findByTestId("holiday-add"));
    await user.type(screen.getByTestId("holiday-name"), "إجازة نصف السنة");
    fireEvent.change(screen.getByTestId("holiday-from"), { target: { value: "2026-07-01" } });
    fireEvent.change(screen.getByTestId("holiday-to"), { target: { value: "2026-07-10" } });
    await user.click(screen.getByTestId("holiday-next"));

    // The dry run first: nothing is written until the numbers are confirmed.
    await waitFor(() => expect(previewHoliday).toHaveBeenCalledWith("2026-07-01", "2026-07-10"));
    const confirm = await screen.findByTestId("holiday-confirm");
    expect(within(confirm).getByText(/سيتم إلغاء 3 حصة/)).toBeInTheDocument();
    expect(within(confirm).getByText("2 حصة مجموعات")).toBeInTheDocument();
    expect(within(confirm).getByText("1 حصة فردية")).toBeInTheDocument();
    expect(createHoliday).not.toHaveBeenCalled();

    listHolidays.mockResolvedValue({ holidays: [holiday(), holiday({ id: "h2", name: "إجازة نصف السنة" })] });
    await user.click(screen.getByTestId("holiday-confirm-submit"));
    await waitFor(() => expect(createHoliday).toHaveBeenCalledWith({ name: "إجازة نصف السنة", starts_on: "2026-07-01", ends_on: "2026-07-10" }));
    expect(await screen.findByText("تمت إضافة الأجازة وإلغاء 3 حصة.")).toBeInTheDocument();
    expect(await screen.findByTestId("holiday-h2")).toBeInTheDocument();
  });

  it("asks before deleting and says what came back", async () => {
    deleteHoliday.mockResolvedValue({ ok: true, restored: { group_lessons: 2, sessions: 0 } });
    const user = userEvent.setup();
    render(withAuth(session, <HolidaysManager />));

    await user.click(within(await screen.findByTestId("holiday-h1")).getByRole("button", { name: /حذف/ }));
    expect(deleteHoliday).not.toHaveBeenCalled();
    listHolidays.mockResolvedValue({ holidays: [] });
    await user.click(screen.getByTestId("holiday-delete-submit"));

    await waitFor(() => expect(deleteHoliday).toHaveBeenCalledWith("h1"));
    expect(await screen.findByText("تم حذف الأجازة وإرجاع 2 حصة.")).toBeInTheDocument();
    expect(await screen.findByText(ar.empty)).toBeInTheDocument();
  });

  it("offers no add or delete without settings.manage", async () => {
    render(withAuth(makeSession("SUPERVISOR", { permissions: ["group.read"], capabilities: ["groups", "centre"] }), <HolidaysManager />));

    await screen.findByTestId("holiday-h1");
    expect(screen.queryByTestId("holiday-add")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /حذف/ })).not.toBeInTheDocument();
  });
});

describe("SubstituteModal — a colleague covers one lesson", () => {
  beforeEach(() => vi.clearAllMocks());

  it("offers the group's own teacher first, saves the chosen substitute, and can put the teacher back", async () => {
    setGroupLessonSubstitute.mockResolvedValue({ lesson: lesson({ teacher_id: "t2", teacher_name: "Karim", is_substitute: true }) });
    const onSaved = vi.fn();
    const user = userEvent.setup();
    render(withAuth(session, <SubstituteModal lesson={lesson()} open onClose={() => {}} onSaved={onSaved} />));

    const select = await screen.findByTestId("substitute-teacher");
    await waitFor(() => expect(within(select).getAllByRole("option")).toHaveLength(3));
    expect(within(select).getAllByRole("option")[0]).toHaveTextContent("مدرس المجموعة (Mona)");
    expect(screen.getByText(ar.substitute.payNote)).toBeInTheDocument();

    await user.selectOptions(select, "t2");
    await user.click(screen.getByTestId("substitute-save"));
    await waitFor(() => expect(setGroupLessonSubstitute).toHaveBeenCalledWith("l1", "t2"));
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ teacher_id: "t2", is_substitute: true }), ar.substitute.saved);
  });

  it("sends null to hand the lesson back to the group's teacher", async () => {
    setGroupLessonSubstitute.mockResolvedValue({ lesson: lesson() });
    const user = userEvent.setup();
    render(
      withAuth(
        session,
        <SubstituteModal lesson={lesson({ teacher_id: "t2", teacher_name: "Karim", is_substitute: true })} open onClose={() => {}} onSaved={() => {}} />,
      ),
    );

    const select = await screen.findByTestId("substitute-teacher");
    await waitFor(() => expect(within(select).getAllByRole("option")).toHaveLength(3));
    expect(select).toHaveValue("t2");
    await user.selectOptions(select, "");
    await user.click(screen.getByTestId("substitute-save"));
    await waitFor(() => expect(setGroupLessonSubstitute).toHaveBeenCalledWith("l1", null));
  });
});
