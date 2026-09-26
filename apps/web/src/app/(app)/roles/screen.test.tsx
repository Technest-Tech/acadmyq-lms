import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeSession, withAuth } from "@/test/auth";
import arMessages from "../../../../messages/ar.json";
import { AcademyRolesScreen } from "./screen";

vi.mock("@/lib/api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/api")>()),
  listAcademyRoles: vi.fn(),
}));

import * as api from "@/lib/api";

// Every code the role builder can offer — including the module ones (LMS, video, supervision)
// that used to render as raw codes like `room.monitor`.
const GRANTABLE = [
  "student.read",
  "session.mark_attendance",
  "session.revert_attendance",
  "session.follow",
  "supervision.stats",
  "course.read",
  "course.manage",
  "access_code.manage",
  "learner.read",
  "course_order.read",
  "payment_method.manage",
  "room.read",
  "room.monitor",
  "recording.view",
];

describe("AcademyRolesScreen — capability picker", () => {
  beforeEach(() => {
    vi.mocked(api.listAcademyRoles).mockResolvedValue({
      system: [],
      custom: [],
      grantable: GRANTABLE,
      financial: [],
      presets: [],
    });
  });

  it("labels every capability in Arabic — never a raw code", async () => {
    render(withAuth(makeSession("ACADEMY_OWNER", { permissions: ["role.manage"] }), <AcademyRolesScreen />));
    await userEvent.setup().click(await screen.findByTestId("new-role"));

    for (const code of GRANTABLE) {
      const row = screen.getByTestId(`perm-${code}`).closest("label")!;
      expect(row.textContent).not.toContain(code);
    }
    expect(screen.getByText(arMessages.permissions.items.room_monitor.label)).toBeInTheDocument();
  });

  // The LMS is one module to an academy, not five one-line sections; a recording belongs with
  // its classroom; the Following button is supervision.
  it("files module capabilities under one group each", async () => {
    render(withAuth(makeSession("ACADEMY_OWNER", { permissions: ["role.manage"] }), <AcademyRolesScreen />));
    await userEvent.setup().click(await screen.findByTestId("new-role"));

    const group = (domain: string) =>
      screen.getByTestId(`group-toggle-${domain}`).closest("div.overflow-hidden") as HTMLElement;

    const lms = within(group("course"));
    for (const code of ["course.read", "access_code.manage", "learner.read", "course_order.read", "payment_method.manage"]) {
      expect(lms.getByTestId(`perm-${code}`)).toBeInTheDocument();
    }
    expect(within(group("room")).getByTestId("perm-recording.view")).toBeInTheDocument();
    expect(within(group("supervision")).getByTestId("perm-session.follow")).toBeInTheDocument();

    for (const gone of ["access_code", "learner", "course_order", "payment_method", "recording"]) {
      expect(screen.queryByTestId(`group-toggle-${gone}`)).not.toBeInTheDocument();
    }
  });
});
