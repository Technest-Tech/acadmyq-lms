import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import arMessages from "../../../messages/ar.json";
import { makeSession, withAuth } from "@/test/auth";
import type { TrialAgenda, TrialRow, TrialSummary } from "@/lib/api";
import { formatNumber } from "@/lib/money";
import { dayIn } from "./trial-time";
import { TrialsManager } from "./trials-manager";

/**
 * The trials desk: four stat cards that are also the views (today · needs a decision · upcoming ·
 * all), one compact table, one-tap decisions with an undo (and "convert" for a prospect who came),
 * and "add a trial" from the page itself.
 */

const getTrialAgenda = vi.fn();
const getTrialSummary = vi.fn();
const listTrials = vi.fn();
const listTrialTeachers = vi.fn();
const updateTrial = vi.fn();
const createTrial = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getTrialAgenda: (params: unknown) => getTrialAgenda(params),
  getTrialSummary: () => getTrialSummary(),
  listTrials: (q: unknown) => listTrials(q),
  listTrialTeachers: () => listTrialTeachers(),
  updateTrial: (id: string, patch: unknown) => updateTrial(id, patch),
  createTrial: (input: unknown) => createTrial(input),
  listTeamActors: () => Promise.resolve({ actors: [] }),
}));

const TZ = "Africa/Cairo";
const MIN = 60_000;
const ar = arMessages.trials;
const n = (value: number) => formatNumber(value, "ar");

function trial(
  id: string,
  startOffsetMin: number,
  over: Partial<TrialRow> = {},
): TrialRow {
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
  total: 12,
  scheduled: 3,
  upcoming: 4,
  today: 3,
  awaiting_outcome: 2,
  needs_decision: 1,
  completed: 0,
  no_show: 0,
  cancelled: 0,
  converted: 0,
  from_crm: 0,
  conversion_rate: 25,
};

function agenda(trials: TrialRow[], overdue: TrialRow[]): TrialAgenda {
  const today = dayIn(new Date(), TZ);
  return {
    timezone: TZ,
    today,
    date: today,
    trials,
    days: [
      { date: today, total: trials.length, needs_decision: overdue.length },
    ],
    needs_decision: overdue,
    needs_decision_count: overdue.length,
  };
}

function renderDesk() {
  const session = makeSession("ACADEMY_OWNER", {
    permissions: ["trial.read", "trial.manage"],
  });
  return render(withAuth(session, <TrialsManager />));
}

