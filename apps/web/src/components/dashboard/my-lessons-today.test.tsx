import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import enMessages from "../../../messages/en.json";
import { MyLessonsToday } from "./my-lessons-today";

// The teacher's "Today's lessons" card: one row per lesson, the Enter button live only on the
// lesson that is on now.

vi.mock("@/lib/api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/api")>()),
  getSessionsByDay: vi.fn(),
  enterSession: vi.fn(),
}));

import * as api from "@/lib/api";

const row = (id: string, at: string, extra: Partial<api.DaySession> = {}): api.DaySession => ({
  id,
  student_id: `st-${id}`,
  teacher_id: "t1",
  scheduled_at_utc: at,
  duration_minutes: 30,
  status: "SCHEDULED",
  student_name: `Student ${id}`,
  teacher_name: "Mona Teacher",
  student_status: "ACTIVE",
  pending_cancel_type: null,
  meeting_url: "https://zoom.us/j/111",
  teacher_joined_at: null,
  ...extra,
});

const wrap = (node: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={enMessages}>{node}</NextIntlClientProvider>
);

describe("MyLessonsToday", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-09-26T13:05:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("lights up Enter only on the lesson that is on now", async () => {
    vi.mocked(api.getSessionsByDay).mockResolvedValue({
      sessions: [
        row("past", "2026-09-26T10:00:00Z", { status: "ATTENDED", teacher_joined_at: "2026-09-26T10:02:00Z" }),
        row("now", "2026-09-26T13:00:00Z"),
        row("later", "2026-09-26T16:00:00Z"),
      ],
    });
    render(wrap(<MyLessonsToday />));

    const rows = await screen.findAllByTestId("my-lesson");
    const byId = (state: string) => rows.find((r) => r.dataset.state === state)!;

    expect(within(byId("open")).getByTestId("row-enter")).toHaveAttribute("href", "https://zoom.us/j/111");
    expect(within(byId("early")).getByTestId("row-enter-early")).toBeDisabled();
    expect(within(byId("ended")).queryByTestId("row-enter")).not.toBeInTheDocument();
    expect(byId("ended")).toHaveTextContent(/Entered at/);
  });

  it("tells a teacher with no link to ask for one", async () => {
    vi.mocked(api.getSessionsByDay).mockResolvedValue({
      sessions: [row("now", "2026-09-26T13:00:00Z", { meeting_url: null })],
    });
    render(wrap(<MyLessonsToday />));

    expect(await screen.findByTestId("my-lessons-no-link")).toBeInTheDocument();
    expect(screen.getByTestId("row-enter-no-link")).toBeDisabled();
  });

  it("renders nothing on a day without lessons", async () => {
    vi.mocked(api.getSessionsByDay).mockResolvedValue({ sessions: [] });
    const { container } = render(wrap(<MyLessonsToday />));

    await vi.waitFor(() => expect(api.getSessionsByDay).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
