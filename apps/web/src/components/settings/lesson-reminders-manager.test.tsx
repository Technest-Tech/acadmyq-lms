import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enMessages from "../../../messages/en.json";
import { PersonGroupCard } from "@/components/lesson-reminders/person-group-card";
import { ToastProvider } from "@/components/ui/toast";
import { ApiError } from "@/lib/api";
import { LessonRemindersManager } from "./lesson-reminders-manager";

// Settings → Lesson reminders, and the WhatsApp group on a profile: assign a group, see the timing,
// see whether reminders arrive — and be told plainly when something stands in the way.

const auth = vi.hoisted(() => ({
  perms: new Set(["settings.manage", "student.update", "teacher.update", "teacher.read"]),
  capabilities: ["whatsapp.automation", "whatsapp.group_reminders"] as string[] | null,
}));

vi.mock("@/components/auth-provider", () => ({
  useAuth: () => ({
    can: (p: string) => auth.perms.has(p),
    session: { role: "ACADEMY_OWNER", academyId: "a1", capabilities: auth.capabilities },
  }),
}));

vi.mock("@/lib/lesson-reminders-api", () => ({
  getLessonReminders: vi.fn(),
  updateLessonReminderSettings: vi.fn(),
  listReminderGroups: vi.fn(),
  listReminderAssignments: vi.fn(),
  getReminderPerson: vi.fn(),
  assignReminderGroup: vi.fn(),
  testReminderGroup: vi.fn(),
  listReminderLog: vi.fn(),
}));

import * as api from "@/lib/lesson-reminders-api";

const overview = (over: Partial<api.LessonRemindersOverview> = {}): api.LessonRemindersOverview => ({
  settings: { lead_minutes: 30, at_start: true, language: "ar" },
  lead_choices: [0, 15, 30, 60],
  timezone: "Africa/Cairo",
  whatsapp: { state: "connected", phone: "201000000000" },
  capacity: { sent_today: 12, daily_cap: 500, expected_next_day: 40 },
  assigned: { students: { assigned: 0, total: 1 }, teachers: { assigned: 0, total: 1 } },
  last_day: { sent: 7, waiting: 1, failed: 2, missed: 0 },
  ...over,
});

const family: api.ReminderGroupOption = { jid: "111-1@g.us", name: "Omar family", size: 4, can_send: true, assigned_students: 0, assigned_teachers: 0 };
const announcements: api.ReminderGroupOption = { jid: "333-3@g.us", name: "Announcements", size: 9, can_send: false, assigned_students: 0, assigned_teachers: 0 };

const omar: api.ReminderPerson = { id: "s1", name: "Omar", group: null };
const assigned = (over: Partial<api.AssignedReminderGroup> = {}): api.ReminderPerson => ({
  ...omar,
  group: { id: "g1", jid: family.jid, name: family.name, last_status: null, last_error: null, last_at: null, ...over },
});

const wrap = (node: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={enMessages}>
    <ToastProvider>{node}</ToastProvider>
  </NextIntlClientProvider>
);

async function pickGroup(personId: string, label: string) {
  const user = userEvent.setup();
  await user.click(within(await screen.findByTestId(`reminder-row-${personId}`)).getByRole("button", { name: /choose a group|no group/i }));
  await user.click(await screen.findByRole("option", { name: new RegExp(label) }));
}

