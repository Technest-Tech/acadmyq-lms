import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enMessages from "../../../messages/en.json";
import {
  OverdueLessonsPanel,
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

function renderPanel(s: OverdueState, onOpen = vi.fn(), isTeacher = false) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <OverdueLessonsPanel state={s} onOpen={onOpen} isTeacher={isTeacher} />
    </NextIntlClientProvider>,
  );
  return onOpen;
}

describe("OverdueLessonsPanel (الحصص المعلقة)", () => {
  beforeEach(() => vi.clearAllMocks());

  // An admin with a clean slate must not be shown a box every day just to say "nothing wrong".
  it("renders nothing when there is no backlog", () => {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <OverdueLessonsPanel
          state={state({ sessions: [], count: 0 })}
          onOpen={vi.fn()}
          isTeacher={false}
        />
      </NextIntlClientProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing while the backlog is still loading", () => {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <OverdueLessonsPanel state={state({ loading: true })} onOpen={vi.fn()} isTeacher={false} />
      </NextIntlClientProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the backlog size and the lessons in it", () => {
    renderPanel(state({ sessions: [row({ id: "se1" }), row({ id: "se2" })], count: 2 }));

    expect(screen.getByTestId("overdue-count")).toHaveTextContent("2");
    expect(screen.getAllByTestId("overdue-row")).toHaveLength(2);
  });

  // The count is the SERVER's total, not the number of rows it could fit in one page.
  it("reports the true backlog size even when the row list was capped", () => {
    renderPanel(
      state({ sessions: [row({ id: "se1" }), row({ id: "se2" })], count: 640, truncated: true }),
    );

    expect(screen.getByTestId("overdue-count")).toHaveTextContent("640");
    expect(screen.getByText(/Showing the oldest 2 of 640/)).toBeInTheDocument();
  });

  // A pending cancellation means the TEACHER already acted — chasing them would be wrong.
  it("says a lesson is waiting on the owner rather than blaming the teacher", () => {
    renderPanel(
      state({
        sessions: [row({ id: "se1", pending_approval: true }), row({ id: "se2" })],
        count: 2,
      }),
    );

    expect(screen.getByText(enMessages.attendance.awaitingApproval)).toBeInTheDocument();
    // Only the row nobody has acted on carries the "already late" stamp.
    expect(screen.getAllByTestId("overdue-late-by")).toHaveLength(1);
  });

  it("hands the lesson to the attendance popup when Record is pressed", async () => {
    const user = userEvent.setup();
    const onOpen = renderPanel(state());

    await user.click(screen.getByTestId("overdue-record"));

    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "se1" }));
  });

  it("collapses a long backlog and expands it on request", async () => {
    const user = userEvent.setup();
    const sessions = Array.from({ length: 8 }, (_, i) => row({ id: `se${i}` }));
    renderPanel(state({ sessions, count: 8 }));

    expect(screen.getAllByTestId("overdue-row")).toHaveLength(5);

    await user.click(screen.getByTestId("overdue-toggle"));
    expect(screen.getAllByTestId("overdue-row")).toHaveLength(8);

    await user.click(screen.getByTestId("overdue-toggle"));
    expect(screen.getAllByTestId("overdue-row")).toHaveLength(5);
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
