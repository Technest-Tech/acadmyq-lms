import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeSession, withAuth } from "@/test/auth";
import { AcademyNameCard } from "@/components/settings/academy-name-card";
import { TeacherDetail } from "./teacher-detail";
import { TeacherForm } from "./teacher-form";
import { TeacherWorkspace } from "./teacher-workspace";

/**
 * The "online lessons" switch (docs/centre-profile/02-COHERENCE-AUDIT §1) on the teacher's pages and
 * on the Academy card: a centre with it off has no meeting-link field and no Punctuality tab; a
 * centre with it on, and every academy without the `centre` switch, keeps both exactly as they were.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/teachers/t1",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/api")>()),
  getTeacher: vi.fn(),
  updateTeacher: vi.fn(),
  listSpecializations: vi.fn().mockResolvedValue({ specializations: [] }),
  getAcademyProfile: vi.fn(),
  updateAcademyProfile: vi.fn(),
}));

import * as api from "@/lib/api";

const academy = (onlineLessons?: boolean) => ({ name: "Lingo", displayName: "Lingo", logoUrl: null, onlineLessons });
const centre = (onlineLessons?: boolean) =>
  makeSession("ACADEMY_OWNER", {
    permissions: ["teacher.read", "teacher.update", "teacher.create", "teacher.set_pay", "settings.manage"],
    capabilities: ["centre", "groups", "accounting"],
    academy: academy(onlineLessons),
  });
const quran = (onlineLessons?: boolean) =>
  makeSession("ACADEMY_OWNER", {
    permissions: ["teacher.read", "teacher.update", "teacher.create", "teacher.set_pay", "settings.manage"],
    capabilities: ["groups", "invoicing"],
    academy: academy(onlineLessons),
  });

const TEACHER = {
  id: "t1",
  user_id: null,
  full_name: "Ustadh Kareem",
  phone: null,
  specialization: "Tajweed",
  session_rate_minor: 8000,
  pay_type: "HOURLY",
  fixed_salary_minor: 0,
  currency: "EGP",
  timezone: null,
  payout_method: null,
  payout_handle: null,
  meeting_url: "https://zoom.us/j/kareem",
  availability: [],
  is_active: true,
  deleted_at: null,
  created_at: "",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getTeacher).mockResolvedValue({
    teacher: TEACHER,
    students: [],
    student_rates: [],
    login: { has_login: false, email: null, is_active: null },
  } as unknown as Awaited<ReturnType<typeof api.getTeacher>>);
  vi.mocked(api.updateTeacher).mockResolvedValue({ ok: true, changed: [] });
  vi.mocked(api.getAcademyProfile).mockResolvedValue({
    academy: { id: "a1", name: "Lingo", timezone: "Africa/Cairo", default_currency: "EGP", country: "EG", invoice_grouping: "PER_STUDENT", billing_day: 1, online_lessons: null },
  });
  vi.mocked(api.updateAcademyProfile).mockResolvedValue({ ok: true });
});

describe("TeacherForm's meeting link", () => {
  it("is not there for a centre with online lessons off", () => {
    render(withAuth(centre(false), <TeacherForm onCreated={() => {}} onCancel={() => {}} />));
    expect(screen.queryByTestId("meeting-url")).toBeNull();
  });

  it("is there for a centre with them on, and for everyone else whatever the session says", () => {
    const on = render(withAuth(centre(true), <TeacherForm onCreated={() => {}} onCancel={() => {}} />));
    expect(screen.getByTestId("meeting-url")).toBeInTheDocument();
    on.unmount();

    render(withAuth(quran(false), <TeacherForm onCreated={() => {}} onCancel={() => {}} />));
    expect(screen.getByTestId("meeting-url")).toBeInTheDocument();
  });
});

describe("TeacherDetail's meeting link", () => {
  it("is hidden, not cleared: a save keeps the link on the teacher", async () => {
    const user = userEvent.setup();
    render(withAuth(centre(false), <TeacherDetail teacherId="t1" onBack={() => {}} />));

    await screen.findByTestId("teacher-rate");
    expect(screen.queryByTestId("meeting-url")).toBeNull();

    await user.click(screen.getByTestId("save-teacher"));
    await waitFor(() => expect(api.updateTeacher).toHaveBeenCalled());
    expect(vi.mocked(api.updateTeacher).mock.calls[0]![1]).toMatchObject({ meeting_url: "https://zoom.us/j/kareem" });
  });

  it("stays for an academy without the centre switch", async () => {
    render(withAuth(quran(false), <TeacherDetail teacherId="t1" onBack={() => {}} />));
    expect(await screen.findByTestId("meeting-url")).toHaveValue("https://zoom.us/j/kareem");
  });
});

describe("The teacher's Punctuality tab", () => {
  it("is not there for a centre with online lessons off", async () => {
    render(withAuth(centre(false), <TeacherWorkspace teacherId="t1" />));
    await screen.findByTestId("teacher-tab-profile");
    expect(screen.queryByTestId("teacher-tab-punctuality")).toBeNull();
  });

  it("is there for a centre with them on (an ONLINE group, or the setting)", async () => {
    render(withAuth(centre(true), <TeacherWorkspace teacherId="t1" />));
    expect(await screen.findByTestId("teacher-tab-punctuality")).toBeInTheDocument();
  });

  it("is there for an academy without the centre switch, whatever the session says", async () => {
    render(withAuth(quran(false), <TeacherWorkspace teacherId="t1" />));
    expect(await screen.findByTestId("teacher-tab-punctuality")).toBeInTheDocument();
  });
});

describe("The Academy card's online-lessons choice", () => {
  it("opens a centre on what was said, sends the choice, and re-reads the session", async () => {
    const user = userEvent.setup();
    const refresh = vi.fn(async () => {});
    render(withAuth(centre(false), <AcademyNameCard />, { refresh }));

    expect(await screen.findByTestId("academy-online-AUTO")).toHaveAttribute("aria-checked", "true");

    await user.click(screen.getByTestId("academy-online-OFF"));
    await user.click(screen.getByTestId("save-academy-name"));
    await waitFor(() => expect(api.updateAcademyProfile).toHaveBeenCalled());
    expect(vi.mocked(api.updateAcademyProfile).mock.calls[0]![0]).toMatchObject({ online_lessons: false });
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));

    await user.click(screen.getByTestId("academy-online-AUTO"));
    await user.click(screen.getByTestId("save-academy-name"));
    await waitFor(() => expect(api.updateAcademyProfile).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.updateAcademyProfile).mock.calls[1]![0]).toMatchObject({ online_lessons: null });
  });

  it("is not on an academy without the centre switch, and its save sends nothing about it", async () => {
    const user = userEvent.setup();
    render(withAuth(quran(), <AcademyNameCard />));

    await user.type(await screen.findByTestId("academy-name-input"), " Centre");
    expect(screen.queryByTestId("academy-online")).toBeNull();
    await user.click(screen.getByTestId("save-academy-name"));

    await waitFor(() => expect(api.updateAcademyProfile).toHaveBeenCalled());
    expect(vi.mocked(api.updateAcademyProfile).mock.calls[0]![0]).not.toHaveProperty("online_lessons");
  });
});
