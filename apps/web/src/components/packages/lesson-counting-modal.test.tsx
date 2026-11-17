import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import arMessages from "../../../messages/ar.json";
import { makeSession, withAuth } from "@/test/auth";
import type { LessonCountingEffect, PackageLesson } from "@/lib/api";
import { LessonCountingAction, LessonCountingModal } from "./lesson-counting-modal";

/** A cancelled lesson set to count or not, the teacher's share with it (Ahmed 2026-11-17). */

const previewLessonCounting = vi.fn();
const setLessonCounting = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  previewLessonCounting: (...a: unknown[]) => previewLessonCounting(...a),
  setLessonCounting: (...a: unknown[]) => setLessonCounting(...a),
}));

const ar = arMessages.packages.counting;

function lesson(over: Partial<PackageLesson> = {}): PackageLesson {
  return {
    id: "se1",
    student_id: "s1",
    teacher_id: "t1",
    scheduled_at_utc: "2026-06-02T10:00:00Z",
    duration_minutes: 60,
    status: "CANCELLED_BY_STUDENT",
    package_state: null,
    counts: false,
    teacher_pay_percent: null,
    ...over,
  } as PackageLesson;
}

function effect(over: Partial<LessonCountingEffect["student"]> = {}): LessonCountingEffect {
  return {
    blocker: null,
    student: {
      counts_before: false,
      counts_after: true,
      mode: "ADD",
      package: { id: "p2", sequence_no: 2, status: "ACTIVE", label: "8 × 45" },
      will_complete: true,
      reopens: false,
      renewal_undone: false,
      lessons_moved_back: null,
      stays_closed: null,
      ...over,
    },
    teacher: { percent_before: 0, percent_after: 50, amount_before: 0, currency: null, statement: { year: 2026, month: 6, sealed: true }, locked: false },
  };
}

const manager = () => makeSession("ACADEMY_OWNER", { permissions: ["package.manage", "session.bill_override"] });

describe("LessonCountingModal", () => {
  beforeEach(() => {
    previewLessonCounting.mockReset();
    setLessonCounting.mockReset();
    previewLessonCounting.mockResolvedValue(effect());
    setLessonCounting.mockResolvedValue({ ok: true, ...effect() });
  });

  it("says what counting it does — the block, its renewal, the sealed salary month — then saves", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(withAuth(manager(), <LessonCountingModal lesson={lesson()} onClose={() => {}} onSaved={onSaved} />));

    // Nothing changed yet: nothing to save.
    expect(screen.getByTestId("lesson-counting-save")).toBeDisabled();
    await user.click(screen.getByTestId("lesson-counts-yes"));
    await user.click(screen.getByTestId("teacher-share-50"));

    await waitFor(() => expect(previewLessonCounting).toHaveBeenLastCalledWith("se1", true, 50));
    const box = await screen.findByTestId("lesson-counting-effect");
    await waitFor(() => expect(box.textContent).toContain(ar.add.replace("{n}", "2")));
    expect(box.textContent).toContain(ar.willComplete.replace("{n}", "2"));

    await user.click(screen.getByTestId("lesson-counting-save"));
    await waitFor(() => expect(setLessonCounting).toHaveBeenCalledWith("se1", true, 50));
    expect(onSaved).toHaveBeenCalledWith(ar.saved);
  });

  it("will not save what the server says cannot change", async () => {
    previewLessonCounting.mockResolvedValue({ ...effect({ mode: "FINISHED_PLAN" }), blocker: "PACKAGE_CLOSED" });
    const user = userEvent.setup();
    render(withAuth(manager(), <LessonCountingModal lesson={lesson({ counts: true })} onClose={() => {}} onSaved={() => {}} />));

    await user.click(screen.getByTestId("lesson-counts-no"));
    expect(await screen.findByText(ar.blocker.PACKAGE_CLOSED)).toBeInTheDocument();
    expect(screen.getByTestId("lesson-counting-save")).toBeDisabled();
  });
});

describe("LessonCountingAction", () => {
  it("shows how a cancellation stands, and the edit only to whoever may move its money", () => {
    const { rerender } = render(
      withAuth(manager(), <LessonCountingAction lesson={lesson({ counts: true, teacher_pay_percent: 25 })} onChanged={() => {}} />),
    );
    expect(screen.getByTestId("lesson-counting-se1").textContent).toContain(ar.chipCounts);
    expect(screen.getByTestId("lesson-counting-edit-se1")).toBeInTheDocument();

    rerender(withAuth(makeSession("ACADEMY_OWNER", { permissions: ["package.read"] }), <LessonCountingAction lesson={lesson()} onChanged={() => {}} />));
    expect(screen.queryByTestId("lesson-counting-edit-se1")).not.toBeInTheDocument();

    // An attended lesson has nothing to set.
    rerender(withAuth(manager(), <LessonCountingAction lesson={lesson({ status: "ATTENDED" })} onChanged={() => {}} />));
    expect(screen.queryByTestId("lesson-counting-se1")).not.toBeInTheDocument();
  });
});
