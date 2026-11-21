import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enMessages from "../../../messages/en.json";
import { currentMonth, shiftMonth } from "./performance-ui";
import { TeacherPerformance } from "./teacher-performance";

// Teacher performance: the month's cards, a teacher's detail, and the two things a supervisor
// records on the page — a lesson rating and a conduct note. The fixture mirrors the API test
// (TeacherPerformanceTest.php).

vi.mock("@/lib/api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/api")>()),
  getTeacherPerformance: vi.fn(),
  getTeacherPerformanceDetail: vi.fn(),
  updatePerformanceSettings: vi.fn(),
  createConductNote: vi.fn(),
  deleteConductNote: vi.fn(),
  createLessonVisit: vi.fn(),
}));

import * as api from "@/lib/api";

const settings: api.PerformanceSettings = {
  weights: { quality: 40, reports: 20, entry: 20, conduct: 20 },
  points: { ABSENCE: 10, APOLOGY: 3, VIOLATION: 5 },
  visits_target: 2,
  late_minutes: 5,
  report_minutes: 120,
  criteria: [
    { id: "preparation", name: "Preparation" },
    { id: "teaching", name: "Teaching" },
  ],
  rules: ["Camera on", "Follow the plan"],
};

const scores = (o: {
  total: number | null;
  quality?: Partial<api.PerformanceScores["quality"]>;
  reports?: Partial<api.PerformanceScores["reports"]>;
  entry?: Partial<api.PerformanceScores["entry"]>;
  conduct?: Partial<api.PerformanceScores["conduct"]>;
  lessons?: Partial<api.PerformanceScores["lessons"]>;
}): api.PerformanceScores => ({
  total: o.total,
  quality: { score: null, visits: 0, target: 2, ...o.quality },
  reports: {
    score: null, due: 0, on_time: 0, late: 0, missing: 0, pending: 0,
    trial_due: 0, trial_on_time: 0, trial_late: 0, trial_missing: 0, ...o.reports,
  },
  entry: { score: null, measured: 0, on_time: 0, late: 0, missed: 0, pending: 0, ...o.entry },
  conduct: { score: null, points: 0, absences: 0, apologies: 0, violations: 0, unclassified: 0, ...o.conduct },
  lessons: { total: 0, taught: 0, student_absent: 0, teacher_cancelled: 0, student_cancelled: 0, unmarked: 0, trials: 0, ...o.lessons },
});

const mona: api.PerformanceTeacher = {
  id: "mona", name: "Mona", is_active: true, has_meeting_url: true,
  ...scores({
    total: 70.8,
    reports: { score: 50, due: 3, on_time: 1, late: 1, missing: 1, pending: 1 },
    entry: { score: 62.5, measured: 4, on_time: 2, late: 1, missed: 1, pending: 1 },
    conduct: { score: 100, unclassified: 1 },
    lessons: { total: 6, taught: 3, student_absent: 1, teacher_cancelled: 1 },
  }),
};
const karim: api.PerformanceTeacher = {
  id: "karim", name: "Karim", is_active: true, has_meeting_url: false,
  ...scores({
    total: 94,
    quality: { score: 90, visits: 2 },
    reports: { score: 100, due: 1, on_time: 1, trial_due: 1, trial_on_time: 1 },
    conduct: { score: 95, points: 5, violations: 1 },
    lessons: { total: 1, taught: 1, trials: 1 },
  }),
};
const salma: api.PerformanceTeacher = {
  id: "salma", name: "Salma", is_active: true, has_meeting_url: true, ...scores({ total: null }),
};

const page = (can: api.PerformanceAbilities = { manage: true, settings: true }): api.TeacherPerformance => ({
  month: "2026-09",
  timezone: "Africa/Cairo",
  settings,
  can,
  summary: { teachers: 3, average: 82.4, visits: 2, visited: 1, visits_due: 2, reports_missing: 1, notes: 1, unclassified: 1 },
  teachers: [karim, mona, salma],
});

