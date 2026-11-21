import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import type { CalendarSession } from "@/lib/api";
import enMessages from "../../../../messages/en.json";
import { TimeGridView } from "./time-grid-view";

// A zone that never changes its clocks, so the hour below holds in every season.
const TZ = "Asia/Riyadh";
const today = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());

const lesson = {
  id: "se1",
  student_id: "s1",
  teacher_id: "t1",
  schedule_id: "sch1",
  scheduled_at_utc: `${today}T14:00:00Z`, // 17:00 Riyadh
  duration_minutes: 30,
  status: "SCHEDULED",
  status_reason: null,
  original_session_id: null,
  student_name: "Yusuf",
  teacher_name: "Teacher One",
} as CalendarSession;

function renderGrid() {
  const onReschedule = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <TimeGridView
        days={[today]}
        sessions={[lesson]}
        tz={TZ}
        today={today}
        onSelect={() => {}}
        onReschedule={onReschedule}
        canDrag
      />
    </NextIntlClientProvider>,
  );
  return { onReschedule, block: screen.getByTestId("session-se1") };
}

/** Press on the block, travel well past the drag threshold, and end the gesture. */
function gesture(block: HTMLElement, pointerType: string, end: "pointerUp" | "pointerCancel") {
  fireEvent.pointerDown(block, { pointerType, button: 0, clientX: 0, clientY: 0 });
  fireEvent.pointerMove(window, { pointerType, clientX: 0, clientY: 200 });
  fireEvent[end](window, { pointerType, clientX: 0, clientY: 200 });
}

/**
 * Drag-to-reschedule saves on release with no confirmation, so it must only ever start from a
 * mouse. Ana Muslim, 20 Nov 2026: a supervisor scrolling the calendar on an Android phone moved
 * ten lessons in 76 seconds, some onto another day and one into the past.
 */
describe("time grid drag-to-reschedule", () => {
  it("a mouse drag still moves the lesson", () => {
    const { onReschedule, block } = renderGrid();
    gesture(block, "mouse", "pointerUp");
    expect(onReschedule).toHaveBeenCalledTimes(1);
    expect(onReschedule.mock.calls[0]![0].id).toBe("se1");
  });

  it("a finger swiping across a lesson moves nothing", () => {
    const { onReschedule, block } = renderGrid();
    gesture(block, "touch", "pointerUp");
    gesture(block, "pen", "pointerUp");
    expect(onReschedule).not.toHaveBeenCalled();
  });

  it("a finger on a lesson can still scroll the calendar", () => {
    const { block } = renderGrid();
    expect(block.className).not.toContain("touch-none");
  });

  it("a cancelled gesture is not a drop", () => {
    const { onReschedule, block } = renderGrid();
    gesture(block, "mouse", "pointerCancel");
    expect(onReschedule).not.toHaveBeenCalled();
  });
});
