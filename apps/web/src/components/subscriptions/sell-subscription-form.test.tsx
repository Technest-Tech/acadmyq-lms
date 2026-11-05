import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import arMessages from "../../../messages/ar.json";
import { subRow, studentPick } from "@/components/subscriptions/test-fixtures";
import { ApiError } from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { makeSession, withAuth } from "@/test/auth";
import { SellSubscriptionForm } from "./sell-subscription-form";

/**
 * Selling a block (POST /subscriptions): the student from the contract's picker, the subject from
 * their subjects or a new one, lessons × price with the total following, the warnings a sale needs
 * (subject open, no timetable, pay-first), and the exact payload.
 */
const api = { listSubscriptionStudents: vi.fn(), sellSubscription: vi.fn() };
vi.mock("@/lib/subscriptions-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/subscriptions-api")>()),
  listSubscriptionStudents: (...a: unknown[]) => api.listSubscriptionStudents(...a),
  sellSubscription: (...a: unknown[]) => api.sellSubscription(...a),
}));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  listTeachers: () => Promise.resolve({ rows: [{ id: "t1", full_name: "Mr Ali" }, { id: "t7", full_name: "Mr Hany" }], total: 2, page: 1, pageSize: 200 }),
}));

const ar = arMessages.subscriptions;
const money = (minor: number) => formatMoney({ amount: minor, currency: "EGP" }, "ar");
const session = () => makeSession("ACADEMY_OWNER", { permissions: ["student.read", "teacher.read", "package.read", "package.manage"], capabilities: ["centre"] });

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.listSubscriptionStudents.mockResolvedValue({ rows: [studentPick(), studentPick({ id: "s2", full_name: "Sara", subjects: [], has_timetable_for: [] })] });
  api.sellSubscription.mockResolvedValue({ subscription: subRow(), invoice_id: "i1", due_minor: 72000, warnings: [] });
});

async function pickStudent(name: string) {
  await userEvent.click(await screen.findByTestId("sell-student"));
  // The option's name carries the parent too ("Adam · Umm Adam"), so match the start.
  await userEvent.click(await screen.findByRole("option", { name: new RegExp(`^${name}`) }));
}

