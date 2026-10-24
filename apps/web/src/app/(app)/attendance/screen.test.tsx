import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import arMessages from "../../../../messages/ar.json";
import { makeSession, withAuth } from "@/test/auth";
import { AttendanceScreen } from "./screen";

/**
 * The Attendance route with group classes: the desk marks private lessons and group lessons from
 * one page, as two tabs. An academy without `groups` sees the private page alone, exactly as before.
 */
vi.mock("@/components/attendance/attendance-manager", () => ({
  AttendanceManager: ({ header }: { header?: React.ReactNode }) => (
    <div data-testid="attendance-manager">
      {header}
      <p>private lessons</p>
    </div>
  ),
}));
vi.mock("@/components/groups/board/lessons-board", () => ({
  LessonsBoard: () => <div data-testid="lessons-board">group lessons</div>,
}));

const ar = arMessages.attendance;

describe("AttendanceScreen", () => {
  it("shows the private page alone to an academy without group classes", () => {
    render(withAuth(makeSession("ACADEMY_OWNER", { permissions: ["session.read", "group.read"], capabilities: ["invoicing"] }), <AttendanceScreen />));
    expect(screen.getByTestId("attendance-manager")).toBeTruthy();
    expect(screen.queryByTestId("attendance-tab-groups")).toBeNull();
  });

  it("adds a group lessons tab for a client with group classes, and switches to the groups' own board", async () => {
    render(withAuth(makeSession("ACADEMY_OWNER", { permissions: ["session.read", "group.read"], capabilities: ["invoicing", "groups"] }), <AttendanceScreen />));
    expect(screen.getByTestId("attendance-manager")).toBeTruthy();
    expect(screen.getByTestId("attendance-tab-groups").textContent).toContain(ar.tabs.groups);

    await userEvent.click(screen.getByTestId("attendance-tab-groups"));
    expect(screen.getByTestId("lessons-board")).toBeTruthy();
    expect(screen.queryByTestId("attendance-manager")).toBeNull();

    await userEvent.click(screen.getByTestId("attendance-tab-private"));
    expect(screen.getByTestId("attendance-manager")).toBeTruthy();
  });

  it("offers no group tab to someone who cannot read groups", () => {
    render(withAuth(makeSession("SUPERVISOR", { permissions: ["session.read"], capabilities: ["invoicing", "groups"] }), <AttendanceScreen />));
    expect(screen.queryByTestId("attendance-tab-groups")).toBeNull();
  });
});
