import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeSession, withAuth } from "@/test/auth";
import { GettingStarted } from "./getting-started";
import { HelpButton } from "./help-button";
import { HelpCenter } from "./help-center";
import { forgetHelpVideos } from "./help-data";
import { HelpProvider } from "./help-provider";

// The in-app help as a person meets it: the "?" in the header, the drawer it opens, the help
// centre, and a new academy's first-steps card.

let pathname = "/students";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => pathname,
}));

const getHelpVideos = vi.fn();
const getOnboarding = vi.fn();
vi.mock("@/lib/help-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/help-api")>()),
  getHelpVideos: (...a: unknown[]) => getHelpVideos(...a),
  getOnboarding: (...a: unknown[]) => getOnboarding(...a),
}));

const OWNER = [
  "student.read", "student.create", "student.update", "teacher.read", "teacher.create", "schedule.read",
  "schedule.manage", "session.read", "session.mark_attendance", "invoice.read", "invoice.mark_paid",
];
const TEACHER = ["student.read", "session.read", "session.mark_attendance", "teacher.read_own", "schedule.read"];

function renderHelp(role: "ACADEMY_OWNER" | "TEACHER", node: React.ReactNode, overrides = {}) {
  const session = makeSession(role, { permissions: role === "TEACHER" ? TEACHER : OWNER, ...overrides });
  return render(withAuth(session, <HelpProvider>{node}</HelpProvider>));
}

beforeEach(() => {
  pathname = "/students";
  localStorage.clear();
  forgetHelpVideos();
  getHelpVideos.mockReset().mockResolvedValue({ videos: [] });
  getOnboarding.mockReset();
});

