import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import arMessages from "../../../messages/ar.json";
import { makeSession, withAuth } from "@/test/auth";
import type { LessonCountingEffect, LessonEffectBlock, PackageLesson } from "@/lib/api";
import { LessonDeleteModal, LessonEditModal, LessonLogActions } from "./lesson-edit-modal";

/**
 * A lesson in a package's log, corrected or deleted, on old blocks too (Ahmed 2026-11-26): the
 * blocks that move are shown first, and the change is confirmed twice before anything is written.
 */

const previewLessonCounting = vi.fn();
const setLessonCounting = vi.fn();
const previewPackageLessonDelete = vi.fn();
const deletePackageLesson = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  previewLessonCounting: (...a: unknown[]) => previewLessonCounting(...a),
  setLessonCounting: (...a: unknown[]) => setLessonCounting(...a),
  previewPackageLessonDelete: (...a: unknown[]) => previewPackageLessonDelete(...a),
  deletePackageLesson: (...a: unknown[]) => deletePackageLesson(...a),
}));

const ar = arMessages.packages.lessonEdit;
const arCounting = arMessages.packages.counting;

function lesson(over: Partial<PackageLesson> = {}): PackageLesson {
  return {
    id: "se1",
    student_id: "s1",
    teacher_id: "t1",
    scheduled_at_utc: "2026-06-02T10:00:00Z",
    duration_minutes: 40,
    status: "ATTENDED",
    package_state: "COUNTED",
    counts: true,
    teacher_pay_percent: 100,
    ...over,
  } as PackageLesson;
}

function block(n: number, over: Partial<LessonEffectBlock> = {}): LessonEffectBlock {
  return {
    id: `p${n}`,
    sequence_no: n,
    label: "8 × 40",
    capacity: 320,
    lesson_minutes: 40,
    used_before: 320,
    used_after: 320,
    status_before: "COMPLETED",
    status_after: "COMPLETED",
    took_back: 0,
    gave_back: 0,
    bill_voided: null,
    stays_closed: null,
    ...over,
  };
}

/** A lesson off #1: #2 gives one back to #1, #3 (running) gives one back to #2. */
function chainEffect(over: Partial<LessonCountingEffect> = {}): LessonCountingEffect {
  return {
    blocker: null,
    status_before: "ATTENDED",
    status_after: "CANCELLED_BY_STUDENT",
    student: {
      counts_before: true,
      counts_after: false,
      mode: "FINISHED_PLAN",
      package: { id: "p1", sequence_no: 1, status: "COMPLETED", label: "8 × 40" },
      will_complete: false,
      reopens: false,
      renewal_undone: false,
      lessons_moved_back: { sequence_no: 2, lessons: 1 },
      stays_closed: null,
      blocks: [
        block(1, { took_back: 1 }),
        block(2, { took_back: 1, gave_back: 1 }),
        block(3, { used_before: 120, used_after: 80, status_before: "ACTIVE", status_after: "ACTIVE", gave_back: 1 }),
      ],
    },
    teacher: { percent_before: 100, percent_after: 0, amount_before: 5000, currency: "USD", statement: { year: 2026, month: 6, sealed: true }, locked: false },
    ...over,
  };
}

const manager = () =>
  makeSession("ACADEMY_OWNER", { permissions: ["package.manage", "session.bill_override", "session.mark_attendance", "session.delete"] });

