import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext } from "@/components/auth-provider";
import { authValue, makeSession } from "@/test/auth";
import enMessages from "../../../../../messages/en.json";
import { AdminLmsScreen } from "./screen";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ children, href, onClick }: { children: React.ReactNode; href: string; onClick?: (e: React.MouseEvent) => void }) => (
    <a href={href} onClick={onClick}>{children}</a>
  ),
}));

vi.mock("@/lib/api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/api")>()),
  getLmsUsage: vi.fn(),
  getLmsActivity: vi.fn(),
}));

import * as api from "@/lib/api";

const L = enMessages.adminLms;

function renderScreen(permissions: string[] = ["platform.manage"]) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <AuthContext.Provider value={authValue(makeSession("SUPER_ADMIN", { permissions }))}>
        <AdminLmsScreen />
      </AuthContext.Provider>
    </NextIntlClientProvider>,
  );
}

describe("AdminLmsScreen (course platform oversight)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.getLmsUsage).mockResolvedValue({
      academies: [
        {
          academy_id: "a1",
          academy_name: "Course Co",
          subdomain: "coursesite",
          created_at: "2026-01-01T00:00:00Z",
          plan_name: "LMS Basic",
          lms_plan_name: "LMS Basic",
          lms_status: "ACTIVE",
          lms_enabled: true,
          trial_end: null,
          max_courses: 10,
          max_learners: 500,
          max_storage_gb: 50,
          courses_total: 8,
          courses_published: 6,
          courses_draft: 2,
          lessons: 42,
          learners: 120,
          active_learners: 118,
          enrollments: 200,
          active_enrollments: 190,
          codes: 30,
          active_codes: 12,
          redeemed_codes: 150,
          storage_bytes: 12_000_000_000,
          media_processing: 0,
          media_failed: 0,
          certificates: 25,
          last_activity: "2026-07-20T10:00:00Z",
        },
        {
          academy_id: "a2",
          academy_name: "Trial School",
          subdomain: null,
          created_at: "2026-07-01T00:00:00Z",
          plan_name: "Pro",
          lms_plan_name: null,
          lms_status: "TRIAL",
          lms_enabled: true,
          trial_end: "2026-08-01T00:00:00Z",
          max_courses: null,
          max_learners: null,
          max_storage_gb: null,
          courses_total: 1,
          courses_published: 0,
          courses_draft: 1,
          lessons: 0,
          learners: 0,
          active_learners: 0,
          enrollments: 0,
          active_enrollments: 0,
          codes: 0,
          active_codes: 0,
          redeemed_codes: 0,
          storage_bytes: 0,
          media_processing: 0,
          media_failed: 0,
          certificates: 0,
          last_activity: null,
        },
      ],
      totals: {
        academies: 2,
        active: 1,
        trial: 1,
        courses: 9,
        published_courses: 6,
        lessons: 42,
        learners: 120,
        enrollments: 200,
        redeemed_codes: 150,
        storage_bytes: 12_000_000_000,
        certificates: 25,
      },
    });
    vi.mocked(api.getLmsActivity).mockResolvedValue({
      rows: [
        {
          id: "e1",
          academy_id: "a1",
          academy_name: "Course Co",
          actor_user_id: "u1",
          actor_name: "Admin",
          actor_role: "SUPER_ADMIN",
          action: "lms.course_moderated",
          entity_type: "course",
          entity_id: "c1",
          created_at: "2026-07-20T10:00:00Z",
        },
        {
          id: "e2",
          academy_id: "a1",
          academy_name: "Course Co",
          actor_user_id: null,
          actor_name: null,
          actor_role: null,
          action: "course.create",
          entity_type: "course",
          entity_id: "c2",
          created_at: "2026-07-19T10:00:00Z",
        },
      ],
      total: 2,
      limit: 60,
    });
  });

  it("renders the client roster with usage against each cap", async () => {
    renderScreen();

    // "6 of 8" is the published-of-total cell, unique to the capped client.
    expect(await screen.findByText("6 of 8")).toBeInTheDocument();
    expect(screen.getByText("120 / 500")).toBeInTheDocument();
    expect(screen.getByText("coursesite")).toBeInTheDocument();
    // An uncapped client shows the bare learner count, no "/ cap".
    expect(screen.getByText(L.clients.noSite)).toBeInTheDocument();
    expect(screen.getAllByText("Course Co").length).toBeGreaterThanOrEqual(1);
  });

  it("renders the platform totals", async () => {
    renderScreen();
    // published / total courses tile
    expect(await screen.findByText("6 / 9")).toBeInTheDocument();
    // Storage renders both in the totals tile and in the client's row cell.
    expect(screen.getAllByText("12 GB").length).toBeGreaterThanOrEqual(1);
    // Redeemed codes are a totals-only figure (no roster column carries them).
    expect(screen.getByText("150")).toBeInTheDocument();
  });

  it("flags a super-admin intervention in the activity feed", async () => {
    renderScreen();
    expect(await screen.findByText(L.action["lms_course_moderated"])).toBeInTheDocument();
    expect(screen.getByText(L.activity.platformBadge)).toBeInTheDocument();
    expect(screen.getByText(L.action["course_create"])).toBeInTheDocument();
    // A null actor falls back to the "System" label.
    expect(screen.getByText(L.activity.system)).toBeInTheDocument();
  });

  it("blocks a user without platform.manage and never fetches", () => {
    renderScreen([]);
    expect(screen.getByText(L.noPermission)).toBeInTheDocument();
    expect(api.getLmsUsage).not.toHaveBeenCalled();
    expect(api.getLmsActivity).not.toHaveBeenCalled();
  });
});
