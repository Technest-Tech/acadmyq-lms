import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enMessages from "../../../messages/en.json";
import { EnterLessonButton, enterState } from "./enter-lesson-button";

// The teacher's Enter button: grey until ten minutes before the lesson, a real link to their room
// while it is on, gone once it has ended — and every press is reported to the API.

vi.mock("@/lib/api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/api")>()),
  enterSession: vi.fn(),
}));

import * as api from "@/lib/api";

const START = Date.parse("2026-09-26T13:00:00Z");
const MIN = 60_000;
const lesson = {
  id: "s1",
  scheduled_at_utc: "2026-09-26T13:00:00Z",
  duration_minutes: 30,
  status: "SCHEDULED" as const,
};

const wrap = (node: React.ReactNode) => (
  <NextIntlClientProvider locale="en" messages={enMessages}>{node}</NextIntlClientProvider>
);

describe("enterState", () => {
  it("opens ten minutes before the start and shuts at the end", () => {
    expect(enterState(lesson, START - 11 * MIN)).toBe("early");
    expect(enterState(lesson, START - 10 * MIN)).toBe("open");
    expect(enterState(lesson, START + 30 * MIN)).toBe("open");
    expect(enterState(lesson, START + 31 * MIN)).toBe("ended");
  });

  it("never opens a cancelled or moved lesson", () => {
    expect(enterState({ ...lesson, status: "CANCELLED_BY_STUDENT" }, START)).toBe("closed");
    expect(enterState({ ...lesson, status: "RESCHEDULED" }, START)).toBe("closed");
    // An outcome recorded early does not lock the teacher out of the room.
    expect(enterState({ ...lesson, status: "ATTENDED" }, START)).toBe("open");
  });
});

describe("EnterLessonButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.enterSession).mockResolvedValue({
      url: "https://zoom.us/j/111",
      joined_at: "2026-09-26T13:02:00+00:00",
      first_joined_at: "2026-09-26T13:02:00+00:00",
    });
  });

  it("is greyed out, saying when it opens, before the window", () => {
    render(wrap(<EnterLessonButton lesson={lesson} meetingUrl="https://zoom.us/j/111" now={START - 60 * MIN} />));

    const button = screen.getByTestId("row-enter-early");
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent(/Opens/);
    expect(screen.queryByTestId("row-enter")).not.toBeInTheDocument();
  });

  it("is a link to the teacher's room while the lesson is on, and reports the press", async () => {
    const onEntered = vi.fn();
    render(
      wrap(
        <EnterLessonButton
          lesson={lesson}
          meetingUrl="https://zoom.us/j/111"
          now={START + 2 * MIN}
          onEntered={onEntered}
        />,
      ),
    );

    const link = screen.getByTestId("row-enter");
    expect(link).toHaveAttribute("href", "https://zoom.us/j/111");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));

    fireEvent.click(link);
    expect(api.enterSession).toHaveBeenCalledWith("s1");
    await waitFor(() => expect(onEntered).toHaveBeenCalledWith("2026-09-26T13:02:00+00:00"));
  });

  it("still opens the room when recording the press fails", async () => {
    vi.mocked(api.enterSession).mockRejectedValue(new Error("offline"));
    const onEntered = vi.fn();
    render(wrap(<EnterLessonButton lesson={lesson} meetingUrl="https://zoom.us/j/111" now={START} onEntered={onEntered} />));

    fireEvent.click(screen.getByTestId("row-enter"));
    await waitFor(() => expect(api.enterSession).toHaveBeenCalled());
    expect(onEntered).not.toHaveBeenCalled();
  });

  it("stays grey without a meeting link, and is gone once the lesson has ended", () => {
    const { rerender } = render(wrap(<EnterLessonButton lesson={lesson} meetingUrl={null} now={START} />));
    expect(screen.getByTestId("row-enter-no-link")).toBeDisabled();

    rerender(wrap(<EnterLessonButton lesson={lesson} meetingUrl="https://zoom.us/j/111" now={START + 45 * MIN} />));
    expect(screen.queryByTestId("row-enter")).not.toBeInTheDocument();
    expect(screen.queryByTestId("row-enter-early")).not.toBeInTheDocument();
  });
});

describe("EnterLessonButton horizon", () => {
  it("stays quiet for a lesson opening beyond the horizon", () => {
    render(
      wrap(
        <EnterLessonButton
          lesson={lesson}
          meetingUrl="https://zoom.us/j/111"
          now={START - 5 * 60 * MIN}
          earlyHorizonMinutes={180}
        />,
      ),
    );
    expect(screen.queryByTestId("row-enter-early")).not.toBeInTheDocument();
  });
});
