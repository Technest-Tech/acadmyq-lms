import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enMessages from "../../../messages/en.json";
import { PersonGroupCard } from "@/components/lesson-reminders/person-group-card";
import { ToastProvider } from "@/components/ui/toast";
import { ApiError } from "@/lib/api";
import { LessonRemindersManager } from "./lesson-reminders-manager";

// The WhatsApp page's lesson reminders, and the WhatsApp group on a profile: choose how and to whom
// reminders go, launch them, assign a group, see whether they arrive — and be told plainly when
// something stands in the way.

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
  launchLessonReminders: vi.fn(),
  stopLessonReminders: vi.fn(),
  listReminderGroups: vi.fn(),
  listReminderAssignments: vi.fn(),
  getReminderPerson: vi.fn(),
  assignReminderGroup: vi.fn(),
  testReminderGroup: vi.fn(),
  listReminderLog: vi.fn(),
}));

import * as api from "@/lib/lesson-reminders-api";

const settings = (over: Partial<api.LessonReminderSettings> = {}): api.LessonReminderSettings => ({
  lead_minutes: 30,
  at_start: true,
  language: "ar",
  channel: "GROUPS",
  audience: "BOTH",
  live: false,
  live_since: null,
  ...over,
});

const overview = (over: Partial<api.LessonRemindersOverview> = {}): api.LessonRemindersOverview => ({
  settings: settings(),
  lead_choices: [0, 15, 30, 60],
  timezone: "Africa/Cairo",
  whatsapp: { state: "connected", phone: "201000000000" },
  capacity: { sent_today: 12, daily_cap: 500, expected_next_day: 40 },
  assigned: { students: { assigned: 0, total: 1 }, teachers: { assigned: 0, total: 1 }, classes: null },
  phones: { students: { with_phone: 0, total: 1 }, teachers: { with_phone: 0, total: 1 } },
  last_day: { sent: 7, waiting: 1, failed: 2, missed: 0 },
  ...over,
});