const lesson = (o: Partial<api.PerformanceLesson> & { id: string }): api.PerformanceLesson => ({
  scheduled_at_utc: "2026-09-24T10:00:00+00:00", local_date: "2026-09-24", duration_minutes: 30, status: "ATTENDED",
  student_name: "Omar", is_trial: false, noted: false, join_bucket: "on_time", first_joined_at: "2026-09-24T10:03:00+00:00",
  join_delay_minutes: 3, presses: 1, report_bucket: "on_time", reported_at: "2026-09-24T10:40:00+00:00", report_delay_minutes: 10, ...o,
});

const note: api.ConductNote = {
  id: "n1", teacher_id: "mona", kind: "VIOLATION", occurred_on: "2026-09-22", session_id: null, lesson_at: null,
  lesson_student: null, rule: "Camera on", note: "Camera off for half the lesson", points: 5, author_name: "Huda",
  created_at: "2026-09-22T12:00:00+00:00",
};
const visit: api.LessonVisit = {
  id: "v1", teacher_id: "mona", visited_on: "2026-09-24", session_id: "l1", lesson_at: "2026-09-24T10:00:00+00:00",
  lesson_student: "Omar", score: 80, items: [
    { criterion_id: "preparation", name: "Preparation", rating: 5 },
    { criterion_id: "teaching", name: "Teaching", rating: 3 },
  ],
  strengths: "Calm and clear", improvements: null, author_name: "Huda", created_at: "2026-09-24T12:00:00+00:00",
};

const detail = (can: api.PerformanceAbilities = { manage: true, settings: true }): api.TeacherPerformanceDetail => ({
  month: "2026-09",
  timezone: "Africa/Cairo",
  settings,
  can,
  teacher: mona,
  trend: ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"].map((month, i) => ({
    month, total: i < 4 ? null : i === 4 ? 50 : 70.8, quality: null, reports: null, entry: null, conduct: null,
  })),
  lessons: [
    lesson({ id: "l1" }),
    lesson({
      id: "l2", scheduled_at_utc: "2026-09-24T12:00:00+00:00", student_name: "Laila", is_trial: true, join_bucket: "late",
      first_joined_at: "2026-09-24T12:12:00+00:00", join_delay_minutes: 12, presses: 2,
      report_bucket: "late", reported_at: "2026-09-24T15:00:00+00:00", report_delay_minutes: 150,
    }),
    lesson({
      id: "l4", scheduled_at_utc: "2026-09-25T12:00:00+00:00", status: "CANCELLED_BY_TEACHER", join_bucket: "not_tracked",
      first_joined_at: null, join_delay_minutes: null, report_bucket: "not_needed", reported_at: null, report_delay_minutes: null,
    }),
  ],
  truncated: false,
  notes: [note],
  visits: [visit],
});

const wrap = (node: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={enMessages}>{node}</NextIntlClientProvider>
);

const cards = () => screen.getAllByTestId("performance-card");
const cardOf = (id: string) => cards().find((c) => c.getAttribute("data-teacher") === id)!;

