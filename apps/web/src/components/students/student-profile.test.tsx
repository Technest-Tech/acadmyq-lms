import { render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext } from "@/components/auth-provider";
import { authValue, makeSession } from "@/test/auth";
import enMessages from "../../../messages/en.json";
import { StudentProfile } from "./student-profile";

vi.mock("@/lib/api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/api")>()),
  getStudent: vi.fn(),
  getTeacherHistory: vi.fn(),
  listTeachers: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/students/s1",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/levels-api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/levels-api")>()),
  getLevelHistory: vi.fn(),
}));

import * as api from "@/lib/api";
import * as levelsApi from "@/lib/levels-api";

function setup() {
  vi.mocked(api.listTeachers).mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 50 });
  vi.mocked(api.getStudent).mockResolvedValue({
    student: {
      id: "s1",
      full_name: "Yusuf",
      guardian_id: "g1",
      is_self_guardian: false,
      status: "REGULAR",
      deleted_at: null,
      level_id: "l2",
      level_name: "A2",
    },
    guardian: null,
    subscription: null,
    teachers: [],
    currentTeacher: null,
  });
  vi.mocked(api.getTeacherHistory).mockResolvedValue({ history: [] });
  vi.mocked(levelsApi.getLevelHistory).mockResolvedValue({ level_id: "l2", level_name: "A2", history: [] });
}

function renderProfile(capabilities: string[]) {
  const session = makeSession("ACADEMY_OWNER", {
    permissions: ["student.read", "student.update", "group.manage"],
    capabilities,
  });
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <AuthContext.Provider value={authValue(session)}>
        <StudentProfile studentId="s1" />
      </AuthContext.Provider>
    </NextIntlClientProvider>,
  );
}

/**
 * The level / grade on the live student profile (docs/centre-profile Phase 2 §1, coherence audit
 * §3): the route renders this page, and only the legacy student-detail carried the card and the badge.
 */
describe("StudentProfile — the level card", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setup();
  });

  it("shows the level badge in the hero and the level card under the identity card for a centre", async () => {
    renderProfile(["invoicing", "groups", "accounting", "centre"]);

    expect(await screen.findByTestId("student-level-badge")).toHaveTextContent("A2");
    expect(await screen.findByTestId("level-card")).toBeInTheDocument();
    await waitFor(() => expect(levelsApi.getLevelHistory).toHaveBeenCalledWith("s1"));
  });

  it("renders neither for an academy without the centre switch, and never fetches the history", async () => {
    renderProfile(["invoicing", "groups"]);

    expect(await screen.findByTestId("student-profile-page")).toBeInTheDocument();
    expect(screen.queryByTestId("student-level-badge")).not.toBeInTheDocument();
    expect(screen.queryByTestId("level-card")).not.toBeInTheDocument();
    expect(levelsApi.getLevelHistory).not.toHaveBeenCalled();
  });
});