describe("TrialsManager — the trials desk", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTrialSummary.mockResolvedValue(summary);
    listTrials.mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 25 });
    listTrialTeachers.mockResolvedValue({
      teachers: [{ id: "t1", full_name: "Mona", specialization: null }],
      durations: [15, 30, 45, 60],
      timezone: TZ,
    });
    updateTrial.mockResolvedValue({
      ok: true,
      changed: ["status"],
      warnings: [],
    });
    createTrial.mockResolvedValue({ trialId: "new", warnings: [] });
  });

  it("opens on today's trials and gives only started trials the decision buttons", async () => {
    const overdue = trial("late", -120);
    const live = trial("live", -10);
    const upcoming = trial("soon", 120);
    const cancelled = trial("off", 60, { status: "CANCELLED" });
    getTrialAgenda.mockResolvedValue(
      agenda([overdue, live, cancelled, upcoming], [overdue]),
    );

    renderDesk();

    const table = await screen.findByTestId("trials-table");
    const rows = within(table).getAllByTestId("trial-row");
    // A cancelled trial is off today's list; the rest keep the day's order.
    expect(rows.map((r) => r.getAttribute("data-phase"))).toEqual([
      "overdue",
      "live",
      "upcoming",
    ]);
    // Nobody can know how a future trial went — no decision buttons on it yet.
    expect(within(rows[0]!).getByTestId("trial-attended")).toBeInTheDocument();
    expect(within(rows[1]!).getByTestId("trial-attended")).toBeInTheDocument();
    expect(
      within(rows[2]!).queryByTestId("trial-attended"),
    ).not.toBeInTheDocument();
    // Today's list is one day — no day header rows.
    expect(
      within(table).queryByTestId("trials-day-row"),
    ).not.toBeInTheDocument();

    // The cards count what their views list.
    expect(screen.getByTestId("trials-view-today")).toHaveTextContent(n(3));
    expect(screen.getByTestId("trials-view-needs")).toHaveTextContent(n(1));
    expect(screen.getByTestId("trials-view-upcoming")).toHaveTextContent(n(4));
    expect(screen.getByTestId("trials-view-all")).toHaveTextContent(n(12));
    expect(screen.getByTestId("trials-view-today")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("lists every undecided trial, any day, under a row per day when its card is pressed", async () => {
    const lastWeek = trial("old", -7 * 24 * 60);
    const earlier = trial("late", -120);
    getTrialAgenda.mockResolvedValue(agenda([earlier], [lastWeek, earlier]));
    const user = userEvent.setup();

    renderDesk();

    await user.click(await screen.findByTestId("trials-view-needs"));
    const list = screen.getByTestId("trials-list-needs");
    const table = within(list).getByTestId("trials-table");
    expect(within(table).getAllByTestId("trial-row")).toHaveLength(2);
    expect(
      within(table).getAllByTestId("trials-day-row").length,
    ).toBeGreaterThanOrEqual(2);
    expect(within(table).getByText("Lead old")).toBeInTheDocument();

    // Pressing the open card again goes home, to today.
    await user.click(screen.getByTestId("trials-view-needs"));
    expect(screen.getByTestId("trials-list-today")).toBeInTheDocument();
  });

  it("records a decision in one tap, then offers convert and undo", async () => {
    const overdue = trial("late", -120);
    getTrialAgenda.mockResolvedValue(agenda([overdue], [overdue]));
    const user = userEvent.setup();

    renderDesk();

    const table = await screen.findByTestId("trials-table");
    await user.click(within(table).getByTestId("trial-attended"));

    expect(updateTrial).toHaveBeenCalledWith("late", { status: "COMPLETED" });
    const strip = await screen.findByTestId("trials-decision-strip");
    expect(
      within(strip).getByTestId("trials-strip-convert"),
    ).toBeInTheDocument();

    await user.click(within(strip).getByTestId("trials-strip-undo"));
    expect(updateTrial).toHaveBeenLastCalledWith("late", {
      status: "SCHEDULED",
    });
  });

  it("narrows today's list as you type a name or a number", async () => {
    getTrialAgenda.mockResolvedValue(
      agenda(
        [
          trial("a", 60, { display_name: "Sara Ali" }),
          trial("b", 90, {
            display_name: "Omar",
            contact_whatsapp: "+966500000001",
          }),
        ],
        [],
      ),
    );
    const user = userEvent.setup();

    renderDesk();

    const table = await screen.findByTestId("trials-table");
    expect(within(table).getAllByTestId("trial-row")).toHaveLength(2);

    await user.type(screen.getByTestId("trials-search"), "9665");
    expect(within(table).getAllByTestId("trial-row")).toHaveLength(1);
    expect(within(table).getByText("Omar")).toBeInTheDocument();

    await user.clear(screen.getByTestId("trials-search"));
    await user.type(screen.getByTestId("trials-search"), "nobody");
    expect(await screen.findByText(ar.list.filteredEmpty)).toBeInTheDocument();
  });

  it("reads upcoming soonest first and the record newest first, paged and filtered on the server", async () => {
    getTrialAgenda.mockResolvedValue(agenda([], []));
    const tomorrow = trial("next", 24 * 60);
    listTrials.mockResolvedValue({
      rows: [tomorrow],
      total: 1,
      page: 1,
      pageSize: 100,
    });
    const user = userEvent.setup();

    renderDesk();

    await user.click(await screen.findByTestId("trials-view-upcoming"));
    await waitFor(() =>
      expect(listTrials).toHaveBeenLastCalledWith(
        expect.objectContaining({
          sort: "scheduled",
          filter: { upcoming: "1" },
        }),
      ),
    );
    const table = await within(
      screen.getByTestId("trials-list-upcoming"),
    ).findByTestId("trials-table");
    expect(within(table).getByTestId("trials-day-row")).toHaveTextContent(
      ar.list.tomorrow,
    );

    await user.click(screen.getByTestId("trials-view-all"));
    await waitFor(() =>
      expect(listTrials).toHaveBeenLastCalledWith(
        expect.objectContaining({ sort: "-scheduled", page: 1, pageSize: 25 }),
      ),
    );
    await user.selectOptions(
      screen.getByTestId("trials-status-filter"),
      "NO_SHOW",
    );
    await waitFor(() =>
      expect(listTrials).toHaveBeenLastCalledWith(
        expect.objectContaining({ filter: { status: "NO_SHOW" } }),
      ),
    );
  });

  it("shows a calm card and an empty list when nothing waits for a decision", async () => {
    getTrialAgenda.mockResolvedValue(
      agenda([trial("done", -120, { status: "COMPLETED" })], []),
    );
    const user = userEvent.setup();

    renderDesk();

    const table = await screen.findByTestId("trials-table");
    // An attended prospect's next step is a button on the row.
    expect(within(table).getByTestId("trial-convert")).toBeInTheDocument();
    expect(screen.getByTestId("trials-view-needs")).toHaveTextContent(n(0));

    await user.click(screen.getByTestId("trials-view-needs"));
    expect(await screen.findByText(ar.list.emptyNeeds)).toBeInTheDocument();
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

  it("books a trial of whatever length the academy types, and refuses a box with no length", async () => {
    getTrialAgenda.mockResolvedValue(agenda([], []));
    const user = userEvent.setup();

    renderDesk();

    await user.click(await screen.findByTestId("trials-add"));
    const form = await screen.findByTestId("add-trial-form");
    await user.type(within(form).getByTestId("add-trial-name"), "Sara Ahmed");
    await user.type(within(form).getByTestId("add-trial-phone"), "01012345678");
    await waitFor(() => expect(listTrialTeachers).toHaveBeenCalled());

    await user.click(within(form).getByTestId("add-trial-duration-custom"));
    await user.click(within(form).getByTestId("add-trial-submit"));
    expect(
      await within(form).findByText(ar.add.durationRequired),
    ).toBeInTheDocument();
    expect(createTrial).not.toHaveBeenCalled();

    await user.type(
      within(form).getByTestId("add-trial-duration-minutes"),
      "20",
    );
    await user.click(within(form).getByTestId("add-trial-submit"));
    await waitFor(() =>
      expect(createTrial).toHaveBeenCalledWith(
        expect.objectContaining({ duration_minutes: 20 }),
      ),
    );
  });
});
