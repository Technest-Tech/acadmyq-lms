import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeSession, withAuth } from "@/test/auth";
import arMessages from "../../../messages/ar.json";
import { TeacherDetail } from "./teacher-detail";

/** The levels a teacher takes (EnglishSpirit, 2026-11-11), on the teacher's profile. */
vi.mock("@/lib/api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/api")>()),
  getTeacher: vi.fn(),
  updateTeacher: vi.fn(),
  listSpecializations: vi.fn().mockResolvedValue({ specializations: [] }),
}));
vi.mock("@/lib/levels-api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/levels-api")>()),
  listLevels: vi.fn(),
}));

import * as api from "@/lib/api";
import * as levelsApi from "@/lib/levels-api";

const level = (id: string, name: string, sort_order: number, is_active = true) => ({
  id, name, sort_order, is_active, students_count: 0, groups_count: 0,
});

const session = (levelsEnabled: boolean) =>
  makeSession("ACADEMY_OWNER", {
    academy: { name: "EnglishSpirit", displayName: "EnglishSpirit", logoUrl: null, country: "EG", defaultCurrency: "EGP", levelsEnabled },
  });

function teacher(levels: { id: string; name: string; is_active: boolean }[]) {
  return {
    teacher: {
      id: "t1", user_id: null, full_name: "Miss Mona", phone: null, specialization: "English",
      session_rate_minor: 8000, pay_type: "HOURLY" as const, fixed_salary_minor: 0, currency: "EGP", timezone: null,
      payout_method: null, payout_handle: null, availability: [], is_active: true, deleted_at: null, created_at: "",
      levels,
    },
    students: [],
    student_rates: [],
    login: { has_login: false, email: null, is_active: null },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.updateTeacher).mockResolvedValue({ ok: true, changed: [] });
  vi.mocked(levelsApi.listLevels).mockResolvedValue({
    levels: [level("a1", "A1", 1), level("a2", "A2", 2), level("old", "Old", 3, false)],
    level_label: "LEVEL",
  } as Awaited<ReturnType<typeof levelsApi.listLevels>>);
});

describe("teacher levels", () => {
  it("adds a level to the ones the teacher takes and saves the whole set", async () => {
    vi.mocked(api.getTeacher).mockResolvedValue(teacher([{ id: "a1", name: "A1", is_active: true }]));
    render(withAuth(session(true), <TeacherDetail teacherId="t1" onBack={vi.fn()} />));

    const a2 = await screen.findByTestId("level-multi-a2");
    expect(screen.getByTestId("level-multi-a1")).toHaveAttribute("aria-pressed", "true");
    // A level switched off in Settings is offered no more.
    expect(screen.queryByTestId("level-multi-old")).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(a2);
    await user.click(screen.getByTestId("save-teacher"));

    await waitFor(() =>
      expect(api.updateTeacher).toHaveBeenCalledWith("t1", expect.objectContaining({ level_ids: ["a1", "a2"] })),
    );
  });

  it("keeps a switched-off level the teacher already takes", async () => {
    vi.mocked(api.getTeacher).mockResolvedValue(teacher([{ id: "old", name: "Old", is_active: false }]));
    render(withAuth(session(true), <TeacherDetail teacherId="t1" onBack={vi.fn()} />));

    expect(await screen.findByTestId("level-multi-old")).toHaveAttribute("aria-pressed", "true");
  });

  it("asks nothing and sends nothing about levels when the academy keeps none", async () => {
    vi.mocked(api.getTeacher).mockResolvedValue(teacher([]));
    render(withAuth(session(false), <TeacherDetail teacherId="t1" onBack={vi.fn()} />));

    await screen.findByTestId("save-teacher");
    expect(screen.queryByText(arMessages.levels.select.loading)).not.toBeInTheDocument();
    expect(screen.queryByTestId("level-multi")).not.toBeInTheDocument();

    await userEvent.setup().click(screen.getByTestId("save-teacher"));
    await waitFor(() => expect(api.updateTeacher).toHaveBeenCalled());
    expect(vi.mocked(api.updateTeacher).mock.calls[0]?.[1]).not.toHaveProperty("level_ids");
    expect(levelsApi.listLevels).not.toHaveBeenCalled();
  });
});