describe("LessonRemindersManager", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    auth.perms = new Set(["settings.manage", "student.update", "teacher.update", "teacher.read"]);
    auth.capabilities = ["whatsapp.automation", "whatsapp.group_reminders"];
    vi.mocked(api.getLessonReminders).mockResolvedValue(overview());
    vi.mocked(api.listReminderGroups).mockResolvedValue({ groups: [announcements, family] });
    vi.mocked(api.listReminderAssignments).mockResolvedValue({ rows: [omar], total: 1, page: 1, pageSize: 30 });
    vi.mocked(api.listReminderLog).mockResolvedValue({ rows: [] });
  });

  it("assigns a group, saving the moment it is picked", async () => {
    vi.mocked(api.assignReminderGroup).mockResolvedValue({ person: assigned() });
    render(wrap(<LessonRemindersManager />));

    await pickGroup("s1", "Omar family");

    await waitFor(() => expect(api.assignReminderGroup).toHaveBeenCalledWith("student", "s1", family.jid));
    expect(await screen.findByTestId("reminder-test-s1")).toBeInTheDocument();
  });

  it("says why a group was refused, in the reader's language", async () => {
    vi.mocked(api.assignReminderGroup).mockRejectedValue(new ApiError(422, "server words", { error: "admins_only" }));
    render(wrap(<LessonRemindersManager />));

    await pickGroup("s1", "Announcements");

    expect(await screen.findByText(enMessages.settings.lessonReminders.errors.admins_only)).toBeInTheDocument();
  });

  it("offers the group named after the person first", async () => {
    render(wrap(<LessonRemindersManager />));
    const user = userEvent.setup();

    await user.click(within(await screen.findByTestId("reminder-row-s1")).getByRole("button", { name: /choose a group|no group/i }));

    const options = within(await screen.findByRole("listbox")).getAllByRole("option");
    expect(options[1]).toHaveTextContent("Omar family");
  });

  it("warns when the number has left an assigned group", async () => {
    vi.mocked(api.listReminderAssignments).mockResolvedValue({
      rows: [{ ...omar, group: { id: "g9", jid: "999-9@g.us", name: "Old group", last_status: "SENT", last_error: null, last_at: null } }],
      total: 1,
      page: 1,
      pageSize: 30,
    });
    render(wrap(<LessonRemindersManager />));

    expect(await screen.findByTestId("reminder-warning-s1")).toHaveTextContent(/no longer in this group/);
  });

  it("does not raise that warning before the number's list has arrived", async () => {
    vi.mocked(api.listReminderGroups).mockReturnValue(new Promise(() => {}));
    vi.mocked(api.listReminderAssignments).mockResolvedValue({ rows: [assigned()], total: 1, page: 1, pageSize: 30 });
    render(wrap(<LessonRemindersManager />));

    await screen.findByTestId("reminder-row-s1");
    expect(screen.queryByTestId("reminder-warning-s1")).not.toBeInTheDocument();
  });

  it("shows reminders on hold and locks the pickers while the number is disconnected", async () => {
    vi.mocked(api.getLessonReminders).mockResolvedValue(overview({ whatsapp: { state: "logged_out", phone: null } }));
    render(wrap(<LessonRemindersManager />));

    expect(await screen.findByTestId("reminders-not-connected")).toBeInTheDocument();
    const row = await screen.findByTestId("reminder-row-s1");
    expect(within(row).getByRole("button", { name: /choose a group|no group/i })).toBeDisabled();
    expect(api.listReminderGroups).not.toHaveBeenCalled();
  });

  it("warns ahead of time when the day will not fit the number's cap", async () => {
    vi.mocked(api.getLessonReminders).mockResolvedValue(overview({ capacity: { sent_today: 0, daily_cap: 500, expected_next_day: 480 } }));
    render(wrap(<LessonRemindersManager />));

    expect(await screen.findByTestId("reminders-capacity-warning")).toHaveTextContent("480");
  });

  it("stays silent about the cap on a normal day", async () => {
    render(wrap(<LessonRemindersManager />));

    await screen.findByTestId("lesson-reminders");
    expect(screen.queryByTestId("reminders-capacity-warning")).not.toBeInTheDocument();
  });

  it("saves the timing", async () => {
    vi.mocked(api.updateLessonReminderSettings).mockResolvedValue({ settings: { lead_minutes: 60, at_start: true, language: "ar" } });
    render(wrap(<LessonRemindersManager />));
    const user = userEvent.setup();

    expect(await screen.findByTestId("reminders-save")).toBeDisabled();
    await user.selectOptions(screen.getByTestId("reminders-lead"), "60");
    await user.click(screen.getByTestId("reminders-save"));

    await waitFor(() =>
      expect(api.updateLessonReminderSettings).toHaveBeenCalledWith({ lead_minutes: 60, at_start: true, language: "ar" }),
    );
  });

  it("shows a supervisor the timing but does not let them change it", async () => {
    auth.perms = new Set(["student.update", "teacher.read"]);
    render(wrap(<LessonRemindersManager />));

    expect(await screen.findByTestId("reminders-lead")).toBeDisabled();
    expect(screen.queryByTestId("reminders-save")).not.toBeInTheDocument();
  });

  it("lets a role that only reads teachers see their groups, not change them", async () => {
    auth.perms = new Set(["student.update", "teacher.read"]);
    render(wrap(<LessonRemindersManager />));
    const user = userEvent.setup();

    await user.click(await screen.findByTestId("reminders-kind-teacher"));

    await waitFor(() => expect(api.listReminderAssignments).toHaveBeenLastCalledWith(expect.objectContaining({ kind: "teacher" })));
    const row = await screen.findByTestId("reminder-row-s1");
    expect(within(row).getByRole("button", { name: /choose a group|no group/i })).toBeDisabled();
  });

  it("lists what went out, and can narrow to what did not arrive", async () => {
    vi.mocked(api.listReminderLog).mockResolvedValue({
      rows: [
        {
          id: "r1",
          event_type: "LESSON_STARTING",
          status: "FAILED",
          error: "boom",
          group_name: "Omar family",
          lesson: { kind: "LESSON", student: "Omar", teacher: "Mona", starts_at: "2026-11-03T13:00:00+00:00" },
          due_at: null,
          sent_at: null,
          delivered_at: null,
        },
      ],
    });
    render(wrap(<LessonRemindersManager />));
    const user = userEvent.setup();

    const row = await screen.findByTestId("reminder-log-r1");
    expect(row).toHaveTextContent("Failed");
    expect(row).toHaveTextContent("3:00 PM"); // Cairo, not the browser's zone

    await user.click(screen.getByTestId("reminders-log-problems"));
    await waitFor(() => expect(api.listReminderLog).toHaveBeenLastCalledWith(true));
  });
});

