import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import arMessages from "../../../messages/ar.json";
import { makeSession, withAuth } from "@/test/auth";
import type { TrialAgenda, TrialRow, TrialSummary } from "@/lib/api";
import { dayIn, weekStart, addDays } from "./trial-time";
import { TrialsManager } from "./trials-manager";

/**
 * The trials desk: the red queue of undecided trials, the day board, one-tap decisions with an
 * undo (and "convert" for a prospect who came), and "add a trial" from the page itself.
 */

const getTrialAgenda = vi.fn();
const getTrialSummary = vi.fn();
const listTrialTeachers = vi.fn();
const updateTrial = vi.fn();
const createTrial = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getTrialAgenda: (params: unknown) => getTrialAgenda(params),
  getTrialSummary: () => getTrialSummary(),
  listTrialTeachers: () => listTrialTeachers(),
  updateTrial: (id: string, patch: unknown) => updateTrial(id, patch),
  createTrial: (input: unknown) => createTrial(input),
  listTeamActors: () => Promise.resolve({ actors: [] }),
}));

const TZ = "Africa/Cairo";
const MIN = 60_000;
const ar = arMessages.trials;

function trial(id: string, startOffsetMin: number, over: Partial<TrialRow> = {}): TrialRow {
  const start = new Date(Date.now() + startOffsetMin * MIN);
  const end = new Date(start.getTime() + 30 * MIN);
  return {
    id,
    teacher_id: "t1",
    teacher_name: "Mona",
    student_id: null,
    student_name: null,
    lead_id: null,
    crm_lead_name: null,
    crm_source: null,
    from_crm: false,
    lead_name: `Lead ${id}`,
    lead_whatsapp: "+201012345678",
    lead_email: null,
    display_name: `Lead ${id}`,
    is_lead: true,
    timezone: TZ,
    scheduled_at_utc: start.toISOString(),
    ends_at_utc: end.toISOString(),
    duration_minutes: 30,
    status: "SCHEDULED",
    outcome_notes: null,
    converted_student_id: null,
    created_at: start.toISOString(),
    needs_decision: end.getTime() <= Date.now(),
    contact_whatsapp: "+201012345678",
    ...over,
  };
}

const summary: TrialSummary = {
  total: 3,
  scheduled: 3,
  upcoming: 1,
  today: 3,
  awaiting_outcome: 2,
  needs_decision: 1,
  completed: 0,
  no_show: 0,
  cancelled: 0,
  converted: 0,
  from_crm: 0,
  conversion_rate: 0,
};

function agenda(trials: TrialRow[], overdue: TrialRow[]): TrialAgenda {
  const today = dayIn(new Date(), TZ);
  const from = weekStart(today);
  return {
    timezone: TZ,
    today,
    date: today,
    trials,
    days: Array.from({ length: 7 }, (_, i) => ({
      date: addDays(from, i),
      total: addDays(from, i) === today ? trials.length : 0,
      needs_decision: addDays(from, i) === today ? overdue.length : 0,
    })),
    needs_decision: overdue,
    needs_decision_count: overdue.length,
  };
}

function renderDesk() {
  const session = makeSession("ACADEMY_OWNER", { permissions: ["trial.read", "trial.manage"] });
  return render(withAuth(session, <TrialsManager />));
}

describe("TrialsManager — the trials desk", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTrialSummary.mockResolvedValue(summary);
    listTrialTeachers.mockResolvedValue({
      teachers: [{ id: "t1", full_name: "Mona", specialization: null }],
      durations: [15, 30, 45, 60],
      timezone: TZ,
    });
    updateTrial.mockResolvedValue({ ok: true, changed: ["status"], warnings: [] });
    createTrial.mockResolvedValue({ trialId: "new", warnings: [] });
  });

  it("puts undecided trials in a red panel and gives only started trials the decision buttons", async () => {
    const overdue = trial("late", -120);
    const live = trial("live", -10);
    const upcoming = trial("soon", 120);
    getTrialAgenda.mockResolvedValue(agenda([overdue, live, upcoming], [overdue]));

    renderDesk();

    const panel = await screen.findByTestId("trials-needs-decision");
    expect(within(panel).getByTestId("trials-needs-decision-count")).toHaveTextContent("1");
    expect(within(panel).getByText("Lead late")).toBeInTheDocument();

    const day = screen.getByTestId("trials-day-list");
    const cards = within(day).getAllByTestId("trial-card");
    expect(cards.map((c) => c.getAttribute("data-phase"))).toEqual(["overdue", "live", "upcoming"]);
    // Nobody can know how a future trial went — no decision buttons on it yet.
    expect(within(cards[0]!).getByTestId("trial-attended")).toBeInTheDocument();
    expect(within(cards[1]!).getByTestId("trial-attended")).toBeInTheDocument();
    expect(within(cards[2]!).queryByTestId("trial-attended")).not.toBeInTheDocument();

    // The week strip flags today as holding an undecided trial.
    expect(screen.getByTestId("trials-day-red-dot")).toBeInTheDocument();
  });

  it("records a decision in one tap, then offers convert and undo", async () => {
    const overdue = trial("late", -120);
    getTrialAgenda.mockResolvedValue(agenda([overdue], [overdue]));
    const user = userEvent.setup();

    renderDesk();

    const panel = await screen.findByTestId("trials-needs-decision");
    await user.click(within(panel).getByTestId("trial-attended"));

    expect(updateTrial).toHaveBeenCalledWith("late", { status: "COMPLETED" });
    const strip = await screen.findByTestId("trials-decision-strip");
    expect(within(strip).getByTestId("trials-strip-convert")).toBeInTheDocument();

    await user.click(within(strip).getByTestId("trials-strip-undo"));
    expect(updateTrial).toHaveBeenLastCalledWith("late", { status: "SCHEDULED" });
  });

  it("shows no red panel when every trial has its decision", async () => {
    getTrialAgenda.mockResolvedValue(agenda([trial("done", -120, { status: "COMPLETED" })], []));

    renderDesk();

    expect(await screen.findByTestId("trials-day-list")).toBeInTheDocument();
    expect(screen.queryByTestId("trials-needs-decision")).not.toBeInTheDocument();
    // The hero pill reads the same queue as the panel, so the two can never disagree.
    expect(screen.queryByTestId("trials-hero-needs-decision")).not.toBeInTheDocument();
  });

  it("adds a trial for a new person straight from the page", async () => {
    getTrialAgenda.mockResolvedValue(agenda([], []));
    const user = userEvent.setup();

    renderDesk();

    await user.click(await screen.findByTestId("trials-add"));
    const form = await screen.findByTestId("add-trial-form");
    await user.type(within(form).getByTestId("add-trial-name"), "Sara Ahmed");
    // A local number typed with its trunk zero must not keep it after the +20.
    await user.type(within(form).getByTestId("add-trial-phone"), "01012345678");
    // One teacher on the roster is picked for you.
    await waitFor(() => expect(listTrialTeachers).toHaveBeenCalled());
    await user.click(within(form).getByTestId("add-trial-submit"));

    await waitFor(() => expect(createTrial).toHaveBeenCalled());
    expect(createTrial).toHaveBeenCalledWith(
      expect.objectContaining({
        teacher_id: "t1",
        lead_name: "Sara Ahmed",
        lead_whatsapp: "+201012345678",
        local_datetime: `${dayIn(new Date(), TZ)} 17:00`,
        timezone: TZ,
        duration_minutes: 30,
      }),
    );
    expect(await screen.findByText(ar.alerts.booked)).toBeInTheDocument();
  });
});
