import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { useState } from "react";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import enMessages from "../../../messages/en.json";
import {
  EMPTY_OVERDUE_FILTERS,
  OverdueLessonsBoard,
  type OverdueFilters,
  useOverdueLessons,
  type OverdueState,
} from "./overdue-lessons";

vi.mock("@/lib/api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/api")>()),
  getOverdueSessions: vi.fn(),
}));

import * as api from "@/lib/api";

function row(over: Partial<api.OverdueSession> & { id: string }): api.OverdueSession {
  return {
    student_id: "st1",
    teacher_id: "t1",
    // 09:00 UTC, 30 minutes — ended long before "now" in every assertion below.
    scheduled_at_utc: "2026-06-01T09:00:00Z",
    duration_minutes: 30,
    status: "SCHEDULED",
    student_name: "Abdullah",
    student_status: "REGULAR",
    teacher_name: "Ustadh",
    pending_cancel_type: null,
    pending_approval: false,
    ...over,
  };
}

function state(over: Partial<OverdueState> = {}): OverdueState {
  return {
    sessions: [row({ id: "se1" })],
    count: 1,
    truncated: false,
    graceHours: 4,
    loading: false,
    reload: vi.fn(),
    ...over,
  };
}

function Harness({
  s,
  onOpen,
  onReschedule,
  isTeacher,
}: {
  s: OverdueState;
  onOpen: (s: api.OverdueSession) => void;
  onReschedule?: (s: api.OverdueSession) => void;
  isTeacher: boolean;
}) {
  const [filters, setFilters] = useState<OverdueFilters>(EMPTY_OVERDUE_FILTERS);
  return (
    <OverdueLessonsBoard
      state={s}
      filters={filters}
      onFiltersChange={setFilters}
      onOpen={onOpen}
      onReschedule={onReschedule}
      isTeacher={isTeacher}
      canFollow={false}
      onError={vi.fn()}
    />
  );
}

function renderBoard(
  s: OverdueState,
  {
    onOpen = vi.fn<(s: api.OverdueSession) => void>(),
    onReschedule,
    isTeacher = false,
  }: {
    onOpen?: Mock<(s: api.OverdueSession) => void>;
    onReschedule?: Mock<(s: api.OverdueSession) => void>;
    isTeacher?: boolean;
  } = {},
) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <Harness s={s} onOpen={onOpen} onReschedule={onReschedule} isTeacher={isTeacher} />
    </NextIntlClientProvider>,
  );
  return onOpen;
}

/** The desktop table — the mobile cards repeat every row, so assertions look inside one list. */
function table() {
  return within(screen.getByRole("table"));
}

/** A lesson that ended `days` days ago (well past the grace window). */
function agoDays(days: number): string {
  return new Date(Date.now() - days * 86_400_000 - 3_600_000).toISOString();
}

const board = enMessages.attendance.overdueBoard;