describe("SellSubscriptionForm", () => {
  it("sells a student's first free subject: lessons × price makes the total, and the payload is the contract's SellInput", async () => {
    const onSaved = vi.fn();
    render(withAuth(session(), <SellSubscriptionForm onSaved={onSaved} onCancel={() => {}} />));
    await pickStudent("Adam");
    // English (nothing open) is chosen first; Maths says it is open.
    const subject = screen.getByTestId("sell-subject") as HTMLSelectElement;
    expect(subject.value).toBe("t1::english");
    expect(within(subject).getByRole("option", { name: /Maths/ }).textContent).toContain(ar.subject.open);

    await userEvent.type(screen.getByTestId("sell-lessons"), "8");
    await userEvent.selectOptions(screen.getByTestId("sell-length"), "40");
    await userEvent.type(screen.getByTestId("sell-unit-price"), "90");
    expect(screen.getByTestId("sell-total")).toHaveValue(720);
    expect(screen.getByTestId("sell-readout")).toHaveTextContent("8");
    // A deal: the total typed over keeps the lesson price and says so.
    await userEvent.clear(screen.getByTestId("sell-total"));
    await userEvent.type(screen.getByTestId("sell-total"), "700");
    expect(screen.getByTestId("sell-readout")).toHaveTextContent(ar.terms.dealNote);

    await userEvent.click(screen.getByTestId("sell-confirm"));
    await waitFor(() =>
      expect(api.sellSubscription).toHaveBeenCalledWith({ student_id: "s1", teacher_id: "t1", course: "English", lessons_sold: 8, lesson_minutes: 40, lesson_price_minor: 9000, price_minor: 70000 }),
    );
    expect(onSaved).toHaveBeenCalledWith(expect.stringContaining(money(72000)));
  });

  it("refuses a subject that already holds an open block, and warns — with the door to the timetable — when the teacher has none with this student", async () => {
    render(withAuth(session(), <SellSubscriptionForm onSaved={() => {}} onCancel={() => {}} />));
    await pickStudent("Adam");
    await userEvent.selectOptions(screen.getByTestId("sell-subject"), "t2::maths");
    expect(screen.getByTestId("sell-already-open")).toBeTruthy();
    expect(screen.getByTestId("sell-no-timetable")).toBeTruthy();
    expect(within(screen.getByTestId("sell-no-timetable")).getByRole("link")).toHaveAttribute("href", "/students/s1?tab=schedule");
    await userEvent.type(screen.getByTestId("sell-lessons"), "4");
    await userEvent.type(screen.getByTestId("sell-unit-price"), "100");
    expect(screen.getByTestId("sell-confirm")).toBeDisabled();
    await userEvent.selectOptions(screen.getByTestId("sell-subject"), "t1::english");
    expect(screen.queryByTestId("sell-already-open")).toBeNull();
    expect(screen.queryByTestId("sell-no-timetable")).toBeNull();
    expect(screen.getByTestId("sell-confirm")).toBeEnabled();
  });

  // Lingo 2026-11-05: the student takes something else with the same teacher — from the refusal
  // straight to a new subject with that teacher, sold without new_subject (the link exists).
  it("goes from 'already open' to another subject with the same teacher", async () => {
    render(withAuth(session(), <SellSubscriptionForm onSaved={() => {}} onCancel={() => {}} />));
    await pickStudent("Adam");
    await userEvent.selectOptions(screen.getByTestId("sell-subject"), "t2::maths");
    await userEvent.click(screen.getByTestId("sell-same-teacher-other"));

    expect(screen.queryByTestId("sell-already-open")).toBeNull();
    expect(screen.getByTestId("sell-new-subject")).toBeTruthy();
    await userEvent.type(screen.getByTestId("sell-new-course"), "Physics");
    await userEvent.type(screen.getByTestId("sell-lessons"), "4");
    await userEvent.type(screen.getByTestId("sell-unit-price"), "100");
    await userEvent.click(screen.getByTestId("sell-confirm"));

    await waitFor(() =>
      expect(api.sellSubscription).toHaveBeenCalledWith(expect.objectContaining({ student_id: "s1", teacher_id: "t2", course: "Physics", lessons_sold: 4 })),
    );
    expect(api.sellSubscription.mock.calls[0]?.[0]).not.toHaveProperty("new_subject");
  });

  it("sells a new subject — a teacher not yet theirs and a name — with new_subject on the payload", async () => {
    render(withAuth(session(), <SellSubscriptionForm onSaved={() => {}} onCancel={() => {}} />));
    await pickStudent("Sara");
    // No subjects: the picker starts on "new subject".
    expect((screen.getByTestId("sell-subject") as HTMLSelectElement).value).toBe("__new__");
    await userEvent.type(screen.getByTestId("sell-new-course"), "French");
    await waitFor(() => expect(within(screen.getByTestId("sell-new-teacher")).getByRole("option", { name: "Mr Hany" })).toBeTruthy());
    await userEvent.selectOptions(screen.getByTestId("sell-new-teacher"), "t7");
    await userEvent.type(screen.getByTestId("sell-lessons"), "4");
    await userEvent.type(screen.getByTestId("sell-unit-price"), "120");
    await userEvent.type(screen.getByTestId("sell-starts-on"), "2026-11-10");
    await userEvent.click(screen.getByTestId("sell-confirm"));
    await waitFor(() =>
      expect(api.sellSubscription).toHaveBeenCalledWith(expect.objectContaining({ student_id: "s2", teacher_id: "t7", course: "French", new_subject: true, lessons_sold: 4, lesson_price_minor: 12000, price_minor: 48000, starts_on: "2026-11-10" })),
    );
  });

  it("shows the pay-first refusal with the override, and re-sends with override_pay_first", async () => {
    api.sellSubscription.mockRejectedValueOnce(new ApiError(422, "الاشتراك السابق غير مدفوع (فاتورة #12).", { message: "…" }));
    render(withAuth(session(), <SellSubscriptionForm onSaved={() => {}} onCancel={() => {}} />));
    await pickStudent("Adam");
    await userEvent.type(screen.getByTestId("sell-lessons"), "8");
    await userEvent.type(screen.getByTestId("sell-unit-price"), "90");
    await userEvent.click(screen.getByTestId("sell-confirm"));
    expect(await screen.findByText(/#12/)).toBeTruthy();
    const override = await screen.findByTestId("sell-override-pay-first");
    expect(screen.getByTestId("sell-confirm")).toBeDisabled();
    await userEvent.click(within(override).getByRole("checkbox"));
    await userEvent.click(screen.getByTestId("sell-confirm"));
    await waitFor(() => expect(api.sellSubscription).toHaveBeenLastCalledWith(expect.objectContaining({ override_pay_first: true })));
  });

  it("renews from a finished block: the student fixed, the subject and terms already filled", async () => {
    render(withAuth(session(), <SellSubscriptionForm initialStudentId="s1" prefill={subRow({ status: "FINISHED", lessons_sold: 12, lesson_price_minor: 8500, price_minor: 100000 })} onSaved={() => {}} onCancel={() => {}} />));
    await waitFor(() => expect((screen.getByTestId("sell-subject") as HTMLSelectElement).value).toBe("t1::english"));
    expect(screen.getByTestId("sell-lessons")).toHaveValue(12);
    expect(screen.getByTestId("sell-unit-price")).toHaveValue(85);
    expect(screen.getByTestId("sell-total")).toHaveValue(1000);
    expect(screen.getByTestId("sell-confirm")).toHaveTextContent(ar.sell.renewConfirm);
  });
});