describe("LessonEditModal", () => {
  beforeEach(() => {
    previewLessonCounting.mockReset();
    setLessonCounting.mockReset();
    previewLessonCounting.mockResolvedValue(chainEffect());
    setLessonCounting.mockResolvedValue({ ok: true, ...chainEffect() });
  });

  it("shows every block that moves, then asks twice before it changes anything", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(withAuth(manager(), <LessonEditModal lesson={lesson()} onClose={() => {}} onSaved={onSaved} />));

    // Nothing changed yet: nothing to save.
    expect(screen.getByTestId("lesson-step-save")).toBeDisabled();
    await user.click(screen.getByTestId("lesson-outcome-CANCELLED_BY_STUDENT"));

    // A fresh cancellation: not counted, nothing for the teacher — and the outcome goes with it.
    await waitFor(() => expect(previewLessonCounting).toHaveBeenLastCalledWith("se1", false, 0, "CANCELLED_BY_STUDENT"));
    const blocks = await screen.findByTestId("lesson-effect-blocks");
    expect(blocks.children).toHaveLength(3);
    expect(screen.getByTestId("lesson-effect-block-3").textContent).toMatch(/3|٣/);

    // First "sure?", then the last word that every package moves: only then is it written.
    await user.click(screen.getByTestId("lesson-step-save"));
    expect(screen.getByTestId("lesson-edit-confirm")).toBeInTheDocument();
    expect(setLessonCounting).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("lesson-step-confirm"));
    expect(screen.getByTestId("lesson-final-warning").textContent).toContain(ar.finalWarning);
    expect(setLessonCounting).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("lesson-step-final"));
    await waitFor(() => expect(setLessonCounting).toHaveBeenCalledWith("se1", false, 0, "CANCELLED_BY_STUDENT"));
    expect(onSaved).toHaveBeenCalledWith(ar.edited);
  });

  it("goes back a step without saving", async () => {
    const user = userEvent.setup();
    render(withAuth(manager(), <LessonEditModal lesson={lesson()} onClose={() => {}} onSaved={() => {}} />));

    await user.click(screen.getByTestId("lesson-outcome-FREE"));
    await screen.findByTestId("lesson-effect-blocks");
    await user.click(screen.getByTestId("lesson-step-save"));
    await user.click(screen.getByTestId("lesson-step-confirm"));
    await user.click(screen.getByTestId("lesson-step-back"));
    await user.click(screen.getByTestId("lesson-step-back"));

    expect(screen.getByTestId("lesson-outcome-FREE")).toHaveAttribute("aria-pressed", "true");
    expect(setLessonCounting).not.toHaveBeenCalled();
  });

  it("sets only a cancellation's counting without sending an outcome", async () => {
    const user = userEvent.setup();
    render(
      withAuth(
        manager(),
        <LessonEditModal lesson={lesson({ status: "CANCELLED_BY_STUDENT", counts: false, teacher_pay_percent: null })} onClose={() => {}} onSaved={() => {}} />,
      ),
    );

    await user.click(screen.getByTestId("lesson-counts-yes"));
    await user.click(screen.getByTestId("teacher-share-50"));
    await waitFor(() => expect(previewLessonCounting).toHaveBeenLastCalledWith("se1", true, 50, undefined));
  });

  it("will not go on with what the server says cannot change", async () => {
    previewLessonCounting.mockResolvedValue(chainEffect({ blocker: "PACKAGE_CLOSED" }));
    const user = userEvent.setup();
    render(withAuth(manager(), <LessonEditModal lesson={lesson()} onClose={() => {}} onSaved={() => {}} />));

    await user.click(screen.getByTestId("lesson-outcome-CANCELLED_BY_TEACHER"));
    expect(await screen.findByTestId("lesson-effect-blocker")).toHaveTextContent(arCounting.blocker.PACKAGE_CLOSED);
    expect(screen.getByTestId("lesson-step-save")).toBeDisabled();
  });
});

describe("LessonDeleteModal", () => {
  beforeEach(() => {
    previewPackageLessonDelete.mockReset();
    deletePackageLesson.mockReset();
    previewPackageLessonDelete.mockResolvedValue(chainEffect());
    deletePackageLesson.mockResolvedValue({ ok: true, ...chainEffect() });
  });

  it("says what moves, then deletes only after the second yes", async () => {
    const user = userEvent.setup();
    const onDeleted = vi.fn();
    render(withAuth(manager(), <LessonDeleteModal lesson={lesson()} onClose={() => {}} onDeleted={onDeleted} />));

    expect(await screen.findByTestId("lesson-effect-blocks")).toBeInTheDocument();
    expect(screen.getByTestId("lesson-delete-confirm")).toHaveTextContent(ar.confirmDelete);

    await user.click(screen.getByTestId("lesson-step-confirm"));
    expect(screen.getByTestId("lesson-final-warning").textContent).toContain(ar.finalWarningDelete);
    expect(deletePackageLesson).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("lesson-step-final"));
    await waitFor(() => expect(deletePackageLesson).toHaveBeenCalledWith("se1"));
    expect(onDeleted).toHaveBeenCalledWith(ar.deleted);
  });
});

describe("LessonLogActions", () => {
  it("offers edit and delete to the office, never on a planned date or to someone without the rights", () => {
    const { rerender } = render(withAuth(manager(), <LessonLogActions lesson={lesson()} onChanged={() => {}} />));
    expect(screen.getByTestId("lesson-edit-se1")).toBeInTheDocument();
    expect(screen.getByTestId("lesson-delete-se1")).toBeInTheDocument();

    // A lesson still ahead can be deleted, not given an outcome.
    rerender(withAuth(manager(), <LessonLogActions lesson={lesson({ scheduled_at_utc: "2999-01-01T10:00:00Z", status: "SCHEDULED" })} onChanged={() => {}} />));
    expect(screen.queryByTestId("lesson-edit-se1")).not.toBeInTheDocument();
    expect(screen.getByTestId("lesson-delete-se1")).toBeInTheDocument();

    // A date the timetable only plans is not a lesson yet.
    rerender(withAuth(manager(), <LessonLogActions lesson={lesson({ id: "plan-x-2026-06-09-0", planned: true, status: "SCHEDULED" })} onChanged={() => {}} />));
    expect(screen.queryByTestId("lesson-actions-plan-x-2026-06-09-0")).not.toBeInTheDocument();

    rerender(withAuth(makeSession("ACADEMY_OWNER", { permissions: ["package.read"] }), <LessonLogActions lesson={lesson()} onChanged={() => {}} />));
    expect(screen.queryByTestId("lesson-edit-se1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("lesson-delete-se1")).not.toBeInTheDocument();
  });

  it("still shows how a cancellation stands", () => {
    render(withAuth(manager(), <LessonLogActions lesson={lesson({ status: "CANCELLED_BY_STUDENT", counts: true, teacher_pay_percent: 25 })} onChanged={() => {}} />));
    expect(screen.getByTestId("lesson-counting-se1").textContent).toContain(arCounting.chipCounts);
  });
});