describe("OverdueLessonsBoard (الحصص المعلقة)", () => {
  beforeEach(() => vi.clearAllMocks());

  // On its own tab the empty backlog is something the user went to look at — say it plainly.
  it("says the slate is clean when there is no backlog", () => {
    renderBoard(state({ sessions: [], count: 0 }));

    expect(screen.getByTestId("overdue-clear")).toHaveTextContent(board.emptyTitle);
    expect(screen.queryByTestId("overdue-board")).not.toBeInTheDocument();
  });

  it("shows skeleton rows, not the clean slate, while the backlog is still loading", () => {
    renderBoard(state({ sessions: [], count: 0, loading: true }));

    expect(screen.getByTestId("overdue-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("overdue-clear")).not.toBeInTheDocument();
  });

  it("lists the lessons in the backlog", () => {
    renderBoard(state({ sessions: [row({ id: "se1" }), row({ id: "se2" })], count: 2 }));

    expect(screen.getByTestId("overdue-count")).toHaveTextContent("2");
    expect(table().getAllByTestId("overdue-row")).toHaveLength(2);
  });

  // The tile is the SERVER's total, not the number of rows it could fit in one page.
  it("reports the true backlog size even when the row list was capped", () => {
    renderBoard(
      state({ sessions: [row({ id: "se1" }), row({ id: "se2" })], count: 640, truncated: true }),
    );

    expect(screen.getByTestId("segment-overdue-all")).toHaveTextContent("640");
    expect(screen.getByText(/Showing the oldest 2 of 640/)).toBeInTheDocument();
  });

  // A pending cancellation means the TEACHER already acted — chasing them would be wrong.
  it("says a lesson is waiting on the owner rather than blaming the teacher", () => {
    renderBoard(
      state({
        sessions: [row({ id: "se1", pending_approval: true }), row({ id: "se2" })],
        count: 2,
      }),
    );

    expect(table().getByText(enMessages.attendance.awaitingApproval)).toBeInTheDocument();
    // Only the row nobody has acted on carries the "already late" stamp.
    expect(table().getAllByTestId("overdue-late-by")).toHaveLength(1);
  });

  it("hands the lesson to the attendance popup when Record is pressed", async () => {
    const user = userEvent.setup();
    const onOpen = renderBoard(state());

    await user.click(table().getByTestId("overdue-record"));

    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "se1" }));
  });

  it("offers Reschedule only to a login that may move lessons", async () => {
    const user = userEvent.setup();
    const onReschedule = vi.fn<(s: api.OverdueSession) => void>();
    renderBoard(state(), { onReschedule });

    await user.click(table().getByTestId("overdue-reschedule"));
    expect(onReschedule).toHaveBeenCalledWith(expect.objectContaining({ id: "se1" }));
  });

  it("hides Reschedule from a login that may not move lessons", () => {
    renderBoard(state());

    expect(screen.queryByTestId("overdue-reschedule")).not.toBeInTheDocument();
  });

  // The tiles are the filters that produce them — the number and the list cannot disagree.
  it("narrows to the lessons waiting on an approval from the tile", async () => {
    const user = userEvent.setup();
    renderBoard(
      state({
        sessions: [
          row({ id: "se1", student_name: "Waiting", pending_approval: true }),
          row({ id: "se2", student_name: "Forgotten" }),
          row({ id: "se3", student_name: "Forgotten too" }),
        ],
        count: 3,
      }),
    );

    expect(screen.getByTestId("segment-overdue-approval")).toHaveTextContent("1");
    expect(screen.getByTestId("segment-overdue-marking")).toHaveTextContent("2");

    await user.click(screen.getByTestId("segment-overdue-approval"));
    expect(table().getAllByTestId("overdue-row")).toHaveLength(1);
    expect(table().getByText("Waiting")).toBeInTheDocument();

    // Pressed again, the tile lets go.
    await user.click(screen.getByTestId("segment-overdue-approval"));
    expect(table().getAllByTestId("overdue-row")).toHaveLength(3);
  });

  it("filters by teacher, and the tiles recount that teacher's share", async () => {
    const user = userEvent.setup();
    renderBoard(
      state({
        sessions: [
          row({ id: "se1", teacher_id: "t1", teacher_name: "Ustadh" }),
          row({ id: "se2", teacher_id: "t2", teacher_name: "Shaykh", pending_approval: true }),
          row({ id: "se3", teacher_id: "t2", teacher_name: "Shaykh" }),
        ],
        count: 3,
      }),
    );

    // The heaviest teacher first, each with how many they owe.
    const options = within(screen.getByTestId("overdue-teacher")).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["All teachers", "Shaykh (2)", "Ustadh (1)"]);

    await user.selectOptions(screen.getByTestId("overdue-teacher"), "t2");

    expect(table().getAllByTestId("overdue-row")).toHaveLength(2);
    expect(screen.getByTestId("segment-overdue-all")).toHaveTextContent("2");
    expect(screen.getByTestId("segment-overdue-approval")).toHaveTextContent("1");
  });

  it("filters by how late the lesson is", async () => {
    const user = userEvent.setup();
    renderBoard(
      state({
        sessions: [
          row({ id: "se1", student_name: "Old", scheduled_at_utc: agoDays(10) }),
          row({ id: "se2", student_name: "Recent", scheduled_at_utc: agoDays(0.5) }),
        ],
        count: 2,
      }),
    );

    expect(screen.getByTestId("segment-overdue-week")).toHaveTextContent("1");

    await user.selectOptions(screen.getByTestId("overdue-age"), "3");
    expect(table().getAllByTestId("overdue-row")).toHaveLength(1);
    expect(table().getByText("Old")).toBeInTheDocument();
  });

  it("searches by student or teacher and clears every filter at once", async () => {
    const user = userEvent.setup();
    renderBoard(
      state({
        sessions: [
          row({ id: "se1", student_name: "Abdullah" }),
          row({ id: "se2", student_name: "Maryam", student_status: "TRIAL" }),
        ],
        count: 2,
      }),
    );

    await user.type(screen.getByTestId("overdue-search"), "mary");
    expect(table().getAllByTestId("overdue-row")).toHaveLength(1);

    await user.click(screen.getByTestId("overdue-clear-filters"));
    expect(table().getAllByTestId("overdue-row")).toHaveLength(2);

    await user.click(screen.getByTestId("overdue-trials"));
    expect(table().getAllByTestId("overdue-row")).toHaveLength(1);
    expect(table().getByText("Maryam")).toBeInTheDocument();
  });

  it("says nothing matches, with a way out, when the filters empty the list", async () => {
    const user = userEvent.setup();
    renderBoard(state());

    await user.type(screen.getByTestId("overdue-search"), "nobody");

    expect(screen.getByTestId("overdue-no-match")).toHaveTextContent(board.noMatch);
  });

  // Chasing a backlog is one phone call per teacher: whoever owes the most comes first.
  it("groups by teacher, the teacher owing the most first", async () => {
    const user = userEvent.setup();
    renderBoard(
      state({
        sessions: [
          row({ id: "se1", teacher_id: "t1", teacher_name: "Ustadh" }),
          row({ id: "se2", teacher_id: "t2", teacher_name: "Shaykh" }),
          row({ id: "se3", teacher_id: "t2", teacher_name: "Shaykh" }),
        ],
        count: 3,
      }),
    );

    await user.click(screen.getByTestId("overdue-group-teacher"));

    const groups = table().getAllByTestId("overdue-group");
    expect(groups.map((g) => g.getAttribute("data-group"))).toEqual(["t2", "t1"]);
    expect(groups[0]).toHaveTextContent("Shaykh");
  });

  // A teacher's backlog is all theirs — the teacher cuts would only ever show one name.
  it("drops the teacher filter and grouping for a teacher", () => {
    renderBoard(state(), { isTeacher: true });

    expect(screen.queryByTestId("overdue-teacher")).not.toBeInTheDocument();
    expect(screen.queryByTestId("overdue-group-teacher")).not.toBeInTheDocument();
  });
});

describe("useOverdueLessons", () => {
  beforeEach(() => vi.clearAllMocks());

  function Probe() {
    const s = useOverdueLessons();
    return <span data-testid="probe">{s.loading ? "…" : `${s.count}/${s.graceHours}`}</span>;
  }

  it("carries the server's count and grace window", async () => {
    vi.mocked(api.getOverdueSessions).mockResolvedValue({
      sessions: [row({ id: "se1" })],
      count: 12,
      truncated: false,
      grace_hours: 4,
    });

    render(<Probe />);

    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("12/4"));
  });

  // The panel is an extra signal on top of the page, never the page itself.
  it("falls silent instead of surfacing an error when the backlog cannot be read", async () => {
    vi.mocked(api.getOverdueSessions).mockRejectedValue(new Error("boom"));

    render(<Probe />);

    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("0/4"));
  });
});