const family: api.ReminderGroupOption = { jid: "111-1@g.us", name: "Omar family", size: 4, can_send: true, assigned_students: 0, assigned_teachers: 0, assigned_classes: 0 };
const announcements: api.ReminderGroupOption = { jid: "333-3@g.us", name: "Announcements", size: 9, can_send: false, assigned_students: 0, assigned_teachers: 0, assigned_classes: 0 };

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
    vi.mocked(api.getLessonReminders).mockResolvedValue(overview({ settings: settings({ live: true }), whatsapp: { state: "logged_out", phone: null } }));
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
    vi.mocked(api.updateLessonReminderSettings).mockResolvedValue({ settings: settings({ lead_minutes: 60 }) });
    render(wrap(<LessonRemindersManager />));
    const user = userEvent.setup();

    expect(await screen.findByTestId("reminders-save")).toBeDisabled();
    await user.selectOptions(screen.getByTestId("reminders-lead"), "60");
    await user.click(screen.getByTestId("reminders-save"));

    await waitFor(() =>
      expect(api.updateLessonReminderSettings).toHaveBeenCalledWith({ lead_minutes: 60, at_start: true, language: "ar", channel: "GROUPS", audience: "BOTH" }),
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

  it("waits for the launch: nothing runs, and the button stays off until someone can be reached", async () => {
    render(wrap(<LessonRemindersManager />));

    expect(await screen.findByTestId("reminders-launch-state")).toHaveTextContent(enMessages.settings.lessonReminders.launch.offTitle);
    expect(screen.getByTestId("reminders-check-connected")).toHaveAttribute("data-ok", "true");
    expect(screen.getByTestId("reminders-check-reach")).toHaveAttribute("data-ok", "false");
    expect(screen.getByTestId("reminders-check-reach")).toHaveTextContent(enMessages.settings.lessonReminders.launch.checkNoGroups);
    expect(screen.getByTestId("reminders-launch-button")).toBeDisabled();
    // On hold is for reminders that were launched; before that there is nothing to hold.
    expect(screen.queryByTestId("reminders-not-connected")).not.toBeInTheDocument();
  });

  it("launches once a student has a group", async () => {
    const ready = { assigned: { students: { assigned: 1, total: 1 }, teachers: { assigned: 0, total: 1 }, classes: null } };
    const live = settings({ live: true, live_since: "2026-11-05T10:00:00+00:00" });
    vi.mocked(api.getLessonReminders).mockResolvedValueOnce(overview(ready)).mockResolvedValue(overview({ ...ready, settings: live }));
    vi.mocked(api.launchLessonReminders).mockResolvedValue({ settings: live });
    render(wrap(<LessonRemindersManager />));
    const user = userEvent.setup();

    await user.click(await screen.findByTestId("reminders-launch-button"));

    await waitFor(() => expect(api.launchLessonReminders).toHaveBeenCalled());
    expect(api.updateLessonReminderSettings).not.toHaveBeenCalled();
    expect(await screen.findByTestId("reminders-launch-state")).toHaveTextContent(enMessages.settings.lessonReminders.launch.liveTitle);
    expect(screen.getByTestId("reminders-stop")).toBeInTheDocument();
  });

  it("saves the choices on screen before it launches, so what runs is what was chosen", async () => {
    vi.mocked(api.getLessonReminders).mockResolvedValue(
      overview({ phones: { students: { with_phone: 3, total: 4 }, teachers: { with_phone: 0, total: 1 } } }),
    );
    vi.mocked(api.updateLessonReminderSettings).mockResolvedValue({ settings: settings({ channel: "PRIVATE", audience: "STUDENTS" }) });
    vi.mocked(api.launchLessonReminders).mockResolvedValue({ settings: settings({ channel: "PRIVATE", audience: "STUDENTS", live: true }) });
    render(wrap(<LessonRemindersManager />));
    const user = userEvent.setup();

    await user.click(await screen.findByTestId("reminders-channel-PRIVATE"));
    await user.click(screen.getByTestId("reminders-audience-STUDENTS"));
    // Private only: no group picker, and how many can be messaged instead.
    expect(screen.queryByTestId("reminders-assign")).not.toBeInTheDocument();
    expect(screen.getByTestId("reminders-phones-students")).toHaveTextContent("3");
    expect(screen.queryByTestId("reminders-phones-teachers")).not.toBeInTheDocument();

    await user.click(screen.getByTestId("reminders-launch-button"));

    await waitFor(() => expect(api.launchLessonReminders).toHaveBeenCalled());
    expect(api.updateLessonReminderSettings).toHaveBeenCalledWith({ lead_minutes: 30, at_start: true, language: "ar", channel: "PRIVATE", audience: "STUDENTS" });
    const [saved] = vi.mocked(api.updateLessonReminderSettings).mock.invocationCallOrder;
    const [launched] = vi.mocked(api.launchLessonReminders).mock.invocationCallOrder;
    expect(saved).toBeLessThan(launched ?? 0);
  });

  it("explains a refused launch in the reader's language", async () => {
    vi.mocked(api.getLessonReminders).mockResolvedValue(
      overview({ assigned: { students: { assigned: 1, total: 1 }, teachers: { assigned: 0, total: 1 }, classes: null } }),
    );
    vi.mocked(api.launchLessonReminders).mockRejectedValue(new ApiError(422, "server words", { error: "nobody_to_remind" }));
    render(wrap(<LessonRemindersManager />));
    const user = userEvent.setup();

    await user.click(await screen.findByTestId("reminders-launch-button"));

    expect(await screen.findByText(enMessages.settings.lessonReminders.errors.nobody_to_remind)).toBeInTheDocument();
  });

  it("stops running reminders", async () => {
    vi.mocked(api.getLessonReminders).mockResolvedValueOnce(overview({ settings: settings({ live: true }) })).mockResolvedValue(overview());
    vi.mocked(api.stopLessonReminders).mockResolvedValue({ settings: settings({ live: false }) });
    render(wrap(<LessonRemindersManager />));
    const user = userEvent.setup();

    await user.click(await screen.findByTestId("reminders-stop"));

    await waitFor(() => expect(api.stopLessonReminders).toHaveBeenCalled());
    expect(await screen.findByTestId("reminders-launch-state")).toHaveTextContent(enMessages.settings.lessonReminders.launch.offTitle);
  });

  it("keeps the launch to the owner", async () => {
    auth.perms = new Set(["student.update", "teacher.read"]);
    render(wrap(<LessonRemindersManager />));

    await screen.findByTestId("reminders-launch");
    expect(screen.queryByTestId("reminders-launch-button")).not.toBeInTheDocument();
    expect(screen.getByText(enMessages.settings.lessonReminders.launch.viewOnly)).toBeInTheDocument();
  });

  it("offers a centre's classes first, each with one group for all its students", async () => {
    auth.perms = new Set(["settings.manage", "student.update", "teacher.update", "teacher.read", "group.manage"]);
    vi.mocked(api.getLessonReminders).mockResolvedValue(
      overview({ assigned: { students: { assigned: 0, total: 1 }, teachers: { assigned: 0, total: 1 }, classes: { assigned: 0, total: 2 } } }),
    );
    render(wrap(<LessonRemindersManager />));

    expect(await screen.findByTestId("reminders-kind-class")).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(api.listReminderAssignments).toHaveBeenCalledWith(expect.objectContaining({ kind: "class" })));
  });

  it("names a private reminder's person in the log", async () => {
    vi.mocked(api.listReminderLog).mockResolvedValue({
      rows: [
        {
          id: "r2",
          event_type: "LESSON_REMINDER",
          status: "SENT",
          error: null,
          channel: "PRIVATE",
          group_name: "Omar",
          recipient_kind: "GUARDIAN",
          lesson: { kind: "LESSON", student: "Omar", teacher: "Mona", starts_at: "2026-11-03T13:00:00+00:00" },
          due_at: null,
          sent_at: null,
          delivered_at: null,
        },
      ],
    });
    render(wrap(<LessonRemindersManager />));

    expect(await screen.findByTestId("reminder-log-r2")).toHaveTextContent(`Omar· ${enMessages.settings.lessonReminders.recipient.GUARDIAN}`);
  });

  it("lists what went out, and can narrow to what did not arrive", async () => {
    vi.mocked(api.listReminderLog).mockResolvedValue({
      rows: [
        {
          id: "r1",
          event_type: "LESSON_STARTING",
          status: "FAILED",
          error: "boom",
          channel: "GROUP",
          group_name: "Omar family",
          recipient_kind: null,
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
