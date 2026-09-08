import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { formatHours } from "@/lib/time";
import { makeSession, withAuth } from "@/test/auth";
import type { LessonPackageCredit, LessonPackageRow } from "@/lib/api";
import { PackageDetail } from "./package-detail";

/**
 * The ledger is the answer to "why is my balance that number", so these pin the two things the
 * component owns: the running balance it derives (the server stores totals, not per-row leftovers)
 * and the fact that a settled lesson offers no controls at all — a button that is certain to fail
 * is worse than no button.
 */

const getLessonPackage = vi.fn();
const listAttachablePackageLessons = vi.fn();
const addPackageLesson = vi.fn();
const updatePackageLesson = vi.fn();
const removePackageLesson = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getLessonPackage: (id: string) => getLessonPackage(id),
  listAttachablePackageLessons: (id: string) => listAttachablePackageLessons(id),
  addPackageLesson: (id: string, input: unknown) => addPackageLesson(id, input),
  updatePackageLesson: (id: string, creditId: string, minutes: number) =>
    updatePackageLesson(id, creditId, minutes),
  removePackageLesson: (id: string, creditId: string, rebill: boolean) =>
    removePackageLesson(id, creditId, rebill),
  listTeachers: () => Promise.resolve({ rows: [], total: 0, page: 1, pageSize: 20 }),
}));

function pkg(overrides: Partial<LessonPackageRow> = {}): LessonPackageRow {
  return {
    id: "p1",
    student_id: "s1",
    student_name: "Sara",
    label: "4 hours",
    sequence_no: 1,
    status: "ACTIVE",
    bill_timing: "ON_COMPLETION",
    minutes_total: 240,
    carried_over_minutes: 0,
    minutes_sold: 240,
    minutes_consumed: 100,
    minutes_remaining: 140,
    minutes_overdrawn: 0,
    lesson_count: 2,
    upcoming_lesson_count: 0,
    next_lesson_at: null,
    percent_used: 42,
    price_minor: 80000,
    hourly_rate_minor: 20000,
    currency: "EGP",
    starts_on: "2026-09-01",
    expires_on: null,
    closed_at: null,
    closed_reason: null,
    invoice_id: null,
    invoice_status: null,
    invoice_token: null,
    invoice_total_minor: 0,
    invoice_paid_minor: 0,
    outstanding_minor: 0,
    payment_method: null,
    payment_reason: null,
    payment_reference: null,
    payment_proof_url: null,
    overdraft_billed: false,
    created_at: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

function credit(overrides: Partial<LessonPackageCredit> = {}): LessonPackageCredit {
  return {
    id: "c1",
    session_id: "sess1",
    minutes: 60,
    minutes_overdrawn: 0,
    amount_minor: 0,
    currency: "EGP",
    description: "1h — 2026-09-02",
    consumed_at: "2026-09-02T10:00:00Z",
    scheduled_at_utc: "2026-09-02T10:00:00Z",
    session_status: "ATTENDED",
    duration_minutes: 60,
    teacher_name: "Ahmed",
    locked: false,
    lock_reason: null,
    ...overrides,
  };
}

function renderDetail(
  credits: LessonPackageCredit[],
  canManage = true,
  onChanged = vi.fn(),
) {
  getLessonPackage.mockResolvedValue({ package: pkg(), credits });

  return render(
    withAuth(
      makeSession("ACADEMY_OWNER", { permissions: ["package.read", "package.manage"] }),
      <PackageDetail
        row={pkg()}
        timezone="Africa/Cairo"
        canManage={canManage}
        onChanged={onChanged}
      />,
    ),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  listAttachablePackageLessons.mockResolvedValue({ lessons: [] });
});

it("counts the balance down across the ledger", async () => {
  renderDetail([
    credit({ id: "c1", minutes: 60 }),
    credit({ id: "c2", minutes: 40, session_id: "sess2" }),
  ]);

  const [, first, second] = await screen.findAllByRole("row");
  // Header + two lessons.
  expect(second).toBeDefined();

  // 240 sold − 60 = 180 left, then − 40 = 140 left. The server sends totals, not leftovers.
  expect(first?.textContent).toContain(formatHours(180, "ar"));
  expect(second?.textContent).toContain(formatHours(140, "ar"));
});

it("offers no controls for a lesson whose money is already settled", async () => {
  renderDetail([
    credit({ id: "c1", locked: true, lock_reason: "PAYOUT_FINALIZED" }),
  ]);

  const [, lesson] = await screen.findAllByRole("row");
  const buttons = within(lesson as HTMLElement).getAllByRole("button");

  expect(buttons).toHaveLength(2);
  for (const button of buttons) expect(button).toBeDisabled();
});

it("makes the caller choose what happens to the money when removing a lesson", async () => {
  const user = userEvent.setup();
  const onChanged = vi.fn();
  removePackageLesson.mockResolvedValue({
    ok: true,
    minutes_returned: 60,
    rebilled: false,
  });
  renderDetail([credit()], true, onChanged);

  await user.click(await screen.findByRole("button", { name: /إزالة من الباقة/ }));

  // Both outcomes are offered; neither is the quiet default.
  await user.click(screen.getByRole("button", { name: /إرجاع الساعات دون فوترة/ }));

  expect(removePackageLesson).toHaveBeenCalledWith("p1", "c1", false);
  expect(onChanged).toHaveBeenCalled();
});

it("sends a corrected length for the lesson that was edited", async () => {
  const user = userEvent.setup();
  updatePackageLesson.mockResolvedValue({ ok: true, impact: {} });
  renderDetail([credit({ id: "c9", minutes: 80 })]);

  await user.click(await screen.findByRole("button", { name: /تصحيح المدة/ }));

  const field = screen.getByRole("spinbutton");
  await user.clear(field);
  await user.type(field, "40");
  await user.click(screen.getByRole("button", { name: /حفظ/ }));

  expect(updatePackageLesson).toHaveBeenCalledWith("p1", "c9", 40);
});

it("hides every control from someone who may only read", async () => {
  renderDetail([credit()], false);

  await screen.findAllByRole("row");
  expect(screen.queryByRole("button", { name: /إضافة حصة/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /تصحيح المدة/ })).not.toBeInTheDocument();
});
