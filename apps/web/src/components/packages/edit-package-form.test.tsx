import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import arMessages from "../../../messages/ar.json";
import { makeSession, withAuth } from "@/test/auth";
import type { LessonPackageRow } from "@/lib/api";
import { EditPackageForm } from "./edit-package-form";
import { lessonBalance } from "./lesson-price-fields";

/**
 * Correcting a centre's prepaid subscription (lingo, 2026-11-01): nearly every block has money on
 * it, so the form has to work on one, say what happens to the money, and never move a bill by a
 * rounded lesson price when only the name changed.
 */

const updateLessonPackage = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  updateLessonPackage: (id: string, input: unknown) => updateLessonPackage(id, input),
}));

const ar = arMessages.packages;

function row(over: Partial<LessonPackageRow> = {}): LessonPackageRow {
  return {
    id: "p1",
    label: "برايفت مايا عربي",
    status: "ACTIVE",
    minutes_total: 180,
    minutes_sold: 180,
    minutes_consumed: 60,
    minutes_remaining: 120,
    carried_over_minutes: 0,
    lesson_minutes: 60,
    lesson_count: 1,
    // Three lessons for 1000: one lesson's price does not divide evenly.
    price_minor: 100000,
    hourly_rate_minor: 33333,
    currency: "EGP",
    starts_on: "2026-10-01",
    expires_on: null,
    auto_renew: false,
    invoice_id: "i1",
    invoice_paid_minor: 100000,
    sequence_no: 1,
    next_terms: null,
    ...over,
  } as LessonPackageRow;
}

const centre = () => makeSession("ACADEMY_OWNER", { permissions: ["package.manage"], capabilities: ["centre"] });

describe("EditPackageForm on a centre's paid subscription", () => {
  beforeEach(() => {
    updateLessonPackage.mockReset();
    updateLessonPackage.mockResolvedValue({ ok: true, changed: ["label"], invoice_id: "i1", credited_minor: 0, due_minor: 0 });
  });

  it("offers the edit, says what happens to the money, and keeps the price to the piastre on a rename", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(withAuth(centre(), <EditPackageForm row={row()} onSaved={onSaved} onCancel={() => {}} />));

    expect(screen.getByText(/المدفوع يبقى محسوبًا/)).toBeInTheDocument();
    const label = screen.getByLabelText(ar.form.label);
    await user.clear(label);
    await user.type(label, "برايفت مايا");
    await user.click(screen.getByTestId("save-package-edit"));

    await waitFor(() => expect(updateLessonPackage).toHaveBeenCalled());
    expect(updateLessonPackage.mock.calls[0]?.[1]).toMatchObject({ label: "برايفت مايا", price_minor: 100000, lesson_minutes: 60 });
    expect(onSaved).toHaveBeenCalledWith(ar.alerts.edited);
  });

  it("tells the desk what came back to the family", async () => {
    updateLessonPackage.mockResolvedValue({ ok: true, changed: ["minutes_total"], invoice_id: "i1", credited_minor: 33300, due_minor: 0 });
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(withAuth(centre(), <EditPackageForm row={row()} onSaved={onSaved} onCancel={() => {}} />));

    const lessons = screen.getByTestId("pkg-edit-lessons");
    await user.clear(lessons);
    await user.type(lessons, "2");
    await user.click(screen.getByTestId("save-package-edit"));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(onSaved.mock.calls[0]?.[0]).toContain("رصيدًا للأسرة");
  });
});

describe("lessonBalance", () => {
  it("counts whole lessons when a lesson ran off-length", () => {
    // 4 × 90 sold, one 60-minute and one 90-minute lesson taken.
    expect(lessonBalance({ minutes_sold: 360, minutes_remaining: 210 }, 90)).toEqual({ sold: 4, left: 2, used: 2 });
    expect(lessonBalance({ minutes_sold: 240, minutes_remaining: 0 }, 60)).toEqual({ sold: 4, left: 0, used: 4 });
  });
});