describe("PersonGroupCard", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    auth.perms = new Set(["student.update", "teacher.update"]);
    auth.capabilities = ["whatsapp.group_reminders"];
    vi.mocked(api.getReminderPerson).mockResolvedValue({ person: assigned({ last_status: "DELIVERED" }) });
    vi.mocked(api.listReminderGroups).mockResolvedValue({ groups: [family] });
  });

  it("shows the person's group and how the last message went", async () => {
    render(wrap(<PersonGroupCard kind="student" personId="s1" />));

    expect(await screen.findByTestId("person-group-card")).toBeInTheDocument();
    expect(await screen.findByText(enMessages.settings.lessonReminders.last.ok)).toBeInTheDocument();
    expect(api.getReminderPerson).toHaveBeenCalledWith("student", "s1");
  });

  it("does not exist until a Super Admin switches the feature on", () => {
    auth.capabilities = ["whatsapp.automation"];
    render(wrap(<PersonGroupCard kind="student" personId="s1" />));

    expect(screen.queryByTestId("person-group-card")).not.toBeInTheDocument();
    expect(api.getReminderPerson).not.toHaveBeenCalled();
  });

  it("does not guess when there is no capability list at all", () => {
    auth.capabilities = null;
    render(wrap(<PersonGroupCard kind="teacher" personId="t1" />));

    expect(screen.queryByTestId("person-group-card")).not.toBeInTheDocument();
  });

  it("does not exist for someone who cannot edit that person", () => {
    auth.perms = new Set(["student.update"]);
    render(wrap(<PersonGroupCard kind="teacher" personId="t1" />));

    expect(screen.queryByTestId("person-group-card")).not.toBeInTheDocument();
  });

  it("explains when the number is not connected", async () => {
    vi.mocked(api.listReminderGroups).mockRejectedValue(new ApiError(409, "x", { error: "not_connected" }));
    render(wrap(<PersonGroupCard kind="student" personId="s1" />));

    expect(await screen.findByText(enMessages.settings.lessonReminders.errors.not_connected)).toBeInTheDocument();
  });
});