describe("TeacherPerformance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getTeacherPerformance).mockResolvedValue(page());
    vi.mocked(api.getTeacherPerformanceDetail).mockResolvedValue(detail());
    vi.mocked(api.createConductNote).mockResolvedValue({ note });
    vi.mocked(api.createLessonVisit).mockResolvedValue({ visit });
    vi.mocked(api.deleteConductNote).mockResolvedValue({ deleted: true });
    vi.mocked(api.updatePerformanceSettings).mockResolvedValue({ settings, can: { manage: true, settings: true } });
  });

  it("shows the month as one card per teacher, best total first", async () => {
    render(wrap(<TeacherPerformance />));

    await screen.findAllByTestId("performance-card");
    expect(cards().map((c) => c.getAttribute("data-teacher"))).toEqual(["karim", "mona", "salma"]);
    expect(api.getTeacherPerformance).toHaveBeenCalledWith(currentMonth());

    const m = within(cardOf("mona"));
    expect(m.getByTestId("card-total")).toHaveTextContent("71 of 100");
    expect(m.getByText("6 lessons this month")).toBeInTheDocument();
    expect(m.getByTestId("card-quality")).toHaveTextContent("No lesson visited yet");
    expect(m.getByTestId("card-reports")).toHaveTextContent("1 of 3 on time");
    expect(m.getByTestId("card-entry")).toHaveTextContent("2 of 4 on time");
    expect(m.getByTestId("card-conduct")).toHaveTextContent("1 cancelled lesson to record");

    const k = within(cardOf("karim"));
    expect(k.getByText("Excellent")).toBeInTheDocument();
    expect(k.getByTestId("card-quality")).toHaveTextContent("2 of 2 visits");
    expect(k.getByTestId("card-entry")).toHaveTextContent("No meeting link");
    expect(k.getByTestId("card-conduct")).toHaveTextContent("1 rule not kept");

    // Nothing this month: listed, with nothing to score.
    expect(within(cardOf("salma")).getByTestId("card-total")).toHaveTextContent("Nothing to evaluate yet");

    expect(screen.getByTestId("tile-average")).toHaveTextContent("82");
    expect(screen.getByTestId("tile-visits")).toHaveTextContent("1 of 2");
    expect(screen.getByTestId("tile-reports")).toHaveTextContent("1");
    expect(screen.getByTestId("tile-notes")).toHaveTextContent("1 cancelled lesson waiting to be recorded");
  });

  it("narrows to the teachers nobody has visited, and searches by name", async () => {
    const user = userEvent.setup();
    render(wrap(<TeacherPerformance />));
    await screen.findAllByTestId("performance-card");

    await user.click(screen.getByTestId("performance-filter-notVisited"));
    expect(cards().map((c) => c.getAttribute("data-teacher"))).toEqual(["mona"]);

    await user.click(screen.getByTestId("performance-filter-all"));
    await user.type(screen.getByTestId("performance-search"), "kar");
    expect(cards().map((c) => c.getAttribute("data-teacher"))).toEqual(["karim"]);

    await user.clear(screen.getByTestId("performance-search"));
    await user.type(screen.getByTestId("performance-search"), "zzz");
    expect(screen.getByTestId("performance-empty")).toHaveTextContent("No teacher matches.");
  });

  it("moves between months and never past the current one", async () => {
    const user = userEvent.setup();
    render(wrap(<TeacherPerformance />));
    await screen.findAllByTestId("performance-card");

    expect(screen.getByTestId("month-next")).toBeDisabled();
    await user.click(screen.getByTestId("month-previous"));
    await waitFor(() => expect(api.getTeacherPerformance).toHaveBeenLastCalledWith(shiftMonth(currentMonth(), -1)));
    expect(screen.getByTestId("month-next")).toBeEnabled();

    await user.click(screen.getByTestId("month-current"));
    await waitFor(() => expect(api.getTeacherPerformance).toHaveBeenLastCalledWith(currentMonth()));
  });

  it("opens a teacher's month: the parts, the lessons, the ratings and the notes", async () => {
    const user = userEvent.setup();
    render(wrap(<TeacherPerformance />));
    await screen.findAllByTestId("performance-card");

    await user.click(within(cardOf("mona")).getByTestId("card-details"));
    const dialog = within(await screen.findByTestId("performance-detail"));
    await dialog.findByTestId("detail-parts");
    expect(api.getTeacherPerformanceDetail).toHaveBeenCalledWith("mona", currentMonth());

    expect(dialog.getByTestId("detail-part-quality")).toHaveTextContent("40%");
    expect(dialog.getByTestId("detail-part-quality")).toHaveTextContent("left out of the total");
    expect(dialog.getByTestId("detail-part-reports")).toHaveTextContent("50");
    expect(dialog.getByTestId("detail-part-entry")).toHaveTextContent("63");
    expect(dialog.getByTestId("detail-unclassified")).toHaveTextContent("1 lesson this teacher cancelled is not recorded yet");
    expect(dialog.getByTestId("trend-2026-08")).toHaveTextContent("50");

    const table = within(dialog.getByTestId("lesson-table"));
    expect(table.getAllByTestId("lesson-row")).toHaveLength(3);
    expect(dialog.getByTestId("lesson-table")).toHaveTextContent("12 min after the start");
    expect(table.getByText("Trial")).toBeInTheDocument();

    await user.click(dialog.getByTestId("lesson-filter-lateReport"));
    expect(table.getAllByTestId("lesson-row")).toHaveLength(1);

    await user.click(dialog.getByTestId("detail-tab-visits"));
    expect(dialog.getByTestId("visit-v1")).toHaveTextContent("Lesson with Omar");
    expect(dialog.getByTestId("visit-v1")).toHaveTextContent("Calm and clear");

    await user.click(dialog.getByTestId("detail-tab-notes"));
    const row = dialog.getByTestId("note-n1");
    expect(row).toHaveTextContent("Rule not kept");
    expect(row).toHaveTextContent("Camera on");
    expect(row).toHaveTextContent("−5 points");

    // Deleting takes two presses, then both the detail and the page re-read.
    await user.click(dialog.getByTestId("note-n1-delete"));
    await user.click(dialog.getByTestId("note-n1-confirm-delete"));
    await waitFor(() => expect(api.deleteConductNote).toHaveBeenCalledWith("n1"));
    await waitFor(() => expect(api.getTeacherPerformance).toHaveBeenCalledTimes(2));
  });

  it("records a cancelled lesson as an absence", async () => {
    const user = userEvent.setup();
    render(wrap(<TeacherPerformance />));
    await screen.findAllByTestId("performance-card");

    await user.click(within(cardOf("mona")).getByTestId("card-details"));
    const dialog = within(await screen.findByTestId("performance-detail"));
    await user.click(await dialog.findByTestId("lesson-absence-l4"));

    // The form opens on that lesson, already an absence, showing what it costs.
    expect(dialog.getByTestId("note-kind-ABSENCE")).toHaveAttribute("aria-pressed", "true");
    expect(dialog.getByTestId("note-kind-ABSENCE")).toHaveTextContent("−10 points");
    expect(dialog.getByTestId("note-lesson")).toHaveValue("l4");
    await user.type(dialog.getByTestId("note-details"), "No notice");
    await user.click(dialog.getByTestId("note-save"));

    await waitFor(() =>
      expect(api.createConductNote).toHaveBeenCalledWith("mona", {
        kind: "ABSENCE", session_id: "l4", occurred_on: null, rule: null, note: "No notice",
      }),
    );
    // Back on the teacher's notes, with fresh numbers.
    await dialog.findByTestId("note-list");
    expect(api.getTeacherPerformanceDetail).toHaveBeenCalledTimes(2);
  });

  it("asks which rule when a rule was not kept", async () => {
    const user = userEvent.setup();
    render(wrap(<TeacherPerformance />));
    await screen.findAllByTestId("performance-card");

    await user.click(within(cardOf("mona")).getByTestId("card-add-note"));
    const dialog = within(await screen.findByTestId("performance-detail"));
    await user.click(await dialog.findByTestId("note-kind-VIOLATION"));
    await user.selectOptions(dialog.getByTestId("note-rule"), "Another rule");
    await user.click(dialog.getByTestId("note-save"));
    expect(dialog.getByText("Say which rule was not kept.")).toBeInTheDocument();
    expect(api.createConductNote).not.toHaveBeenCalled();

    await user.type(dialog.getByTestId("note-rule-text"), "Phone away");
    await user.click(dialog.getByTestId("note-save"));
    await waitFor(() =>
      expect(api.createConductNote).toHaveBeenCalledWith("mona", expect.objectContaining({ kind: "VIOLATION", rule: "Phone away", session_id: null })),
    );
  });

  it("rates a lesson out of five and shows the result as it is built", async () => {
    const user = userEvent.setup();
    render(wrap(<TeacherPerformance />));
    await screen.findAllByTestId("performance-card");

    await user.click(within(cardOf("mona")).getByTestId("card-add-visit"));
    const dialog = within(await screen.findByTestId("performance-detail"));
    await dialog.findByTestId("visit-form");
    expect(dialog.getByTestId("visit-score")).toHaveTextContent("Not rated yet");

    await user.click(dialog.getByTestId("visit-save"));
    expect(dialog.getByText("Rate at least one item.")).toBeInTheDocument();

    await user.selectOptions(dialog.getByTestId("visit-lesson"), "l1");
    await user.click(within(dialog.getByTestId("visit-criterion-preparation")).getByRole("button", { name: "5 of 5" }));
    await user.click(within(dialog.getByTestId("visit-criterion-teaching")).getByRole("button", { name: "3 of 5" }));
    expect(dialog.getByTestId("visit-score")).toHaveTextContent("80 of 100");
    await user.type(dialog.getByTestId("visit-strengths"), "Calm and clear");
    await user.click(dialog.getByTestId("visit-save"));

    await waitFor(() =>
      expect(api.createLessonVisit).toHaveBeenCalledWith("mona", {
        session_id: "l1", visited_on: null,
        ratings: [{ criterion_id: "preparation", rating: 5 }, { criterion_id: "teaching", rating: 3 }],
        strengths: "Calm and clear", improvements: null,
      }),
    );
    await dialog.findByTestId("visit-list");
  });

  it("saves the academy's weights only when they add up to 100", async () => {
    const user = userEvent.setup();
    render(wrap(<TeacherPerformance />));
    await screen.findAllByTestId("performance-card");

    await user.click(screen.getByTestId("performance-settings-button"));
    const sheet = within(await screen.findByTestId("performance-settings"));
    expect(sheet.getByTestId("settings-sum")).toHaveTextContent("Total 100 of 100");

    await user.clear(sheet.getByTestId("settings-weight-quality"));
    await user.type(sheet.getByTestId("settings-weight-quality"), "50");
    expect(sheet.getByTestId("settings-sum")).toHaveTextContent("Total 110 of 100");
    await user.click(screen.getByTestId("settings-save"));
    expect(sheet.getByText("The four weights must add up to 100.")).toBeInTheDocument();
    expect(api.updatePerformanceSettings).not.toHaveBeenCalled();

    await user.clear(sheet.getByTestId("settings-weight-conduct"));
    await user.type(sheet.getByTestId("settings-weight-conduct"), "10");
    await user.click(screen.getByTestId("settings-save"));
    await waitFor(() =>
      expect(api.updatePerformanceSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          weights: { quality: 50, reports: 20, entry: 20, conduct: 10 },
          criteria: settings.criteria,
          rules: settings.rules,
        }),
      ),
    );
    await waitFor(() => expect(api.getTeacherPerformance).toHaveBeenCalledTimes(2));
  });

  it("only reads for someone who cannot record or change the settings", async () => {
    const user = userEvent.setup();
    const readOnly = { manage: false, settings: false };
    vi.mocked(api.getTeacherPerformance).mockResolvedValue(page(readOnly));
    vi.mocked(api.getTeacherPerformanceDetail).mockResolvedValue(detail(readOnly));
    render(wrap(<TeacherPerformance />));
    await screen.findAllByTestId("performance-card");

    expect(screen.queryByTestId("performance-settings-button")).not.toBeInTheDocument();
    expect(screen.queryByTestId("card-add-visit")).not.toBeInTheDocument();
    expect(screen.queryByTestId("card-add-note")).not.toBeInTheDocument();

    await user.click(within(cardOf("mona")).getByTestId("card-details"));
    const dialog = within(await screen.findByTestId("performance-detail"));
    await dialog.findByTestId("lesson-table");
    expect(dialog.queryByTestId("detail-add-visit")).not.toBeInTheDocument();
    expect(dialog.queryByTestId("lesson-absence-l4")).not.toBeInTheDocument();
    await user.click(dialog.getByTestId("detail-tab-notes"));
    expect(dialog.queryByTestId("note-n1-delete")).not.toBeInTheDocument();
  });
});