describe("the header's help button", () => {
  it("opens the page's guide: what it is for, the video's place, and the tasks as questions", async () => {
    renderHelp("ACADEMY_OWNER", <HelpButton modern />);

    await userEvent.click(screen.getByTestId("header-help"));
    const drawer = await screen.findByRole("dialog");

    expect(await within(drawer).findByRole("heading", { name: "الطلاب" })).toBeInTheDocument();
    // No video recorded yet: the quiet "coming soon" card, never a broken player.
    expect(within(drawer).getByTestId("help-video-soon")).toBeInTheDocument();
    // The first question is open, with its steps and the button it names drawn as a chip.
    expect(within(drawer).getByRole("button", { name: /كيف أضيف طالبًا جديدًا؟/ })).toHaveAttribute("aria-expanded", "true");
    expect(within(drawer).getByText("طالب جديد")).toBeInTheDocument();
    expect(within(drawer).getByRole("button", { name: /كيف أضع جدول حصص أسبوعي للطالب؟/ })).toHaveAttribute("aria-expanded", "false");
  });

  it("shows a teacher only what a teacher does on that page", async () => {
    renderHelp("TEACHER", <HelpButton modern />);

    await userEvent.click(screen.getByTestId("header-help"));
    const drawer = await screen.findByRole("dialog");

    expect(await within(drawer).findByRole("button", { name: /كيف أرى طلابي وحصصهم؟/ })).toBeInTheDocument();
    expect(within(drawer).queryByRole("button", { name: /كيف أضيف طالبًا جديدًا؟/ })).not.toBeInTheDocument();
  });

  it("marks a page whose guide was never opened, once", async () => {
    renderHelp("ACADEMY_OWNER", <HelpButton modern />);

    expect(await screen.findByTestId("header-help-dot")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("header-help"));
    await userEvent.click(await screen.findByRole("button", { name: "إغلاق" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByTestId("header-help-dot")).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("academiq:help:seen") ?? "[]")).toEqual(["students"]);
  });

  it("plays a recorded video in place of the coming-soon card", async () => {
    getHelpVideos.mockResolvedValue({
      videos: [{ slot: "students", source: "LINK", url: "https://youtu.be/dQw4w9WgXcQ", filename: null, sizeBytes: null, updatedAt: "2026-11-15T10:00:00Z" }],
    });
    renderHelp("ACADEMY_OWNER", <HelpButton modern />);

    await userEvent.click(screen.getByTestId("header-help"));
    const play = await screen.findByTestId("help-video-play");
    expect(screen.queryByTestId("help-video-soon")).not.toBeInTheDocument();
    // Nothing is fetched from YouTube until the person asks for it.
    expect(document.querySelector("iframe")).toBeNull();

    await userEvent.click(play);
    expect(document.querySelector("iframe")).toHaveAttribute(
      "src",
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&autoplay=1",
    );
  });

  it("says so, and points at the help centre, on a page with no guide yet", async () => {
    pathname = "/audit";
    renderHelp("ACADEMY_OWNER", <HelpButton modern />);

    expect(screen.queryByTestId("header-help-dot")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("header-help"));
    const drawer = await screen.findByRole("dialog");

    expect(within(drawer).getByRole("heading", { name: "لا يوجد شرح لهذه الصفحة بعد" })).toBeInTheDocument();
    expect(within(drawer).getByRole("link", { name: "كل الشروحات" })).toHaveAttribute("href", "/help");
  });

  it("closes on Escape", async () => {
    renderHelp("ACADEMY_OWNER", <HelpButton modern />);

    await userEvent.click(screen.getByTestId("header-help"));
    await screen.findByRole("dialog");
    await userEvent.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

describe("the help centre", () => {
  it("lists the person's guides by question and finds one by a word in its steps", async () => {
    pathname = "/help";
    renderHelp("ACADEMY_OWNER", <HelpCenter />);

    const center = screen.getByTestId("help-center");
    expect(await within(center).findByRole("button", { name: /كيف أضيف طالبًا جديدًا؟/ })).toBeInTheDocument();
    expect(center.querySelector('[data-topic="attendance"]')).not.toBeNull();

    // "ولي أمر جديد" is a step of adding a student, not the name of any page the owner here can open.
    await userEvent.type(within(center).getByRole("searchbox"), "ولي امر جديد");
    await waitFor(() => expect(center.querySelector('[data-topic="attendance"]')).toBeNull());
    expect(within(center).getByRole("button", { name: /كيف أضيف طالبًا جديدًا؟/ })).toBeInTheDocument();
  });

  it("opens the drawer on the question that was pressed, offering to go to its page", async () => {
    pathname = "/help";
    renderHelp("ACADEMY_OWNER", <HelpCenter />);

    await userEvent.click(await screen.findByRole("button", { name: /كيف أضع جدول حصص أسبوعي للطالب؟/ }));
    const drawer = await screen.findByRole("dialog");

    expect(await within(drawer).findByRole("button", { name: /كيف أضع جدول حصص أسبوعي للطالب؟/ })).toHaveAttribute("aria-expanded", "true");
    expect(within(drawer).getByRole("link", { name: "افتح الصفحة" })).toHaveAttribute("href", "/students");
  });

  it("gives a teacher a teacher's shelf, not the owner's", async () => {
    pathname = "/help";
    renderHelp("TEACHER", <HelpCenter />);

    const center = screen.getByTestId("help-center");
    await within(center).findByRole("button", { name: /كيف أسجّل حضور حصة؟/ });
    expect(center.querySelector('[data-topic="teachers"]')).toBeNull();
    expect(center.querySelector('[data-topic="invoices"]')).toBeNull();
    expect(within(center).getByRole("link", { name: /دليل المعلّم الكامل/ })).toHaveAttribute("href", "/docs/teacher-guide");
  });
});

describe("a new academy's first steps", () => {
  const fresh = { show: true, done: { teacher: true, student: false, schedule: false, attendance: false, money: false } };

  it("ticks what is done, leads with what is next, and offers the help for it", async () => {
    getOnboarding.mockResolvedValue(fresh);
    pathname = "/dashboard";
    renderHelp("ACADEMY_OWNER", <GettingStarted />);

    const card = await screen.findByTestId("getting-started");
    expect(within(card).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
    expect(card.querySelector('[data-step="teacher"]')).toHaveAttribute("data-done", "true");

    const next = card.querySelector<HTMLElement>('[data-step="student"]')!;
    expect(within(next).getByRole("link", { name: "ابدأ" })).toHaveAttribute("href", "/students");

    await userEvent.click(within(next).getByRole("button", { name: /كيف؟/ }));
    const drawer = await screen.findByRole("dialog");
    expect(await within(drawer).findByRole("button", { name: /كيف أضيف طالبًا جديدًا؟/ })).toHaveAttribute("aria-expanded", "true");
  });

  it("gives a centre its own steps: a group before a student, a receipt for the money", async () => {
    getOnboarding.mockResolvedValue({ show: true, done: {} });
    renderHelp("ACADEMY_OWNER", <GettingStarted />, {
      permissions: [...OWNER, "group.manage"],
      academy: { name: "Lingo", displayName: "Lingo", logoUrl: null, profile: "CENTRE" },
    });

    const card = await screen.findByTestId("getting-started");
    const steps = [...card.querySelectorAll("[data-step]")].map((node) => node.getAttribute("data-step"));
    expect(steps).toEqual(["teacher", "group", "student", "attendance", "money"]);
  });

  it("never shows a teacher the card, and does not even ask the server", () => {
    renderHelp("TEACHER", <GettingStarted />);

    expect(screen.queryByTestId("getting-started")).not.toBeInTheDocument();
    expect(getOnboarding).not.toHaveBeenCalled();
  });

  it("stays away from an academy that is no longer new, and from one that finished", async () => {
    getOnboarding.mockResolvedValue({ ...fresh, show: false });
    const { unmount } = renderHelp("ACADEMY_OWNER", <GettingStarted />);
    await waitFor(() => expect(getOnboarding).toHaveBeenCalled());
    expect(screen.queryByTestId("getting-started")).not.toBeInTheDocument();
    unmount();

    getOnboarding.mockResolvedValue({
      show: true,
      done: { teacher: true, student: true, schedule: true, attendance: true, money: true },
    });
    renderHelp("ACADEMY_OWNER", <GettingStarted />);
    await waitFor(() => expect(getOnboarding).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId("getting-started")).not.toBeInTheDocument();
  });

  it("remembers being closed", async () => {
    getOnboarding.mockResolvedValue(fresh);
    const { unmount } = renderHelp("ACADEMY_OWNER", <GettingStarted />);

    await userEvent.click(await screen.findByRole("button", { name: "إخفاء" }));
    expect(screen.queryByTestId("getting-started")).not.toBeInTheDocument();
    unmount();

    renderHelp("ACADEMY_OWNER", <GettingStarted />);
    expect(screen.queryByTestId("getting-started")).not.toBeInTheDocument();
    expect(getOnboarding).toHaveBeenCalledTimes(1);
  });

  it("shows nothing rather than an error when the server cannot answer", async () => {
    getOnboarding.mockRejectedValue(new Error("offline"));
    renderHelp("ACADEMY_OWNER", <GettingStarted />);

    await waitFor(() => expect(getOnboarding).toHaveBeenCalled());
    expect(screen.queryByTestId("getting-started")).not.toBeInTheDocument();
  });
});
